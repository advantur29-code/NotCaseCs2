const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

// Твой токен и настройки
const bot = new Telegraf('8297728079:AAFRadxLDhZ61mPzcpspS0Sbfgjlv4a9Kvc');
const app = express();

app.use(cors());
app.use(bodyParser.json());

const ADMIN_ID = 8019223768; 
const DB_FILE = 'database.json';

let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ БАЗА ЗАГРУЖЕНА: ${Object.keys(users).length} юзеров`);
    } catch (e) { 
        console.error("Ошибка чтения базы, создаю новую...");
        users = {}; 
    }
}

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error("Ошибка сохранения базы:", e);
    }
};

// --- АДМИНКА ---
const isAdmin = (ctx) => ctx.from && ctx.from.id === ADMIN_ID;

bot.command('admin', (ctx) => {
    if (!isAdmin(ctx)) return;
    const userCount = Object.keys(users).length;
    ctx.reply(`Админ-панель\nЮзеров: ${userCount}\n\nЧтобы выдать монеты всем, напиши:\n/give [сумма]`, Markup.inlineKeyboard([
        [Markup.button.callback("📊 Стата", "admin_stats")]
    ]));
});

bot.command('give', (ctx) => {
    if (!isAdmin(ctx)) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Пиши: /give 5000");

    Object.keys(users).forEach(id => { 
        users[id].balance = (users[id].balance || 0) + amount; 
    });
    saveDB();
    ctx.reply(`✅ Выдано по ${amount.toLocaleString()} NC всем юзерам!`);
});

bot.action('admin_stats', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.answerCbQuery();
    ctx.reply(`Всего юзеров: ${Object.keys(users).length}`);
});

// --- API ДЛЯ КЛИЕНТА ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).send("No ID");
    
    if (!users[userId]) {
        // УСТАНОВЛЕНО: 10 000 NC при первом входе
        users[userId] = { 
            username: req.body.username || 'unknown', 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            lastBonus: null, 
            tradeLink: "",
            invitedBy: null
        };
    } else {
        // Проверка на целостность данных
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
        if (!users[userId].completedTasks) users[userId].completedTasks = [];
        if (users[userId].balance === undefined) users[userId].balance = 10000;
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/daily-bonus', (req, res) => {
    const { userId } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    
    const now = new Date();
    const lastBonus = users[id].lastBonus ? new Date(users[id].lastBonus) : null;
    
    if (!lastBonus || (now - lastBonus) > 24 * 60 * 60 * 1000) {
        users[id].balance += 500;
        users[id].lastBonus = now.toISOString();
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    } else {
        const diff = 24 * 60 * 60 * 1000 - (now - lastBonus);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        return res.status(400).json({ error: `Приходи через ${hours} ч.` });
    }
});

app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    if (users[id].completedTasks.includes(taskId)) return res.status(400).json({ error: "Уже выполнено!" });

    let reward = 0;
    if (taskId === 'sub_tg') reward = 50000;
    if (taskId === 'join_chat') reward = 25000;
    if (taskId === 'boost_tg') reward = 500000;
    
    if (reward > 0) {
        users[id].balance += reward;
        users[id].completedTasks.push(taskId);
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Задание не найдено" });
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId?.toString();
    const promo = (req.body.promo || "").toUpperCase();
    
    if (userId && users[userId]) {
        if (!Array.isArray(users[userId].usedPromos)) users[userId].usedPromos = [];
        if (users[userId].usedPromos.includes(promo)) return res.status(400).json({ error: 'Уже использовано!' });
        
        let bonus = 0;
        if (promo === 'WELCOME') bonus = 1000;
        if (promo === 'CYGAN') bonus = 1670;
        
        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo);
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Неверный код' });
});

app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    if (userId && users[userId]) { 
        users[userId].tradeLink = tradeLink; 
        saveDB(); 
        res.json({ ok: true }); 
    } else { 
        res.status(400).send("User not found"); 
    }
});

app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    if (userId && users[userId]) { 
        users[userId].balance = balance; 
        saveDB(); 
        res.json({ ok: true }); 
    } else {
        res.status(400).send("User not found");
    }
});

// БОТ СТАРТ
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload;
    
    if (!users[userId]) {
        // ТУТ ТОЖЕ 10 000 NC
        users[userId] = { 
            username: ctx.from.username || 'unknown', 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            tradeLink: "", 
            invitedBy: null 
        };
        
        if (startPayload && startPayload !== userId) {
            const refId = startPayload;
            if (users[refId]) {
                users[refId].balance += 500;
                users[userId].invitedBy = refId;
                try { 
                    await bot.telegram.sendMessage(refId, `🤝 **+500 NC!** @${users[userId].username} зашел по ссылке!`); 
                } catch (e) {}
            }
        }
        saveDB();
        ctx.reply("Добро пожаловать в NotCase! 💎\nТвой начальный баланс: 10,000 NC");
    } else { 
        ctx.reply("С возвращением!"); 
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Сервер запущен на порту ${PORT}`); 
    bot.launch(); 
});
