const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const HTML_TAG_REGEX = /<[^>]*(?:>|$)/g

function isWhitespaceControl(code) {
  return code >= 9 && code <= 13
}

function isDisallowedControlOrInvisible(code) {
  return (
    code < 32 ||
    code === 127 ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

function normalizeControlWhitespace(raw) {
  const str = String(raw ?? '')
  let out = ''
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i)
    out += isWhitespaceControl(code) ? ' ' : str[i]
  }
  return out
}

function stripTagsAndControls(value) {
  let text = normalizeControlWhitespace(value)
  let prev = null
  while (prev !== text) {
    prev = text
    text = text.replace(HTML_TAG_REGEX, '')
  }
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const code = text.charCodeAt(i)
    if (ch === '<' || ch === '>' || isDisallowedControlOrInvisible(code)) {
      continue
    }
    out += ch
  }
  return out
}

/**
 * Escapes HTML special characters for safe interpolation outside JSX.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

/**
 * Normalizes and sanitizes SOS note text for interactive controlled inputs.
 * Strips control/invisible characters and angle brackets while clamping to maxLength.
 */
export function sanitizeSosNoteInput(value, maxLength = 200) {
  if (value == null) return ''
  let out = ''
  const raw = normalizeControlWhitespace(value)
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    const code = raw.charCodeAt(i)
    if (ch === '<' || ch === '>' || isDisallowedControlOrInvisible(code)) {
      continue
    }
    out += ch
  }
  return out.slice(0, maxLength)
}

/**
 * Normalizes and sanitizes user-provided note text for safe React rendering.
 * Strips HTML tags, angle brackets, and non-printable/invisible control characters.
 */
export function sanitizeUserNote(note, maxLength = 200) {
  if (note == null) return ''
  const cleaned = stripTagsAndControls(note).replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength - 1)}…`
}
