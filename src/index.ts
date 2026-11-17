import { Bot, Context, session } from "grammy";
import { FileAdapter } from "@grammyjs/storage-file";
import { join } from "path";

// 1. Определяем структуру данных для трат
interface Expense {
  amount: number;
  description: string;
  userId: number;
  username: string;
}

interface SessionData {
  expenses: Expense[];
}

// Создаем тип контекста с нашей сессией
type MyContext = Context & {
  session: SessionData;
};

const bot = new Bot<MyContext>(process.env.BOT_TOKEN || "");

// 2. Настраиваем сессию с файловым хранилищем
bot.use(session({
  initial: (): SessionData => ({ expenses: [] }),
  storage: new FileAdapter({
    dir: join(process.cwd(), "data"), // Папка для хранения файлов
  }),
  // КЛЮЧЕВОЙ МОМЕНТ: сохраняем данные по ID чата, чтобы все участники видели общий список
  getSessionKey: (ctx) => ctx.chat?.id.toString(),
}));

// Команда /add - добавить трату
// Формат: /add 500 Такси
bot.command("add", async (ctx) => {
  const args = ctx.match.split(" ");
  const amount = parseFloat(args[0]);
  const description = args.slice(1).join(" ") || "Без описания";

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply("Пожалуйста, укажите корректную сумму. Пример: /add 500 Такси");
  }

  const expense: Expense = {
    amount,
    description,
    userId: ctx.from.id,
    username: ctx.from.first_name,
  };

  // Добавляем в сессию
  ctx.session.expenses.push(expense);

  await ctx.reply(`✅ Добавлено: ${description} — ${amount} руб. (от ${ctx.from.first_name})`);
});

// Команда /split - показать итог и разделить
bot.command("split", async (ctx) => {
  const expenses = ctx.session.expenses;

  if (expenses.length === 0) {
    return ctx.reply("Список трат пуст. Добавьте траты командой /add");
  }

  // Считаем общую сумму
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Формируем красивый список для вывода
  let message = `💰 *Общая сумма:* ${total.toFixed(2)} руб.\n\n`;
  message += `📋 *Детали трат:*\n`;

  expenses.forEach((e, index) => {
    message += `${index + 1}. ${e.username}: ${e.description} — ${e.amount} руб.\n`;
  });

  // Считаем, на сколько человек делить (по уникальным пользователям, которые вносили траты)
  const uniqueMembers = new Set(expenses.map(e => e.userId));
  const memberCount = uniqueMembers.size;
  const perPerson = total / memberCount;

  message += `\n👥 *Участников (кто тратил):* ${memberCount}\n`;
  message += `💸 *Каждый должен скинуться по:* ${perPerson.toFixed(2)} руб.`;

  await ctx.reply(message, { parse_mode: "Markdown" });
});

// Команда /reset - сбросить данные
bot.command("reset", async (ctx) => {
  ctx.session.expenses = [];
  await ctx.reply("🧹 Данные о тратах сброшены.");
});

// Обработчик остальных сообщений
bot.on("message:text", async (ctx) => {
  await ctx.reply("Я понимаю только команды /add, /split и /reset.");
});

// Запуск бота с выводом в консоль
bot.start({
  onStart: (botInfo) => {
    console.log(`Бот @${botInfo.username} запущен и слушает сообщения...`);
  },
});
