// ═══════════════════════════════════════════════════════════════
// VoiceLink Pro — Complete Backend Server
// Node.js + Express + Twilio
// cPanel compatible — serves React build under /Dialer
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const twilio     = require("twilio");
const bodyParser = require("body-parser");
const path       = require("path");
const fs         = require("fs");

const app = express();

// ── Sub-path config (cPanel URI context = /Dialer) ──────────
const BASE = process.env.BASE_PATH || "/Dialer";

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ── Serve React build statically ────────────────────────────
// Place your React build/ folder inside the same directory as server.js
const buildPath = path.join(__dirname, "build");
if (fs.existsSync(buildPath)) {
  app.use(BASE, express.static(buildPath));
  app.use(express.static(buildPath));
  console.log("✅ React build found — serving from", buildPath);
} else {
  console.log("⚠️  No build/ folder found. Run: npm run build");
}

// ── Root "/" → redirect to /Dialer ──────────────────────────
app.get("/", (req, res) => res.redirect(301, BASE));

// ── GET /Dialer → serve React app ───────────────────────────
app.get(BASE, (req, res) => {
  const idx = path.join(buildPath, "index.html");
  if (fs.existsSync(idx)) {
    return res.sendFile(idx);
  }
  res.send(`
    <html>
    <head><title>VoiceLink Pro</title></head>
    <body style="font-family:sans-serif;background:#0c0c12;color:#e2e8f0;padding:40px;text-align:center;">
      <h2 style="color:#6366f1">VoiceLink Pro Backend ✅</h2>
      <p style="color:#888">Server is running. React build not uploaded yet.</p>
      <p style="color:#555">Upload your <strong>build/</strong> folder next to server.js in cPanel</p>
      <br>
      <a href="${BASE}/api/health" style="color:#6366f1;font-size:14px">Check API Health →</a>
    </body>
    </html>
  `);
});

// ── /Dialer/* → SPA fallback (React Router support) ─────────
app.get(`${BASE}/*`, (req, res, next) => {
  if (req.path.includes("/api/")) return next();
  const idx = path.join(buildPath, "index.html");
  if (fs.existsSync(idx)) return res.sendFile(idx);
  res.redirect(BASE);
});

// ── Twilio Client ────────────────────────────────────────────
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log("✅ Twilio client initialized");
  } else {
    console.log("⚠️  Twilio credentials not set in .env");
  }
} catch(e) {
  console.error("Twilio init error:", e.message);
}

// ── Recordings store ─────────────────────────────────────────
let recordings = [];

// ════════════════════════════════════════════════════════════
// API ROUTES — all under /Dialer/api/ AND /api/ (both work)
// ════════════════════════════════════════════════════════════
const router = express.Router();

// 1. TOKEN — Twilio access token for browser calls
router.get("/token", (req, res) => {
  try {
    if (!twilioClient) return res.status(503).json({ error: "Twilio not configured. Set credentials in .env" });
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant  = AccessToken.VoiceGrant;
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: req.query.identity || "voicelink_user" }
    );
    const grant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });
    token.addGrant(grant);
    res.json({ token: token.toJwt(), identity: token.identity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. VOICE — TwiML outbound call handler
router.post("/voice", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const to    = req.body.To;
  if (!to) { twiml.say("No destination."); return res.type("text/xml").send(twiml.toString()); }
  const dial = twiml.dial({
    callerId: process.env.TWILIO_NUMBER,
    record: "record-from-ringing",
    recordingStatusCallback:      `https://${req.hostname}${BASE}/api/recording-complete`,
    recordingStatusCallbackMethod: "POST",
  });
  if (to.startsWith("sip:")) dial.sip(to);
  else dial.number(to);
  res.type("text/xml").send(twiml.toString());
});

// 3. INCOMING — IVR
router.post("/incoming", (req, res) => {
  const twiml  = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({ numDigits: 1, action: `https://${req.hostname}${BASE}/api/ivr-route`, method: "POST" });
  gather.say({ voice: "Polly.Joanna" }, "Welcome to VoiceLink Pro. Press 1 for Sales, 2 for Support, 3 for Billing.");
  twiml.redirect(`https://${req.hostname}${BASE}/api/incoming`);
  res.type("text/xml").send(twiml.toString());
});

// 4. IVR ROUTE
router.post("/ivr-route", (req, res) => {
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
    twiml.say("Invalid option."); twiml.redirect(`https://${req.hostname}${BASE}/api/incoming`);
  }
  res.type("text/xml").send(twiml.toString());
});

// 5. SEND SMS
router.post("/sms/send", async (req, res) => {
  if (!twilioClient) return res.status(503).json({ error: "Twilio not configured" });
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
    res.status(500).json({ error: err.message });
  }
});

// 6. INCOMING SMS WEBHOOK
router.post("/sms/incoming", (req, res) => {
  const { From, Body } = req.body;
  console.log(`📩 SMS from ${From}: ${Body}`);
  const twiml = new twilio.twiml.MessagingResponse();
  res.type("text/xml").send(twiml.toString());
});

// 7. RECORDING COMPLETE CALLBACK
router.post("/recording-complete", (req, res) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
  recordings.unshift({
    id: RecordingSid,
    callSid: CallSid,
    url: RecordingUrl + ".mp3",
    duration: parseInt(RecordingDuration || 0),
    createdAt: new Date().toISOString(),
  });
  console.log("🎙 Recording saved:", RecordingSid);
  res.sendStatus(200);
});

// 8. GET RECORDINGS LIST
router.get("/recordings", async (req, res) => {
  try {
    if (!twilioClient) return res.json(recordings);
    const list = await twilioClient.recordings.list({ limit: 50 });
    res.json(list.map(r => ({
      id: r.sid,
      callSid: r.callSid,
      url: `https://api.twilio.com${r.uri.replace(".json", ".mp3")}`,
      duration: r.duration,
      createdAt: r.dateCreated,
    })));
  } catch (err) {
    res.json(recordings);
  }
});

// 9. DOWNLOAD RECORDING (proxied)
router.get("/recordings/:sid/download", async (req, res) => {
  if (!twilioClient) return res.status(503).json({ error: "Twilio not configured" });
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${req.params.sid}.mp3`;
    const response = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
      },
    });
    if (!response.ok) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="rec-${req.params.sid}.mp3"`);
    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. SIP VALIDATE — actually tests provided credentials against Twilio API
router.post("/sip/validate", async (req, res) => {
  const { domain, username, password, number } = req.body;
  if (!domain || !username || !password || !number) {
    return res.status(400).json({ valid: false, error: "All fields required" });
  }
  if (!domain.includes(".")) {
    return res.status(400).json({ valid: false, error: "Invalid SIP domain format" });
  }
  if (!username.startsWith("AC") || username.length < 30) {
    return res.status(400).json({ valid: false, error: "SIP Username must be your Twilio Account SID (starts with AC)" });
  }
  if (password.length < 16) {
    return res.status(400).json({ valid: false, error: "SIP Password (Auth Token) appears too short" });
  }
  try {
    // Create a client with the provided credentials to actually test them
    const testClient = twilio(username.trim(), password.trim());
    // Try to fetch the account — this will fail with 401 if credentials are wrong
    const account = await testClient.api.accounts(username.trim()).fetch();
    if (!account || account.status === "suspended") {
      return res.json({ valid: false, error: "Twilio account suspended or not found" });
    }
    // Verify the DID number belongs to this account
    const numbers = await testClient.incomingPhoneNumbers.list({ phoneNumber: number });
    if (numbers.length === 0) {
      return res.json({ valid: false, error: `Number ${number} not found in this Twilio account` });
    }
    res.json({ valid: true, message: `SIP verified ✅ — Account: ${account.friendlyName}` });
  } catch (err) {
    if (err.status === 401 || err.code === 20003) {
      return res.json({ valid: false, error: "Invalid credentials — check your Account SID and Auth Token" });
    }
    res.status(500).json({ valid: false, error: err.message });
  }
});

// 11. HEALTH CHECK
router.get("/health", (req, res) => {
  res.json({
    status:     "ok",
    base_path:  BASE,
    twilio:     !!twilioClient,
    number:     process.env.TWILIO_NUMBER || "not set",
    build:      fs.existsSync(buildPath) ? "found" : "missing",
    timestamp:  new Date().toISOString(),
  });
});

// ── Mount router at BOTH /api and /Dialer/api ────────────────
app.use("/api", router);
app.use(`${BASE}/api`, router);

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 VoiceLink Pro running on port ${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}${BASE}`);
  console.log(`   Health:  http://localhost:${PORT}${BASE}/api/health\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} already in use. Kill the other process and restart.`);
    process.exit(1);
  } else {
    throw err;
  }
});
