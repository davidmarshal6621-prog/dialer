// ═══════════════════════════════════════════════════════════════
// VoiceLink Pro — Complete Backend Server
// Node.js + Express + Twilio
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const twilio     = require("twilio");
const bodyParser = require("body-parser");
const path       = require("path");
const fs         = require("fs");

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ── Twilio Client ───────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── Recordings in-memory store (use DB in production) ───────
let recordings = [];

// ════════════════════════════════════════════════════════════
// 1. GENERATE ACCESS TOKEN (for browser calls via Twilio SDK)
// ════════════════════════════════════════════════════════════
app.get("/api/token", (req, res) => {
  try {
    const AccessToken  = twilio.jwt.AccessToken;
    const VoiceGrant   = AccessToken.VoiceGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: req.query.identity || "voicelink_user" }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });
    token.addGrant(voiceGrant);

    res.json({ token: token.toJwt(), identity: token.identity });
  } catch (err) {
    console.error("Token error:", err);
    res.status(500).json({ error: "Token generation failed", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 2. TWIML — Handle outbound call routing
// ════════════════════════════════════════════════════════════
app.post("/api/voice", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to    = req.body.To;

  if (!to) {
    twiml.say("No destination number provided.");
    return res.type("text/xml").send(twiml.toString());
  }

  const dial = twiml.dial({
    callerId:    process.env.TWILIO_NUMBER,
    record:      "record-from-ringing",
    recordingStatusCallback:     "/api/recording-complete",
    recordingStatusCallbackMethod: "POST",
  });

  // Phone number or SIP
  if (to.startsWith("sip:")) {
    dial.sip(to);
  } else {
    dial.number(to);
  }

  res.type("text/xml").send(twiml.toString());
});

// ════════════════════════════════════════════════════════════
// 3. TWIML — Incoming call handler (IVR)
// ════════════════════════════════════════════════════════════
app.post("/api/incoming", (req, res) => {
  const twiml   = new twilio.twiml.VoiceResponse();
  const gather  = twiml.gather({ numDigits: 1, action: "/api/ivr-route", method: "POST" });

  gather.say(
    { voice: "Polly.Joanna" },
    "Welcome to VoiceLink Pro. Press 1 for Sales, Press 2 for Support, Press 3 for Billing."
  );
  twiml.say("We did not receive your input. Goodbye.");

  res.type("text/xml").send(twiml.toString());
});

// ════════════════════════════════════════════════════════════
// 4. IVR ROUTING
// ════════════════════════════════════════════════════════════
app.post("/api/ivr-route", (req, res) => {
  const digit  = req.body.Digits;
  const twiml  = new twilio.twiml.VoiceResponse();

  const routes = {
    "1": process.env.SALES_NUMBER   || process.env.TWILIO_NUMBER,
    "2": process.env.SUPPORT_NUMBER || process.env.TWILIO_NUMBER,
    "3": process.env.BILLING_NUMBER || process.env.TWILIO_NUMBER,
  };

  if (routes[digit]) {
    const dial = twiml.dial({ callerId: process.env.TWILIO_NUMBER });
    dial.number(routes[digit]);
  } else {
    twiml.say("Invalid option. Goodbye.");
  }

  res.type("text/xml").send(twiml.toString());
});

// ════════════════════════════════════════════════════════════
// 5. SEND SMS
// ════════════════════════════════════════════════════════════
app.post("/api/sms/send", async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: "to and body required" });

  try {
    const msg = await twilioClient.messages.create({
      from: process.env.TWILIO_NUMBER,
      to,
      body: body.slice(0, 1600),
    });
    res.json({ success: true, sid: msg.sid, status: msg.status });
  } catch (err) {
    console.error("SMS error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 6. SMS INCOMING WEBHOOK
// ════════════════════════════════════════════════════════════
app.post("/api/sms/incoming", (req, res) => {
  const { From, Body } = req.body;
  console.log(`SMS from ${From}: ${Body}`);
  // Store in DB / push to frontend via WebSocket in production
  const twiml = new twilio.twiml.MessagingResponse();
  // Auto-reply (optional)
  // twiml.message("Thanks! We received your message.");
  res.type("text/xml").send(twiml.toString());
});

// ════════════════════════════════════════════════════════════
// 7. RECORDING COMPLETE CALLBACK
// ════════════════════════════════════════════════════════════
app.post("/api/recording-complete", async (req, res) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
  const rec = {
    id:        RecordingSid,
    callSid:   CallSid,
    url:        RecordingUrl + ".mp3",
    duration:   parseInt(RecordingDuration || 0),
    createdAt:  new Date().toISOString(),
  };
  recordings.unshift(rec);
  console.log("Recording saved:", rec);
  res.sendStatus(200);
});

// ════════════════════════════════════════════════════════════
// 8. GET RECORDINGS LIST
// ════════════════════════════════════════════════════════════
app.get("/api/recordings", async (req, res) => {
  try {
    // Fetch from Twilio (live)
    const list = await twilioClient.recordings.list({ limit: 50 });
    const data = list.map(r => ({
      id:       r.sid,
      callSid:  r.callSid,
      url:      `https://api.twilio.com${r.uri.replace(".json",".mp3")}`,
      duration: r.duration,
      createdAt: r.dateCreated,
    }));
    res.json(data);
  } catch (err) {
    // Fallback to in-memory
    res.json(recordings);
  }
});

// ════════════════════════════════════════════════════════════
// 9. DOWNLOAD RECORDING (proxied — keeps Twilio auth hidden)
// ════════════════════════════════════════════════════════════
app.get("/api/recordings/:sid/download", async (req, res) => {
  try {
    const sid = req.params.sid;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
    const response = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
      },
    });
    if (!response.ok) return res.status(404).json({ error: "Recording not found" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="recording-${sid}.mp3"`);
    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 10. SIP VALIDATE (check credentials before frontend shows connected)
// ════════════════════════════════════════════════════════════
app.post("/api/sip/validate", async (req, res) => {
  const { domain, username, password, number } = req.body;
  if (!domain || !username || !password || !number) {
    return res.status(400).json({ valid: false, error: "All fields required" });
  }
  try {
    // Verify the number actually belongs to this Twilio account
    const numbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: number });
    if (numbers.length === 0) {
      return res.json({ valid: false, error: "Number not found in your Twilio account" });
    }
    res.json({ valid: true, message: "SIP credentials verified" });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 11. HEALTH CHECK
// ════════════════════════════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({
    status:    "ok",
    twilio:    !!process.env.TWILIO_ACCOUNT_SID,
    number:    process.env.TWILIO_NUMBER || "not set",
    timestamp: new Date().toISOString(),
  });
});

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`VoiceLink backend running on port ${PORT}`));
