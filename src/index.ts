
import { Bot, Context, session } from "grammy";
import { FileAdapter } from "@grammyjs/storage-file";
import { join } from "path";

const ADMIN_USERNAME = "KlementyevDenis";

interface Expense {
  id: number;
  amount: number;
  description: string;
  userId: number;
  username: string;
  createdAt: string;
  source: "auto" | "add" | "import";
}

interface KnownUser {
  userId: number;
  username: string;
}

interface SessionData {
  expenses: Expense[];
  knownUsers: KnownUser[];
  nextId: number;
}

type MyContext = Context & {
  session: SessionData;
};

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("Не задан BOT_TOKEN");
}

const bot = new Bot<MyContext>(token);

bot.use(
  session({
    initial: (): SessionData => ({
      expenses: [],
      knownUsers: [],
      nextId: 1,
    }),
    storage: new FileAdapter({
      dir: join(process.cwd(), "data"),
    }),
    getSessionKey: (ctx) => ctx.chat?.id.toString(),
  })
);

// Миграция старых данных
bot.use(async (ctx, next) => {
  if (ctx.session) {
    const data = ctx.session as SessionData;

    if (!Array.isArray(data.expenses)) {
      data.expenses = [];
    }

    if (!Array.isArray(data.knownUsers)) {
      data.knownUsers = [];
    }

    data.expenses.forEach((expense, index) => {
      if (!expense.id) expense.id = index + 1;
      if (!expense.createdAt) {
        expense.createdAt = new Date().toISOString();
      }
      if (!expense.source) expense.source = "auto";
    });

    const maxId = data.expenses.reduce(
      (max, expense) => Math.max(max, expense.id),
      0
    );

    if (!data.nextId || data.nextId <= maxId) {
      data.nextId = maxId + 1;
    }
  }

  await next();
});

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getName(username: string): string {
  return username.startsWith("@") ? username : `@${username}`;
}

function isAdmin(ctx: MyContext): boolean {
  return ctx.from?.username?.toLowerCase() ===
    ADMIN_USERNAME.toLowerCase();
}

function parseExpense(text: string) {
  const match = text.trim().match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);

  if (!match) return null;

  const amount = Number(match[1].replace(",", "."));
  const description = match[2].trim();

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return null;
  }

  return { amount, description };
}

function addExpense(
  ctx: MyContext,
  amount: number,
  description: string,
  userId: number,
  username: string,
  source: "auto" | "add" | "import"
): Expense {
  const expense: Expense = {
    id: ctx.session.nextId++,
    amount: Math.round(amount * 100) / 100,
    description: description.trim(),
    userId,
    username,
    createdAt: new Date().toISOString(),
    source,
  };

  ctx.session.expenses.push(expense);
  return expense;
}

// Запоминаем участников
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.chat) {
    const userId = ctx.from.id;
    const username = ctx.from.username ||
      ctx.from.first_name || String(userId);

    const existing = ctx.session.knownUsers.find(
      user => user.userId === userId
    );

    if (existing) {
      existing.username = username;
    } else {
      ctx.session.knownUsers.push({ userId, username });
    }
  }

  await next();
});

// /start
bot.command("start", async ctx => {
  await ctx.reply(
    "Привет! Я бот для учёта общих расходов.\n\n" +
    "Просто отправляй сообщение:\n100 Такси\n\n" +
    "Команда /help — список возможностей."
  );
});

// /help
bot.command("help", async ctx => {
  await ctx.reply(
    "📋 Команды бота:\n\n" +
    "Автоматическая запись: 100 Такси\n" +
    "Добавить: /add 500 Такси\n" +
    "Импорт: /import @username 500 Такси\n" +
    "Расчёт: /balance\n" +
    "История: /list\n" +
    "Отмена последней записи: /undo\n" +
    "Сброс расходов: /reset\n\n" +
    "Обычные сообщения игнорируются."
  );
});

// /add
bot.command("add", async ctx => {
  const parsed = parseExpense(ctx.match);

  if (!parsed) {
    return ctx.reply("Пример: /add 500 Такси");
  }

  const expense = addExpense(
    ctx,
    parsed.amount,
    parsed.description,
    ctx.from.id,
    ctx.from.username || ctx.from.first_name,
    "add"
  );

  await ctx.reply(
    `✅ Записал: ${getName(expense.username)} — ` +
    `${formatMoney(expense.amount)} (${expense.description})`
  );
});

// /import
bot.command("import", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Команда доступна только администратору.");
  }

  const match = ctx.match.trim().match(
    /^(@\S+)\s+(\d+(?:[.,]\d+)?)\s+(.+)$/
  );

  if (!match) {
    return ctx.reply("Пример: /import @username 500 Такси");
  }

  const username = match[1].replace("@", "");
  const amount = Number(match[2].replace(",", "."));
  const description = match[3].trim();

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return ctx.reply("⛔ Проверьте сумму и описание.");
  }

  const user = ctx.session.knownUsers.find(
    u => u.username.replace("@", "").toLowerCase() ===
      username.toLowerCase()
  );

  const expense = addExpense(
    ctx,
    amount,
    description,
    user?.userId ?? 0,
    username,
    "import"
  );

  await ctx.reply(
    `✅ Импортировано: ${getName(expense.username)} — ` +
    `${formatMoney(expense.amount)} (${expense.description})` +
    (user ? "" : "\n⚠️ Участник не найден в списке чата.")
  );
});

// /list
bot.command("list", async ctx => {
  const expenses = ctx.session.expenses;

  if (!expenses.length) {
    return ctx.reply("Список трат пуст.");
  }

  const lines = expenses.map(e =>
    `${e.id}. ${getName(e.username)}: ${formatMoney(e.amount)} — ` +
    `${e.description}${e.source === "import" ? " (+импорт)" : ""}`
  );

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  await ctx.reply(
    "📋 История расходов:\n\n" +
    lines.join("\n") +
    `\n\n💰 Итого: ${formatMoney(total)}`
  );
});

// /balance
bot.command("balance", async ctx => {
  const expenses = ctx.session.expenses;
  const participants = ctx.session.knownUsers;

  if (!expenses.length) {
    return ctx.reply("Список трат пуст.");
  }

  if (!participants.length) {
    return ctx.reply("Нет участников для расчёта.");
  }

  const total = expenses.reduce(
    (sum, e) => sum + Math.round(e.amount * 100), 0
  );

  const share = Math.round(total / participants.length);

  const spent: Record<number, number> = {};

  for (const expense of expenses) {
    spent[expense.userId] =
      (spent[expense.userId] || 0) +
      Math.round(expense.amount * 100);
  }

  const debtors: { user: KnownUser; amount: number }[] = [];
  const creditors: { user: KnownUser; amount: number }[] = [];

  for (const user of participants) {
    const balance = share - (spent[user.userId] || 0);

    if (balance > 0) {
      debtors.push({ user, amount: balance });
    } else if (balance < 0) {
      creditors.push({ user, amount: -balance });
    }
  }

  const transfers: string[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(
      debtors[i].amount,
      creditors[j].amount
    );

    transfers.push(
      `${getName(debtors[i].user.username)} → ` +
      `${getName(creditors[j].user.username)}: ` +
      `${formatMoney(amount / 100)}`
    );

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  let message =
    `💰 Всего: ${formatMoney(total / 100)}\n` +
    `👥 Участников: ${participants.length}\n` +
    `💸 С каждого: ${formatMoney(share / 100)}\n\n`;

  message += transfers.length
    ? "💳 Переводы:\n" + transfers.join("\n")
    : "✅ Все в расчёте.";

  await ctx.reply(message);
});

// /undo
bot.command("undo", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Команда доступна только администратору.");
  }

  const removed = ctx.session.expenses.pop();

  if (!removed) {
    return ctx.reply("Нечего отменять.");
  }

  await ctx.reply(
    `↩️ Удалена запись:\n${getName(removed.username)} — ` +
    `${formatMoney(removed.amount)} (${removed.description})`
  );
});

// /reset
bot.command("reset", async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Команда доступна только администратору.");
  }

  ctx.session.expenses = [];
  ctx.session.nextId = 1;

  await ctx.reply(
    "🧹 Расходы удалены. Список участников сохранён."
  );
});

// Автоматическая запись расходов
bot.on("message:text", async ctx => {
  const parsed = parseExpense(ctx.message.text);

  if (!parsed) return;

  const expense = addExpense(
    ctx,
    parsed.amount,
    parsed.description,
    ctx.from.id,
    ctx.from.username || ctx.from.first_name,
    "auto"
  );

  await ctx.reply(
    `✅ Записал: ${getName(expense.username)} — ` +
    `${formatMoney(expense.amount)} (${expense.description})`
  );
});

bot.catch(err => {
  console.error("Ошибка бота:", err);
});

bot.start({
  onStart: botInfo => {
    console.log(
      `Бот @${botInfo.username} запущен и слушает сообщения...`
    );
  },
});
