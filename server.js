import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = join(process.cwd(), "public");
const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES || 25 * 1024 * 1024);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GEMMA_API_URL = process.env.GEMMA_API_URL;
const GEMMA_API_KEY = process.env.GEMMA_API_KEY;
const GEMMA_PROVIDER = process.env.GEMMA_PROVIDER || (GEMMA_API_URL ? "openai-compatible" : "ollama");
const GEMMA_MODEL = process.env.GEMMA_MODEL || "gemma4:e2b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const GEMMA_TIMEOUT_MS = Number(process.env.GEMMA_TIMEOUT_MS || 6000);
const GEMMA_TRANSLATION_TIMEOUT_MS = Number(process.env.GEMMA_TRANSLATION_TIMEOUT_MS || 3000);
const CLINIC_SYNC_URL = process.env.CLINIC_SYNC_URL;
const CLINIC_SYNC_ENABLED = process.env.CLINIC_SYNC_ENABLED === "true" && Boolean(CLINIC_SYNC_URL);

const memory = {
  submissions: []
};

function loadLocalEnv() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm"
};

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' http://127.0.0.1:11434 http://localhost:11434 https://api.openai.com https://api.elevenlabs.io",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ")
};

function withSecurityHeaders(headers = {}) {
  return {
    ...securityHeaders,
    ...headers
  };
}

function createTimeoutSignal(timeoutMs = GEMMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

function audioExtensionFromMime(contentType = "") {
  const type = contentType.toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("aac")) return "aac";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function languageNameFromCode(code = "") {
  const normalized = code.toLowerCase();
  const names = {
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
  return names[normalized] || names[normalized.slice(0, 2)] || code || "Auto";
}

function sendJson(res, status, body) {
  res.writeHead(status, withSecurityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  res.end(JSON.stringify(body, null, 2));
}

function sendAudio(res, status, buffer, contentType) {
  res.writeHead(status, withSecurityHeaders({
    "content-type": contentType,
    "cache-control": "no-store"
  }));
  res.end(Buffer.from(buffer));
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readRequestBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function sampleTranscript(language) {
  if (!language || language === "auto") {
    return "Me duele el pecho desde hace dos dias. Tambien me falta el aire cuando camino.";
  }
  if (language === "es") {
    return "Me duele el pecho desde hace dos dias. Tambien me falta el aire cuando camino.";
  }
  if (language === "fr") {
    return "J'ai mal a la poitrine depuis deux jours et je suis essouffle quand je marche.";
  }
  if (language === "hi") {
    return "Mujhe do din se seene me dard hai aur chalne par saans phoolti hai.";
  }
  if (language === "ar") {
    return "أشعر بألم في صدري منذ يومين وأضيق في التنفس عندما أمشي.";
  }
  if (language === "sw") {
    return "Kifua kinauma kwa siku mbili na ninakosa pumzi nikitembea.";
  }
  if (language === "pt") {
    return "Tenho dor no peito ha dois dias e fico sem ar quando caminho.";
  }
  return "I have had chest pain for two days and I get short of breath when I walk.";
}

function inferLanguage(text = "") {
  const lower = text.toLowerCase();
  if (/[\u0600-\u06ff]/.test(text)) {
    return { code: "ar", name: "Arabic", confidence: 0.9 };
  }
  if (/[¿¡ñáéíóú]/.test(lower) || lower.includes(" me ") || lower.includes(" pecho") || lower.includes(" aire") || lower.includes(" dias")) {
    return { code: "es", name: "Spanish", confidence: 0.92 };
  }
  if (lower.includes("j'ai") || lower.includes("poitrine") || lower.includes("essouffle") || lower.includes("depuis")) {
    return { code: "fr", name: "French", confidence: 0.88 };
  }
  if (lower.includes("mujhe") || lower.includes("saans") || lower.includes("dard")) {
    return { code: "hi", name: "Hindi", confidence: 0.82 };
  }
  if (lower.includes("kifua") || lower.includes("pumzi") || lower.includes("ninakosa")) {
    return { code: "sw", name: "Swahili", confidence: 0.82 };
  }
  if (lower.includes("tenho") || lower.includes("peito") || lower.includes("sem ar")) {
    return { code: "pt", name: "Portuguese", confidence: 0.84 };
  }
  return { code: "en", name: "English", confidence: 0.74 };
}

function mockTranslate(text, targetLanguage) {
  const lower = text.toLowerCase();
  const chestPainSample = lower.includes("pecho") || lower.includes("chest pain") || lower.includes("poitrine");
  if (targetLanguage === "English" && chestPainSample) {
    return "I have had chest pain for two days. I also get short of breath when I walk.";
  }
  if (targetLanguage === "Spanish") {
    if (chestPainSample) return "Me duele el pecho desde hace dos dias. Tambien me falta el aire cuando camino.";
    if (lower.includes("does the pain")) return "El dolor se extiende al brazo, la mandibula o la espalda?";
    if (lower.includes("trouble breathing") || lower.includes("shortness")) return "Tiene dificultad para respirar?";
    if (lower.includes("how severe")) return "Que tan fuerte es el dolor, de cero a diez?";
    if (lower.includes("medications")) return "Esta tomando algun medicamento ahora?";
    return "Traduccion al espanol: " + text;
  }
  if (targetLanguage === "French") {
    if (chestPainSample) return "J'ai mal a la poitrine depuis deux jours et je suis essouffle quand je marche.";
    return "Traduction francaise: " + text;
  }
  if (targetLanguage === "Hindi") {
    if (chestPainSample) return "Mujhe do din se seene me dard hai aur chalne par saans phoolti hai.";
    return "Hindi translation: " + text;
  }
  if (targetLanguage === "Arabic") {
    if (chestPainSample) return "أشعر بألم في صدري منذ يومين وأضيق في التنفس عندما أمشي.";
    if (lower.includes("does the pain")) return "هل ينتشر الألم إلى الذراع أو الفك أو الظهر؟";
    if (lower.includes("trouble breathing") || lower.includes("shortness")) return "هل لديك صعوبة في التنفس الآن؟";
    if (lower.includes("how severe")) return "ما شدة الألم من صفر إلى عشرة؟";
    if (lower.includes("medications")) return "هل تتناول أي أدوية الآن؟";
    return "ترجمة عربية: " + text;
  }
  if (targetLanguage === "Swahili") {
    if (chestPainSample) return "Kifua kinauma kwa siku mbili na ninakosa pumzi nikitembea.";
    if (lower.includes("does the pain")) return "Maumivu yanaenea kwenye mkono, taya, au mgongo?";
    if (lower.includes("trouble breathing") || lower.includes("shortness")) return "Una shida ya kupumua sasa?";
    if (lower.includes("how severe")) return "Maumivu ni makali kiasi gani, sifuri hadi kumi?";
    if (lower.includes("medications")) return "Unatumia dawa yoyote sasa?";
    return "Tafsiri ya Kiswahili: " + text;
  }
  if (targetLanguage === "Portuguese") {
    if (chestPainSample) return "Tenho dor no peito ha dois dias e fico sem ar quando caminho.";
    if (lower.includes("does the pain")) return "A dor se espalha para o braco, mandibula ou costas?";
    if (lower.includes("trouble breathing") || lower.includes("shortness")) return "Voce esta com dificuldade para respirar agora?";
    if (lower.includes("how severe")) return "Qual e a intensidade da dor de zero a dez?";
    if (lower.includes("medications")) return "Voce esta tomando algum medicamento agora?";
    return "Traducao para portugues: " + text;
  }
  if (targetLanguage === "Mandarin") {
    if (chestPainSample) return "我胸痛已经两天了，走路时也会气短。";
    return "中文翻译: " + text;
  }
  if (targetLanguage === "Ukrainian") {
    if (chestPainSample) return "У мене болить у грудях уже два дні, і під час ходьби мені бракує повітря.";
    return "Український переклад: " + text;
  }
  if (targetLanguage === "Russian") {
    if (chestPainSample) return "У меня болит грудь уже два дня, и при ходьбе мне не хватает воздуха.";
    return "Перевод на русский: " + text;
  }
  return text;
}

function detectUrgency(text) {
  const lower = text.toLowerCase();
  const redFlags = [];
  if (lower.includes("chest pain") || lower.includes("pecho") || lower.includes("poitrine")) redFlags.push("chest pain");
  if (lower.includes("short of breath") || lower.includes("falta el aire") || lower.includes("essouffle")) redFlags.push("shortness of breath");
  if (lower.includes("bleeding") || lower.includes("sangrado")) redFlags.push("heavy bleeding");
  if (lower.includes("pregnant") || lower.includes("embarazada")) redFlags.push("pregnancy concern");
  const vitals = extractVitals(text);
  const tempValue = Number(vitals.temperature);
  if (tempValue > 0 && tempValue < 35) redFlags.push("very low temperature");
  if (tempValue >= 39.5) redFlags.push("high fever");
  if (redFlags.length >= 1) return { urgency: "red", redFlags };
  if (lower.includes("fever") || lower.includes("fiebre") || lower.includes("vomit") || lower.includes("cough") || lower.includes("tos")) {
    return { urgency: "yellow", redFlags: ["possible infection or dehydration"] };
  }
  return { urgency: "green", redFlags };
}

function extractVitals(text = "") {
  const lower = text.toLowerCase();
  const vitals = {};
  const temperatureMatch =
    lower.match(/(?:temperature|temp|temperatura|fever)\s*(?:is|was|of|:)?\s*(-?\d+(?:\.\d+)?)/) ||
    lower.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees|degree|°|celsius|fahrenheit|c|f)\b/);
  if (temperatureMatch) vitals.temperature = temperatureMatch[1];

  const oxygenMatch = lower.match(/(?:oxygen|o2|spo2|saturation)\s*(?:is|was|of|:)?\s*(\d{2,3})/);
  if (oxygenMatch) vitals.oxygenSaturation = oxygenMatch[1];

  const heartRateMatch = lower.match(/(?:heart rate|pulse)\s*(?:is|was|of|:)?\s*(\d{2,3})/);
  if (heartRateMatch) vitals.heartRate = heartRateMatch[1];

  const bloodPressureMatch = lower.match(/(?:blood pressure|bp)\s*(?:is|was|of|:)?\s*(\d{2,3}\s*\/\s*\d{2,3})/);
  if (bloodPressureMatch) vitals.bloodPressure = bloodPressureMatch[1].replace(/\s+/g, "");

  const painMatch = lower.match(/(?:pain|dolor)\s*(?:is|was|score|level|:)?\s*(\d{1,2})\s*(?:out of|\/)?\s*(?:10|ten)?/);
  if (painMatch) vitals.painScore = painMatch[1];

  const ageMatch = lower.match(/(?:i am|i'm|age|edad)\s*(\d{1,3})\s*(?:years old|anos|años)?/);
  if (ageMatch) vitals.age = ageMatch[1];
  return vitals;
}

function buildTriageSignals(text, vitals = {}) {
  const lower = text.toLowerCase();
  const extractedVitals = { ...vitals, ...extractVitals(text) };
  const signals = {
    airwayBreathingCirculation: [],
    neurologic: [],
    painRisk: [],
    infectionDehydration: [],
    maternalChild: [],
    disasterStart: []
  };

  if (lower.includes("short of breath") || lower.includes("falta el aire") || lower.includes("can't breathe") || lower.includes("essouffle")) {
    signals.airwayBreathingCirculation.push("Breathing difficulty");
  }
  if (lower.includes("chest pain") || lower.includes("pecho") || lower.includes("poitrine")) {
    signals.painRisk.push("Chest pain");
  }
  if (lower.includes("confused") || lower.includes("unconscious") || lower.includes("seizure") || lower.includes("convulsion")) {
    signals.neurologic.push("Altered mental status or seizure");
  }
  if (lower.includes("bleeding") || lower.includes("sangrado") || lower.includes("blood")) {
    signals.airwayBreathingCirculation.push("Bleeding concern");
  }
  if (lower.includes("fever") || lower.includes("fiebre") || lower.includes("vomit") || lower.includes("diarrhea")) {
    signals.infectionDehydration.push("Possible infection or dehydration");
  }
  if (lower.includes("cough") || lower.includes("coughing") || lower.includes("tos")) {
    signals.infectionDehydration.push("Cough");
  }
  if (lower.includes("pregnant") || lower.includes("embarazada")) {
    signals.maternalChild.push("Pregnancy concern");
  }
  if (lower.includes("cannot walk") || lower.includes("can't walk")) {
    signals.disasterStart.push("Not walking");
  }
  const temperatureValue = Number(extractedVitals.temperature);
  if (temperatureValue > 0 && temperatureValue < 35) {
    signals.airwayBreathingCirculation.push("Very low temperature");
  }
  if (temperatureValue >= 38) {
    signals.infectionDehydration.push("Fever");
  }
  if (Number(extractedVitals.oxygenSaturation) > 0 && Number(extractedVitals.oxygenSaturation) < 92) {
    signals.airwayBreathingCirculation.push("Low oxygen saturation");
  }
  if (Number(extractedVitals.heartRate) >= 130) {
    signals.airwayBreathingCirculation.push("Very high heart rate");
  }
  return signals;
}

function mockExtract({ transcript, sourceLanguage = "Spanish", targetLanguage = "English", existingForm = {} }) {
  const detectedLanguage = sourceLanguage === "Auto detect" ? inferLanguage(transcript).name : sourceLanguage;
  const { urgency, redFlags } = detectUrgency(transcript);
  const extractedVitals = extractVitals(transcript);
  const mergedVitals = {
    ...(existingForm.vitals || {}),
    ...Object.fromEntries(Object.entries(extractedVitals).filter(([, value]) => value !== undefined && value !== ""))
  };
  const triageSignals = buildTriageSignals(transcript, mergedVitals);
  const lower = transcript.toLowerCase();
  const symptoms = [];
  if (lower.includes("chest") || lower.includes("pecho") || lower.includes("poitrine")) {
    symptoms.push({
      name: "Chest pain",
      duration: lower.includes("two days") || lower.includes("dos dias") || lower.includes("deux jours") ? "2 days" : "",
      severity: "",
      evidence: transcript,
      confidence: 0.9
    });
  }
  if (lower.includes("short") || lower.includes("aire") || lower.includes("essouffle")) {
    symptoms.push({
      name: "Shortness of breath",
      duration: "",
      severity: "",
      evidence: transcript,
      confidence: 0.86
    });
  }
  if (lower.includes("cough") || lower.includes("coughing") || lower.includes("tos")) {
    symptoms.push({
      name: "Cough",
      duration: "",
      severity: "",
      evidence: transcript,
      confidence: 0.84
    });
  }

  const questions = [];
  if (redFlags.includes("chest pain")) {
    questions.push({
      id: randomUUID(),
      questionEnglish: "Does the pain spread to your arm, jaw, or back?",
      questionPatientLanguage: mockTranslate("Does the pain spread to your arm, jaw, or back?", detectedLanguage),
      reason: "Chest pain with radiation can indicate a higher-risk presentation.",
      urgency: "red",
      asked: false,
      answer: ""
    });
    questions.push({
      id: randomUUID(),
      questionEnglish: "Are you having trouble breathing right now?",
      questionPatientLanguage: mockTranslate("Are you having trouble breathing right now?", detectedLanguage),
      reason: "Breathing difficulty changes triage priority.",
      urgency: "red",
      asked: false,
      answer: ""
    });
    questions.push({
      id: randomUUID(),
      questionEnglish: "How severe is the pain from zero to ten?",
      questionPatientLanguage: mockTranslate("How severe is the pain from zero to ten?", detectedLanguage),
      reason: "Severity helps the clinician prioritize and monitor change.",
      urgency: "yellow",
      asked: false,
      answer: ""
    });
  }
  questions.push({
    id: randomUUID(),
    questionEnglish: "Are you taking any medications right now?",
    questionPatientLanguage: mockTranslate("Are you taking any medications right now?", detectedLanguage),
    reason: "Medication history is needed before treatment.",
    urgency: "green",
    asked: false,
    answer: ""
  });

  return {
    triageId: existingForm.triageId || randomUUID(),
    patientId: existingForm.patientId || "local-patient-" + Math.floor(1000 + Math.random() * 9000),
    encounterId: existingForm.encounterId || randomUUID(),
    sourceLanguage: detectedLanguage,
    targetLanguage,
    chiefComplaint: symptoms[0]?.name || existingForm.chiefComplaint || "Unclear chief complaint",
    urgency,
    redFlags,
    symptoms,
    vitals: {
      heartRate: "",
      temperature: "",
      bloodPressure: "",
      oxygenSaturation: "",
      ...mergedVitals
    },
    allergies: existingForm.allergies || [],
    medications: existingForm.medications || [],
    medicalHistory: existingForm.medicalHistory || [],
    triageSignals,
    triageBasis: [
      "WHO IITT-style red/yellow/green acuity sorting",
      "AHRQ ESI-style immediate danger, high-risk symptoms, pain/distress, and vital-sign review",
      "HHS START-style walking, breathing, perfusion, and mental-status cues for disaster mode"
    ],
    recommendedQuestions: questions,
    aiSummary: symptoms.length
      ? `Patient reports ${symptoms.map((symptom) => symptom.name.toLowerCase()).join(" and ")}. ${urgency === "red" ? "Immediate clinical review is recommended." : "Aide review is recommended."}`
      : "Insufficient information. Ask follow-up questions before submitting.",
    reviewStatus: "ai_draft",
    evidence: transcript,
    confidence: symptoms.length ? 0.88 : 0.42,
    updatedAt: new Date().toISOString()
  };
}

function extractionSystemPrompt() {
  return [
    "You are Gemma 4 local medical triage extraction.",
    "Return ONLY valid JSON. Do not diagnose. Do not invent facts.",
    "Extract stated facts from transcript. Mark uncertain fields as empty strings or empty arrays.",
    "Use red/yellow/green/gray urgency. Red for chest pain, severe breathing difficulty, stroke signs, unconsciousness, heavy bleeding, severe allergy, pregnancy emergency, seizure, or very abnormal vitals.",
    "JSON keys: chiefComplaint, urgency, redFlags, symptoms, vitals, allergies, medications, medicalHistory, triageSignals, recommendedQuestions, aiSummary, confidence.",
    "symptoms items: name,duration,severity,evidence,confidence.",
    "vitals keys: age,painScore,heartRate,bloodPressure,temperature,oxygenSaturation.",
    "triageSignals keys: airwayBreathingCirculation,neurologic,painRisk,infectionDehydration,maternalChild,disasterStart.",
    "recommendedQuestions: up to 4 items with questionEnglish, questionPatientLanguage, reason, urgency, asked=false, answer=''.",
    "Include follow-up questions in the patient language."
  ].join(" ");
}

function parseJsonFromModel(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
  }
  return null;
}

function normalizeGemmaSubmission(candidate, body) {
  const fallback = mockExtract(body);
  const submission = candidate?.submission || candidate || {};
  return {
    ...fallback,
    ...submission,
    triageId: submission.triageId || fallback.triageId,
    patientId: submission.patientId || fallback.patientId,
    encounterId: submission.encounterId || fallback.encounterId,
    sourceLanguage: submission.sourceLanguage || fallback.sourceLanguage,
    targetLanguage: submission.targetLanguage || body.targetLanguage || fallback.targetLanguage,
    urgency: ["red", "yellow", "green", "gray"].includes(submission.urgency) ? submission.urgency : fallback.urgency,
    redFlags: Array.isArray(submission.redFlags) ? submission.redFlags : fallback.redFlags,
    symptoms: Array.isArray(submission.symptoms) ? submission.symptoms : fallback.symptoms,
    vitals: { ...(fallback.vitals || {}), ...(submission.vitals || {}) },
    allergies: Array.isArray(submission.allergies) ? submission.allergies : fallback.allergies,
    medications: Array.isArray(submission.medications) ? submission.medications : fallback.medications,
    medicalHistory: Array.isArray(submission.medicalHistory) ? submission.medicalHistory : fallback.medicalHistory,
    triageSignals: submission.triageSignals || fallback.triageSignals,
    triageBasis: Array.isArray(submission.triageBasis) ? submission.triageBasis : fallback.triageBasis,
    recommendedQuestions: Array.isArray(submission.recommendedQuestions) ? submission.recommendedQuestions : fallback.recommendedQuestions,
    aiSummary: submission.aiSummary || fallback.aiSummary,
    reviewStatus: "ai_draft",
    evidence: submission.evidence || body.transcript || fallback.evidence,
    confidence: Number(submission.confidence || fallback.confidence || 0.5),
    updatedAt: new Date().toISOString()
  };
}

async function callOllamaGemma(body) {
  const timeout = createTimeoutSignal();
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    signal: timeout.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      stream: false,
      format: "json",
      options: {
        temperature: Number(process.env.GEMMA_TEMPERATURE || 0.2),
        top_p: Number(process.env.GEMMA_TOP_P || 0.95),
        top_k: Number(process.env.GEMMA_TOP_K || 64),
        num_predict: Number(process.env.GEMMA_NUM_PREDICT || 1200)
      },
      messages: [
        { role: "system", content: extractionSystemPrompt() },
        { role: "user", content: JSON.stringify(body) }
      ]
    })
  });
  timeout.clear();
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Ollama Gemma request failed with ${response.status}`);
  }
  const content = payload.message?.content || payload.response || "";
  const parsed = parseJsonFromModel(content);
  if (!parsed) throw new Error("Gemma returned non-JSON output");
  return parsed;
}

async function callOllamaGemmaText(system, user, timeoutMs = GEMMA_TIMEOUT_MS) {
  const timeout = createTimeoutSignal(timeoutMs);
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    signal: timeout.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      stream: false,
      options: {
        temperature: Number(process.env.GEMMA_TEMPERATURE || 0.2),
        top_p: Number(process.env.GEMMA_TOP_P || 0.95),
        top_k: Number(process.env.GEMMA_TOP_K || 64)
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  timeout.clear();
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Ollama Gemma request failed with ${response.status}`);
  return (payload.message?.content || payload.response || "").trim();
}

async function callOpenAICompatibleGemma(body) {
  const timeout = createTimeoutSignal();
  const response = await fetch(GEMMA_API_URL, {
    method: "POST",
    signal: timeout.signal,
    headers: {
      "content-type": "application/json",
      ...(GEMMA_API_KEY ? { authorization: `Bearer ${GEMMA_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      response_format: { type: "json_object" },
      temperature: Number(process.env.GEMMA_TEMPERATURE || 0.2),
      messages: [
        { role: "system", content: extractionSystemPrompt() },
        { role: "user", content: JSON.stringify(body) }
      ]
    })
  });
  timeout.clear();
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || `Gemma endpoint failed with ${response.status}`);
  }
  const content = payload.output_text || payload.choices?.[0]?.message?.content || payload.message?.content || JSON.stringify(payload);
  const parsed = typeof content === "string" ? parseJsonFromModel(content) : content;
  if (!parsed) throw new Error("Gemma endpoint returned non-JSON output");
  return parsed;
}

async function callOpenAICompatibleGemmaText(system, user, timeoutMs = GEMMA_TIMEOUT_MS) {
  const timeout = createTimeoutSignal(timeoutMs);
  const response = await fetch(GEMMA_API_URL, {
    method: "POST",
    signal: timeout.signal,
    headers: {
      "content-type": "application/json",
      ...(GEMMA_API_KEY ? { authorization: `Bearer ${GEMMA_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: GEMMA_MODEL,
      temperature: Number(process.env.GEMMA_TEMPERATURE || 0.2),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  timeout.clear();
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || payload.error || `Gemma endpoint failed with ${response.status}`);
  return (payload.output_text || payload.choices?.[0]?.message?.content || payload.message?.content || "").trim();
}

async function translateWithGemma({ text, sourceLanguage, targetLanguage }) {
  const system = "You are Gemma 4 translating clinical speech for a medical aide. Translate faithfully, preserve uncertainty and numbers, do not add medical facts, and output only the translated text.";
  const user = `Translate from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`;
  return GEMMA_PROVIDER === "openai-compatible"
    ? callOpenAICompatibleGemmaText(system, user, GEMMA_TRANSLATION_TIMEOUT_MS)
    : callOllamaGemmaText(system, user, GEMMA_TRANSLATION_TIMEOUT_MS);
}

async function checkGemmaAvailable() {
  if (GEMMA_PROVIDER === "mock") return false;
  if (GEMMA_PROVIDER === "openai-compatible") return Boolean(GEMMA_API_URL);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600);
    const tagsUrl = OLLAMA_URL.replace(/\/api\/chat\/?$/, "/api/tags");
    const response = await fetch(tagsUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return false;
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models.some((model) => model.name?.startsWith(GEMMA_MODEL.split(":")[0])) : true;
  } catch {
    return false;
  }
}

function makeFhirBundle(submission) {
  const now = new Date().toISOString();
  const patientId = submission.patientId || randomUUID();
  const encounterId = submission.encounterId || randomUUID();
  const bundleId = randomUUID();

  const observations = (submission.symptoms || []).map((symptom) => ({
    resource: {
      resourceType: "Observation",
      id: randomUUID(),
      status: "preliminary",
      code: {
        text: symptom.name
      },
      subject: {
        reference: `Patient/${patientId}`
      },
      encounter: {
        reference: `Encounter/${encounterId}`
      },
      effectiveDateTime: now,
      note: [
        {
          text: `AI-assisted draft. Evidence: ${symptom.evidence || submission.evidence || ""}`
        }
      ],
      valueString: [symptom.duration, symptom.severity].filter(Boolean).join(", ") || symptom.name
    }
  }));

  return {
    resourceType: "Bundle",
    id: bundleId,
    type: "collection",
    timestamp: now,
    entry: [
      {
        resource: {
          resourceType: "Patient",
          id: patientId,
          communication: [
            {
              language: {
                text: submission.sourceLanguage || "Unknown"
              },
              preferred: true
            }
          ]
        }
      },
      {
        resource: {
          resourceType: "Encounter",
          id: encounterId,
          status: submission.reviewStatus === "aide_confirmed" ? "finished" : "in-progress",
          class: {
            code: "AMB",
            display: "ambulatory"
          },
          subject: {
            reference: `Patient/${patientId}`
          },
          reasonCode: [
            {
              text: submission.chiefComplaint || "AI-assisted triage intake"
            }
          ],
          priority: {
            text: submission.urgency || "gray"
          }
        }
      },
      ...observations,
      {
        resource: {
          resourceType: "QuestionnaireResponse",
          id: submission.triageId || randomUUID(),
          status: submission.reviewStatus === "aide_confirmed" ? "completed" : "in-progress",
          subject: {
            reference: `Patient/${patientId}`
          },
          authored: now,
          item: [
            {
              linkId: "ai-summary",
              text: "AI-assisted triage summary",
              answer: [
                {
                  valueString: submission.aiSummary || ""
                }
              ]
            },
            {
              linkId: "red-flags",
              text: "Red flags",
              answer: [
                {
                  valueString: (submission.redFlags || []).join(", ")
                }
              ]
            }
          ]
        }
      }
    ]
  };
}

async function transcribeAudio(req, res, url) {
  const language = url.searchParams.get("language") || "auto";
  const audio = await readRequestBody(req);
  if (!audio.length) {
    const text = sampleTranscript(language);
    const detected = inferLanguage(text);
    return sendJson(res, 200, {
      provider: "mock",
      text,
      language: detected.code,
      languageName: detected.name,
      languageConfidence: detected.confidence
    });
  }

  if (ELEVENLABS_API_KEY) {
    return transcribeWithElevenLabs(res, audio, req.headers["content-type"] || "audio/webm", language);
  }

  if (!OPENAI_API_KEY) {
    return sendJson(res, 400, {
      error: "Real transcription requires ELEVENLABS_API_KEY. Add it to your environment and restart npm start.",
      provider: "none"
    });
  }

  const formData = new FormData();
  formData.set("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  if (language && language !== "auto") formData.set("language", language);
  const contentType = req.headers["content-type"] || "audio/webm";
  const extension = audioExtensionFromMime(contentType);
  formData.set("file", new Blob([audio], { type: contentType }), `recording.${extension}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: formData
  });
  const payload = await response.json();
  if (!response.ok) return sendJson(res, response.status, payload);
  return sendJson(res, 200, {
    provider: "openai",
    text: payload.text || "",
    language: language === "auto" ? payload.language || "" : language,
    languageName: payload.language || ""
  });
}

async function transcribeWithElevenLabs(res, audio, contentType, language) {
  const extension = audioExtensionFromMime(contentType);
  const formData = new FormData();
  formData.set("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v2");
  formData.set("file", new Blob([audio], { type: contentType }), `recording.${extension}`);
  formData.set("tag_audio_events", "false");
  formData.set("diarize", "false");
  if (language && language !== "auto") {
    formData.set("language_code", language);
  }

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY
    },
    body: formData
  });
  const payload = await response.json();
  if (!response.ok) return sendJson(res, response.status, payload);

  const detectedCode = payload.language_code || payload.language || "";
  return sendJson(res, 200, {
    provider: "elevenlabs-scribe",
    model: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
    text: payload.text || "",
    language: detectedCode,
    languageName: languageNameFromCode(detectedCode),
    languageConfidence: payload.language_probability ?? payload.language_probability_score ?? 0.9,
    words: payload.words || []
  });
}

async function detectLanguage(req, res) {
  const body = await readJson(req);
  return sendJson(res, 200, {
    provider: "mock",
    detected: inferLanguage(body.text || "")
  });
}

async function translateText(req, res) {
  const body = await readJson(req);
  const { text = "", sourceLanguage = "Spanish", targetLanguage = "English" } = body;
  if (!OPENAI_API_KEY) {
    if (GEMMA_PROVIDER !== "mock") {
      try {
        const translated = await translateWithGemma({ text, sourceLanguage, targetLanguage });
        if (translated) {
          return sendJson(res, 200, {
            provider: `gemma4:${GEMMA_PROVIDER}`,
            model: GEMMA_MODEL,
            text: translated
          });
        }
      } catch {
        // Keep the app usable when the local Gemma runtime is not running.
      }
    }
    return sendJson(res, 200, {
      provider: "mock",
      text: mockTranslate(text, targetLanguage)
    });
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "Translate clinical speech faithfully. Do not add medical facts. Preserve uncertainty and numbers."
        },
        {
          role: "user",
          content: `Translate from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`
        }
      ]
    })
  });
  const payload = await response.json();
  if (!response.ok) return sendJson(res, response.status, payload);
  return sendJson(res, 200, {
    provider: "openai",
    text: payload.output_text || ""
  });
}

async function extractClinical(req, res) {
  const body = await readJson(req);
  if (GEMMA_PROVIDER === "mock") {
    return sendJson(res, 200, {
      provider: "mock-gemma4",
      submission: mockExtract(body)
    });
  }

  try {
    const raw = GEMMA_PROVIDER === "openai-compatible" ? await callOpenAICompatibleGemma(body) : await callOllamaGemma(body);
    return sendJson(res, 200, {
      provider: `gemma4:${GEMMA_PROVIDER}`,
      model: GEMMA_MODEL,
      submission: normalizeGemmaSubmission(raw, body)
    });
  } catch (error) {
    return sendJson(res, 200, {
      provider: "mock-gemma4-fallback",
      model: GEMMA_MODEL,
      fallbackReason: error.message,
      submission: mockExtract(body)
    });
  }
}

async function synthesizeSpeech(req, res) {
  const body = await readJson(req);
  const { text = "", voiceId = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us" } = body;
  if (!ELEVENLABS_API_KEY || !text) {
    return sendJson(res, 200, {
      provider: "browser",
      useBrowserSpeech: true,
      text
    });
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75
      }
    })
  });
  if (!response.ok) {
    const payload = await response.text();
    return sendJson(res, 200, {
      provider: "browser-fallback",
      useBrowserSpeech: true,
      text,
      elevenLabsError: payload
    });
  }
  const buffer = await response.arrayBuffer();
  return sendAudio(res, 200, buffer, "audio/mpeg");
}

async function syncSubmission(req, res) {
  const submission = await readJson(req);
  if (!submission.consentCaptured) {
    return sendJson(res, 400, { error: "Consent is required before storing or syncing a triage submission." });
  }
  if (submission.reviewStatus === "ai_draft") {
    return sendJson(res, 400, { error: "Aide review is required before storing or syncing a triage submission." });
  }
  const fhirBundle = makeFhirBundle(submission);
  const record = {
    id: submission.triageId || randomUUID(),
    submittedAt: new Date().toISOString(),
    submission,
    fhirBundle,
    status: CLINIC_SYNC_ENABLED ? "forwarded" : "stored_locally"
  };
  memory.submissions.unshift(record);

  if (CLINIC_SYNC_ENABLED) {
    const response = await fetch(CLINIC_SYNC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/fhir+json"
      },
      body: JSON.stringify(fhirBundle)
    });
    record.forwardStatus = response.status;
  }

  return sendJson(res, 200, record);
}

async function routeApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/transcribe") return await transcribeAudio(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/detect-language") return await detectLanguage(req, res);
    if (req.method === "POST" && url.pathname === "/api/translate") return await translateText(req, res);
    if (req.method === "POST" && url.pathname === "/api/extract") return await extractClinical(req, res);
    if (req.method === "POST" && url.pathname === "/api/speak") return await synthesizeSpeech(req, res);
    if (req.method === "POST" && url.pathname === "/api/sync") return await syncSubmission(req, res);
    if (req.method === "POST" && url.pathname === "/api/fhir") {
      const body = await readJson(req);
      return sendJson(res, 200, makeFhirBundle(body));
    }
    if (req.method === "GET" && url.pathname === "/api/submissions") return sendJson(res, 200, memory.submissions);
    if (req.method === "GET" && url.pathname === "/api/health") {
      const gemmaAvailable = await checkGemmaAvailable();
      return sendJson(res, 200, {
        ok: true,
        providers: {
          openai: Boolean(OPENAI_API_KEY),
          elevenlabs: Boolean(ELEVENLABS_API_KEY),
          gemma: gemmaAvailable,
          gemmaConfigured: GEMMA_PROVIDER !== "mock",
          gemmaProvider: GEMMA_PROVIDER,
          gemmaModel: GEMMA_MODEL,
          clinicSync: CLINIC_SYNC_ENABLED
        }
      });
    }
    return sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, withSecurityHeaders({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }));
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  const content = await readFile(filePath);
  res.writeHead(200, withSecurityHeaders({
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  }));
  res.end(content);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
  return serveStatic(req, res, url);
}).listen(PORT, HOST, () => {
  console.log(`Care Bridge Gemma 4 demo running at http://${HOST}:${PORT}`);
});
