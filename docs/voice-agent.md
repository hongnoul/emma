# Voice agent (ElevenLabs Conversational AI) — patient app

The `/patient` Rarepath companion has a voice mode in the AI tab. It uses the
ElevenLabs Agents platform (ASR + LLM + TTS over one WebSocket), billed per
conversation minute against your ElevenLabs credits.

## Architecture

```
ChatTab mic button
  → GET {API_BASE}/v1/voice/signed-url        (backend holds the API key)
  → WebSocket session via @elevenlabs/react
Agent (ElevenLabs cloud)
  → server tool webhook: GET /v1/voice/tools/atlas-brief?q=...
      (search → detail → patient-gated evidence, one call per question)
  → client tool: switch_tab {tab}             (drives the phone UI)
```

Every atlas claim the agent speaks passed `trust.gate(audience="patient")`:
established-only at calibrated ≥0.90 with replicated evidence and no serious
contradiction. Suppressed edges are never put in the agent's context.

## One-time setup

### 1. Create the agent (dashboard → Agents → New agent)

System prompt (paste):

```
You are Rarepath, a warm voice companion for rare-disease patients. You are
speaking with Adira, who is on day 118 of treatment under Dr. Santoso.

Rules:
- You are NOT a diagnostician. Never diagnose, never adjust medication.
  Symptoms get logged and routed to Dr. Santoso.
- For any disease or research question, call the atlas_brief tool and speak
  only from its spoken_brief and facts. If facts are empty, say the evidence
  has not yet passed the patient-safety review and keep it general.
- Always name your source briefly ("according to the Rare Disease Atlas").
- Missed doses: reassure, never advise doubling up, offer a reminder.
- Keep replies under three sentences unless asked for detail. Speak plainly,
  no jargon unless the patient uses it first.
- Use the switch_tab client tool when the patient wants to see something:
  journey, home, chat, community, research.
- If the patient sounds distressed or describes an emergency, tell them to
  contact their physician or emergency services immediately.
```

### 2. Add the server tool

- Type: Webhook, Name: `atlas_brief`
- Description: "Look up a disease, symptom cluster, or research topic in the
  Rare Disease Atlas. Returns a spoken brief plus patient-vetted evidence."
- Method: GET, URL: `https://<your-api-host>/v1/voice/tools/atlas-brief`
- Query param: `q` (string, required) — "disease name or topic to look up"

### 3. Add the client tool

- Name: `switch_tab`, wait for response: yes
- Parameter: `tab` (string) — one of journey, home, chat, community, research

### 4. Enable auth

Agent → Security → enable "Require authentication" so only signed URLs work.

### 5. Env vars

Backend (Fly: `fly secrets set ...`):

```
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_AGENT_ID=agent_...
```

Frontend needs nothing new (`NEXT_PUBLIC_API_BASE` already points at the API).

## Verify

```
curl $API/v1/voice/status           # configured: true
curl $API/v1/voice/signed-url       # signed_url: wss://...
curl "$API/v1/voice/tools/atlas-brief?q=ciliopathy"
```

Then open `/patient?tab=chat`, press the mic, allow the microphone, talk.
Transcripts appear as chat bubbles; "show me my community" should flip tabs.

## Files

- `backend/app/routers/voice.py` — signed-url + atlas-brief tool
- `frontend/components/patient-voice.tsx` — provider, session hook, mic button
- `frontend/app/(atlas)/patient/page.tsx` — ChatTab wiring

## Next phases (not built yet)

- Voice check-in: client tools to pre-fill the ResearchTab form (symptoms,
  severity, doses) with the consent gate enforced in the prompt.
- Bahasa Indonesia voice + language detection for the Adira persona.
- Spoken daily-support toast and "read this study" on the research feed.
