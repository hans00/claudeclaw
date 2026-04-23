---
description: Send a text notification to another ClaudeClaw target (Telegram chat / Discord channel)
---

Post a plain-text notification to a cross-session target via the daemon's `/api/send` endpoint. Useful for one session poking another (e.g. Telegram-session alerting Discord-channel-session, or pinging Hans on Telegram when a long task finishes).

Port defaults to `4632`; read `.claude/claudeclaw/settings.json` for `web.port` if the key exists.

Parse `$ARGUMENTS` as `<target> <message...>`. `<target>` grammar:
- `telegram:<chatId>` — Telegram chat id (numeric, may be negative for groups)
- `discord:<channelId>` — Discord channel id (18–20 digit snowflake)

Call:
```
curl -s -X POST http://127.0.0.1:<port>/api/send \
  -H "Content-Type: application/json" \
  -d '{"target":"<target>","text":"<message>"}'
```

Use `jq -Rs .` or equivalent to JSON-escape multi-line messages safely.

Report the response: `{ok: true, target, kind}` on success, `{ok: false, error}` on failure.

**Rules:**
- This is a one-way notification. The receiving session's agent will NOT reply to it automatically (Discord ignores bot messages; Telegram has no user event attached).
- If the user wants the target session to actually *process* the message as a prompt and respond, this command is the wrong tool — tell them.
- Never send sensitive content to a shared channel without the user's explicit confirmation.
