
import { Bot, Context, session } from "grammy";
import { FileAdapter } from "@grammyjs/storage-file";
import { join } from "path";
import { readdir } from "fs/promises";

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

// Единое хранилище для всех чатов
const storage = new FileAdapter<SessionData>({
  dirName: "sessions",
});

bot.use(
  session({
    initial: (): SessionData => ({
      expenses: [],
      knownUsers: [],
      nextId: 1,
    }),
    storage,
    getSessionKey: (ctx) => ctx.chat?.id.toString(),
  })
);

// Приведение старых данных к актуальному формату
function normalizeSession(data: any): SessionData {
  if (!data || typeof data !== "object") {
    return {
      expenses: [],
      knownUsers: [],
      nextId: 1,
    };
  }

  if (!Array.isArray(data.expenses)) {
    data.expenses = [];
  }

  if (!Array.isArray(data.knownUsers)) {
    data.knownUsers = [];
  }

  data.expenses.forEach((expense: any, index: number) => {
    if (!expense.id) expense.id = index + 1;

    if (!expense.createdAt) {
      expense.createdAt = new Date().toISOString();
    }

    if (!expense.source) {
      expense.source = "auto";
    }
  });

  const maxId = data.expenses.reduce(
    (max: number, expense: Expense) =>
      Math.max(max, expense.id),
    0
  );

  if (
    !Number.isFinite(data.nextId) ||
    data.nextId <= maxId
  ) {
    data.nextId = maxId + 1;
  }

  return data as SessionData;
}

// Миграция данных при обычной работе бота
bot.use(async (ctx, next) => {
  ctx.session = normalizeSession(ctx.session);
  await next();
});

// Проверка администратора
function isAdmin(ctx: MyContext): boolean {
  return (
    ctx.from?.username?.toLowerCase() ===
    ADMIN_USERNAME.toLowerCase()
  );
}

// Административные команды разрешены только в личном чате
function isPrivateAdmin(ctx: MyContext): boolean {
  return isAdmin(ctx) && ctx.chat?.type === "private";
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getName(username: string): string {
  return username.startsWith("@")
    ? username
    : `@${username}`;
}

function parseExpense(text: string) {
  const match = text.trim().match(
    /^(\d+(?:[.,]\d+)?)\s+(.+)$/
  );

  if (!match) return null;

  const amount = Number(match[1].replace(",", "."));
  const description = match[2].trim();

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return null;
  }

  return { amount, description };
}

function addExpense(
  data: SessionData,
  amount: number,
  description: string,
  userId: number,
  username: string,
  source: "auto" | "add" | "import"
): Expense {
  const expense: Expense = {
    id: data.nextId++,
    amount: Math.round(amount * 100) / 100,
    description: description.trim(),
    userId,
    username,
    createdAt: new Date().toISOString(),
    source,
  };

  data.expenses.push(expense);

  return expense;
}

// Запоминаем участников
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.chat) {
    const userId = ctx.from.id;

    const username =
      ctx.from.username ||
      ctx.from.first_name ||
      String(userId);

    const existing = ctx.session.knownUsers.find(
      user => user.userId === userId
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

// Получение списка всех существующих баз
async function getAllSessions(): Promise<
  { chatId: string; data: SessionData }[]
> {
  const root = join(process.cwd(), "sessions");
  const result: {
    chatId: string;
    data: SessionData;
  }[] = [];

  let folders;

  try {
    folders = await readdir(root, {
      withFileTypes: true,
    });
  } catch {
    return result;
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const folderPath = join(root, folder.name);

    let files;

    try {
      files = await readdir(folderPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const chatId = file.slice(0, -5);

      if (!/^-?\d+$/.test(chatId)) continue;

      try {
        const data = await storage.read(chatId);

        if (data) {
          result.push({
            chatId,
            data: normalizeSession(data),
          });
        }
      } catch (error) {
        console.error(
          `Ошибка чтения базы ${chatId}:`,
          error
        );
      }
    }
  }

  return result;
}

// Чтение выбранной базы
async function getTargetSession(
  ctx: MyContext,
  chatId: string
): Promise<SessionData | null> {
  // Если работаем с текущим чатом,
  // используем уже загруженную сессию
  if (ctx.chat?.id.toString() === chatId) {
    return ctx.session;
  }

  const data = await storage.read(chatId);

  if (!data) return null;

  return normalizeSession(data);
}

// Сохранение выбранной базы
async function saveTargetSession(
  ctx: MyContext,
  chatId: string,
  data: SessionData
): Promise<void> {
  // Текущую сессию сохранит middleware grammY
  if (ctx.chat?.id.toString() === chatId) {
    return;
  }

  await storage.write(chatId, data);
}

// /start
bot.command("start", async ctx => {
  await ctx.reply(
    "Привет! Я бот для учёта общих расходов.\n\n" +
    "Просто отправляй сообщение:\n" +
    "100 Такси\n\n" +
    "Команда /help — список возможностей."
  );
});

// /help
bot.command("help", async ctx => {
  let message =
    "📋 Команды бота:\n\n" +
    "Автоматическая запись: 100 Такси\n" +
    "Добавить: /add 500 Такси\n" +
    "Импорт: /import @username 500 Такси\n" +
    "Расчёт: /balance\n" +
    "История: /list\n" +
    "Отмена последней записи: /undo\n" +
    "Сброс расходов: /reset";

  if (isAdmin(ctx)) {
    message +=
      "\n\n🛠 Администрирование:\n" +
      "/admin\n" +
      "/addto ID 500 Такси\n" +
      "/addto ID @username 500 Такси\n" +
      "/listto ID\n" +
      "/resetto ID confirm";
  }

  message += "\n\nОбычные сообщения игнорируются.";

  await ctx.reply(message);
});

// /add
bot.command("add", async ctx => {
  const parsed = parseExpense(ctx.match);

  if (!parsed) {
    return ctx.reply("Пример: /add 500 Такси");
  }

  const expense = addExpense(
    ctx.session,
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
    return ctx.reply(
      "⛔ Команда доступна только администратору."
    );
  }

  const match = ctx.match.trim().match(
    /^(@\S+)\s+(\d+(?:[.,]\d+)?)\s+(.+)$/
  );

  if (!match) {
    return ctx.reply(
      "Пример: /import @username 500 Такси"
    );
  }

  const username = match[1].replace("@", "");
  const amount = Number(match[2].replace(",", "."));
  const description = match[3].trim();

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !description
  ) {
    return ctx.reply("⛔ Проверьте сумму и описание.");
  }

  const user = ctx.session.knownUsers.find(
    u =>
      u.username.replace("@", "").toLowerCase() ===
      username.toLowerCase()
  );

  const expense = addExpense(
    ctx.session,
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
    `${e.id}. ${getName(e.username)}: ` +
    `${formatMoney(e.amount)} — ` +
    `${e.description}${e.source === "import" ? " (+импорт)" : ""}`
  );

  const total = expenses.reduce(
    (sum, e) => sum + e.amount,
    0
  );

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
    (sum, e) => sum + Math.round(e.amount * 100),
    0
  );

  const share = Math.round(
    total / participants.length
  );

  const spent: Record<number, number> = {};

  for (const expense of expenses) {
    spent[expense.userId] =
      (spent[expense.userId] || 0) +
      Math.round(expense.amount * 100);
  }

  const debtors: {
    user: KnownUser;
    amount: number;
  }[] = [];

  const creditors: {
    user: KnownUser;
    amount: number;
  }[] = [];

  for (const user of participants) {
    const balance =
      share - (spent[user.userId] || 0);

    if (balance > 0) {
      debtors.push({ user, amount: balance });
    } else if (balance < 0) {
      creditors.push({
        user,
        amount: -balance,
      });
    }
  }

  const transfers: string[] = [];

  let i = 0;
  let j = 0;

  while (
    i < debtors.length &&
    j < creditors.length
  ) {
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
    return ctx.reply(
      "⛔ Команда доступна только администратору."
    );
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
    return ctx.reply(
      "⛔ Команда доступна только администратору."
    );
  }

  ctx.session.expenses = [];
  ctx.session.nextId = 1;

  await ctx.reply(
    "🧹 Расходы удалены. Список участников сохранён."
  );
});

// ======================================
// АДМИНИСТРАТИВНЫЕ КОМАНДЫ
// Доступны только администратору в личном чате
// ======================================

// /admin
bot.command("admin", async ctx => {
  if (!isPrivateAdmin(ctx)) {
    return ctx.reply(
      "⛔ Команда доступна только администратору в личном чате."
    );
  }

  const sessions = await getAllSessions();

  if (!sessions.length) {
    return ctx.reply("Базы данных не найдены.");
  }

  const lines: string[] = [
    "🛠 Администрирование\n",
  ];

  let totalExpenses = 0;
  let totalAmount = 0;

  for (let i = 0; i < sessions.length; i++) {
    const item = sessions[i];

    const chatId = Number(item.chatId);
    const data = item.data;

    let chatName = "Название неизвестно";
    let chatType = "неизвестно";

    try {
      const chat = await bot.api.getChat(chatId);

      chatType = chat.type;

      if ("title" in chat && chat.title) {
        chatName = chat.title;
      } else if ("first_name" in chat) {
        chatName = chat.first_name;
      } else if ("username" in chat && chat.username) {
        chatName = "@" + chat.username;
      }
    } catch {
      chatName = "Не удалось получить название";
    }

    const amount = data.expenses.reduce(
      (sum, e) => sum + e.amount,
      0
    );

    totalExpenses += data.expenses.length;
    totalAmount += amount;

    lines.push(
      `${i + 1}. ${chatName}\n` +
      `Тип: ${chatType}\n` +
      `ID: ${item.chatId}\n` +
      `Участников: ${data.knownUsers.length}\n` +
      `Расходов: ${data.expenses.length}\n` +
      `Сумма: ${formatMoney(amount)} ₽\n`
    );
  }

  lines.push(
    "──────────────\n" +
    `Всего баз: ${sessions.length}\n` +
    `Всего расходов: ${totalExpenses}\n` +
    `Общая сумма: ${formatMoney(totalAmount)} ₽`
  );

  await ctx.reply(lines.join("\n"));
});

// /addto
// Формат:
// /addto ID 500 Такси
// /addto ID @username 500 Такси

bot.command("addto", async ctx => {
  if (!isPrivateAdmin(ctx)) {
    return ctx.reply(
      "⛔ Команда доступна только администратору в личном чате."
    );
  }

  const match = ctx.match.trim().match(
    /^(-?\d+)\s+(?:(@\S+)\s+)?(\d+(?:[.,]\d+)?)\s+(.+)$/
  );

  if (!match) {
    return ctx.reply(
      "Примеры:\n" +
      "/addto -5322275256 500 Такси\n" +
      "/addto -5322275256 @username 500 Такси"
    );
  }

  const chatId = match[1];
  const targetUsername = match[2]
    ? match[2].replace("@", "")
    : null;

  const amount = Number(
    match[3].replace(",", ".")
  );

  const description = match[4].trim();

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !description
  ) {
    return ctx.reply("⛔ Проверьте сумму и описание.");
  }

  const data = await getTargetSession(ctx, chatId);

  if (!data) {
    return ctx.reply(
      `⛔ База ${chatId} не найдена.`
    );
  }

  let userId: number;
  let username: string;

  if (targetUsername) {
    const user = data.knownUsers.find(
      u =>
        u.username.replace("@", "").toLowerCase() ===
        targetUsername.toLowerCase()
    );

    userId = user?.userId ?? 0;
    username = targetUsername;
  } else {
    userId = ctx.from.id;
    username =
      ctx.from.username ||
      ctx.from.first_name ||
      String(ctx.from.id);
  }

  const expense = addExpense(
    data,
    amount,
    description,
    userId,
    username,
    "add"
  );

  await saveTargetSession(ctx, chatId, data);

  await ctx.reply(
    `✅ Добавлено в базу ${chatId}:\n` +
    `${getName(expense.username)} — ` +
    `${formatMoney(expense.amount)} ₽ ` +
    `(${expense.description})`
  );
});

// /listto
// Формат: /listto ID

bot.command("listto", async ctx => {
  if (!isPrivateAdmin(ctx)) {
    return ctx.reply(
      "⛔ Команда доступна только администратору в личном чате."
    );
  }

  const match = ctx.match.trim().match(
    /^(-?\d+)$/
  );

  if (!match) {
    return ctx.reply(
      "Пример: /listto -5322275256"
    );
  }

  const chatId = match[1];

  const data = await getTargetSession(ctx, chatId);

  if (!data) {
    return ctx.reply(
      `⛔ База ${chatId} не найдена.`
    );
  }

  if (!data.expenses.length) {
    return ctx.reply(
      `📋 База ${chatId}\n\nСписок трат пуст.`
    );
  }

  const lines = data.expenses.map(e =>
    `${e.id}. ${getName(e.username)}: ` +
    `${formatMoney(e.amount)} — ` +
    `${e.description}` +
    `${e.source === "import" ? " (+импорт)" : ""}`
  );

  const total = data.expenses.reduce(
    (sum, e) => sum + e.amount,
    0
  );

  await ctx.reply(
    `📋 История расходов: ${chatId}\n\n` +
    lines.join("\n") +
    `\n\n💰 Итого: ${formatMoney(total)} ₽`
  );
});

// /resetto
// Формат: /resetto ID confirm

bot.command("resetto", async ctx => {
  if (!isPrivateAdmin(ctx)) {
    return ctx.reply(
      "⛔ Команда доступна только администратору в личном чате."
    );
  }

  const match = ctx.match.trim().match(
    /^(-?\d+)(?:\s+(\S+))?$/
  );

  if (!match) {
    return ctx.reply(
      "Пример: /resetto -5322275256 confirm"
    );
  }

  const chatId = match[1];
  const confirmation = match[2];

  if (confirmation !== "confirm") {
    return ctx.reply(
      "⚠️ Для подтверждения удаления отправьте:\n" +
      `/resetto ${chatId} confirm\n\n` +
      "Все расходы выбранной базы будут удалены. " +
      "Список участников сохранится."
    );
  }

  const data = await getTargetSession(ctx, chatId);

  if (!data) {
    return ctx.reply(
      `⛔ База ${chatId} не найдена.`
    );
  }

  const removedCount = data.expenses.length;

  data.expenses = [];
  data.nextId = 1;

  await saveTargetSession(ctx, chatId, data);

  await ctx.reply(
    `🧹 База ${chatId} очищена.\n` +
    `Удалено расходов: ${removedCount}\n` +
    `Участников сохранено: ${data.knownUsers.length}`
  );
});

// ======================================
// АВТОМАТИЧЕСКАЯ ЗАПИСЬ РАСХОДОВ
// ======================================

bot.on("message:text", async ctx => {
  const parsed = parseExpense(ctx.message.text);

  if (!parsed) return;

  const expense = addExpense(
    ctx.session,
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

// Обработка ошибок
bot.catch(err => {
  console.error("Ошибка бота:", err);
});

// Запуск
bot.start({
  onStart: botInfo => {
    console.log(
      `Бот @${botInfo.username} запущен и слушает сообщения...`
    );
  },
});
