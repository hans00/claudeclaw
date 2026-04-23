---
description: List and read transcripts from other ClaudeClaw sessions (cross-session viewer)
---

Inspect ClaudeClaw sessions other than the one you're currently in — e.g. the global session, Discord-channel sessions, Telegram-thread sessions — by calling the daemon's HTTP API. The port defaults to `4632` but comes from `.claude/claudeclaw/settings.json` under `web.port`; read that file first if present.

Parse `$ARGUMENTS` as a subcommand:

**`list`** (default when no args)
- `curl -s http://127.0.0.1:<port>/api/sessions`
- Response: `{ok: true, sessions: SessionSummary[]}` — each summary has `sessionId`, `kind` (`global` / `thread` / `orphan`), `label`, optional `threadId`, `turnCount`, `lastUsedAt`, `fileSize`.
- Render as a compact table: short id (first 8 chars), kind, label, turnCount, lastUsedAt. Sort is already newest-first from the server.

**`read <sessionId>`**
- Accept a full UUID or a prefix — if prefix, first hit `/api/sessions` to resolve.
- `curl -s http://127.0.0.1:<port>/api/sessions/<sessionId>/transcript`
- Response: `{ok: true, transcript: {sessionId, turns, truncated, totalLines}}`.
- Each turn has `role` (`user`/`assistant`/`system`), optional `timestamp`, and `blocks[]` where each block is one of:
  - `{kind: "text", text}` — render as the role's message body
  - `{kind: "thinking", text}` — render dimmed / prefixed with `(thinking)`
  - `{kind: "tool_use", name, input}` — render as `→ tool: <name>` plus one-line input summary
  - `{kind: "tool_result", text, isError?}` — render as `← result` plus the text
- Clip very long blocks when displaying.
- If `truncated: true`, mention at the end that more turns exist.

If the daemon is not running the curl will fail — report that plainly rather than retrying.

Keep the output concise. This command is for *looking at* sessions, not executing anything in them.
