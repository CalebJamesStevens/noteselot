export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[/\\]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
