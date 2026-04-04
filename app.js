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

// Фикс кодировки для кириллицы
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// --- РАБОТА С БАЗОЙ ДАННЫХ ---
let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`Base loaded: ${Object.keys(users).length} users`);
    } catch (e) { 
        console.error("DB Error, creating new");
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

// --- ПЛАТЕЖИ (STARS) ---

app.post('/create-stars-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "Top up NC",
            description: `Exchange ${stars} Stars for NC coins`,
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
        await ctx.reply(`✅ Payment received! +${amountNC} NC`);
    }
});

// --- РЕФЕРАЛКА И СТАРТ ---

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload; 
    
    if (!users[userId]) {
        users[userId] = { 
            username: ctx.from.username || 'unknown', 
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
            try { await bot.telegram.sendMessage(L1, `💰 +1,000 NC! Friend @${ctx.from.username || userId} joined!`); } catch(e){}

            const L2 = users[L1].invitedBy;
            if (L2 && users[L2]) {
                users[L2].balance += 500;
                try { await bot.telegram.sendMessage(L2, `📈 +500 NC! L2 Referral joined!`); } catch(e){}

                const L3 = users[L2].invitedBy;
                if (L3 && users[L3]) {
                    users[L3].balance += 250;
                    try { await bot.telegram.sendMessage(L3, `🔥 +250 NC! L3 Referral joined!`); } catch(e){}
                }
            }
        }
        saveDB();
        ctx.reply("Welcome to NotCase! 📦\nOpen cases and earn!");
    } else { 
        ctx.reply("Welcome back!"); 
    }
});

// --- АДМИНКА ---

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(`Admin\nUsers: ${Object.keys(users).length}\n/give [amount]`);
});

bot.command('give', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Use: /give 5000");
    Object.keys(users).forEach(id => { users[id].balance += amount; });
    saveDB();
    ctx.reply("Added " + amount + " NC to everyone.");
});

// --- СТАРТ СЕРВЕРА ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`); 
    bot.launch(); 
});
