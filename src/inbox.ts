/**
 * Per-thread inbox: cross-session activity that happened while a thread's
 * SDK session was idle. The runner drains these entries and prepends them
 * to the next user prompt so the resumed session can "see" what happened.
 *
 * Storage: .claude/claudeclaw/inbox/<safeKey>.jsonl
 *   - threadKey "global"                — Telegram bridge + main session
 *   - threadKey "<channelId>"           — Discord per-channel session
 *
 * Single-daemon assumption: appendFile + read+unlink is "atomic enough".
 */
import { join } from "path";
import { appendFile, mkdir, readFile, unlink } from "fs/promises";

const INBOX_DIR = join(process.cwd(), ".claude", "claudeclaw", "inbox");
const MAX_ENTRIES_BEFORE_TRUNCATE = 50;
const MAX_TEXT_PREVIEW = 400;

export type InboxKind = "send" | "trigger-result" | "external";

export interface InboxEntry {
  ts: string;
  kind: InboxKind;
  /** Origin label, e.g. "telegram:116013788" or "(bridge)". */
  from?: string;
  /** The text content that was delivered. */
  text: string;
  /** Optional structured note (e.g. "target=discord:123"). */
  note?: string;
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function filePath(key: string): string {
  return join(INBOX_DIR, `${safeKey(key)}.jsonl`);
}

/** Map a runner threadId to its inbox key. */
export function inboxKeyForThread(threadId: string | undefined): string {
  return threadId && threadId.trim() ? threadId : "global";
}

/** Map a trigger target (kind+id) to the inbox key of the *receiving* thread. */
export function inboxKeyForTarget(kind: string, id: string): string | null {
  if (kind === "telegram") return "global";
  if (kind === "discord") return id || null;
  if (kind === "global") return "global";
  return null;
}

export async function appendInbox(
  key: string,
  entry: Omit<InboxEntry, "ts"> & { ts?: string },
): Promise<void> {
  await mkdir(INBOX_DIR, { recursive: true });
  const record: InboxEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    kind: entry.kind,
    from: entry.from,
    text: entry.text,
    note: entry.note,
  };
  await appendFile(filePath(key), JSON.stringify(record) + "\n", "utf8");
}

/** Read all entries for this key, delete the file, return parsed entries. */
export async function drainInbox(key: string): Promise<InboxEntry[]> {
  let raw: string;
  try {
    raw = await readFile(filePath(key), "utf8");
  } catch {
    return [];
  }
  try {
    await unlink(filePath(key));
  } catch {}
  const entries: InboxEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as InboxEntry);
    } catch {}
  }
  if (entries.length <= MAX_ENTRIES_BEFORE_TRUNCATE) return entries;
  const head = entries.slice(0, entries.length - MAX_ENTRIES_BEFORE_TRUNCATE);
  const tail = entries.slice(entries.length - MAX_ENTRIES_BEFORE_TRUNCATE);
  return [
    {
      ts: head[0].ts,
      kind: "external",
      text: `[${head.length} earlier inbox entries omitted]`,
    },
    ...tail,
  ];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Format drained entries as a system-note block to prepend to the user prompt. */
export function formatInboxForPrompt(entries: InboxEntry[]): string {
  if (!entries.length) return "";
  const lines: string[] = [
    "[Channel activity since your last turn — your session was idle while these happened]",
  ];
  for (const e of entries) {
    const time = e.ts.length >= 16 ? e.ts.slice(11, 16) : e.ts;
    const from = e.from ? ` from ${e.from}` : "";
    const suffix = e.note ? ` (${e.note})` : "";
    let label: string;
    switch (e.kind) {
      case "send":
        label = `bridge delivered to your channel${from}`;
        break;
      case "trigger-result":
        label = `trigger response${from}`;
        break;
      case "external":
      default:
        label = "system";
        break;
    }
    lines.push(`- ${time} — ${label}${suffix}: ${truncate(e.text, MAX_TEXT_PREVIEW)}`);
  }
  lines.push("");
  lines.push(
    "Treat this as already-seen context. Do NOT re-post or echo it. Reference it only if relevant.",
  );
  return lines.join("\n");
}
