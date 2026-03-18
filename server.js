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

  const tone        = normalizeInput(settings.tone)           || "formal";
  const formality   = normalizeInput(settings.formality)      || "medio";
  const objective   = normalizeInput(settings.objective)      || "informar";
  const audience    = normalizeInput(settings.audience)       || "audiencia general";
  const channel     = normalizeInput(settings.channel)        || "presentacion";
  const length      = normalizeInput(settings.length)         || "media";
  const industry    = normalizeInput(settings.industry)       || "general";
  const urgency     = normalizeInput(settings.urgency)        || "media";
  const argStyle    = normalizeInput(settings.argument_style) || "balanceado";
  const ctaType     = normalizeInput(settings.cta_type)       || "directa";

  const point   = normalizeInput(sections.point)   || "(vacio)";
  const example = normalizeInput(sections.example) || "(vacio)";
  const reasons = normalizeInput(sections.reasons) || "(vacio)";
  const action  = normalizeInput(sections.action)  || "(vacio)";

  return `Eres el ultimo revisor de este mensaje PERA antes de que llegue a su audiencia. Tu trabajo es diagnosticar con precision y proponer mejoras que eleven el impacto real del mensaje.

=== CONTEXTO DE ENTREGA ===
- Objetivo comunicacional: ${objective}
- Audiencia especifica: ${audience}
- Canal de entrega: ${channel}
- Tono deseado: ${tone}
- Nivel de formalidad: ${formality}
- Longitud esperada: ${length}
- Industria / contexto: ${industry}
- Nivel de urgencia: ${urgency}
- Estilo argumentativo: ${argStyle}
- Tipo de CTA: ${ctaType}

=== MENSAJE PERA A ANALIZAR ===
[P] PUNTO — la idea central que debe recordar la audiencia:
${point}

[E] EJEMPLO — historia especifica que ilustra el Punto:
${example}

[R] RAZONES — datos, autoridad o logica que validan el Punto:
${reasons}

[A] ACCION — instruccion especifica: quien hace que y para cuando:
${action}

=== RUBRICA DE EVALUACION (sé honesto, diferencia los puntajes) ===

CLARIDAD (0-100):
- 90-100: Cada idea se entiende en una sola lectura; vocabulario perfecto para la audiencia y el canal.
- 70-89: Ideas claras pero con alguna ambiguedad o termino innecesariamente complejo.
- 50-69: Requiere releer alguna parte; hay oraciones largas o conceptos que se mezclan.
- 0-49: Confuso, ambiguo o con jerga inapropiada para la audiencia.

COHERENCIA (0-100):
- 90-100: El hilo conductor es solido; P→E→R→A fluyen como un argumento unico y sin costuras.
- 70-89: La estructura es visible pero algun bloque no conecta de forma natural con el anterior.
- 50-69: Los bloques existen de forma aislada; no construyen juntos hacia un argumento.
- 0-49: La estructura PERA no es perceptible; el mensaje parece desordenado o contradictorio.

PERSUASION (0-100):
- 90-100: Combina impacto emocional + evidencia racional de forma irresistible para esta audiencia concreta.
- 70-89: Persuade, pero le falta fuerza en alguna dimension (emocional o racional).
- 50-69: El argumento existe pero no genera urgencia ni tension; la audiencia puede ignorarlo.
- 0-49: Debil, predecible o generico; no mueve a esta audiencia especifica.

ACCIONABILIDAD (0-100):
- 90-100: La accion es especifica (quien, que, cuando), alcanzable y con nivel de compromiso calibrado al canal.
- 70-89: La accion es clara pero le falta especificidad o el nivel de compromiso no es optimo.
- 50-69: Hay una peticion pero es vaga, muy grande o mal dimensionada para el contexto.
- 0-49: No hay accion clara, o la accion pedida es irreal o desproporcionada.

=== INSTRUCCIONES PARA EL ANALISIS ===
1. DIAGNOSTICO: identifica el problema ESPECIFICO, no generalidades. Cita el texto exacto que falla si es posible.
2. SUGERENCIA: propone la mejora MAS IMPACTANTE, no un listado exhaustivo. Una sola direccion clara.
3. REWRITE: reescritura completa del bloque, sustancialmente mejor (no un retoque cosmético). Debe sonar natural para el canal y la audiencia. Usa **negrita** para resaltar 2-4 palabras o frases clave dentro del rewrite.
4. FULL_REWRITE: version integrada del mensaje completo que fluye como texto continuo, no como lista de bloques. Aplica todas las mejoras con coherencia. Usa **negrita** para resaltar los terminos y frases mas importantes del mensaje final.
5. ALTERNATIVAS: 3 versiones con enfoques genuinamente distintos entre si. Usa **negrita** en cada una para destacar la frase de mayor impacto:
   - "Version emocional": prioriza la conexion humana y la historia.
   - "Version datos": prioriza evidencia, cifras y logica.
   - "Version directa": version ultra-concisa y de alto impacto para contextos de poco tiempo.
6. SUMMARY: 1-2 oraciones que capturan el diagnostico mas importante. Como lo que dirias al cliente en los primeros 10 segundos de retroalimentacion. Usa **negrita** en la frase mas critica.
7. NEXT_STEP: la UNA accion mas impactante que el usuario debe hacer ahora mismo para mejorar este mensaje. Usa **negrita** en el verbo de accion principal.
8. DIAGNOSIS y SUGGESTION: usa **negrita** para destacar el problema especifico o la mejora recomendada.
9. Los puntajes deben ser honestos y diferenciados entre si. Evita la zona comoda de dar todo entre 70-80. Si algo es debil, refleja que es debil (40-55).

=== FORMATO DE RESPUESTA ===
Unicamente JSON valido sin ningun markdown exterior. Schema exacto:
{"summary":"","scores":{"clarity":0,"coherence":0,"persuasion":0,"actionability":0},"section_feedback":{"point":{"diagnosis":"","suggestion":"","rewrite":""},"example":{"diagnosis":"","suggestion":"","rewrite":""},"reasons":{"diagnosis":"","suggestion":"","rewrite":""},"action":{"diagnosis":"","suggestion":"","rewrite":""}},"full_rewrite":"","alternatives":[{"label":"","text":""},{"label":"","text":""},{"label":"","text":""}],"next_step":""}`;
}

function buildQPCPrompt(payload) {
  const sections = payload.sections || {};
  const settings = payload.settings || {};

  const tone        = normalizeInput(settings.tone)           || "formal";
  const formality   = normalizeInput(settings.formality)      || "medio";
  const objective   = normalizeInput(settings.objective)      || "informar";
  const audience    = normalizeInput(settings.audience)       || "audiencia general";
  const channel     = normalizeInput(settings.channel)        || "presentacion";
  const length      = normalizeInput(settings.length)         || "media";
  const industry    = normalizeInput(settings.industry)       || "general";
  const urgency     = normalizeInput(settings.urgency)        || "media";
  const argStyle    = normalizeInput(settings.argument_style) || "balanceado";
  const ctaType     = normalizeInput(settings.cta_type)       || "directa";

  const que     = normalizeInput(sections.que)     || "(vacio)";
  const porque  = normalizeInput(sections.porque)  || "(vacio)";
  const como    = normalizeInput(sections.como)    || "(vacio)";

  return `Eres el ultimo revisor de este mensaje QPC antes de que llegue a su audiencia. Tu trabajo es diagnosticar con precision y proponer mejoras que eleven el impacto real del mensaje.

=== CONTEXTO DE ENTREGA ===
- Objetivo comunicacional: ${objective}
- Audiencia especifica: ${audience}
- Canal de entrega: ${channel}
- Tono deseado: ${tone}
- Nivel de formalidad: ${formality}
- Longitud esperada: ${length}
- Industria / contexto: ${industry}
- Nivel de urgencia: ${urgency}
- Estilo argumentativo: ${argStyle}
- Tipo de CTA: ${ctaType}

=== MENSAJE QPC A ANALIZAR ===
[Q] QUE — intencion clara + detonante especifico que justifica el mensaje ahora:
${que}

[P] POR QUE — evidencia concreta y relevancia para esta audiencia:
${porque}

[C] COMO — pasos operativos concretos, secuenciales y con responsables / tiempos:
${como}

=== RUBRICA DE EVALUACION (sé honesto, diferencia los puntajes) ===

CLARIDAD (0-100):
- 90-100: Intencion y detonante son inmediatamente comprensibles; vocabulario preciso para la audiencia.
- 70-89: La idea es clara pero con algun rodeo o termino que no encaja perfectamente.
- 50-69: El mensaje requiere esfuerzo para entenderse; hay ambiguedad en la intencion o el detonante.
- 0-49: Confuso; la audiencia no sabra que se le esta pidiendo o por que.

COHERENCIA (0-100):
- 90-100: Q→P→C forman un argumento solido y progresivo; cada bloque refuerza al siguiente.
- 70-89: La estructura es visible pero algun bloque rompe el flujo o repite informacion.
- 50-69: Los tres bloques existen pero parecen independientes; no construyen un argumento unico.
- 0-49: La piramide QPC no es perceptible; el mensaje no tiene logica interna clara.

PERSUASION (0-100):
- 90-100: La evidencia y la relevancia son irresistibles para esta audiencia; genera urgencia genuina.
- 70-89: Persuade parcialmente; le falta fuerza en la evidencia o en la conexion con la audiencia.
- 50-69: El argumento existe pero es generco; la audiencia puede postergar la decision.
- 0-49: No genera urgencia ni conviction; la audiencia no ve razon para actuar.

ACCIONABILIDAD (0-100):
- 90-100: Los pasos del Como son especificos, secuenciales, con duenos y plazos claros.
- 70-89: Los pasos son comprensibles pero les falta especificidad o algun responsable / plazo.
- 50-69: Hay una direccion pero los pasos son vagos o dificiles de ejecutar sin mas informacion.
- 0-49: No hay pasos claros; la audiencia no sabra por donde empezar.

=== INSTRUCCIONES PARA EL ANALISIS ===
1. DIAGNOSTICO: identifica el problema ESPECIFICO de cada bloque. Cita el texto exacto que falla si es posible.
2. SUGERENCIA: la mejora MAS IMPACTANTE para ese bloque; una sola direccion clara, no una lista.
3. REWRITE: reescritura completa del bloque, sustancialmente mejor. Que suene natural para el canal y la audiencia. Usa **negrita** para resaltar 2-4 palabras o frases clave dentro del rewrite.
4. FULL_REWRITE: version integrada del mensaje completo que fluye como texto ejecutivo continuo. Aplica todas las mejoras con coherencia interna. Usa **negrita** para resaltar los terminos y frases mas importantes del mensaje final.
5. ALTERNATIVAS: 3 versiones con enfoques genuinamente distintos entre si. Usa **negrita** en cada una para destacar la frase de mayor impacto:
   - "Version estrategica": enmarca el mensaje como decision estrategica de alto nivel.
   - "Version operativa": foco en los pasos concretos y la ejecucion inmediata.
   - "Version concisa": version ultra-corta de alto impacto, maxima densidad de informacion.
6. SUMMARY: 1-2 oraciones que capturan el diagnostico mas importante del mensaje completo. Usa **negrita** en la frase mas critica.
7. NEXT_STEP: la UNA accion que mas impacto tendra si el usuario la hace ahora mismo. Usa **negrita** en el verbo de accion principal.
8. DIAGNOSIS y SUGGESTION: usa **negrita** para destacar el problema especifico o la mejora recomendada.
9. Los puntajes deben ser honestos y diferenciados. Evita la zona comoda de 70-80 para todo. Si algo es debil, muestra que es debil (40-55).

=== FORMATO DE RESPUESTA ===
Unicamente JSON valido sin ningun markdown exterior. Schema exacto:
{"summary":"","scores":{"clarity":0,"coherence":0,"persuasion":0,"actionability":0},"section_feedback":{"que":{"diagnosis":"","suggestion":"","rewrite":""},"porque":{"diagnosis":"","suggestion":"","rewrite":""},"como":{"diagnosis":"","suggestion":"","rewrite":""}},"full_rewrite":"","alternatives":[{"label":"","text":""},{"label":"","text":""},{"label":"","text":""}],"next_step":""}`;
}

async function analyzeWithOpenAI(payload) {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en el entorno del servidor.");
  }

  const systemPrompt =
    "Eres un coach senior de comunicacion ejecutiva con amplia experiencia asesorando a lideres en Latinoamerica. Tu especialidad es el framework PERA (Punto-Ejemplo-Razones-Accion). Eres directo, especifico y accionable en tu retroalimentacion — no diplomatico en exceso. Identificas exactamente donde falla el mensaje y propones la mejora mas impactante, no la mas segura. Respondes EXCLUSIVAMENTE en JSON valido segun el schema solicitado.";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildPrompt(payload) },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

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
    "Eres un coach senior de comunicacion ejecutiva con amplia experiencia asesorando a lideres en Latinoamerica. Tu especialidad es la Piramide QPC (Que-Por que-Como) para comunicacion estrategica y operativa. Eres directo, especifico y accionable — no diplomatico en exceso. Identificas exactamente donde falla el mensaje y propones la mejora mas impactante, no la mas segura. Respondes EXCLUSIVAMENTE en JSON valido segun el schema solicitado.";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildQPCPrompt(payload) },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

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
