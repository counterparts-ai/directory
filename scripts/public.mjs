/*
 * Model text that goes out in public, on a pull request or an issue (review-decide.mjs,
 * intake-finish.mjs).
 */

/** Model text in a public comment: one line, no table breaks, no @mentions, no images. */
export const clean = (s, max = 600) =>
  String(s ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|").replace(/@(?=\w)/g, "@\u200b").replace(/!\[/g, "[").slice(0, max).trim();

/** Whatever the model was talked into writing, no secret goes out: REDACT_* values and anything shaped like a token. */
export function redact(text) {
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("REDACT_") && v && v.length >= 8) text = text.replaceAll(v, "[redacted]");
  return text.replace(/\b(sk-ant-[\w-]+|gh[opsur]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, "[redacted]");
}
