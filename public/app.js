const state = {
  providerHealth: null,
  aide: null,
  outputLanguage: "English",
  detectedLanguage: { code: "auto", name: "Auto", confidence: 0 },
  mediaRecorder: null,
  audioStream: null,
  audioContext: null,
  analyser: null,
  meterFrame: null,
  recordedChunks: [],
  recordingMimeType: "",
  isRecording: false,
  translation: "",
  currentSubmission: null,
  submissions: [],
  selectedSubmissionId: null,
  bluetoothDevice: null
};

const storageKeys = {
  draft: "careBridge.currentDraft",
  transcript: "careBridge.transcript",
  translation: "careBridge.translation",
  session: "careBridge.session",
  outputLanguage: "careBridge.outputLanguage"
};

const els = {
  screens: {
    login: document.querySelector("#login-screen"),
    language: document.querySelector("#language-screen"),
    setup: document.querySelector("#setup-screen"),
    visit: document.querySelector("#visit-screen"),
    triage: document.querySelector("#triage-screen"),
    clinic: document.querySelector("#clinic-screen")
  },
  providerStatus: document.querySelector("#provider-status"),
  loginForm: document.querySelector("#login-form"),
  aideName: document.querySelector("#aide-name"),
  clinicCode: document.querySelector("#clinic-code"),
  languageList: document.querySelector("#language-list"),
  startSetupButton: document.querySelector("#start-setup-button"),
  bluetoothButton: document.querySelector("#bluetooth-button"),
  bluetoothStatus: document.querySelector("#bluetooth-status"),
  microphoneSelect: document.querySelector("#microphone-select"),
  speakerSelect: document.querySelector("#speaker-select"),
  voiceStatus: document.querySelector("#voice-status"),
  voiceMeter: document.querySelector("#voice-meter"),
  enterAppButton: document.querySelector("#enter-app-button"),
  bottomNav: document.querySelector("#bottom-nav"),
  navItems: [...document.querySelectorAll(".nav-item")],
  visitTitle: document.querySelector("#visit-title"),
  outputLanguageLabel: document.querySelector("#output-language-label"),
  detectedLanguage: document.querySelector("#detected-language"),
  recordButton: document.querySelector("#record-button"),
  recordLabel: document.querySelector("#record-label"),
  recordIcon: document.querySelector("#record-icon"),
  mockButton: document.querySelector("#mock-button"),
  processButton: document.querySelector("#process-button"),
  playTranslationButton: document.querySelector("#play-translation-button"),
  translationConfidence: document.querySelector("#translation-confidence"),
  transcriptInput: document.querySelector("#transcript-input"),
  translationOutput: document.querySelector("#translation-output"),
  urgencyBadge: document.querySelector("#urgency-badge"),
  chiefComplaintLabel: document.querySelector("#chief-complaint-label"),
  chiefComplaintInput: document.querySelector("#chief-complaint-input"),
  formConfidence: document.querySelector("#form-confidence"),
  redFlagList: document.querySelector("#red-flag-list"),
  symptomList: document.querySelector("#symptom-list"),
  clinicalDetailList: document.querySelector("#clinical-detail-list"),
  aiSummary: document.querySelector("#ai-summary"),
  patientAge: document.querySelector("#patient-age"),
  painScore: document.querySelector("#pain-score"),
  heartRate: document.querySelector("#heart-rate"),
  bloodPressure: document.querySelector("#blood-pressure"),
  temperature: document.querySelector("#temperature"),
  oxygen: document.querySelector("#oxygen"),
  triageChecklist: document.querySelector("#triage-checklist"),
  questionList: document.querySelector("#question-list"),
  questionCount: document.querySelector("#question-count"),
  consentCheckbox: document.querySelector("#consent-checkbox"),
  aideNotes: document.querySelector("#aide-notes"),
  reviewStatus: document.querySelector("#review-status"),
  submitButton: document.querySelector("#submit-button"),
  fhirButton: document.querySelector("#fhir-button"),
  refreshDashboardButton: document.querySelector("#refresh-dashboard-button"),
  queueList: document.querySelector("#queue-list"),
  submissionDetail: document.querySelector("#submission-detail"),
  selectedStatus: document.querySelector("#selected-status"),
  fhirOutput: document.querySelector("#fhir-output"),
  speechAudio: document.querySelector("#speech-audio"),
  modal: document.querySelector("#modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalContent: document.querySelector("#modal-content"),
  closeModalButton: document.querySelector("#close-modal-button")
};

const languageCodes = {
  English: "en",
  Spanish: "es",
  French: "fr",
  Hindi: "hi",
  Arabic: "ar",
  Swahili: "sw",
  Portuguese: "pt",
  Mandarin: "zh",
  Ukrainian: "uk",
  Russian: "ru",
  Bengali: "bn",
  Urdu: "ur",
  Vietnamese: "vi",
  Tagalog: "tl",
  "Haitian Creole": "ht",
  Somali: "so",
  Amharic: "am",
  Korean: "ko",
  Japanese: "ja",
  German: "de",
  Italian: "it"
};

const browserMemory = new Map();
const browserStore = {
  getItem: (key) => browserMemory.get(key) || "",
  setItem: (key, value) => browserMemory.set(key, value),
  removeItem: (key) => browserMemory.delete(key)
};

function getSupportedRecordingMimeType() {
  if (!window.MediaRecorder) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/aac"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

const defaultChecklist = [
  { key: "abc", label: "Airway, breathing, circulation danger signs", active: false },
  { key: "mental", label: "Confusion, seizure, fainting, or cannot follow commands", active: false },
  { key: "pain", label: "Severe pain, chest pain, or high-risk complaint", active: false },
  { key: "vitals", label: "Vital signs outside safe range", active: false },
  { key: "walk", label: "Cannot walk or disaster triage concern", active: false }
];

function showScreen(name) {
  Object.entries(els.screens).forEach(([screenName, element]) => {
    element.classList.toggle("is-active", screenName === name);
  });
  const appScreens = ["visit", "triage", "clinic"];
  els.bottomNav.hidden = !appScreens.includes(name);
  els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.screen === name));
  if (name === "clinic") refreshDashboard();
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = label;
}

async function apiJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function checkProviders() {
  const response = await fetch("/api/health");
  state.providerHealth = await response.json();
  const providers = state.providerHealth.providers;
  const enabled = [];
  if (providers.gemma) enabled.push(`Gemma 4 ${providers.gemmaModel || ""}`.trim());
  else if (providers.gemmaConfigured) enabled.push("Gemma 4 ready when local model starts");
  if (providers.openai) enabled.push("OpenAI audio");
  if (providers.elevenlabs) enabled.push("ElevenLabs voice");
  if (providers.clinicSync) enabled.push("Clinic sync");
  els.providerStatus.textContent = enabled.length ? `Live: ${enabled.join(", ")}` : "Mock mode";
}

async function enumerateAudioDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillDeviceSelect(els.microphoneSelect, devices.filter((device) => device.kind === "audioinput"), "Default microphone");
    fillDeviceSelect(els.speakerSelect, devices.filter((device) => device.kind === "audiooutput"), "Default speaker");
  } catch {
    fillDeviceSelect(els.microphoneSelect, [], "Default microphone");
    fillDeviceSelect(els.speakerSelect, [], "Default speaker");
  }
}

function fillDeviceSelect(select, devices, fallbackLabel) {
  select.innerHTML = "";
  const fallback = document.createElement("option");
  fallback.value = "";
  fallback.textContent = fallbackLabel;
  select.append(fallback);
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    showModal("Bluetooth", "This browser does not expose Web Bluetooth. Pair the glasses in phone settings, then choose them as microphone/speaker here.");
    return;
  }
  try {
    state.bluetoothDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["battery_service", "device_information"]
    });
    els.bluetoothStatus.textContent = `${state.bluetoothDevice.name || "Glasses"} connected`;
    state.bluetoothDevice.addEventListener("gattserverdisconnected", () => {
      els.bluetoothStatus.textContent = "Glasses disconnected";
    });
  } catch (error) {
    showModal("Bluetooth", error.message);
  }
}

async function getAudioStream() {
  const deviceId = els.microphoneSelect.value;
  const constraints = {
    audio: deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function startVoiceMeter() {
  try {
    if (state.audioStream) state.audioStream.getTracks().forEach((track) => track.stop());
    state.audioStream = await getAudioStream();
    await enumerateAudioDevices();
    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(state.audioStream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 512;
    source.connect(state.analyser);
    tickVoiceMeter();
  } catch (error) {
    els.voiceStatus.textContent = "Microphone permission needed";
  }
}

function tickVoiceMeter() {
  if (!state.analyser) return;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  const percent = Math.min(100, Math.round((average / 90) * 100));
  els.voiceMeter.style.width = `${Math.max(4, percent)}%`;
  els.voiceStatus.textContent = percent > 28 ? "Speaking detected" : "Listening for speech";
  state.meterFrame = requestAnimationFrame(tickVoiceMeter);
}

async function startRecording() {
  const stream = await getAudioStream();
  state.recordedChunks = [];
  state.recordingMimeType = getSupportedRecordingMimeType();
  state.mediaRecorder = state.recordingMimeType ? new MediaRecorder(stream, { mimeType: state.recordingMimeType }) : new MediaRecorder(stream);
  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordedChunks.push(event.data);
  });
  state.mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach((track) => track.stop());
    await transcribeRecording();
  });
  state.mediaRecorder.start();
  state.isRecording = true;
  els.recordButton.classList.add("recording");
  els.recordLabel.textContent = "Listening...";
  els.recordIcon.textContent = "■";
  els.visitTitle.textContent = "Listening through glasses";
}

function stopRecording() {
  state.mediaRecorder?.stop();
  state.isRecording = false;
  els.recordButton.classList.remove("recording");
  els.recordLabel.textContent = "Transcribing...";
  els.recordIcon.textContent = "●";
}

async function transcribeRecording() {
  try {
    const contentType = state.recordingMimeType || state.mediaRecorder?.mimeType || "application/octet-stream";
    const blob = new Blob(state.recordedChunks, { type: contentType });
    const response = await fetch("/api/transcribe?language=auto", {
      method: "POST",
      headers: { "content-type": contentType },
      body: blob
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Transcription failed");
    if (!payload.text?.trim()) throw new Error("ElevenLabs returned an empty transcript. Try recording a little longer and closer to the microphone.");
    applyDetectedLanguage(payload.languageName || payload.language || "Auto", payload.languageConfidence || 0.8);
    els.providerStatus.textContent = payload.provider === "elevenlabs-scribe" ? `Live: ElevenLabs ${payload.model || "Scribe"}` : `Live: ${payload.provider || "transcription"}`;
    els.transcriptInput.value = payload.text;
    await processTranscript();
  } catch (error) {
    showModal("Transcription", error.message);
  } finally {
    els.recordLabel.textContent = "Tap to speak";
    els.visitTitle.textContent = "Ready to listen";
  }
}

function applyDetectedLanguage(name, confidence) {
  const cleanName = normalizeLanguageName(name);
  state.detectedLanguage = {
    code: languageCodes[cleanName] || cleanName,
    name: cleanName,
    confidence
  };
  els.detectedLanguage.textContent = cleanName;
  els.translationConfidence.textContent = `${Math.round(confidence * 100)}% language`;
}

function normalizeLanguageName(name = "") {
  const lower = String(name).toLowerCase();
  const aliases = {
    ar: "Arabic",
    ara: "Arabic",
    en: "English",
    eng: "English",
    es: "Spanish",
    spa: "Spanish",
    fr: "French",
    fra: "French",
    fre: "French",
    hi: "Hindi",
    hin: "Hindi",
    pt: "Portuguese",
    por: "Portuguese",
    ru: "Russian",
    rus: "Russian",
    sw: "Swahili",
    swa: "Swahili",
    uk: "Ukrainian",
    ukr: "Ukrainian",
    zh: "Mandarin",
    zho: "Mandarin",
    cmn: "Mandarin",
    bn: "Bengali",
    ben: "Bengali",
    ur: "Urdu",
    urd: "Urdu",
    vi: "Vietnamese",
    vie: "Vietnamese",
    tl: "Tagalog",
    fil: "Tagalog",
    ht: "Haitian Creole",
    hat: "Haitian Creole",
    so: "Somali",
    som: "Somali",
    am: "Amharic",
    amh: "Amharic",
    ko: "Korean",
    kor: "Korean",
    ja: "Japanese",
    jpn: "Japanese",
    de: "German",
    deu: "German",
    ger: "German",
    it: "Italian",
    ita: "Italian"
  };
  return aliases[lower] || name || "Auto";
}

async function useSampleSpeech() {
  const response = await fetch("/api/transcribe?language=auto", {
    method: "POST",
    headers: { "content-type": "audio/webm" },
    body: new Blob([])
  });
  const payload = await response.json();
  els.transcriptInput.value = payload.text;
  applyDetectedLanguage(payload.languageName || "Spanish", payload.languageConfidence || 0.9);
  await processTranscript();
}

async function detectTypedLanguage(text) {
  const payload = await apiJson("/api/detect-language", { text });
  applyDetectedLanguage(payload.detected.name, payload.detected.confidence);
  return payload.detected.name;
}

async function processTranscript() {
  const transcript = els.transcriptInput.value.trim();
  if (!transcript) {
    showModal("Missing speech", "Record the patient, tap Sample, or type a transcript first.");
    return;
  }

  setBusy(els.processButton, true, "Analyzing");
  try {
    const sourceLanguage = state.detectedLanguage.name && state.detectedLanguage.name !== "Auto" ? state.detectedLanguage.name : await detectTypedLanguage(transcript);
    const translation = await apiJson("/api/translate", {
      text: transcript,
      sourceLanguage,
      targetLanguage: state.outputLanguage
    });
    state.translation = translation.text;
    els.translationOutput.textContent = translation.text || "Translation unavailable.";

    const extraction = await apiJson("/api/extract", {
      transcript,
      sourceLanguage,
      targetLanguage: state.outputLanguage,
      existingForm: collectSubmissionFromForm()
    });
    if (extraction.provider?.startsWith("gemma4")) {
      els.providerStatus.textContent = `Live: ${extraction.model || "Gemma 4"}`;
    } else if (extraction.fallbackReason) {
      els.providerStatus.textContent = "Triage filled; Gemma slow";
    }
    state.currentSubmission = normalizeSubmission(extraction.submission);
    renderSubmission();
    showScreen("triage");
  } catch (error) {
    showModal("Analysis", error.message);
  } finally {
    setBusy(els.processButton, false, "Analyze");
  }
}

function normalizeSubmission(submission) {
  return {
    triageId: submission.triageId || crypto.randomUUID(),
    patientId: submission.patientId || "local-patient",
    encounterId: submission.encounterId || crypto.randomUUID(),
    sourceLanguage: submission.sourceLanguage || state.detectedLanguage.name,
    targetLanguage: submission.targetLanguage || state.outputLanguage,
    chiefComplaint: submission.chiefComplaint || "",
    urgency: submission.urgency || "gray",
    redFlags: submission.redFlags || [],
    symptoms: submission.symptoms || [],
    vitals: {
      age: submission.vitals?.age || "",
      painScore: submission.vitals?.painScore || "",
      heartRate: submission.vitals?.heartRate || "",
      bloodPressure: submission.vitals?.bloodPressure || "",
      temperature: submission.vitals?.temperature || "",
      oxygenSaturation: submission.vitals?.oxygenSaturation || ""
    },
    allergies: submission.allergies || [],
    medications: submission.medications || [],
    medicalHistory: submission.medicalHistory || [],
    recommendedQuestions: submission.recommendedQuestions || [],
    triageSignals: submission.triageSignals || {},
    triageBasis: submission.triageBasis || [],
    aiSummary: submission.aiSummary || "",
    reviewStatus: submission.reviewStatus || "ai_draft",
    evidence: submission.evidence || els.transcriptInput.value,
    confidence: submission.confidence || 0,
    aideNotes: submission.aideNotes || "",
    consentCaptured: Boolean(submission.consentCaptured),
    updatedAt: submission.updatedAt || new Date().toISOString()
  };
}

function renderSubmission() {
  const submission = state.currentSubmission || normalizeSubmission({});
  const mergedSubmission = collectVisibleVitals(submission);
  els.urgencyBadge.textContent = submission.urgency;
  els.urgencyBadge.className = `urgency ${submission.urgency}`;
  els.chiefComplaintLabel.textContent = submission.chiefComplaint || "No complaint yet";
  els.chiefComplaintInput.value = submission.chiefComplaint || "";
  els.formConfidence.textContent = `${Math.round((submission.confidence || 0) * 100)}% confidence`;
  els.aiSummary.textContent = submission.aiSummary || "No summary yet.";
  els.patientAge.value = mergedSubmission.vitals.age || "";
  els.painScore.value = mergedSubmission.vitals.painScore || "";
  els.heartRate.value = mergedSubmission.vitals.heartRate || "";
  els.bloodPressure.value = mergedSubmission.vitals.bloodPressure || "";
  els.temperature.value = mergedSubmission.vitals.temperature || "";
  els.oxygen.value = mergedSubmission.vitals.oxygenSaturation || "";
  els.consentCheckbox.checked = Boolean(submission.consentCaptured);
  els.reviewStatus.value = submission.reviewStatus;
  els.aideNotes.value = submission.aideNotes || "";
  renderFilledForm(submission);
  renderChecklist(mergedSubmission);
  renderQuestions(submission.recommendedQuestions);
  saveDraft();
}

function collectVisibleVitals(submission) {
  return {
    ...submission,
    vitals: {
      ...(submission.vitals || {}),
      age: submission.vitals?.age || els.patientAge.value.trim(),
      painScore: submission.vitals?.painScore || els.painScore.value.trim(),
      heartRate: submission.vitals?.heartRate || els.heartRate.value.trim(),
      bloodPressure: submission.vitals?.bloodPressure || els.bloodPressure.value.trim(),
      temperature: submission.vitals?.temperature || els.temperature.value.trim(),
      oxygenSaturation: submission.vitals?.oxygenSaturation || els.oxygen.value.trim()
    }
  };
}

function renderFilledForm(submission) {
  const redFlags = submission.redFlags || [];
  els.redFlagList.innerHTML = redFlags.length
    ? redFlags.map((flag) => `<span class="chip">${escapeHtml(flag)}</span>`).join("")
    : `<span class="muted">No red flags extracted.</span>`;

  const symptoms = submission.symptoms || [];
  els.symptomList.innerHTML = symptoms.length
    ? symptoms
        .map(
          (symptom) => `
            <div class="filled-item">
              <strong>${escapeHtml(symptom.name || "Symptom")}</strong>
              <span>${escapeHtml([symptom.duration, symptom.severity].filter(Boolean).join(" | ") || "Duration/severity not captured")}</span>
            </div>
          `
        )
        .join("")
    : `<div class="filled-item muted">No symptoms extracted yet.</div>`;

  const detailGroups = [
    ["Medications", submission.medications || []],
    ["Allergies", submission.allergies || []],
    ["History", submission.medicalHistory || []]
  ];
  els.clinicalDetailList.innerHTML = detailGroups
    .map(([label, values]) => {
      const text = values.length ? values.join(", ") : "Not mentioned";
      return `<div class="filled-item"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(text)}</span></div>`;
    })
    .join("");
}

function renderChecklist(submission) {
  const signals = submission.triageSignals || {};
  const activeText = [
    ...(signals.airwayBreathingCirculation || []),
    ...(signals.neurologic || []),
    ...(signals.painRisk || []),
    ...(signals.infectionDehydration || []),
    ...(signals.maternalChild || []),
    ...(signals.disasterStart || []),
    ...(submission.redFlags || [])
  ].join(" ").toLowerCase();
  const vitalsActive = Number(els.oxygen.value) < 92 && Number(els.oxygen.value) > 0;
  const painActive = Number(els.painScore.value) >= 7;

  const checklist = defaultChecklist.map((item) => ({
    ...item,
    active:
      (item.key === "abc" && /breath|oxygen|bleeding|airway|circulation/.test(activeText)) ||
      (item.key === "mental" && /confused|seizure|mental|commands|unconscious/.test(activeText)) ||
      (item.key === "pain" && (/pain|chest|high-risk/.test(activeText) || painActive)) ||
      (item.key === "vitals" && vitalsActive) ||
      (item.key === "walk" && /walk|disaster/.test(activeText))
  }));

  els.triageChecklist.innerHTML = checklist
    .map(
      (item) => `
        <div class="check-item ${item.active ? "active" : ""}">
          <span class="check-dot">${item.active ? "!" : "✓"}</span>
          <p>${escapeHtml(item.label)}</p>
        </div>
      `
    )
    .join("");
}

function renderQuestions(questions) {
  els.questionList.innerHTML = "";
  els.questionCount.textContent = String(questions.length);
  if (!questions.length) {
    els.questionList.innerHTML = `<div class="list-card muted">Gemma 4 will ask for missing triage details after analysis.</div>`;
    return;
  }

  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "list-card question-card";
    card.innerHTML = `
      <strong>${escapeHtml(question.questionEnglish || "Question")}</strong>
      <p class="muted">${escapeHtml(question.questionPatientLanguage || "")}</p>
      <label>
        Answer
        <input data-question-answer="${index}" value="${escapeAttribute(question.answer || "")}" placeholder="Patient response" />
      </label>
      <div class="question-actions">
        <button class="secondary-button" data-ask-question="${index}">Speak</button>
        <button class="secondary-button" data-append-answer="${index}">Save</button>
      </div>
    `;
    els.questionList.append(card);
  });
}

function collectSubmissionFromForm() {
  const base = state.currentSubmission || normalizeSubmission({});
  const questionInputs = [...document.querySelectorAll("[data-question-answer]")];
  const recommendedQuestions = (base.recommendedQuestions || []).map((question, index) => ({
    ...question,
    answer: questionInputs.find((input) => Number(input.dataset.questionAnswer) === index)?.value || question.answer || ""
  }));

  return {
    ...base,
    chiefComplaint: els.chiefComplaintInput.value.trim() || base.chiefComplaint,
    targetLanguage: state.outputLanguage,
    vitals: {
      age: els.patientAge.value.trim(),
      painScore: els.painScore.value.trim(),
      heartRate: els.heartRate.value.trim(),
      bloodPressure: els.bloodPressure.value.trim(),
      temperature: els.temperature.value.trim(),
      oxygenSaturation: els.oxygen.value.trim()
    },
    recommendedQuestions,
    reviewStatus: els.reviewStatus.value,
    aideNotes: els.aideNotes.value.trim(),
    consentCaptured: els.consentCheckbox.checked,
    updatedAt: new Date().toISOString()
  };
}

function saveDraft() {
  if (state.currentSubmission) {
    browserStore.setItem(storageKeys.draft, JSON.stringify(collectSubmissionFromForm()));
  }
  browserStore.setItem(storageKeys.transcript, els.transcriptInput.value);
  browserStore.setItem(storageKeys.translation, state.translation || "");
  browserStore.setItem(storageKeys.outputLanguage, state.outputLanguage);
  if (state.aide) browserStore.setItem(storageKeys.session, JSON.stringify(state.aide));
}

function restoreDraft() {
  const session = browserStore.getItem(storageKeys.session);
  const outputLanguage = browserStore.getItem(storageKeys.outputLanguage);
  const transcript = browserStore.getItem(storageKeys.transcript);
  const translation = browserStore.getItem(storageKeys.translation);
  const draft = browserStore.getItem(storageKeys.draft);
  if (session) {
    try {
      state.aide = JSON.parse(session);
      els.aideName.value = state.aide.name || "";
      els.clinicCode.value = state.aide.clinic || "";
    } catch {
      state.aide = null;
    }
  }
  if (outputLanguage) setOutputLanguage(outputLanguage);
  if (transcript) els.transcriptInput.value = transcript;
  if (translation) {
    state.translation = translation;
    els.translationOutput.textContent = translation;
  }
  if (draft) {
    try {
      state.currentSubmission = normalizeSubmission(JSON.parse(draft));
      renderSubmission();
    } catch {
      state.currentSubmission = null;
    }
  }
}

function setOutputLanguage(language) {
  state.outputLanguage = language;
  els.outputLanguageLabel.textContent = language;
  [...els.languageList.querySelectorAll(".language-card")].forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.language === language);
  });
  saveDraft();
}

async function setAudioSink(audioElement) {
  const sinkId = els.speakerSelect.value;
  if (sinkId && typeof audioElement.setSinkId === "function") {
    await audioElement.setSinkId(sinkId);
  }
}

async function speakText(text) {
  if (!text) return;
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language: state.detectedLanguage.name })
    });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("audio/")) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      els.speechAudio.src = url;
      await setAudioSink(els.speechAudio);
      els.speechAudio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      await els.speechAudio.play();
      return;
    }
    const payload = await response.json();
    const utterance = new SpeechSynthesisUtterance(payload.text || text);
    utterance.lang = languageCodes[state.detectedLanguage.name] || "en";
    speechSynthesis.speak(utterance);
  } catch (error) {
    showModal("Speaker", error.message);
  }
}

function appendQuestionAnswer(index) {
  const submission = collectSubmissionFromForm();
  const question = submission.recommendedQuestions[index];
  if (!question?.answer) {
    showModal("Missing answer", "Type the patient's response before saving it.");
    return;
  }
  els.transcriptInput.value += `\n\nFollow-up question: ${question.questionEnglish}\nPatient answer: ${question.answer}`;
  question.asked = true;
  submission.recommendedQuestions[index] = question;
  state.currentSubmission = submission;
  renderSubmission();
}

async function submitToClinic() {
  state.currentSubmission = collectSubmissionFromForm();
  if (!state.currentSubmission.consentCaptured) {
    showModal("Consent required", "Capture patient consent before clinic sync.");
    return;
  }
  if (state.currentSubmission.reviewStatus === "ai_draft") {
    showModal("Review required", "Confirm the AI draft or mark it as needing a clinician.");
    return;
  }
  setBusy(els.submitButton, true, "Submitting");
  try {
    const response = await apiJson("/api/sync", state.currentSubmission);
    state.submissions.unshift(response);
    browserStore.removeItem(storageKeys.draft);
    await refreshDashboard();
    showScreen("clinic");
  } catch (error) {
    showModal("Sync", error.message);
  } finally {
    setBusy(els.submitButton, false, "Submit to clinic");
  }
}

async function showFhirForCurrent() {
  const fhir = await apiJson("/api/fhir", collectSubmissionFromForm());
  showModal("FHIR Bundle", JSON.stringify(fhir, null, 2));
}

async function refreshDashboard() {
  const response = await fetch("/api/submissions");
  state.submissions = await response.json();
  renderQueue();
  renderSelectedSubmission();
}

function renderQueue() {
  els.queueList.innerHTML = "";
  if (!state.submissions.length) {
    els.queueList.innerHTML = `<div class="detail-empty">No synced submissions yet.</div>`;
    return;
  }
  if (!state.selectedSubmissionId) state.selectedSubmissionId = state.submissions[0]?.id;
  state.submissions.forEach((record) => {
    const submission = record.submission;
    const card = document.createElement("button");
    card.className = "queue-card";
    card.innerHTML = `
      <strong>${escapeHtml(submission.chiefComplaint || "Triage submission")}</strong>
      <p class="muted">${escapeHtml(submission.sourceLanguage || "Detected")} → ${escapeHtml(submission.targetLanguage || state.outputLanguage)}</p>
      <span class="urgency ${submission.urgency || "gray"}">${escapeHtml(submission.urgency || "gray")}</span>
    `;
    card.addEventListener("click", () => {
      state.selectedSubmissionId = record.id;
      renderSelectedSubmission();
    });
    els.queueList.append(card);
  });
}

function renderSelectedSubmission() {
  const record = state.submissions.find((item) => item.id === state.selectedSubmissionId) || state.submissions[0];
  if (!record) {
    els.selectedStatus.textContent = "None";
    els.submissionDetail.className = "detail-empty";
    els.submissionDetail.textContent = "Submit a triage draft from the visit.";
    els.fhirOutput.hidden = true;
    return;
  }
  const submission = record.submission;
  els.selectedStatus.textContent = record.status;
  els.submissionDetail.className = "detail-grid";
  els.submissionDetail.innerHTML = `
    <p><strong>${escapeHtml(submission.chiefComplaint || "No complaint")}</strong></p>
    <p>${escapeHtml(submission.aiSummary || "")}</p>
    <p class="muted">Red flags: ${escapeHtml((submission.redFlags || []).join(", ") || "None")}</p>
    <p class="muted">Consent: ${submission.consentCaptured ? "Captured" : "Missing"}</p>
  `;
  els.fhirOutput.hidden = false;
  els.fhirOutput.textContent = JSON.stringify(record.fhirBundle, null, 2);
}

function showModal(title, content) {
  els.modalTitle.textContent = title;
  els.modalContent.textContent = content;
  els.modal.showModal();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function bindEvents() {
  els.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.aide = {
      name: els.aideName.value.trim(),
      clinic: els.clinicCode.value.trim()
    };
    saveDraft();
    showScreen("language");
  });
  document.querySelectorAll("[data-back-to]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.backTo));
  });
  els.languageList.addEventListener("click", (event) => {
    const card = event.target.closest(".language-card");
    if (card) setOutputLanguage(card.dataset.language);
  });
  els.startSetupButton.addEventListener("click", async () => {
    showScreen("setup");
    await startVoiceMeter();
  });
  els.bluetoothButton.addEventListener("click", connectBluetooth);
  els.microphoneSelect.addEventListener("change", startVoiceMeter);
  els.enterAppButton.addEventListener("click", () => showScreen("visit"));
  els.navItems.forEach((item) => item.addEventListener("click", () => showScreen(item.dataset.screen)));
  els.recordButton.addEventListener("click", () => {
    if (state.isRecording) stopRecording();
    else startRecording().catch((error) => showModal("Microphone", error.message));
  });
  els.mockButton.addEventListener("click", useSampleSpeech);
  els.processButton.addEventListener("click", processTranscript);
  els.playTranslationButton.addEventListener("click", () => speakText(state.translation));
  els.questionList.addEventListener("click", (event) => {
    const askIndex = event.target.dataset.askQuestion;
    const appendIndex = event.target.dataset.appendAnswer;
    if (askIndex !== undefined) {
      const question = collectSubmissionFromForm().recommendedQuestions[Number(askIndex)];
      speakText(question?.questionPatientLanguage || question?.questionEnglish || "");
    }
    if (appendIndex !== undefined) appendQuestionAnswer(Number(appendIndex));
  });
  els.submitButton.addEventListener("click", submitToClinic);
  els.fhirButton.addEventListener("click", showFhirForCurrent);
  els.refreshDashboardButton.addEventListener("click", refreshDashboard);
  els.closeModalButton.addEventListener("click", () => els.modal.close());
  [els.transcriptInput, els.chiefComplaintInput, els.patientAge, els.painScore, els.heartRate, els.bloodPressure, els.temperature, els.oxygen, els.consentCheckbox, els.aideNotes, els.reviewStatus].forEach((element) => {
    element.addEventListener("input", saveDraft);
    element.addEventListener("change", saveDraft);
  });
}

bindEvents();
restoreDraft();
checkProviders();
enumerateAudioDevices();
