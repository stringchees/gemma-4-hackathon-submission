import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), "public");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GEMMA_API_URL = process.env.GEMMA_API_URL;
const GEMMA_API_KEY = process.env.GEMMA_API_KEY;
const CLINIC_SYNC_URL = process.env.CLINIC_SYNC_URL;

const memory = {
  submissions: []
};

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

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendAudio(res, status, buffer, contentType) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(Buffer.from(buffer));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readRequestBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function sampleTranscript(language) {
  if (language === "es") {
    return "Me duele el pecho desde hace dos dias. Tambien me falta el aire cuando camino.";
  }
  if (language === "fr") {
    return "J'ai mal a la poitrine depuis deux jours et je suis essouffle quand je marche.";
  }
  if (language === "hi") {
    return "Mujhe do din se seene me dard hai aur chalne par saans phoolti hai.";
  }
  return "I have had chest pain for two days and I get short of breath when I walk.";
}

function mockTranslate(text, targetLanguage) {
  const lower = text.toLowerCase();
  if (targetLanguage === "Spanish") {
    if (lower.includes("does the pain")) return "El dolor se extiende al brazo, la mandibula o la espalda?";
    if (lower.includes("trouble breathing") || lower.includes("shortness")) return "Tiene dificultad para respirar?";
    if (lower.includes("how severe")) return "Que tan fuerte es el dolor, de cero a diez?";
    if (lower.includes("medications")) return "Esta tomando algun medicamento ahora?";
    return "Traduccion al espanol: " + text;
  }
  if (targetLanguage === "French") {
    return "Traduction francaise: " + text;
  }
  if (targetLanguage === "Hindi") {
    return "Hindi translation: " + text;
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
  if (redFlags.length >= 1) return { urgency: "red", redFlags };
  if (lower.includes("fever") || lower.includes("fiebre") || lower.includes("vomit")) {
    return { urgency: "yellow", redFlags: ["possible infection or dehydration"] };
  }
  return { urgency: "green", redFlags };
}

function mockExtract({ transcript, sourceLanguage = "Spanish", targetLanguage = "English", existingForm = {} }) {
  const { urgency, redFlags } = detectUrgency(transcript);
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

  const questions = [];
  if (redFlags.includes("chest pain")) {
    questions.push({
      id: randomUUID(),
      questionEnglish: "Does the pain spread to your arm, jaw, or back?",
      questionPatientLanguage: mockTranslate("Does the pain spread to your arm, jaw, or back?", sourceLanguage),
      reason: "Chest pain with radiation can indicate a higher-risk presentation.",
      urgency: "red",
      asked: false,
      answer: ""
    });
    questions.push({
      id: randomUUID(),
      questionEnglish: "Are you having trouble breathing right now?",
      questionPatientLanguage: mockTranslate("Are you having trouble breathing right now?", sourceLanguage),
      reason: "Breathing difficulty changes triage priority.",
      urgency: "red",
      asked: false,
      answer: ""
    });
    questions.push({
      id: randomUUID(),
      questionEnglish: "How severe is the pain from zero to ten?",
      questionPatientLanguage: mockTranslate("How severe is the pain from zero to ten?", sourceLanguage),
      reason: "Severity helps the clinician prioritize and monitor change.",
      urgency: "yellow",
      asked: false,
      answer: ""
    });
  }
  questions.push({
    id: randomUUID(),
    questionEnglish: "Are you taking any medications right now?",
    questionPatientLanguage: mockTranslate("Are you taking any medications right now?", sourceLanguage),
    reason: "Medication history is needed before treatment.",
    urgency: "green",
    asked: false,
    answer: ""
  });

  return {
    triageId: existingForm.triageId || randomUUID(),
    patientId: existingForm.patientId || "local-patient-" + Math.floor(1000 + Math.random() * 9000),
    encounterId: existingForm.encounterId || randomUUID(),
    sourceLanguage,
    targetLanguage,
    chiefComplaint: symptoms[0]?.name || existingForm.chiefComplaint || "Unclear chief complaint",
    urgency,
    redFlags,
    symptoms,
    vitals: existingForm.vitals || {
      heartRate: "",
      temperature: "",
      bloodPressure: "",
      oxygenSaturation: ""
    },
    allergies: existingForm.allergies || [],
    medications: existingForm.medications || [],
    medicalHistory: existingForm.medicalHistory || [],
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
  const language = url.searchParams.get("language") || "";
  const audio = await readRequestBody(req);
  if (!OPENAI_API_KEY || !audio.length) {
    return sendJson(res, 200, {
      provider: "mock",
      text: sampleTranscript(language || "es"),
      language: language || "es"
    });
  }

  const formData = new FormData();
  formData.set("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  if (language) formData.set("language", language);
  formData.set("file", new Blob([audio], { type: req.headers["content-type"] || "audio/webm" }), "recording.webm");

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
    language: language || payload.language || ""
  });
}

async function translateText(req, res) {
  const body = await readJson(req);
  const { text = "", sourceLanguage = "Spanish", targetLanguage = "English" } = body;
  if (!OPENAI_API_KEY) {
    return sendJson(res, 200, {
      provider: "mock",
      text: targetLanguage === "English" ? text.replace("Me duele el pecho desde hace dos dias.", "I have had chest pain for two days.") : mockTranslate(text, targetLanguage)
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
  if (!GEMMA_API_URL) {
    return sendJson(res, 200, {
      provider: "mock-gemma4",
      submission: mockExtract(body)
    });
  }

  const response = await fetch(GEMMA_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GEMMA_API_KEY ? { authorization: `Bearer ${GEMMA_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: process.env.GEMMA_MODEL || "gemma-4-e4b-it",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a medical intake extraction assistant. Extract only stated facts, cite evidence, mark uncertainty, never diagnose, and generate follow-up questions in both English and the patient's language. Return JSON matching the triage submission schema."
        },
        {
          role: "user",
          content: JSON.stringify(body)
        }
      ]
    })
  });
  const payload = await response.json();
  if (!response.ok) return sendJson(res, response.status, payload);
  return sendJson(res, 200, {
    provider: "gemma4",
    submission: payload.submission || payload
  });
}

async function synthesizeSpeech(req, res) {
  const body = await readJson(req);
  const { text = "", voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM" } = body;
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
    return sendJson(res, response.status, { error: payload });
  }
  const buffer = await response.arrayBuffer();
  return sendAudio(res, 200, buffer, "audio/mpeg");
}

async function syncSubmission(req, res) {
  const submission = await readJson(req);
  const fhirBundle = makeFhirBundle(submission);
  const record = {
    id: submission.triageId || randomUUID(),
    submittedAt: new Date().toISOString(),
    submission,
    fhirBundle,
    status: CLINIC_SYNC_URL ? "forwarded" : "stored_locally"
  };
  memory.submissions.unshift(record);

  if (CLINIC_SYNC_URL) {
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
      return sendJson(res, 200, {
        ok: true,
        providers: {
          openai: Boolean(OPENAI_API_KEY),
          elevenlabs: Boolean(ELEVENLABS_API_KEY),
          gemma: Boolean(GEMMA_API_URL),
          clinicSync: Boolean(CLINIC_SYNC_URL)
        }
      });
    }
    return sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  const content = await readFile(filePath);
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(content);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
  return serveStatic(req, res, url);
}).listen(PORT, () => {
  console.log(`Care Bridge Gemma 4 demo running at http://localhost:${PORT}`);
});
