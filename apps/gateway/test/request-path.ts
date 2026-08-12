/** Preserve path + query when routing fetch() through `gateway.app.request`. */
export function honoRequestPath(input: RequestInfo | URL): string {
  const raw = String(input instanceof Request ? input.url : input);
  if (!raw.startsWith("http")) return raw;
  const url = new URL(raw);
  return `${url.pathname}${url.search}`;
}
