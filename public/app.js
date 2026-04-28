const state = {
  providerHealth: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  translation: "",
  currentSubmission: null,
  submissions: [],
  selectedSubmissionId: null
};

const storageKeys = {
  draft: "careBridge.currentDraft",
  transcript: "careBridge.transcript",
  translation: "careBridge.translation"
};

const els = {
  tabs: [...document.querySelectorAll(".tab")],
  views: {
    field: document.querySelector("#field-view"),
    clinic: document.querySelector("#clinic-view"),
    architecture: document.querySelector("#architecture-view")
  },
  providerStatus: document.querySelector("#provider-status"),
  sourceLanguage: document.querySelector("#source-language"),
  targetLanguage: document.querySelector("#target-language"),
  recordButton: document.querySelector("#record-button"),
  mockButton: document.querySelector("#mock-button"),
  processButton: document.querySelector("#process-button"),
  playTranslationButton: document.querySelector("#play-translation-button"),
  transcriptInput: document.querySelector("#transcript-input"),
  translationOutput: document.querySelector("#translation-output"),
  urgencyBadge: document.querySelector("#urgency-badge"),
  chiefComplaint: document.querySelector("#chief-complaint"),
  reviewStatus: document.querySelector("#review-status"),
  heartRate: document.querySelector("#heart-rate"),
  bloodPressure: document.querySelector("#blood-pressure"),
  temperature: document.querySelector("#temperature"),
  oxygen: document.querySelector("#oxygen"),
  aiSummary: document.querySelector("#ai-summary"),
  symptomList: document.querySelector("#symptom-list"),
  questionList: document.querySelector("#question-list"),
  questionCount: document.querySelector("#question-count"),
  addSymptomButton: document.querySelector("#add-symptom-button"),
  consentCheckbox: document.querySelector("#consent-checkbox"),
  aideNotes: document.querySelector("#aide-notes"),
  submitButton: document.querySelector("#submit-button"),
  fhirButton: document.querySelector("#fhir-button"),
  refreshDashboardButton: document.querySelector("#refresh-dashboard-button"),
  queueList: document.querySelector("#queue-list"),
  submissionDetail: document.querySelector("#submission-detail"),
  selectedStatus: document.querySelector("#selected-status"),
  fhirOutput: document.querySelector("#fhir-output"),
  modal: document.querySelector("#modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalContent: document.querySelector("#modal-content"),
  closeModalButton: document.querySelector("#close-modal-button")
};

const languageCodes = {
  English: "en",
  Spanish: "es",
  French: "fr",
  Hindi: "hi"
};

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (label) button.textContent = label;
}

function getSourceLanguageCode() {
  const selected = els.sourceLanguage.selectedOptions[0];
  return selected?.dataset.code || languageCodes[els.sourceLanguage.value] || "es";
}

async function apiJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
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
  const enabled = Object.entries(providers)
    .filter(([, value]) => value)
    .map(([key]) => key);
  els.providerStatus.textContent = enabled.length ? `Live: ${enabled.join(", ")}` : "Mock mode";
}

function switchView(viewName) {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewName));
  Object.entries(els.views).forEach(([name, view]) => view.classList.toggle("is-active", name === viewName));
  if (viewName === "clinic") refreshDashboard();
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  state.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordedChunks.push(event.data);
  });
  state.mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach((track) => track.stop());
    await transcribeRecording();
  });
  state.mediaRecorder.start();
  state.isRecording = true;
  els.recordButton.textContent = "Stop Recording";
  els.recordButton.classList.add("recording");
}

function stopRecording() {
  state.mediaRecorder?.stop();
  state.isRecording = false;
  els.recordButton.textContent = "Transcribing...";
  els.recordButton.disabled = true;
  els.recordButton.classList.remove("recording");
}

async function transcribeRecording() {
  try {
    const blob = new Blob(state.recordedChunks, { type: "audio/webm" });
    const response = await fetch(`/api/transcribe?language=${encodeURIComponent(getSourceLanguageCode())}`, {
      method: "POST",
      headers: {
        "content-type": "audio/webm"
      },
      body: blob
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Transcription failed");
    els.transcriptInput.value = payload.text;
  } catch (error) {
    showModal("Transcription Error", error.message);
  } finally {
    els.recordButton.disabled = false;
    els.recordButton.textContent = "Start Recording";
  }
}

async function useSampleSpeech() {
  const response = await fetch(`/api/transcribe?language=${encodeURIComponent(getSourceLanguageCode())}`, {
    method: "POST",
    headers: {
      "content-type": "audio/webm"
    },
    body: new Blob([])
  });
  const payload = await response.json();
  els.transcriptInput.value = payload.text;
}

async function processTranscript() {
  const transcript = els.transcriptInput.value.trim();
  if (!transcript) {
    showModal("Missing Transcript", "Record, use sample speech, or type patient speech before processing.");
    return;
  }

  setBusy(els.processButton, true, "Processing...");
  try {
    const sourceLanguage = els.sourceLanguage.value;
    const targetLanguage = els.targetLanguage.value;
    const translation = await apiJson("/api/translate", {
      text: transcript,
      sourceLanguage,
      targetLanguage
    });
    state.translation = translation.text;
    els.translationOutput.textContent = translation.text || "Translation unavailable.";

    const extraction = await apiJson("/api/extract", {
      transcript,
      sourceLanguage,
      targetLanguage,
      existingForm: collectSubmissionFromForm()
    });
    state.currentSubmission = normalizeSubmission(extraction.submission);
    renderSubmission();
  } catch (error) {
    showModal("Processing Error", error.message);
  } finally {
    setBusy(els.processButton, false, "Translate + Extract");
  }
}

function normalizeSubmission(submission) {
  return {
    triageId: submission.triageId || crypto.randomUUID(),
    patientId: submission.patientId || "local-patient",
    encounterId: submission.encounterId || crypto.randomUUID(),
    sourceLanguage: submission.sourceLanguage || els.sourceLanguage.value,
    targetLanguage: submission.targetLanguage || els.targetLanguage.value,
    chiefComplaint: submission.chiefComplaint || "",
    urgency: submission.urgency || "gray",
    redFlags: submission.redFlags || [],
    symptoms: submission.symptoms || [],
    vitals: submission.vitals || {
      heartRate: "",
      temperature: "",
      bloodPressure: "",
      oxygenSaturation: ""
    },
    allergies: submission.allergies || [],
    medications: submission.medications || [],
    medicalHistory: submission.medicalHistory || [],
    recommendedQuestions: submission.recommendedQuestions || [],
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
  els.urgencyBadge.textContent = submission.urgency;
  els.urgencyBadge.className = `urgency ${submission.urgency}`;
  els.chiefComplaint.value = submission.chiefComplaint;
  els.reviewStatus.value = submission.reviewStatus;
  els.heartRate.value = submission.vitals.heartRate || "";
  els.bloodPressure.value = submission.vitals.bloodPressure || "";
  els.temperature.value = submission.vitals.temperature || "";
  els.oxygen.value = submission.vitals.oxygenSaturation || "";
  els.aiSummary.textContent = submission.aiSummary || "No summary yet.";
  els.consentCheckbox.checked = Boolean(submission.consentCaptured);
  els.aideNotes.value = submission.aideNotes || "";
  renderSymptoms(submission.symptoms);
  renderQuestions(submission.recommendedQuestions);
  saveDraft();
}

function renderSymptoms(symptoms) {
  els.symptomList.innerHTML = "";
  if (!symptoms.length) {
    els.symptomList.innerHTML = `<div class="list-card muted">No symptoms extracted yet.</div>`;
    return;
  }
  symptoms.forEach((symptom, index) => {
    const card = document.createElement("article");
    card.className = "list-card";
    card.innerHTML = `
      <div class="list-card-header">
        <div>
          <strong>${escapeHtml(symptom.name || "Symptom")}</strong>
          <p class="muted">${escapeHtml([symptom.duration, symptom.severity].filter(Boolean).join(" | ") || "Duration/severity not captured")}</p>
        </div>
        <span class="count-pill">${Math.round((symptom.confidence || 0) * 100)}%</span>
      </div>
      <p class="muted">${escapeHtml(symptom.evidence || "")}</p>
    `;
    card.addEventListener("click", () => editSymptom(index));
    els.symptomList.append(card);
  });
}

function renderQuestions(questions) {
  els.questionList.innerHTML = "";
  els.questionCount.textContent = String(questions.length);
  if (!questions.length) {
    els.questionList.innerHTML = `<div class="list-card muted">Gemma 4 will suggest follow-up questions when information is missing.</div>`;
    return;
  }
  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "list-card question-card";
    card.innerHTML = `
      <div class="list-card-header">
        <div>
          <strong>${escapeHtml(question.questionEnglish || "Question")}</strong>
          <p class="muted">${escapeHtml(question.questionPatientLanguage || "")}</p>
          <p class="muted">${escapeHtml(question.reason || "")}</p>
        </div>
        <span class="urgency ${question.urgency || "gray"}">${escapeHtml(question.urgency || "gray")}</span>
      </div>
      <label>
        Patient answer
        <input data-question-answer="${index}" type="text" value="${escapeAttribute(question.answer || "")}" placeholder="Capture answer here..." />
      </label>
      <div class="question-actions">
        <button class="secondary action-button" data-ask-question="${index}">Speak to Patient</button>
        <button class="secondary action-button" data-append-answer="${index}">Add Answer to Transcript</button>
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
    chiefComplaint: els.chiefComplaint.value.trim(),
    reviewStatus: els.reviewStatus.value,
    vitals: {
      heartRate: els.heartRate.value.trim(),
      bloodPressure: els.bloodPressure.value.trim(),
      temperature: els.temperature.value.trim(),
      oxygenSaturation: els.oxygen.value.trim()
    },
    recommendedQuestions,
    aideNotes: els.aideNotes.value.trim(),
    consentCaptured: els.consentCheckbox.checked,
    updatedAt: new Date().toISOString()
  };
}

function saveDraft() {
  const questionInputs = [...document.querySelectorAll("[data-question-answer]")];
  const recommendedQuestions = state.currentSubmission?.recommendedQuestions?.map((question, index) => ({
    ...question,
    answer: questionInputs.find((input) => Number(input.dataset.questionAnswer) === index)?.value || question.answer || ""
  }));
  const draft = state.currentSubmission
    ? {
        ...state.currentSubmission,
        chiefComplaint: els.chiefComplaint.value.trim(),
        reviewStatus: els.reviewStatus.value,
        vitals: {
          heartRate: els.heartRate.value.trim(),
          bloodPressure: els.bloodPressure.value.trim(),
          temperature: els.temperature.value.trim(),
          oxygenSaturation: els.oxygen.value.trim()
        },
        recommendedQuestions: recommendedQuestions || state.currentSubmission.recommendedQuestions || [],
        aideNotes: els.aideNotes.value.trim(),
        consentCaptured: els.consentCheckbox.checked
      }
    : null;

  if (draft) localStorage.setItem(storageKeys.draft, JSON.stringify(draft));
  localStorage.setItem(storageKeys.transcript, els.transcriptInput.value);
  localStorage.setItem(storageKeys.translation, state.translation || "");
}

function restoreDraft() {
  const transcript = localStorage.getItem(storageKeys.transcript);
  const translation = localStorage.getItem(storageKeys.translation);
  const draft = localStorage.getItem(storageKeys.draft);
  if (transcript) els.transcriptInput.value = transcript;
  if (translation) {
    state.translation = translation;
    els.translationOutput.textContent = translation;
  }
  if (draft) {
    try {
      state.currentSubmission = normalizeSubmission(JSON.parse(draft));
    } catch {
      state.currentSubmission = null;
    }
  }
}

function addSymptom() {
  state.currentSubmission = collectSubmissionFromForm();
  state.currentSubmission.symptoms.push({
    name: "New symptom",
    duration: "",
    severity: "",
    evidence: "Added by aide",
    confidence: 1
  });
  renderSubmission();
}

function editSymptom(index) {
  const submission = collectSubmissionFromForm();
  const symptom = submission.symptoms[index];
  const name = prompt("Symptom name", symptom.name || "");
  if (name === null) return;
  const duration = prompt("Duration", symptom.duration || "");
  if (duration === null) return;
  const severity = prompt("Severity", symptom.severity || "");
  if (severity === null) return;
  submission.symptoms[index] = {
    ...symptom,
    name,
    duration,
    severity,
    confidence: 1
  };
  state.currentSubmission = submission;
  renderSubmission();
}

async function speakText(text) {
  if (!text) return;
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text,
        language: els.sourceLanguage.value
      })
    });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("audio/")) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url));
      await audio.play();
      return;
    }
    const payload = await response.json();
    if (payload.useBrowserSpeech) {
      const utterance = new SpeechSynthesisUtterance(payload.text);
      utterance.lang = languageCodes[els.sourceLanguage.value] || "en";
      speechSynthesis.speak(utterance);
    }
  } catch (error) {
    showModal("Speech Error", error.message);
  }
}

function appendQuestionAnswer(index) {
  const submission = collectSubmissionFromForm();
  const question = submission.recommendedQuestions[index];
  if (!question?.answer) {
    showModal("Missing Answer", "Type or transcribe the patient's answer before adding it to the transcript.");
    return;
  }
  const block = `\n\nFollow-up question: ${question.questionEnglish}\nPatient answer: ${question.answer}`;
  els.transcriptInput.value += block;
  question.asked = true;
  submission.recommendedQuestions[index] = question;
  state.currentSubmission = submission;
  renderSubmission();
}

async function submitToClinic() {
  state.currentSubmission = collectSubmissionFromForm();
  if (!state.currentSubmission.consentCaptured) {
    showModal("Consent Required", "Capture patient consent before syncing the triage submission.");
    return;
  }
  if (state.currentSubmission.reviewStatus === "ai_draft") {
    showModal("Review Required", "Change the review status to aide confirmed or needs clinician before submitting.");
    return;
  }
  setBusy(els.submitButton, true, "Submitting...");
  try {
    const response = await apiJson("/api/sync", state.currentSubmission);
    state.submissions.unshift(response);
    localStorage.removeItem(storageKeys.draft);
    await refreshDashboard();
    switchView("clinic");
  } catch (error) {
    showModal("Sync Error", error.message);
  } finally {
    setBusy(els.submitButton, false, "Submit to Clinic");
  }
}

async function showFhirForCurrent() {
  const submission = collectSubmissionFromForm();
  const fhir = await apiJson("/api/fhir", submission);
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
    els.queueList.innerHTML = `<div class="detail-empty">No submissions yet.</div>`;
    return;
  }
  state.submissions.forEach((record) => {
    const submission = record.submission;
    const card = document.createElement("button");
    card.className = "queue-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(submission.chiefComplaint || "Untitled triage")}</strong>
        <p class="muted">${escapeHtml(submission.sourceLanguage || "Unknown language")} | ${escapeHtml(record.status || "stored")}</p>
        <p class="muted">${escapeHtml(new Date(record.submittedAt).toLocaleString())}</p>
      </div>
      <span class="urgency ${submission.urgency || "gray"}">${escapeHtml(submission.urgency || "gray")}</span>
    `;
    card.addEventListener("click", () => {
      state.selectedSubmissionId = record.id;
      renderSelectedSubmission();
    });
    els.queueList.append(card);
  });
  if (!state.selectedSubmissionId) state.selectedSubmissionId = state.submissions[0]?.id;
}

function renderSelectedSubmission() {
  const record = state.submissions.find((item) => item.id === state.selectedSubmissionId) || state.submissions[0];
  if (!record) {
    els.selectedStatus.textContent = "No record";
    els.submissionDetail.className = "detail-empty";
    els.submissionDetail.textContent = "Submit a triage draft from the field app.";
    els.fhirOutput.hidden = true;
    return;
  }
  const submission = record.submission;
  els.selectedStatus.textContent = record.status;
  els.submissionDetail.className = "detail-grid";
  els.submissionDetail.innerHTML = `
    <div class="detail-metric-grid">
      <div class="metric"><p class="eyebrow">Urgency</p><strong>${escapeHtml(submission.urgency)}</strong></div>
      <div class="metric"><p class="eyebrow">Review</p><strong>${escapeHtml(submission.reviewStatus)}</strong></div>
      <div class="metric"><p class="eyebrow">Consent</p><strong>${submission.consentCaptured ? "Captured" : "Missing"}</strong></div>
    </div>
    <div>
      <p class="eyebrow">AI summary</p>
      <p>${escapeHtml(submission.aiSummary || "")}</p>
    </div>
    <div>
      <p class="eyebrow">Red flags</p>
      <p>${escapeHtml((submission.redFlags || []).join(", ") || "None")}</p>
    </div>
    <div>
      <p class="eyebrow">Aide notes</p>
      <p>${escapeHtml(submission.aideNotes || "None")}</p>
    </div>
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
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  els.recordButton.addEventListener("click", () => {
    if (state.isRecording) stopRecording();
    else startRecording().catch((error) => showModal("Microphone Error", error.message));
  });
  els.mockButton.addEventListener("click", useSampleSpeech);
  els.processButton.addEventListener("click", processTranscript);
  els.playTranslationButton.addEventListener("click", () => speakText(state.translation));
  els.addSymptomButton.addEventListener("click", addSymptom);
  els.submitButton.addEventListener("click", submitToClinic);
  els.fhirButton.addEventListener("click", showFhirForCurrent);
  els.refreshDashboardButton.addEventListener("click", refreshDashboard);
  els.closeModalButton.addEventListener("click", () => els.modal.close());
  [els.transcriptInput, els.chiefComplaint, els.reviewStatus, els.heartRate, els.bloodPressure, els.temperature, els.oxygen, els.consentCheckbox, els.aideNotes].forEach((element) => {
    element.addEventListener("input", saveDraft);
    element.addEventListener("change", saveDraft);
  });
  els.questionList.addEventListener("click", (event) => {
    const askIndex = event.target.dataset.askQuestion;
    const appendIndex = event.target.dataset.appendAnswer;
    if (askIndex !== undefined) {
      const question = collectSubmissionFromForm().recommendedQuestions[Number(askIndex)];
      speakText(question?.questionPatientLanguage || question?.questionEnglish || "");
    }
    if (appendIndex !== undefined) appendQuestionAnswer(Number(appendIndex));
  });
  els.questionList.addEventListener("input", saveDraft);
}

bindEvents();
restoreDraft();
checkProviders();
renderSubmission();
