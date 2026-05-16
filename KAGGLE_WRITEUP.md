# Care Bridge: Earpiece Translation and Triage with Gemma

## Project Summary

Care Bridge is a local-first medical intake prototype for clinics, mobile health teams, and emergency aid settings where language access and clinician time are both limited. The system pairs a simple Bluetooth earpiece with a microphone and speaker to a phone-style web app. A medical aide can capture patient speech, translate it, play follow-up questions through the earpiece speaker, generate a structured triage draft, and sync a FHIR-style record to a clinic dashboard.

The goal is not to replace a clinician. The goal is to help an aide collect the right facts faster, in the right language, while clearly marking the result as an AI-assisted draft that must be reviewed before submission.

## Problem

Many frontline care settings face three problems at once:

- Patients and aides may not share a language.
- Clinicians are scarce, especially during surge events or in rural/mobile clinics.
- Intake information often arrives unstructured, incomplete, or delayed.

Even when translation tools exist, they usually stop at raw translation. Care Bridge goes a step further: it turns a short spoken complaint into an aide-reviewed triage draft with red/yellow/green urgency, red flags, missing details, follow-up questions, and a structured handoff.

## Solution

Care Bridge uses a discreet Bluetooth earpiece as the real-world interaction layer and a phone web app as the intelligence layer.

The demo flow:

1. The aide logs in and chooses their output language.
2. The aide pairs or selects an earpiece microphone and speaker, or skips hardware setup for the local demo.
3. The patient speaks naturally in their language.
4. The app detects the patient language and translates the complaint for the aide.
5. Gemma extracts a triage draft: chief complaint, urgency, symptoms, red flags, vitals, and follow-up questions.
6. The aide reviews the draft, captures consent, and confirms or escalates it.
7. The clinic dashboard receives an in-memory record and FHIR-style bundle.

The prototype runs locally by default and includes a fast local demo mode. For a convincing live voice demo, configure a free ElevenLabs account API key so the app can use ElevenLabs Scribe for speech-to-text and ElevenLabs speech for playback through the earpiece speaker.

## How We Use Gemma

Gemma is used as the clinical reasoning and structure layer. In live mode, the server can call Gemma through local Ollama or an OpenAI-compatible endpoint. The configured model is `gemma4:e2b`, chosen because it is more practical for lightweight local demos and constrained hardware.

Gemma receives the transcript, source language, target language, and any existing form fields. It is prompted to return strict JSON only, without diagnosing or inventing facts. The extracted schema includes:

- `chiefComplaint`
- `urgency`
- `redFlags`
- `symptoms`
- `vitals`
- `allergies`
- `medications`
- `medicalHistory`
- `triageSignals`
- `recommendedQuestions`
- `aiSummary`
- `confidence`

The server normalizes Gemma output so the app can render a consistent triage form from local Ollama or an OpenAI-compatible Gemma endpoint. In production mode, the model provider should be required and monitored rather than silently replaced.

## Why an Earpiece

The earpiece framing makes the prototype feel closer to a real deployment:

- It is cheap, familiar, and easy to pair with a phone.
- It keeps the aide's hands free during intake.
- Its built-in speaker can play follow-up questions aloud in the patient's language.
- It avoids requiring specialized wearable displays or new clinical hardware.
- It fits naturally into community health, pop-up clinic, ambulance, and disaster response workflows.

The phone remains the source of truth. The earpiece is the low-friction capture and playback layer: microphone input from the patient side, speaker output for translated prompts and follow-up questions.

## Technical Architecture

The prototype is intentionally small:

- `server.js`: Node.js HTTP server, static file serving, provider endpoints, Gemma extraction, translation, speech, sync, and FHIR bundle generation.
- `public/index.html`: phone-shaped app shell.
- `public/app.js`: app state, recording, mock sample flow, triage review, consent gate, and clinic dashboard.
- `public/styles.css`: responsive mobile UI styling.
- `.env.example`: optional live-provider configuration.

Provider paths:

- Transcription: local sample by default, ElevenLabs Scribe or OpenAI when configured.
- Translation: mock by default, OpenAI or Gemma fallback when configured.
- Extraction: Gemma through Ollama or OpenAI-compatible endpoints for live model runs.
- Speech: browser speech synthesis by default, ElevenLabs playback through the selected earpiece speaker when configured.
- Sync: in-memory by default, optional external FHIR endpoint.

## What Makes It Useful

Care Bridge is designed around the messy middle of care delivery: before a clinician sees the patient, but after someone needs to decide whether the situation is urgent.

The prototype helps by:

- Highlighting red flags such as chest pain and shortness of breath.
- Creating patient-language follow-up questions.
- Keeping the aide in control of review and submission.
- Producing a structured record instead of a loose transcript.
- Supporting offline-first or local-first demonstrations.
- Making the demo runnable with one command.

## Production Readiness

To become production ready, Care Bridge needs the following controls as part of the deployed system, not only as documentation:

- Authentication: verified user accounts for aides, clinicians, and administrators.
- Access controls: role-based permissions so aides can draft intake records, clinicians can approve them, and administrators can manage devices without seeing unnecessary patient details.
- Audit logs: immutable create/view/edit/sync/delete events with user, device, timestamp, and reason metadata.
- Retention policies: configurable expiration and deletion rules for transcripts, audio, drafts, submitted records, and audit data.
- Device management: registered earpieces and phones, pairing records, device health, firmware/version metadata, and the ability to disable lost devices.
- Remote wipe: a server-side command path to revoke a device session and erase locally queued patient data.
- Clinical validation: testing against reviewed intake scenarios, red-flag sensitivity analysis, multilingual safety review, and clinician signoff before real patient use.
- Secure storage: encrypted local queues and encrypted server-side persistence.
- Provider governance: BAAs or equivalent legal/privacy review for any speech, model, or sync provider that handles protected health information.

## Safety and Privacy

The app treats AI output as a draft. The aide must review the form, capture consent, and change the review status before clinic sync.

The local demo does not intentionally store patient data in files or browser persistent storage. Submitted records live in server memory only. API and static responses include `Cache-Control: no-store`, and clinic sync is disabled unless explicitly configured.

This is not a production medical device or HIPAA-certified system yet. The controls above are required before use with real patients.

## Demo Instructions

Run:

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Recommended demo:

1. Log in with any aide name and clinic code.
2. Keep English as the output language.
3. Click through the earpiece setup screen.
4. On the visit screen, click **Sample**.
5. Show the Spanish transcript, English translation, red urgency, and follow-up questions.
6. Capture consent and change review status to **Aide confirmed**.
7. Submit to clinic.
8. Show the FHIR-style bundle in the Clinic tab.

For live Gemma:

```bash
ollama pull gemma4:e2b
ollama serve
npm run gemma:ollama
```

For live earpiece speech capture and playback, create an ElevenLabs account, generate an API key, and set it in `.env`:

```bash
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_VOICE_ID=hpp4J3VqNfWAUOO0d1Us
```

## Future Work

The next version would focus on making this field-ready:

- Real mobile packaging as a PWA or native app.
- Better language coverage and dialect handling.
- Model evaluation against synthetic and clinician-reviewed intake cases.
- Offline encrypted queueing for sync.
- Role-based clinic dashboard.
- Audit logs and consent history.
- Device pairing polish for commodity Bluetooth earpieces.
- More complete FHIR mapping.

## Closing

Care Bridge shows how Gemma can act as a practical local reasoning layer inside a low-cost clinical workflow. The prototype starts with a simple patient complaint and ends with a reviewed, structured, clinic-ready draft. That small bridge between speech and usable triage data is where the project can have real-world impact.
