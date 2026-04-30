# Care Bridge Gemma 4 Prototype

Care Bridge is a local-first smart-glasses medical translation and triage demo for the Gemma 4 Good Hackathon. The glasses are treated as a low-cost Bluetooth microphone/speaker accessory. The phone or local web app captures speech, translates it, asks AI-generated follow-up questions in the patient's language, extracts structured triage data with Gemma 4, and syncs a FHIR-style bundle to a clinic dashboard.

## What is implemented

- Phone-shaped app flow: login, output language selection, glasses/audio setup, live visit, triage review, and clinic sync.
- Field app UI for live visit capture.
- Audio recording from the browser microphone.
- Browser audio-device selection for paired Bluetooth microphones/speakers.
- Web Bluetooth hook for BLE glasses controls/battery where supported.
- Simple voice activity meter for speaking detection.
- Automatic spoken-language detection in mock mode, with OpenAI transcription auto-detect hook when configured.
- Mock transcription when no API key is present.
- OpenAI transcription endpoint hook when `OPENAI_API_KEY` is present.
- Translation endpoint hook with mock fallback.
- Gemma 4 clinical extraction endpoint with local Ollama support, OpenAI-compatible endpoint support, strict JSON parsing, and mock fallback.
- Gemma 4 translation fallback when OpenAI translation is not configured.
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

If `npm start` says the script is missing, you are not in this project folder. Run:

```bash
cd /Users/vasilisabaginskaya/Documents/Codex/2026-04-27/your-mission-is-to-create-a
npm start
```

## Optional environment variables

```bash
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_VOICE_ID=...
GEMMA_PROVIDER=ollama
GEMMA_MODEL=gemma4:e4b
OLLAMA_URL=http://127.0.0.1:11434/api/chat
CLINIC_SYNC_URL=https://example-clinic.test/fhir
CLINIC_SYNC_ENABLED=true
PORT=3000
```

You can put those values in a local `.env` file in this project directory. The server loads `.env` automatically and does not print secret values.

If keys are missing, the **Sample** button stays usable for demos. Real microphone transcription requires `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`; ElevenLabs Scribe is used first when configured.

## Connect Gemma 4 locally

Recommended local setup:

```bash
ollama pull gemma4:e4b
ollama serve
npm start
```

If `ollama` is not installed on macOS and Homebrew exists:

```bash
brew install ollama
```

Then open a separate terminal for `ollama serve`, and run `npm start` from this project directory in another terminal.

If both `brew` and `ollama` are missing, install Ollama from the official macOS download at https://ollama.com/download, then open a new terminal and run:

```bash
ollama pull gemma4:e4b
ollama serve
```

The server will call Ollama at `http://127.0.0.1:11434/api/chat` by default. Use `gemma4:e2b` for weaker phones/laptops and `gemma4:26b` or `gemma4:31b` for stronger demo machines.

For a hosted or OpenAI-compatible Gemma endpoint:

```bash
GEMMA_PROVIDER=openai-compatible
GEMMA_API_URL=http://localhost:11434/v1/chat/completions
GEMMA_MODEL=gemma4:e4b
npm start
```

Set `GEMMA_PROVIDER=mock` to force mock mode.

## Recommended demo flow

1. Log in as a medical aide.
2. Choose the language the aide wants output translated to.
3. Pair/select the glasses microphone and speaker.
4. Start the visit and click **Sample** or record audio.
5. Let the app detect the patient's spoken language automatically.
6. Review the red/yellow/green triage draft.
7. Use **Speak** on follow-up questions to ask the patient in their language.
8. Capture consent, change review status, and submit to clinic.
9. Review the synced record and FHIR JSON in the Clinic tab.

## Triage basis

The prototype uses a simplified aide-facing triage form inspired by:

- WHO/ICRC/MSF Interagency Integrated Triage Tool: red/yellow/green acuity sorting for routine and mass-casualty triage.
- AHRQ Emergency Severity Index: immediate danger, high-risk symptoms, pain/distress, vital signs, and resource need.
- HHS/CHEMM START: walking, breathing, perfusion, and mental-status cues for mass-casualty mode.

The model output remains an AI-assisted draft until an aide confirms it.

## HIPAA and filesystem handling

This browser prototype is for hackathon demonstration, not a legal certification of HIPAA compliance. The current web client keeps draft transcript/form data in memory only, not `localStorage` or `sessionStorage`, and the Node server keeps submitted records in memory only. The app does not intentionally write PHI into project files.

Current safeguards in the prototype:

- Localhost-only binding by default via `HOST=127.0.0.1`.
- No raw audio storage after transcription.
- No persistent browser storage for transcript/form drafts.
- No server-side file writes for patient submissions.
- `Cache-Control: no-store` on API and static responses.
- Security headers including CSP, `nosniff`, `no-referrer`, and frame blocking.
- Request body size limit via `MAX_REQUEST_BYTES`.
- Clinic sync disabled unless both `CLINIC_SYNC_URL` and `CLINIC_SYNC_ENABLED=true` are set.

For production:

- Store PHI only in encrypted mobile storage such as SQLCipher, Android Keystore/iOS Keychain-wrapped keys, or an encrypted FHIR store.
- Do not store raw audio by default. Process it, extract the minimal required facts, then discard audio unless explicit consent/policy requires retention.
- Encrypt queued sync bundles at rest and transmit only over TLS.
- Keep audit events for record create/view/edit/sync/delete.
- Add role-based access, device registration, remote wipe, retention limits, and patient consent capture.
- Use BAAs and appropriate privacy/security review for any provider that receives PHI.
- Avoid putting PHI in logs, filenames, URLs, git repos, analytics, crash reports, or browser persistent storage.

## Production notes

The prototype intentionally labels AI output as a draft. A medical aide must review and confirm before sync. For a real deployment, add SQLCipher or platform keystore encryption, authenticated user accounts, audit-log persistence, clinic endpoint authentication, device registration, retention controls, and formal HIPAA/BAA review for any cloud provider that processes PHI.
