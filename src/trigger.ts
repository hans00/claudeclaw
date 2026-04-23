/**
 * Cross-session trigger / notification routing. Lets one session poke another
 * via the daemon's HTTP surface: `POST /api/send` ends up calling `sendToTarget`.
 *
 * Target grammar: "<kind>:<id>"
 *   - telegram:<chatId>    — send a text message via the Telegram bot
 *   - discord:<channelId>  — post a text message into a Discord channel
 *
 * This is notification-level only — the target session's agent does NOT
 * respond to the injected message (Discord ignores bot messages, Telegram
 * has no user event attached). Agent-invocation "prompt" mode is a follow-up.
 */
import { loadSettings } from "./config";
import { sendMessage as sendTelegramMessage } from "./commands/telegram";
import { sendMessage as sendDiscordMessage } from "./commands/discord";

export interface SendResult {
  target: string;
  kind: string;
}

export async function sendToTarget(target: string, text: string): Promise<SendResult> {
  const colon = target.indexOf(":");
  if (colon < 0) throw new Error(`invalid target "${target}": expected "kind:id"`);
  const kind = target.slice(0, colon);
  const id = target.slice(colon + 1);
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
