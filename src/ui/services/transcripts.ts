import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { peekSession } from "../../sessions";
import { listThreadSessions } from "../../sessionManager";

function projectsDir(): string {
  return join(homedir(), ".claude", "projects", process.cwd().replace(/\//g, "-"));
}

function sessionJsonlPath(sessionId: string): string {
  return join(projectsDir(), `${sessionId}.jsonl`);
}

export interface SessionSummary {
  sessionId: string;
  kind: "global" | "thread" | "orphan";
  label: string;
  threadId?: string;
  turnCount?: number;
  createdAt?: string;
  lastUsedAt?: string;
  compactWarned?: boolean;
  interruptedAt?: string;
  fileSize?: number;
  fileMtime?: string;
  hasFile: boolean;
}

/** Aggregate everything we know about stored sessions.
 *  Global session + thread-session index + any orphan jsonl files on disk. */
export async function listSessions(): Promise<SessionSummary[]> {
  const known = new Map<string, SessionSummary>();

  const global = await peekSession();
  if (global) {
    known.set(global.sessionId, {
      sessionId: global.sessionId,
      kind: "global",
      label: "Global session",
      turnCount: global.turnCount,
      createdAt: global.createdAt,
      lastUsedAt: global.lastUsedAt,
      compactWarned: global.compactWarned,
      interruptedAt: global.interruptedAt,
      hasFile: false,
    });
  }

  const threads = await listThreadSessions();
  for (const t of threads) {
    known.set(t.sessionId, {
      sessionId: t.sessionId,
      kind: "thread",
      label: `Discord thread ${t.threadId.slice(0, 8)}`,
      threadId: t.threadId,
      turnCount: t.turnCount,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      compactWarned: t.compactWarned,
      interruptedAt: t.interruptedAt,
      hasFile: false,
    });
  }

  // Enumerate jsonl files — fill in file-size/mtime + pick up orphan sessions.
  let files: string[] = [];
  try {
    files = await readdir(projectsDir());
  } catch {
    // projects dir may not exist yet — no transcripts to serve.
  }
  for (const name of files) {
    if (!name.endsWith(".jsonl")) continue;
    const sessionId = name.slice(0, -".jsonl".length);
    const filePath = join(projectsDir(), name);
    let size = 0;
    let mtime: string | undefined;
    try {
      const s = await stat(filePath);
      size = s.size;
      mtime = new Date(s.mtimeMs).toISOString();
    } catch {
      continue;
    }

    const existing = known.get(sessionId);
    if (existing) {
      existing.fileSize = size;
      existing.fileMtime = mtime;
      existing.hasFile = true;
    } else {
      known.set(sessionId, {
        sessionId,
        kind: "orphan",
        label: `Session ${sessionId.slice(0, 8)}`,
        fileSize: size,
        fileMtime: mtime,
        hasFile: true,
      });
    }
  }

  return Array.from(known.values()).sort((a, b) => {
    const ta = a.lastUsedAt ?? a.fileMtime ?? "";
    const tb = b.lastUsedAt ?? b.fileMtime ?? "";
    return tb.localeCompare(ta);
  });
}

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; name: string; input: unknown }
  | { kind: "tool_result"; text: string; isError?: boolean };

export interface TranscriptTurn {
  uuid?: string;
  role: "user" | "assistant" | "system";
  timestamp?: string;
  subtype?: string;
  blocks: TranscriptBlock[];
}

export interface Transcript {
  sessionId: string;
  turns: TranscriptTurn[];
  truncated: boolean;
  totalLines: number;
}

const MAX_TEXT_BLOCK = 8000;

function clip(text: string, limit = MAX_TEXT_BLOCK): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n… [${text.length - limit} more chars truncated]`;
}

function stringifyToolResult(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === "object") {
          const obj = b as Record<string, unknown>;
          if (obj.type === "text" && typeof obj.text === "string") return obj.text;
          if (obj.type === "image") return "[image]";
          return JSON.stringify(b);
        }
        return String(b);
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function parseBlocks(raw: unknown): TranscriptBlock[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? [{ kind: "text", text: clip(text) }] : [];
  }
  if (!Array.isArray(raw)) return [];
  const out: TranscriptBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const type = b.type;
    if (type === "text" && typeof b.text === "string") {
      const text = b.text.trim();
      if (text) out.push({ kind: "text", text: clip(text) });
    } else if (type === "thinking" && typeof b.thinking === "string") {
      const text = b.thinking.trim();
      if (text) out.push({ kind: "thinking", text: clip(text) });
    } else if (type === "tool_use") {
      out.push({
        kind: "tool_use",
        name: typeof b.name === "string" ? b.name : "tool",
        input: b.input ?? null,
      });
    } else if (type === "tool_result") {
      const text = clip(stringifyToolResult(b.content));
      out.push({
        kind: "tool_result",
        text,
        ...(b.is_error ? { isError: true } : {}),
      });
    }
  }
  return out;
}

const MAX_TURNS = 1000;

export async function readTranscript(sessionId: string): Promise<Transcript | null> {
  if (!/^[a-z0-9-]+$/i.test(sessionId)) return null;
  let raw: string;
  try {
    raw = await readFile(sessionJsonlPath(sessionId), "utf-8");
  } catch {
    return null;
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const turns: TranscriptTurn[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry.type;
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    const uuid = typeof entry.uuid === "string" ? entry.uuid : undefined;

    if (type === "system") {
      const content = entry.content;
      if (typeof content === "string" && content.trim()) {
        turns.push({
          role: "system",
          timestamp,
          uuid,
          subtype: typeof entry.subtype === "string" ? entry.subtype : undefined,
          blocks: [{ kind: "text", text: clip(content.trim()) }],
        });
      }
      continue;
    }

    if (type !== "user" && type !== "assistant") continue;

    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = msg.role === "assistant" ? "assistant" : "user";
    const blocks = parseBlocks(msg.content);
    if (blocks.length === 0) continue;

    turns.push({ uuid, role, timestamp, blocks });
  }

  const truncated = turns.length > MAX_TURNS;
  const trimmed = truncated ? turns.slice(-MAX_TURNS) : turns;

  return {
    sessionId,
    turns: trimmed,
    truncated,
    totalLines: lines.length,
  };
}
