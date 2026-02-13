import { OPENAI_MODEL, methodNotAllowed, optionsResponse, response } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "GET") return methodNotAllowed();

  return response(200, {
    ok: true,
    provider: "netlify-functions",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: OPENAI_MODEL,
  });
}
