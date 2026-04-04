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
        console.log(`📦 База загружена: ${Object.keys(users).length} юзеров`);
    } catch (e) { 
        console.error("Ошибка базы, создаем новую");
        users = {}; 
    }
}

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error("Ошибка записи:", e);
    }
};

// --- API ДЛЯ ТВОЕГО MINI APP ---

// 1. Синхронизация и создание юзера
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

// 2. Ежедневный бонус (раз в 24 часа)
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
    res.status(400).json({ error: "Бонус уже получен сегодня!" });
});

// 3. Проверка выполнения заданий
app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    
    if (users[id].completedTasks?.includes(taskId)) {
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

// 4. Промокоды
app.post('/apply-promo', (req, res) => {
    const { userId, promo } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });

    if (!users[id].usedPromos) users[id].usedPromos = [];
    if (users[id].usedPromos.includes(promo.toLowerCase())) {
        return res.status(400).json({ error: "Вы уже вводили этот код!" });
    }

    let bonus = 0;
    const code = promo.toLowerCase();
    if (code === 'advantur') bonus = 1000000;
    if (code === 'start') bonus = 50000;

    if (bonus > 0) {
        users[id].balance += bonus;
        users[id].usedPromos.push(code);
        saveDB();
        return res.json({ ok: true, newBalance: users[id].balance });
    }
    res.status(400).json({ error: "Промокод не существует" });
});

// 5. Пополнение через Stars (обмен)
app.post('/top-up', (req, res) => {
    const { userId, stars } = req.body;
    const id = userId?.toString();
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });

    const amountNC = parseInt(stars) * 100; 
    users[id].balance += amountNC;
    saveDB();
    res.json({ ok: true, newBalance: users[id].balance });
});

// 6. Быстрое сохранение баланса (кейсы)
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

// 7. Сохранение трейд-ссылки
app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    const id = userId?.toString();
    if (id && users[id]) { 
        users[id].tradeLink = tradeLink; 
        saveDB(); 
        res.json({ ok: true }); 
    }
});

// --- ЛОГИКА БОТА И РЕФЕРАЛКА ---

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload; // ID пригласителя
    
    if (!users[userId]) {
        users[userId] = { 
            username: ctx.from.username || 'unknown', 
            balance: 10000, 
            usedPromos: [], 
            completedTasks: [], 
            tradeLink: "", 
            invitedBy: null 
        };
        
        // РЕФЕРАЛЬНАЯ СИСТЕМА 3 УРОВНЯ
        if (startPayload && startPayload !== userId && users[startPayload]) {
            // L1 (1000 NC)
            const L1 = startPayload.toString();
            users[userId].invitedBy = L1;
            users[L1].balance += 1000;
            try { await bot.telegram.sendMessage(L1, `💰 +1,000 NC! Друг @${ctx.from.username || userId} в игре!`); } catch(e){}

            // L2 (500 NC)
            const L2 = users[L1].invitedBy;
            if (L2 && users[L2]) {
                users[L2].balance += 500;
                try { await bot.telegram.sendMessage(L2, `📈 +500 NC! Реферал 2-го уровня в игре!`); } catch(e){}

                // L3 (250 NC)
                const L3 = users[L2].invitedBy;
                if (L3 && users[L3]) {
                    users[L3].balance += 250;
                    try { await bot.telegram.sendMessage(L3, `🔥 +250 NC! Реферал 3-го уровня в игре!`); } catch(e){}
                }
            }
        }
        saveDB();
        ctx.reply("Добро пожаловать в NotCase! 📦\nЗапускай приложение и открывай кейсы!");
    } else { 
        ctx.reply("С возвращением в NotCase!"); 
    }
});

// Админка
bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply(`Админка\nЮзеров: ${Object.keys(users).length}\n/give [сумма] - раздать всем`);
});

bot.command('give', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Пример: /give 5000");
    Object.keys(users).forEach(id => { users[id].balance += amount; });
    saveDB();
    ctx.reply(`✅ Выдано по ${amount} NC каждому!`);
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Сервер на порту ${PORT}`); 
    bot.launch(); 
});
