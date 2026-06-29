# VoiceLink Pro — Backend Setup

## Quick Start

### 1. Install
```bash
cd voicelink-backend
npm install
cp .env.example .env
# Fill in your Twilio credentials in .env
```

### 2. Twilio Setup (console.twilio.com)
1. **Account SID + Auth Token** → Dashboard
2. **Buy a number** → Phone Numbers → Buy
3. **API Key** → Settings → API Keys → Create new key
4. **TwiML App** → Voice → TwiML Apps → Create new
   - Voice URL: `https://yourserver.com/api/voice`
5. **Configure your number** → Phone Numbers → your number
   - Voice webhook: `https://yourserver.com/api/incoming`
   - SMS webhook:   `https://yourserver.com/api/sms/incoming`

### 3. Run
```bash
npm run dev    # development
npm start      # production
```

### 4. Deploy on VPS / cPanel Node.js
```bash
# On your server:
git clone your-repo
cd voicelink-backend
npm install
# Set .env variables
node server.js
```

### 5. Use ngrok for local testing
```bash
npx ngrok http 4000
# Copy the https URL and use it in Twilio webhooks
```

## API Endpoints
| Method | URL | Description |
|--------|-----|-------------|
| GET  | /api/token | Get Twilio access token for browser calls |
| POST | /api/voice | TwiML outbound call handler |
| POST | /api/incoming | TwiML incoming call + IVR |
| POST | /api/ivr-route | IVR digit routing |
| POST | /api/sms/send | Send SMS |
| POST | /api/sms/incoming | Incoming SMS webhook |
| GET  | /api/recordings | List all recordings |
| GET  | /api/recordings/:sid/download | Download recording MP3 |
| POST | /api/sip/validate | Validate SIP credentials |
| GET  | /api/health | Health check |
