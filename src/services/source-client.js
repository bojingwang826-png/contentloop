import { requestJson } from "./request-json.js";

export async function extractPublicSource(source, fetchImpl = globalThis.fetch) {
  return requestJson("/api/sources/extract", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url: source.url }),
  }, fetchImpl, 35000);
}
