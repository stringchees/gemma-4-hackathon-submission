# Care Bridge Gemma 4 Prototype

Care Bridge is a Bluetooth earpiece medical translation and triage demo for the Gemma 4 Good Hackathon. The web app simulates a phone connected to a discreet low-cost earpiece with a microphone and speaker, captures or samples patient speech, translates it, plays follow-up prompts through the earpiece speaker, drafts red/yellow/green triage with Gemma 4-compatible extraction, and exports a FHIR-style clinic bundle.

## One-command demo

Requirements: Node.js 20 or newer.

```bash
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The default run is intentionally fast and local: it uses local sample transcription, local translation/extraction fallbacks, browser speech synthesis, and in-memory clinic storage. No API keys, npm install, Ollama model, microphone permission, or paired earpiece are required for the basic demo.

## Demo script

1. Log in with any aide name and clinic code.
2. Choose the aide's output language, usually English.
3. On the earpiece setup screen, click **Start visit**. Microphone testing is optional.
4. Click **Sample** on the visit screen.
5. Review the generated red triage draft and follow-up questions.
6. Check **Consent captured** and change **Review** to **Aide confirmed** or **Needs clinician**.
7. Click **Submit to clinic**.
8. Open the Clinic tab to view the stored record and FHIR bundle.

## Useful commands

```bash
npm start          # Fast local demo, mock providers by default
npm run demo       # Explicit mock demo mode
npm run gemma:ollama
npm run check      # Syntax-check the server and browser app
```

`npm run gemma:ollama` expects Ollama to be running with a compatible Gemma model.

For the most convincing live earpiece demo, create a free ElevenLabs account, generate an API key, and add it to `.env`. The app uses that key for ElevenLabs Scribe speech-to-text and ElevenLabs speech playback through the selected earpiece speaker.

## Optional live providers

Create a local `.env` from `.env.example` when you want real services:

```bash
cp .env.example .env
```

Common settings:

```bash
GEMMA_PROVIDER=ollama
GEMMA_MODEL=gemma4:e2b
OLLAMA_URL=http://127.0.0.1:11434/api/chat

ELEVENLABS_API_KEY=...
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_VOICE_ID=hpp4J3VqNfWAUOO0d1Us

OPENAI_API_KEY=...
CLINIC_SYNC_URL=https://example-clinic.test/fhir
CLINIC_SYNC_ENABLED=true
PORT=3000
HOST=127.0.0.1
```

For local Gemma through Ollama:

```bash
ollama pull gemma4:e2b
ollama serve
npm run gemma:ollama
```

For an OpenAI-compatible Gemma endpoint:

```bash
GEMMA_PROVIDER=openai-compatible
GEMMA_API_URL=http://localhost:11434/v1/chat/completions
GEMMA_MODEL=gemma4:e2b
npm start
```

Set `GEMMA_PROVIDER=mock` to force the fast local demo.

## What is implemented

- Phone-shaped field app: login, language selection, optional earpiece/audio setup, live visit, triage review, and clinic dashboard.
- Browser microphone recording and audio-device selection when live audio is desired.
- Web Bluetooth hook for earpiece BLE controls or battery where supported.
- Earpiece speaker selection for patient-language prompt playback.
- Mock transcription when no API key is present, plus ElevenLabs Scribe and OpenAI transcription hooks.
- Mock translation, OpenAI translation hook, and Gemma translation fallback.
- Gemma 4 clinical extraction through local Ollama, OpenAI-compatible endpoints, strict JSON parsing, and mock fallback.
- Follow-up question loop in the patient's language.
- ElevenLabs speech hook with browser speech fallback.
- Editable triage form, consent gate, in-memory clinic sync, and FHIR Bundle export.

## Production readiness

Before use with real patients, the deployed system needs:

- Authentication for aides, clinicians, and administrators.
- Role-based access controls for draft, review, sync, and admin actions.
- Immutable audit logs for create, view, edit, sync, delete, login, and device events.
- Retention policies for transcripts, audio, drafts, synced records, and audit data.
- Device management for registered earpieces and phones.
- Remote wipe and session revocation for lost or retired devices.
- Clinical validation against reviewed multilingual intake scenarios.
- Encrypted local queues and encrypted server-side persistence.
- Formal privacy/security review and provider agreements for any service that processes protected health information.

## Privacy notes

This is a hackathon prototype, not a HIPAA-certified product. The default localhost demo stores submitted records only in server memory and does not intentionally write patient data to files or browser persistent storage.

Current safeguards include localhost binding by default, no raw audio storage after transcription, `Cache-Control: no-store`, basic security headers, a request-size limit, and clinic sync disabled unless explicitly configured.

The prototype is not yet a certified production medical device. The production controls above must be implemented and validated before real patient use.
