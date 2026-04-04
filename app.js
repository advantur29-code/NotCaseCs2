const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

// Твой рабочий токен
const bot = new Telegraf('8297728079:AAHb8-Sys7zF9ma68vLsa4Vzw2lOWerp8NM');
const app = express();

// --- НАСТРОЙКИ СЕРВЕРА ---
app.use(cors());
app.use(bodyParser.json());

// ГЛОБАЛЬНЫЙ ФИКС КРАКОЗЯБР (UTF-8)
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

const ADMIN_ID = 8019223768; 
const DB_FILE = 'database.json';

let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ БАЗА ЗАГРУЖЕНА: ${Object.keys(users).length} юзеров`);
    } catch (e) { 
        console.error("Ошибка чтения базы данных, создаем чистую");
        users = {}; 
    }
}

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), 'utf8');
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
    ctx.reply(`💰 Выдано по ${amount.toLocaleString()} NC всем юзерам!`);
});

bot.action('admin_stats', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.answerCbQuery();
    ctx.reply(`Всего юзеров: ${Object.keys(users).length}`);
});

// --- API ДЛЯ КЛИЕНТА (Mini App) ---

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
    
    const now = new Date();
    const lastBonus = users[id].lastBonus ? new Date(users[id].lastBonus) : null;
    
    if (!lastBonus || (now - lastBonus) > 24 * 60 * 60 * 1000) {
        users[id].balance += 500;
        users[id].lastBonus = now.toISOString();
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Бонус уже взят" });
});

app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    
    if (users[id].completedTasks && users[id].completedTasks.includes(taskId)) {
        return res.status(400).json({ error: "Уже выполнено!" });
    }
    
    let reward = 0;
    if (taskId === 'sub_tg') reward = 50000;
    if (taskId === 'join_chat') reward = 25000;
    if (taskId === 'boost_tg') reward = 500000;
    
    if (reward > 0) {
        users[id].balance += reward;
        if (!users[id].completedTasks) users[id].completedTasks = [];
        users[id].completedTasks.push(taskId);
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Задание не найдено" });
});

app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    const id = userId?.toString();
    if (id && users[id]) { 
        users[id].balance = balance; 
        saveDB(); 
        res.json({ ok: true }); 
    } else {
        res.status(400).json({ error: "User not found" });
    }
});

app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    const id = userId?.toString();
    if (id && users[id]) { 
        users[id].tradeLink = tradeLink; 
        saveDB(); 
        res.json({ ok: true }); 
    } else { 
        res.status(400).json({ error: "User not found" }); 
    }
});

// --- СТАРТ БОТА ---
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
        
        if (startPayload && startPayload !== userId) {
            const refId = startPayload.toString();
            if (users[refId]) {
                users[refId].balance += 500;
                users[userId].invitedBy = refId;
                try { 
                    await bot.telegram.sendMessage(refId, `🎊 **+500 NC!** @${ctx.from.username || userId} зашел по ссылке!`); 
                } catch (e) {}
            }
        }
        saveDB();
        ctx.reply("Добро пожаловать в NotCase! 🎉");
    } else { 
        ctx.reply("С возвращением!"); 
    }
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Сервер запущен на порту ${PORT}`); 
    bot.launch(); 
});
