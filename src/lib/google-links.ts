// Client-safe: pure URL parsing, no googleapis import. Used by both the request
// form (inline validation) and the server (authoritative gate).
const ALLOWED_HOSTS = new Set(["docs.google.com", "drive.google.com"])

export function isGoogleWorkspaceUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname)
}
