/**
 * Agent-initiated silent reply. When the model decides a message shouldn't
 * trigger a reply (to avoid pinging a group, or because ambient chatter doesn't
 * need a response), it emits "NO_REPLY" — either as the whole output or as a
 * trailing marker on an otherwise-normal reply — and we suppress the send.
 *
 * Design mirrors openclaw's SILENT_REPLY_TOKEN semantics so behaviour is
 * consistent across agent runtimes.
 */
export const SILENT_REPLY_TOKEN = "NO_REPLY";

const EXACT_RE = /^\s*NO_REPLY\s*$/;
const TRAILING_RE = /\s*NO_REPLY\s*$/;

/** True when the whole text is the silent marker (modulo whitespace). */
export function isSilentReplyText(text: string): boolean {
  if (!text) return false;
  return EXACT_RE.test(text);
}

/** Remove a trailing NO_REPLY marker, leaving the actual reply. */
export function stripSilentToken(text: string): string {
  return text.replace(TRAILING_RE, "").replace(/\s+$/, "");
}

/**
 * While streaming, the early prefix may look like it's about to be a lone
 * NO_REPLY. Use this to suppress mid-stream posts until we know whether the
 * model is actually going to produce real content.
 *
 * Returns true when the stream-so-far is empty, is a whitespace prefix of
 * NO_REPLY, or is NO_REPLY itself with trailing whitespace. Any character that
 * diverges from NO_REPLY proves the reply isn't silent, so we can stop gating.
 */
export function isSilentReplyPrefixText(text: string): boolean {
  if (!text) return true;
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed) return true;
  const upper = trimmed.toUpperCase();
  if (SILENT_REPLY_TOKEN.startsWith(upper)) return true;
  if (upper.startsWith(SILENT_REPLY_TOKEN)) {
    const rest = trimmed.slice(SILENT_REPLY_TOKEN.length);
    return /^\s*$/.test(rest);
  }
  return false;
}
