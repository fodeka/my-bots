import { Bot, webhookCallback } from "grammy";

export interface Env {
  BOT_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = new Bot(env.BOT_TOKEN || "");

    bot.on("message:text", async (ctx) => {
      await ctx.reply(ctx.message.text);
    });

    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
