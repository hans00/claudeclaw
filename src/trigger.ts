/**
 * Cross-session trigger / notification routing. Lets one session poke another
 * via the daemon's HTTP surface:
 *   - POST /api/send    → sendToTarget   (notify-only; plain text to a channel)
 *   - POST /api/trigger → triggerTarget  (invoke the target session's agent)
 *
 * Target grammar: "<kind>:<id>" (or the bare "global" for the main session)
 *   - telegram:<chatId>    — Telegram bot message (send only)
 *   - discord:<channelId>  — Discord channel message (send or trigger)
 *   - global               — the main ClaudeClaw session (trigger only)
 */
import { loadSettings } from "./config";
import { runUserMessage } from "./runner";
import { sendMessage as sendTelegramMessage } from "./commands/telegram";
import { sendMessage as sendDiscordMessage } from "./commands/discord";

export interface SendResult {
  target: string;
  kind: string;
}

export interface TriggerSource {
  /** Short human-readable origin identifier (e.g. "claude-code:/home/hans/foo"). */
  label?: string;
  /** Source session id for audit/attribution; treated as opaque. */
  sessionId?: string;
}

export interface TriggerResult {
  target: string;
  kind: string;
  /** Dispatched: the work was queued / started. For async targets (discord),
   *  the response appears in the target channel; for sync targets (global),
   *  response is the agent's reply inline. */
  dispatched: boolean;
  response?: string;
}

export async function sendToTarget(target: string, text: string): Promise<SendResult> {
  const { kind, id } = parseTarget(target);
  if (!id) throw new Error(`invalid target "${target}": missing id`);
  if (!text) throw new Error("text is required");

  const settings = await loadSettings();

  if (kind === "telegram") {
    const chatId = Number(id);
    if (!Number.isFinite(chatId)) throw new Error(`invalid telegram chatId "${id}"`);
    if (!settings.telegram.token) throw new Error("telegram not configured");
    await sendTelegramMessage(settings.telegram.token, chatId, text);
    return { target, kind };
  }

  if (kind === "discord") {
    if (!settings.discord.token) throw new Error("discord not configured");
    await sendDiscordMessage(settings.discord.token, id, text);
    return { target, kind };
  }

  throw new Error(`unknown target kind "${kind}" (expected telegram|discord)`);
}

export async function triggerTarget(
  target: string,
  prompt: string,
  source?: TriggerSource,
): Promise<TriggerResult> {
  const { kind, id } = parseTarget(target);
  if (!prompt.trim()) throw new Error("prompt is required");

  const tagged = buildTriggerPrompt(prompt, source);

  if (kind === "global") {
    const result = await runUserMessage("cross-trigger", tagged);
    return {
      target: "global",
      kind,
      dispatched: true,
      response: result.stdout?.trim() || undefined,
    };
  }

  if (kind === "discord") {
    if (!id) throw new Error(`invalid target "${target}": missing channelId`);
    const settings = await loadSettings();
    if (!settings.discord.token) throw new Error("discord not configured");
    const token = settings.discord.token;

    // Fire and forget. The channel's session runs the agent, output is posted
    // back into the channel. HTTP response returns immediately so callers
    // aren't blocked for however long the agent takes.
    void dispatchDiscordTrigger(token, id, tagged).catch((err) => {
      console.error(`[trigger] discord channel=${id} dispatch failed:`, err instanceof Error ? err.message : err);
    });

    return { target, kind, dispatched: true };
  }

  if (kind === "telegram") {
    throw new Error(
      "telegram target is notify-only for now (the Telegram bot uses the global session). Use /api/send, or trigger `global` instead.",
    );
  }

  throw new Error(`unknown target kind "${kind}" (expected global|discord|telegram)`);
}

function parseTarget(target: string): { kind: string; id: string } {
  const t = target.trim();
  if (!t) throw new Error("target is required");
  if (t === "global") return { kind: "global", id: "" };
  const colon = t.indexOf(":");
  if (colon < 0) throw new Error(`invalid target "${target}": expected "kind:id" or "global"`);
  return { kind: t.slice(0, colon), id: t.slice(colon + 1) };
}

function buildTriggerPrompt(prompt: string, source?: TriggerSource): string {
  const header = ["[Internal cross-session trigger]"];
  if (source?.label) header.push(`Source: ${source.label}`);
  if (source?.sessionId) header.push(`Source session: ${source.sessionId}`);
  header.push("");
  header.push(
    "This message is NOT from a human user. Another ClaudeClaw session sent it to ask for your help. Treat it as a teammate's request — concise, practical, action-first. If the ask is ambiguous, do your best reasonable interpretation and proceed.",
  );
  header.push("");
  header.push("---");
  header.push(prompt);
  return header.join("\n");
}

async function dispatchDiscordTrigger(
  token: string,
  channelId: string,
  taggedPrompt: string,
): Promise<void> {
  // Run the channel's agent (threadId = channelId so the session is the
  // per-channel one). Output is the full final response; chunk + post.
  const result = await runUserMessage("cross-trigger", taggedPrompt, channelId);
  const text = (result.stdout ?? "").trim();
  if (!text) return;
  await sendDiscordMessage(token, channelId, text);
}
