const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escapes HTML special characters for safe interpolation outside JSX.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

/**
 * Normalizes and sanitizes user-provided note text for safe React rendering.
 * Strips non-printable control characters while preserving readable text.
 */
export function sanitizeUserNote(note, maxLength = 280) {
  if (note == null) return ''
  let stripped = ''
  const raw = String(note)
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    stripped += code < 32 || code === 127 ? ' ' : raw[i]
  }
  const cleaned = stripped.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength - 1)}…`
}
