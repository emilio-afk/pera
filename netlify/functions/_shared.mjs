const MAX_BODY_SIZE = 1_000_000;
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const parsedRateLimit = Number(process.env.RATE_LIMIT_PER_DAY || 12);
export const RATE_LIMIT_PER_DAY = Number.isFinite(parsedRateLimit)
  ? Math.max(1, Math.floor(parsedRateLimit))
  : 12;
const rateLimitStore = new Map();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  };
}

export function optionsResponse() {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: "",
  };
}

export function methodNotAllowed() {
  return response(405, { error: "Method Not Allowed" });
}

export function normalizeInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIdentifier(event) {
  const headers = event?.headers || {};
  const forwarded = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

export function consumeRateLimit(event) {
  const key = `${getClientIdentifier(event)}:${getTodayKey()}`;
  const current = rateLimitStore.get(key) || 0;

  if (current >= RATE_LIMIT_PER_DAY) {
    return {
      allowed: false,
      count: current,
      limit: RATE_LIMIT_PER_DAY,
      remaining: 0,
    };
  }

  const next = current + 1;
  rateLimitStore.set(key, next);
  return {
    allowed: true,
    count: next,
    limit: RATE_LIMIT_PER_DAY,
    remaining: Math.max(0, RATE_LIMIT_PER_DAY - next),
  };
}

export function parseJsonBody(event) {
  const raw = event?.body;
  if (!raw) return {};

  let bodyText = raw;
  if (event?.isBase64Encoded) {
    bodyText = Buffer.from(raw, "base64").toString("utf8");
  }

  if (bodyText.length > MAX_BODY_SIZE) {
    throw new Error("Payload demasiado grande.");
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error("JSON invalido.");
  }
}

export function sanitizePayload(body) {
  const sections = body?.sections || {};
  const settings = body?.settings || {};

  return {
    sections: {
      point: normalizeInput(sections.point),
      example: normalizeInput(sections.example),
      reasons: normalizeInput(sections.reasons),
      action: normalizeInput(sections.action),
    },
    settings: {
      tone: normalizeInput(settings.tone),
      formality: normalizeInput(settings.formality),
      objective: normalizeInput(settings.objective),
      audience: normalizeInput(settings.audience),
      channel: normalizeInput(settings.channel),
      length: normalizeInput(settings.length),
      industry: normalizeInput(settings.industry),
      urgency: normalizeInput(settings.urgency),
      argument_style: normalizeInput(settings.argument_style),
      cta_type: normalizeInput(settings.cta_type),
    },
  };
}

export function hasAtLeastOneSection(payload) {
  return Object.values(payload.sections || {}).some(Boolean);
}

function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildPrompt(payload) {
  const sections = payload.sections || {};
  const settings = payload.settings || {};

  return [
    "Analiza y mejora este mensaje PERA en espanol.",
    "Devuelve solo JSON valido sin markdown.",
    "",
    "CONFIGURACION:",
    `- Tono: ${normalizeInput(settings.tone) || "formal"}`,
    `- Formalidad: ${normalizeInput(settings.formality) || "medio"}`,
    `- Objetivo: ${normalizeInput(settings.objective) || "informar"}`,
    `- Audiencia: ${normalizeInput(settings.audience) || "general"}`,
    `- Canal: ${normalizeInput(settings.channel) || "presentacion"}`,
    `- Longitud: ${normalizeInput(settings.length) || "media"}`,
    `- Industria: ${normalizeInput(settings.industry) || "general"}`,
    `- Urgencia: ${normalizeInput(settings.urgency) || "media"}`,
    `- Estilo argumentativo: ${normalizeInput(settings.argument_style) || "balanceado"}`,
    `- Tipo de llamada a la accion: ${normalizeInput(settings.cta_type) || "directa"}`,
    "",
    "CONTENIDO PERA:",
    `Punto: ${normalizeInput(sections.point) || "(vacio)"}`,
    `Ejemplo: ${normalizeInput(sections.example) || "(vacio)"}`,
    `Razones: ${normalizeInput(sections.reasons) || "(vacio)"}`,
    `Accion: ${normalizeInput(sections.action) || "(vacio)"}`,
    "",
    "JSON OBJETIVO:",
    '{"summary":"","scores":{"clarity":0,"coherence":0,"persuasion":0,"actionability":0},"section_feedback":{"point":{"diagnosis":"","suggestion":"","rewrite":""},"example":{"diagnosis":"","suggestion":"","rewrite":""},"reasons":{"diagnosis":"","suggestion":"","rewrite":""},"action":{"diagnosis":"","suggestion":"","rewrite":""}},"full_rewrite":"","alternatives":[{"label":"","text":""},{"label":"","text":""},{"label":"","text":""}],"next_step":""}',
    "",
    "Reglas:",
    "1) Puntajes entre 0 y 100.",
    "2) Reescrituras concisas y accionables.",
    "3) Alternativas diferentes entre si.",
    "4) Mantener coherencia con tono, formalidad y objetivo.",
  ].join("\n");
}

export async function analyzeWithOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("Falta OPENAI_API_KEY en las variables de entorno de Netlify.");
  }

  const responseApi = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Eres un coach experto en comunicacion persuasiva. Respondes estrictamente en JSON valido.",
        },
        { role: "user", content: buildPrompt(payload) },
      ],
    }),
  });

  const raw = await responseApi.text();
  if (!responseApi.ok) {
    throw new Error(`Error OpenAI (${responseApi.status}): ${raw.slice(0, 300)}`);
  }

  let parsedApi;
  try {
    parsedApi = JSON.parse(raw);
  } catch {
    throw new Error("No se pudo interpretar la respuesta del API de OpenAI.");
  }

  const content = parsedApi?.choices?.[0]?.message?.content;
  const analysis = safeJsonParse(content);
  if (!analysis) {
    throw new Error("La IA no devolvio JSON valido para el analisis.");
  }

  return analysis;
}
