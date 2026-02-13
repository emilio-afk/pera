import {
  analyzeWithOpenAI,
  hasAtLeastOneSection,
  methodNotAllowed,
  optionsResponse,
  parseJsonBody,
  response,
  sanitizePayload,
} from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const body = parseJsonBody(event);
    const payload = sanitizePayload(body);

    if (!hasAtLeastOneSection(payload)) {
      return response(400, { error: "Debes completar al menos una seccion PERA." });
    }

    const analysis = await analyzeWithOpenAI(payload);
    return response(200, { analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno.";
    return response(500, { error: message });
  }
}
