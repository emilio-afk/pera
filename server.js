const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = process.cwd();
loadEnvFile(path.join(ROOT, ".env"));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const parsedRateLimit = Number(process.env.RATE_LIMIT_PER_DAY || 12);
const RATE_LIMIT_PER_DAY = Number.isFinite(parsedRateLimit)
  ? Math.max(1, Math.floor(parsedRateLimit))
  : 12;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const MAX_BODY_SIZE = 1_000_000;
const rateLimitStore = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function loadEnvFile(filePath) {
  let content = "";
  try {
    content = fsSync.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(res, status, payload) {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function normalizeInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIdentifier(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isAdminRequest(req) {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers["x-admin-token"] || "";
  return auth === ADMIN_TOKEN;
}

function consumeRateLimit(clientId, isAdmin = false) {
  // Admin users bypass rate limiting completely
  if (isAdmin) {
    return {
      allowed: true,
      count: 0,
      limit: Infinity,
      remaining: Infinity,
    };
  }

  const key = `${clientId}:${getTodayKey()}`;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Payload demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON invalido."));
      }
    });

    req.on("error", reject);
  });
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
    "3) alternativas diferentes entre si.",
    "4) Mantener coherencia con tono, formalidad y objetivo.",
  ].join("\n");
}

function buildQPCPrompt(payload) {
  const sections = payload.sections || {};
  const settings = payload.settings || {};

  return [
    "Analiza y mejora este mensaje QPC (Que, Por que, Como) en espanol.",
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
    "CONTENIDO QPC:",
    `Que: ${normalizeInput(sections.que) || "(vacio)"}`,
    `Por que: ${normalizeInput(sections.porque) || "(vacio)"}`,
    `Como: ${normalizeInput(sections.como) || "(vacio)"}`,
    "",
    "JSON OBJETIVO:",
    '{"summary":"","scores":{"clarity":0,"coherence":0,"persuasion":0,"actionability":0},"section_feedback":{"que":{"diagnosis":"","suggestion":"","rewrite":""},"porque":{"diagnosis":"","suggestion":"","rewrite":""},"como":{"diagnosis":"","suggestion":"","rewrite":""}},"full_rewrite":"","alternatives":[{"label":"","text":""},{"label":"","text":""},{"label":"","text":""}],"next_step":""}',
    "",
    "Reglas:",
    "1) Puntajes entre 0 y 100.",
    "2) Reescrituras concisas y accionables.",
    "3) alternativas diferentes entre si.",
    "4) Mantener coherencia con tono, formalidad y objetivo.",
  ].join("\n");
}

async function analyzeWithOpenAI(payload) {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en el entorno del servidor.");
  }

  const systemPrompt =
    "Eres un coach experto en comunicacion persuasiva. Respondes estrictamente en JSON valido.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildPrompt(payload) },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Error OpenAI (${response.status}): ${raw.slice(0, 300)}`);
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

async function analyzeQPCWithOpenAI(payload) {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en el entorno del servidor.");
  }

  const systemPrompt =
    "Eres un coach experto en comunicacion ejecutiva y persuasiva. Respondes estrictamente en JSON valido.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildQPCPrompt(payload) },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Error OpenAI (${response.status}): ${raw.slice(0, 300)}`);
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

function sanitizePayload(body) {
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

function sanitizeQPCPayload(body) {
  const sections = body?.sections || {};
  const settings = body?.settings || {};

  return {
    sections: {
      que: normalizeInput(sections.que),
      porque: normalizeInput(sections.porque),
      como: normalizeInput(sections.como),
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

function hasAtLeastOneSection(payload) {
  return Object.values(payload.sections).some(Boolean);
}

async function serveStaticFile(res, pathname) {
  const finalPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.resolve(path.join(ROOT, finalPath));
  const relativePath = path.relative(ROOT, safePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    sendText(res, 200, data, type);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const { pathname } = reqUrl;

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && pathname === "/api/pera/analyze") {
    try {
      const body = await readBody(req);
      const payload = sanitizePayload(body);

      if (!hasAtLeastOneSection(payload)) {
        sendJson(res, 400, { error: "Debes completar al menos una seccion PERA." });
        return;
      }

      const rate = consumeRateLimit(getClientIdentifier(req), isAdminRequest(req));

      if (!rate.allowed) {
        sendJson(res, 429, {
          error: `Limite diario alcanzado (${rate.limit} analisis por cliente).`,
          code: "rate_limit_exceeded",
          usage: {
            count: rate.count,
            remaining: rate.remaining,
            limit: rate.limit,
          },
        });
        return;
      }

      const analysis = await analyzeWithOpenAI(payload);
      sendJson(res, 200, {
        analysis,
        usage: {
          count: rate.count,
          remaining: rate.remaining,
          limit: rate.limit,
        },
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno.";
      sendJson(res, 500, { error: message });
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/qpc/analyze") {
    try {
      const body = await readBody(req);
      const payload = sanitizeQPCPayload(body);

      if (!hasAtLeastOneSection(payload)) {
        sendJson(res, 400, { error: "Debes completar al menos una seccion QPC." });
        return;
      }

      const rate = consumeRateLimit(getClientIdentifier(req), isAdminRequest(req));

      if (!rate.allowed) {
        sendJson(res, 429, {
          error: `Limite diario alcanzado (${rate.limit} analisis por cliente).`,
          code: "rate_limit_exceeded",
          usage: {
            count: rate.count,
            remaining: rate.remaining,
            limit: rate.limit,
          },
        });
        return;
      }

      const analysis = await analyzeQPCWithOpenAI(payload);
      sendJson(res, 200, {
        analysis,
        usage: {
          count: rate.count,
          remaining: rate.remaining,
          limit: rate.limit,
        },
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno.";
      sendJson(res, 500, { error: message });
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/health") {
    const admin = isAdminRequest(req);
    sendJson(res, 200, {
      ok: true,
      openaiConfigured: Boolean(OPENAI_API_KEY),
      model: OPENAI_MODEL,
      rateLimitPerDay: admin ? 999999 : RATE_LIMIT_PER_DAY,
      admin,
    });
    return;
  }

  if (req.method === "GET") {
    await serveStaticFile(res, pathname);
    return;
  }

  sendText(res, 405, "Method Not Allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor PERA IA activo en http://localhost:${PORT}`);
});
