// Shared by the email layout and the dispatcher. Kept in its own module so the
// template components don't import from src/server/email.tsx (which imports them).
export const EMAIL_BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000"
export const BRAND = "#0a3d91"
