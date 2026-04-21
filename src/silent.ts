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

/**
 * Append to the system prompt in multi-party contexts (group chats, public
 * channels) so the agent can opt out of replying when its turn isn't warranted
 * — e.g. two humans talking to each other, an off-topic aside, or a reaction
 * that doesn't need a verbal response.
 *
 * The example below is intentionally written WITHOUT backticks, quotes, or
 * markdown around the token. Models copy surrounding formatting from examples,
 * so any wrapping here leaks into the output (we observed `NO_REPLY` with
 * backticks shipping through). The rules list then explicitly forbids those
 * wrappings for defence-in-depth; `isSilentReplyText` still tolerates common
 * wrappers so a single slip doesn't leak.
 */
export const SILENT_REPLY_PROMPT = [
  "## Silent Replies",
  "",
  "You are in a multi-party channel. Not every message needs a reply from you — e.g. two other people are talking to each other, the message is not addressed to you, it is an off-topic aside, or you genuinely have nothing meaningful to add.",
  "",
  "In those cases, output exactly this and nothing else:",
  "",
  "NO_REPLY",
  "",
  "Strict rules:",
  "- Output must be those 8 characters alone. No backticks, no quotes, no bold, no code fence, no trailing period, no emoji, no leading or trailing text.",
  "- Never embed NO_REPLY inside a sentence or explanation. If you want to say anything at all, just reply normally and do NOT include the token.",
  "- When unsure whether to chime in, prefer silence.",
].join("\n");

// Wrappings models commonly add even when told not to: backticks, markdown
// emphasis, quotes, code fences, trailing punctuation. Stripping these before
// comparing means `NO_REPLY`, **NO_REPLY**, "NO_REPLY.", NO_REPLY。 etc. all
// count as silent — one stray formatting character shouldn't leak the token.
const WRAP_CHARS = "`\"'*_~";
const END_PUNCT = ".!?;:。！？；：,，";
const LEAD_RE = new RegExp(`^[${WRAP_CHARS}\\s]+`);
const TAIL_RE = new RegExp(`[${WRAP_CHARS}${END_PUNCT}\\s]+$`);
const EXACT_RE = /^\s*NO_REPLY\s*$/;
const TRAILING_RE = new RegExp(
  `\\s*[${WRAP_CHARS}]*NO_REPLY[${WRAP_CHARS}${END_PUNCT}\\s]*$`,
);

function normalizeSilent(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```[a-zA-Z0-9]*\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return t.replace(LEAD_RE, "").replace(TAIL_RE, "");
}

/** True when the whole text is the silent marker (tolerating common wrappers). */
export function isSilentReplyText(text: string): boolean {
  if (!text) return false;
  if (EXACT_RE.test(text)) return true;
  return normalizeSilent(text) === SILENT_REPLY_TOKEN;
}

/** Remove a trailing NO_REPLY marker (with optional wrappers), leaving the actual reply. */
export function stripSilentToken(text: string): string {
  return text.replace(TRAILING_RE, "").replace(/\s+$/, "");
}

/**
 * While streaming, the early prefix may look like it's about to be a lone
 * NO_REPLY. Use this to suppress mid-stream posts until we know whether the
 * model is actually going to produce real content.
 *
 * Returns true when the stream-so-far is empty, is a prefix of NO_REPLY (with
 * optional leading wrappers like a backtick), or is NO_REPLY itself with only
 * trailing wrappers/punctuation/whitespace. Any character that diverges from
 * NO_REPLY proves the reply isn't silent, so we can stop gating.
 */
export function isSilentReplyPrefixText(text: string): boolean {
  if (!text) return true;
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed) return true;
  const stripped = trimmed.replace(LEAD_RE, "");
  if (!stripped) return true;
  const upper = stripped.toUpperCase();
  if (SILENT_REPLY_TOKEN.startsWith(upper)) return true;
  if (upper.startsWith(SILENT_REPLY_TOKEN)) {
    const rest = stripped.slice(SILENT_REPLY_TOKEN.length);
    if (rest === "") return true;
    return TAIL_RE.test(rest);
  }
  return false;
}
