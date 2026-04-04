const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const bot = new Telegraf('8297728079:AAEubM12zGW6QYrVSRhzZCspHzFqw7tLrIM');
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
        users = {};
    }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

// --- АДМИНКА ---
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

bot.command('admin', (ctx) => {
    if (!isAdmin(ctx)) return;
    const userCount = Object.keys(users).length;
    ctx.reply(`Админ-панель\nЮзеров: ${userCount}`, Markup.inlineKeyboard([
        [Markup.button.callback("💰 Дать всем 1.000.000", "admin_give_money")],
        [Markup.button.callback("📊 Стата", "admin_stats")]
    ]));
});

bot.action('admin_stats', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.answerCbQuery();
    ctx.reply(`Всего юзеров: ${Object.keys(users).length}`);
});

bot.action('admin_give_money', (ctx) => {
    if (!isAdmin(ctx)) return;
    Object.keys(users).forEach(id => { users[id].balance += 1000000; });
    saveDB();
    ctx.answerCbQuery("Выдано!");
});

// --- API ДЛЯ КЛИЕНТА ---

// 1. Синхронизация (ИСПРАВЛЕНО: добавляем новые поля, чтобы не было багов)
app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { 
            username: req.body.username || 'unknown', 
            balance: 1000000, 
            usedPromos: [], 
            completedTasks: [], // Поле для заданий
            lastBonus: null,    // Поле для ежедневки
            tradeLink: "",
            invitedBy: null
        };
    } else {
        // Проверяем наличие полей у старых юзеров
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
        if (!users[userId].completedTasks) users[userId].completedTasks = [];
    }
    
    saveDB();
    res.json(users[userId]);
});

// 2. Ежедневный бонус 500 монет
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

// 3. Выполнение заданий
app.post('/check-task', (req, res) => {
    const { userId, taskId } = req.body;
    const id = userId?.toString();
    
    if (!id || !users[id]) return res.status(400).json({ error: "User not found" });
    if (!users[id].completedTasks) users[id].completedTasks = [];

    if (users[id].completedTasks.includes(taskId)) {
        return res.status(400).json({ error: "Уже выполнено!" });
    }

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

// 4. Промокоды (ИСПРАВЛЕНО: одна рабочая функция)
app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId?.toString();
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (!Array.isArray(users[userId].usedPromos)) users[userId].usedPromos = [];
        
        if (users[userId].usedPromos.includes(promo)) {
            return res.status(400).json({ error: 'Уже использовано!' });
        }

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

// 5. Вывод предметов
app.post('/withdraw-item', async (req, res) => {
    const { userId, item } = req.body;
    const id = userId?.toString();

    if (id && users[id]) {
        const username = users[id].username || "Неизвестно";
        const trade = users[id].tradeLink || "Ссылка не указана";
        try {
            await bot.telegram.sendMessage(ADMIN_ID, 
                `📦 **ЗАЯВКА НА ВЫВОД**\n\n👤 Юзер: @${username}\n🔫 Предмет: ${item}\n🔗 Трейд: ${trade}`
            );
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: "Ошибка ТГ" }); }
    } else { res.status(404).json({ error: "User not found" }); }
});

app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    if (userId && users[userId]) {
        users[userId].tradeLink = tradeLink;
        saveDB();
        res.json({ ok: true });
    } else { res.status(400).send("User not found"); }
});

// --- БОТ И РЕФЕРАЛЫ ---

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload;

    if (!users[userId]) {
        users[userId] = { 
            username: ctx.from.username || 'unknown', 
            balance: 1000000, 
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

                const grandId = users[refId].invitedBy;
                if (grandId && users[grandId]) {
                    users[grandId].balance += 150;
                    try {
                        await bot.telegram.sendMessage(grandId, `📈 **+150 NC!** Реферал 2-го уровня.`);
                    } catch (e) {}
                }
            }
        }
        saveDB();
        ctx.reply("Добро пожаловать в NotCase! 💎");
    } else {
        ctx.reply("С возвращением!");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Live on ${PORT}`);
    bot.launch();
});
