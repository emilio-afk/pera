import {
  analyzeQPCWithOpenAI,
  consumeRateLimit,
  hasAtLeastOneSection,
  methodNotAllowed,
  optionsResponse,
  parseJsonBody,
  response,
  sanitizeQPCPayload,
} from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const body = parseJsonBody(event);
    const payload = sanitizeQPCPayload(body);

    if (!hasAtLeastOneSection(payload)) {
      return response(400, {
        error: "Debes completar al menos una seccion QPC.",
      });
    }

    const rate = consumeRateLimit(event);
    if (!rate.allowed) {
      return response(429, {
        error: `Limite diario alcanzado (${rate.limit} analisis por cliente).`,
        code: "rate_limit_exceeded",
        usage: {
          count: rate.count,
          remaining: rate.remaining,
          limit: rate.limit,
        },
      });
    }

    const analysis = await analyzeQPCWithOpenAI(payload);
    return response(200, {
      analysis,
      usage: {
        count: rate.count,
        remaining: rate.remaining,
        limit: rate.limit,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno.";
    return response(500, { error: message });
  }
}
