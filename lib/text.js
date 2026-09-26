// Lines and line endings of a text file. A leaf: it imports nothing from lib/, so every parser
// can share it without an import cycle.
export function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitLines(text) {
  return text.split(/\r?\n/);
}
