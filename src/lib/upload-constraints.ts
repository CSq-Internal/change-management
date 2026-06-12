// Client-safe upload constraints, shared between the form (client) and the
// documents server module (authoritative check). No server-only imports here.

export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

// Extensions for the file picker's `accept` attribute (PDF + Office + images).
export const ACCEPT_EXTENSIONS = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"
