# Care Bridge Gemma 4 Prototype

Care Bridge is a local-first smart-glasses medical translation and triage demo for the Gemma 4 Good Hackathon. The glasses are treated as a low-cost Bluetooth microphone/speaker accessory. The phone or local web app captures speech, translates it, asks AI-generated follow-up questions in the patient's language, extracts structured triage data with Gemma 4, and syncs a FHIR-style bundle to a clinic dashboard.

## What is implemented

- Field app UI for live visit capture.
- Audio recording from the browser microphone.
- Mock transcription when no API key is present.
- OpenAI transcription endpoint hook when `OPENAI_API_KEY` is present.
- Translation endpoint hook with mock fallback.
- Gemma 4 clinical extraction endpoint hook with mock fallback.
- Follow-up question loop in the patient's language.
- ElevenLabs speech endpoint hook with browser speech fallback.
- Editable triage submission form.
- Consent gate before clinic sync.
- Localhost clinic dashboard.
- FHIR Bundle export.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

## Optional environment variables

```bash
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
GEMMA_API_URL=http://localhost:11434/v1/chat/completions
GEMMA_API_KEY=...
CLINIC_SYNC_URL=https://example-clinic.test/fhir
PORT=3000
```

If keys are missing, the app stays fully usable in mock mode for demos.

## Recommended demo flow

1. Open the Field App.
2. Click **Use Sample Speech**.
3. Click **Translate + Extract**.
4. Review the red triage draft.
5. Click **Speak to Patient** on a follow-up question.
6. Type the patient's answer and click **Add Answer to Transcript**.
7. Process again to update the draft.
8. Capture consent, change review status, and submit to clinic.
9. Review the synced record and FHIR JSON in the Clinic Dashboard.

## Production notes

The prototype intentionally labels AI output as a draft. A medical aide must review and confirm before sync. For a real deployment, add SQLCipher or platform keystore encryption, authenticated user accounts, audit-log persistence, clinic endpoint authentication, device registration, retention controls, and formal HIPAA/BAA review for any cloud provider that processes PHI.
