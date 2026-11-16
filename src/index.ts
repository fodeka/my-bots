import { Bot, webhookCallback } from "grammy";

// Создаем экземпляр бота. Токен берется из настроек Cloudflare (переменная BOT_TOKEN)
const bot = new Bot(process.env.BOT_TOKEN || "");

// Обработчик текстовых сообщений (Эхо-бот)
bot.on("message:text", async (ctx) => {
  await ctx.reply(ctx.message.text);
});

// Экспортируем обработчик для Cloudflare Workers
export default {
  fetch: webhookCallback(bot, "cloudflare-mod"),
};
