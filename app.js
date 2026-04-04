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
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`Base loaded: ${Object.keys(users).length} users`);
    } catch (e) { 
        console.error("DB Error");
        users = {}; 
    }
}

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error("Save Error:", e);
    }
};

// --- API ДЛЯ MINI APP ---

// Синхронизация и создание юзера
app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).json({ error: "No ID" });
    
    if (!users[userId]) {
        users[userId] = { 
            username: req.body.username || 'unknown', 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            lastBonus: null, 
            tradeLink: "",
            invitedBy: null
        };
        saveDB();
    }
    res.json(users[userId]);
});

// Сохранение трейд-ссылки
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

// Обновление баланса (после продаж или спинов)
app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    const id = userId?.toString();
    if (users[id]) {
        users[id].balance = balance;
        saveDB();
        res.json({ ok: true });
    }
});

// Проверка заданий (Подписки, Чаты, Буст)
app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    if (!users[id]) return res.status(404).json({ error: "User not found" });

    if (!users[id].completedTasks) users[id].completedTasks = [];
    if (users[id].completedTasks.includes(taskId)) return res.status(400).json({ error: "Already done" });

    let reward = 0;
    if (taskId === 'sub_tg') reward = 50000;
    if (taskId === 'join_chat') reward = 25000;
    if (taskId === 'boost_tg') reward = 500000; // Твой бонус 500к за буст

    if (reward > 0) {
        users[id].balance += reward;
        users[id].completedTasks.push(taskId);
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Unknown task" });
});

app.post('/daily-bonus', (req, res) => {
    const { userId } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    
    const now = Date.now();
    const lastBonus = users[id].lastBonus ? new Date(users[id].lastBonus).getTime() : 0;
    const DAY = 24 * 60 * 60 * 1000;

    if (now - lastBonus > DAY) {
        users[id].balance += 500;
        users[id].lastBonus = new Date().toISOString();
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Already claimed today" });
});

app.post('/apply-promo', (req, res) => {
    const { userId, promo } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });

    if (!users[id].usedPromos) users[id].usedPromos = [];
    const code = promo.toLowerCase();
    if (users[id].usedPromos.includes(code)) return res.status(400).json({ error: "Already used" });

    let bonus = 0;
    if (code === 'advantur') bonus = 1000000;
    if (code === 'start') bonus = 50000;

    if (bonus > 0) {
        users[id].balance += bonus;
        users[id].usedPromos.push(code);
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
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
        res.status(500).json({ error: "Invoice error" });
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [ , userId, stars] = payload.split('_');
    
    if (users[userId]) {
        const amountNC = parseInt(stars) * 100;
        users[userId].balance += amountNC;
        saveDB();
        await ctx.reply(`✅ Оплата принята! +${amountNC.toLocaleString()} NC зачислено.`);
    }
});

// --- РЕФЕРАЛКА ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload; 
    
    if (!users[userId]) {
        users[userId] = { 
            username: ctx.from.username || ctx.from.first_name, 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            tradeLink: "", 
            invitedBy: null 
        };
        
        if (startPayload && startPayload !== userId && users[startPayload]) {
            const L1 = startPayload.toString();
            users[userId].invitedBy = L1;
            users[L1].balance += 1000;
            try { await bot.telegram.sendMessage(L1, `💰 +1,000 NC! По вашей ссылке зашел @${ctx.from.username || userId}`); } catch(e){}
        }
        saveDB();
        ctx.reply("Добро пожаловать в NotCase! 📦\nОткрывай кейсы и собирай инвентарь.");
    } else { 
        ctx.reply("С возвращением!"); 
    }
});

// --- АДМИНКА ---
bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(`Статистика:\nЮзеров: ${Object.keys(users).length}\nКоманда: /give [сумма]`);
});

bot.command('give', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Пример: /give 5000");
    Object.keys(users).forEach(id => { users[id].balance += amount; });
    saveDB();
    ctx.reply(`Раздали по ${amount} NC всем игрокам!`);
});

// --- СТАРТ ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`); 
    bot.launch(); 
});
