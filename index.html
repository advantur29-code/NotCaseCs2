const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

// --- НАСТРОЙКИ ---
const bot = new Telegraf('8297728079:AAHb8-Sys7zF9ma68vLsa4Vzw2lOWerp8NM');
const app = express();
const ADMIN_ID = 8019223768; 
const DB_FILE = 'database.json';

app.use(cors());
app.use(bodyParser.json());

// Фикс кодировки
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// --- БАЗА ДАННЫХ ---
let users = {};
const loadDB = () => {
    if (fs.existsSync(DB_FILE)) {
        try {
            users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            console.log(`[DB] Loaded: ${Object.keys(users).length} users`);
        } catch (e) { 
            console.error("[DB] Load Error:", e);
            users = {}; 
        }
    }
};
loadDB();

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error("[DB] Save Error:", e);
    }
};

// Хелпер для инициализации юзера (если запросы пришли раньше /sync-user)
const initUser = (id, username = 'unknown') => {
    if (!users[id]) {
        users[id] = { 
            username: username, 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            lastBonus: null, 
            tradeLink: "",
            invitedBy: null,
            inventory: []
        };
        saveDB();
    }
    return users[id];
};

// --- API ДЛЯ MINI APP ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).json({ error: "No ID" });
    const user = initUser(userId, req.body.username);
    res.json(user);
});

app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    const id = userId?.toString();
    if (users[id]) {
        users[id].tradeLink = tradeLink;
        saveDB();
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    const id = userId?.toString();
    if (users[id]) {
        users[id].balance = parseInt(balance) || 0;
        saveDB();
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    
    // Если юзера нет в базе — создаем его на лету
    const user = initUser(id);

    if (!user.completedTasks) user.completedTasks = [];
    if (user.completedTasks.includes(taskId)) {
        return res.status(400).json({ error: "Already done" });
    }

    let reward = 0;
    if (taskId === 'sub_tg') reward = 50000;
    if (taskId === 'join_chat') reward = 25000;
    if (taskId === 'boost_tg') reward = 500000;

    if (reward > 0) {
        user.balance += reward;
        user.completedTasks.push(taskId);
        saveDB();
        console.log(`[Task] User ${id} finished ${taskId}. Reward: ${reward}`);
        return res.json({ ok: true, newBalance: user.balance });
    }
    res.status(400).json({ error: "Unknown task" });
});

app.post('/daily-bonus', (req, res) => {
    const id = req.body.userId?.toString();
    const user = initUser(id);
    
    const now = Date.now();
    const lastBonus = user.lastBonus ? new Date(user.lastBonus).getTime() : 0;
    const DAY = 24 * 60 * 60 * 1000;

    if (now - lastBonus > DAY) {
        user.balance += 500;
        user.lastBonus = new Date().toISOString();
        saveDB();
        return res.json({ ok: true, newBalance: user.balance });
    }
    res.status(400).json({ error: "Already claimed" });
});

app.post('/apply-promo', (req, res) => {
    const id = req.body.userId?.toString();
    const { promo } = req.body;
    const user = initUser(id);

    if (!user.usedPromos) user.usedPromos = [];
    const code = promo?.toLowerCase();
    if (user.usedPromos.includes(code)) return res.status(400).json({ error: "Already used" });

    let bonus = 0;
    if (code === 'advantur') bonus = 1000000;
    if (code === 'start') bonus = 50000;

    if (bonus > 0) {
        user.balance += bonus;
        user.usedPromos.push(code);
        saveDB();
        return res.json({ ok: true, newBalance: user.balance });
    }
    res.status(400).json({ error: "Invalid promo" });
});

// --- STARS PAYMENTS ---
app.post('/create-stars-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "Пополнение NC",
            description: `Обмен ${stars} Stars на монеты NC`,
            payload: `stars_${userId}_${stars}`,
            provider_token: "", 
            currency: "XTR",
            prices: [{ label: "Stars", amount: parseInt(stars) }]
        });
        res.json({ ok: true, link: link });
    } catch (e) {
        console.error("Invoice Error:", e);
        res.status(500).json({ error: "Invoice error" });
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [ , userId, stars] = payload.split('_');
    const user = initUser(userId);
    
    const amountNC = parseInt(stars) * 7500; 
    user.balance += amountNC;
    saveDB();
    await ctx.reply(`✅ +${amountNC.toLocaleString()} NC зачислено!`);
});

// --- БОТ КОМАНДЫ ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload; 
    
    const user = initUser(userId, ctx.from.username || ctx.from.first_name);
    
    if (startPayload && startPayload !== userId && !user.invitedBy && users[startPayload]) {
        user.invitedBy = startPayload;
        users[startPayload].balance += 1000;
        try { 
            await bot.telegram.sendMessage(startPayload, `💰 +1,000 NC! По вашей ссылке зашел @${ctx.from.username || userId}`); 
        } catch(e){}
    }
    saveDB();
    
    ctx.reply("Добро пожаловать в NotCase!", Markup.inlineKeyboard([
        [Markup.button.webApp("ИГРАТЬ", "https://твоя-ссылка.com")]
    ]));
});

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(`Юзеров: ${Object.keys(users).length}\n/give [сумма]`);
});

bot.command('give', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Пример: /give 5000");
    Object.keys(users).forEach(id => { users[id].balance += amount; });
    saveDB();
    ctx.reply(`Раздали ${amount} всем!`);
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server started on port ${PORT}`); 
    bot.launch(); 
});
