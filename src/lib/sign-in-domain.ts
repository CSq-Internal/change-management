const ALLOWED_SUFFIX = "@csquared.com"

/** The CMS is internal: only CSquared Google Workspace accounts may sign in or be onboarded. */
export function isAllowedSignInEmail(email: unknown): boolean {
  if (typeof email !== "string") return false
  const normalized = email.trim().toLowerCase()
  return normalized.length > ALLOWED_SUFFIX.length && normalized.endsWith(ALLOWED_SUFFIX)
}
