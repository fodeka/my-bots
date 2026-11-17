
import { Bot, Context, session } from "grammy";
import { FileAdapter } from "@grammyjs/storage-file";
import { join } from "path";

// Администратор бота
const ADMIN_USERNAME = "KlementyevDenis";

// Структура расхода
interface Expense {
  id: number;
  amount: number;
  description: string;
  userId: number;
  username: string;
  createdAt: string;
  source: "auto" | "add" | "import";
}

// Участники чата
interface KnownUser {
  userId: number;
  username: string;
}

// Общие данные чата
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
  throw new Error("Не задан BOT_TOKEN в переменных окружения");
}

const bot = new Bot<MyContext>(token);

// Файловое хранилище
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

// Вспомогательные функции
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
  return (
    ctx.from?.username?.toLowerCase() ===
    ADMIN_USERNAME.toLowerCase()
  );
}

function findUser(
  session: SessionData,
  username: string
): KnownUser | undefined {
  const normalized = username.replace(/^@/, "").toLowerCase();

  return session.knownUsers.find(
    (user) => user.username.replace(/^@/, "").toLowerCase() === normalized
  );
}

// Запоминание всех участников, написавших хотя бы одно сообщение
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.chat) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || String(userId);

    const existing = ctx.session.knownUsers.find(
      (user) => user.userId === userId
    );

    if (existing) {
      existing.username = username;
    } else {
      ctx.session.knownUsers.push({
        userId,
        username,
      });
    }
  }

  await next();
});

// Добавление расхода
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

// Проверка формата суммы и описания
function parseExpense(text: string): {
  amount: number;
  description: string;
} | null {
  const match = text.trim().match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);

  if (!match) return null;

  const amount = Number(match[1].replace(",", "."));
  const description = match[2].trim();

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return null;
  }

  return { amount, description };
}

// /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Привет! Я бот для учёта общих расходов.\n\n" +
      "Просто отправляй сообщение в формате:\n" +
      "100 Такси\n\n" +
      "Я запишу расход автоматически.\n\n" +
      "Команда /help — список возможностей."
  );
});

// /help
bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 Команды бота:\n\n" +
      "Автоматическая запись:\n" +
      "100 Такси\n" +
      "1500 Продукты\n\n" +
      "Добавить расход:\n" +
      "/add 500 Такси\n\n" +
      "Посмотреть взаиморасчёты:\n" +
      "/balance\n\n" +
      "История расходов:\n" +
      "/list\n\n" +
      "Отменить последнюю запись (админ):\n" +
      "/undo\n\n" +
      "Сбросить расходы (админ):\n" +
      "/reset\n\n" +
      "Импортировать чужой расход (админ):\n" +
      "/import @username 500 Такси\n\n" +
      "Обычные сообщения бот игнорирует."
  );
});

// /add
bot.command("add", async (ctx) => {
  const parsed = parseExpense(ctx.match);

  if (!parsed) {
    return ctx.reply(
      "Неверный формат.\nПример: /add 500 Такси"
    );
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

// /import — импорт расхода другого участника
bot.command("import", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Эта команда доступна только администратору.");
  }

  const match = ctx.match.trim().match(
    /^(@\S+)\s+(\d+(?:[.,]\d+)?)\s+(.+)$/
  );

  if (!match) {
    return ctx.reply(
      "Неверный формат.\nПример: /import @username 500 Такси"
    );
  }

  const username = match[1].replace(/^@/, "");
  const amount = Number(match[2].replace(",", "."));
  const description = match[3].trim();

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return ctx.reply("⛔ Проверьте сумму и описание расхода.");
  }

  const user = findUser(ctx.session, username);

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
      (user ? "" : "\n⚠️ Участник пока не найден в списке чата.")
  );
});

// /list — история расходов
bot.command("list", async (ctx) => {
  const expenses = ctx.session.expenses;

  if (expenses.length === 0) {
    return ctx.reply("Список трат пуст.");
  }

  const lines = expenses.map((expense) => {
    const imported = expense.source === "import" ? " (+импорт)" : "";

    return (
      `${expense.id}. ${getName(expense.username)}: ` +
      `${formatMoney(expense.amount)} — ${expense.description}${imported}`
    );
  });

  const total = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0
  );

  await ctx.reply(
    "📋 История расходов:\n\n" +
      lines.join("\n") +
      `\n\n💰 Итого: ${formatMoney(total)}`
  );
});

// /balance — расчёт взаиморасчётов
bot.command("balance", async (ctx) => {
  const expenses = ctx.session.expenses;
  const participants = ctx.session.knownUsers;

  if (expenses.length === 0) {
    return ctx.reply("Список трат пуст.");
  }

  if (participants.length === 0) {
    return ctx.reply("Пока нет участников для расчёта.");
  }

  const totalCents = expenses.reduce(
    (sum, expense) => sum + Math.round(expense.amount * 100),
    0
  );

  const shareCents = Math.round(totalCents / participants.length);

  // Сколько каждый участник потратил
  const spent: Record<number, number> = {};

  for (const expense of expenses) {
    spent[expense.userId] =
      (spent[expense.userId] || 0) +
      Math.round(expense.amount * 100);
  }

  // Положительный баланс — должен заплатить.
  // Отрицательный баланс — должен получить.
  const debtors: { user: KnownUser; amount: number }[] = [];
  const creditors: { user: KnownUser; amount: number }[] = [];

  for (const user of participants) {
    const balance = shareCents - (spent[user.userId] || 0);

    if (balance > 0) {
      debtors.push({ user, amount: balance });
    } else if (balance < 0) {
      creditors.push({ user, amount: -balance });
    }
  }

  // Жадное сведение должников и кредиторов
  const transfers: string[] = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(
      debtors[i].amount,
      creditors[j].amount
    );

    if (amount > 0) {
      transfers.push(
        `${getName(debtors[i].user.username)} → ` +
          `${getName(creditors[j].user.username)}: ` +
          `${formatMoney(amount / 100)}`
      );
    }

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }

  let message =
    `💰 Всего: ${formatMoney(totalCents / 100)}\n` +
    `👥 Участников: ${participants.length}\n` +
    `💸 С каждого: ${formatMoney(shareCents / 100)}\n\n`;

  if (transfers.length === 0) {
    message += "✅ Все в расчёте.";
  } else {
    message += "💳 Переводы:\n" + transfers.join("\n");
  }

  await ctx.reply(message);
});

// /undo — удалить последнюю запись
bot.command("undo", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Эта команда доступна только администратору.");
  }

  const expenses = ctx.session.expenses;

  if (expenses.length === 0) {
    return ctx.reply("Нечего отменять.");
  }

  const removed = expenses.pop()!;

  await ctx.reply(
    "↩️ Последняя запись отменена:\n\n" +
      `${getName(removed.username)} — ` +
      `${formatMoney(removed.amount)} (${removed.description})`
  );
});

// /reset — очистить расходы
bot.command("reset", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("⛔ Эта команда доступна только администратору.");
  }

  ctx.session.expenses = [];
  ctx.session.nextId = 1;

  await ctx.reply(
    "🧹 Все расходы удалены.\n" +
      "Список участников сохранён.\n" +
      "Можно начинать новый расчёт."
  );
});

// Автоматическая запись расходов.
// Все остальные сообщения игнорируются.
bot.on("message:text", async (ctx) => {
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

// Запуск
bot.start({
  onStart: (botInfo) => {
    console.log(
      `Бот @${botInfo.username} запущен и слушает сообщения...`
    );
  },
});
