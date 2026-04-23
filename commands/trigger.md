---
description: Trigger another ClaudeClaw session's agent (tagged as internal cross-session). For delegation/handoff — not just notification.
---

Hand a prompt off to another ClaudeClaw session's agent. The target treats it as an internal cross-session request from a teammate (NOT a human user), processes it in its own session/working directory, and responds in its own channel.

Use when the active session wants work done in a different context — e.g. the Telegram-session agent asks the Discord-`#dev`-channel agent to inspect a bug, or the local Claude-Code asks the Discord agent to run something in its repo.

For one-way text notifications (no agent response needed), use `/claudeclaw:send` instead.

**Port**: `.claude/claudeclaw/settings.json` → `web.port` (default `4632`).

**Parse `$ARGUMENTS`** as `<target> <prompt...>`. `<target>` grammar:
- `discord:<channelId>` — target Discord channel; its session processes the prompt, response posts to the channel (fire-and-forget, HTTP returns immediately).
- `global` — the main ClaudeClaw / local Claude Code session; synchronous, response returned inline.
- Telegram is **notify-only** right now — this command will reject `telegram:...` targets. Use `/claudeclaw:send` or target `global`.

**Source identification**: always include a source label so the target knows where the trigger came from. Construct a meaningful label from the current context (e.g. `claude-code:<cwd basename>`, or the current chat identifier if known).

**Call shape**:
```bash
curl -s -X POST http://127.0.0.1:<port>/api/trigger \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg t "<target>" --arg p "<prompt>" --arg l "<source-label>" \
    '{target:$t, prompt:$p, source:{label:$l}}')"
```

(Use `jq -n` or equivalent to JSON-escape the prompt and label safely. Don't string-concatenate user input into JSON.)

**Response shape**: `{ok, target, kind, dispatched, response?}`. `response` is populated only for `global` targets. For `discord`, the target channel is the side effect — tell the user to check that channel.

**Rules**:
- Never fire this silently on the user's behalf without them asking for it — cross-session triggers make external noise (messages visible in channels).
- The target agent's response is governed by its own session state; if the target channel is busy with another run, the trigger will queue.
- Keep the prompt short and action-oriented — you're talking to another agent, not a human.
