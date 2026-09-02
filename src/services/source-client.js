export async function extractPublicSource(source, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/api/sources/extract", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url: source.url }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "网页解析失败，请重新启动本地服务后重试；仍失败时可手动补充正文");
  return payload;
}
