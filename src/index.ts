import { Bot } from "grammy";

// Создаем бота. Токен берется из переменных окружения FadeHost
const bot = new Bot(process.env.BOT_TOKEN || "");

// Обработчик текстовых сообщений (Эхо-бот)
bot.on("message:text", async (ctx) => {
  await ctx.reply(ctx.message.text);
});

// Запуск бота через Long Polling
console.log("Бот запущен и слушает сообщения...");
bot.start();
