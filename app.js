const { Telegraf } = require('telegraf');
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

// --- ЗАГРУЗКА БАЗЫ ---
let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ БАЗА ЗАГРУЖЕНА: ${Object.keys(users).length} юзеров`);
    } catch (e) { console.log("❌ Ошибка базы, создаем новую"); users = {}; }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
let activeSessions = new Set();

// --- API ЭНДПОИНТЫ (Все твои функции тут) ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const username = req.body.username || 'unknown';
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { username, balance: 1000, tradeLink: '', withdrawRequests: [] };
        console.log(`[НОВЫЙ ЮЗЕР] @${username} (ID: ${userId})`);
    } else {
        users[userId].username = username;
        if (!activeSessions.has(userId)) {
            console.log(`[ВХОД] @${username} открыл WebApp | Баланс: ${users[userId].balance}`);
            activeSessions.add(userId);
        }
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/log-action', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const { action, caseType, item, price } = req.body;
    if (userId && users[userId]) {
        const user = `@${users[userId].username}`;
        const time = new Date().toLocaleTimeString();
        if (action === 'open_case') {
            console.log(`[КЕЙС] ${time} | ${user} открыл ${caseType} -> ${item}`);
        } else if (action === 'sell_item') {
            console.log(`[ПРОДАЖА] ${time} | ${user} продал ${item} за ${price} NC`);
        }
    }
    res.json({ success: true });
});

app.post('/update-balance', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    if (userId && users[userId]) {
        users[userId].balance = req.body.balance;
        saveDB();
        res.json({ success: true });
    }
});

app.post('/save-trade', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    if (userId && users[userId]) {
        users[userId].tradeLink = req.body.tradeLink;
        saveDB();
        console.log(`[ТРЕЙД] @${users[userId].username} обновил ссылку`);
        res.json({ success: true });
    }
});

app.post('/withdraw-item', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    if (userId && users[userId]) {
        users[userId].withdrawRequests.push({ item: req.body.item, date: new Date().toLocaleString() });
        saveDB();
        console.log(`[ВЫВОД] @${users[userId].username} заказал ${req.body.item}`);
        bot.telegram.sendMessage(ADMIN_ID, `📦 ЗАЯВКА: @${users[userId].username} -> ${req.body.item}`);
        res.json({ success: true });
    }
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const promo = (req.body.promo || "").toUpperCase();
    if (userId && users[userId]) {
        let bonus = (promo === 'WELCOME') ? 1000 : (promo === 'CYGAN' ? 1670 : 0);
        if (bonus > 0) {
            users[userId].balance += bonus;
            saveDB();
            console.log(`[ПРОМО] @${users[userId].username} +${bonus} NC`);
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Ошибка промокода' });
});

// Добавил эндпоинт для Stars, чтобы HTML не ругался
app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    const amount = parseInt(stars);

    if (!userId || isNaN(amount)) return res.status(400).json({ error: "Ошибка данных" });

    try {
        // Создаем ссылку на оплату через Telegram Stars
        const invoiceLink = await bot.telegram.createInvoiceLink(
            "Пополнение NotCase",
            `Покупка ${amount * 100} NC`,
            JSON.stringify({ uId: userId.toString(), amt: amount }), // Payload
            "", // Токен пустой для Stars
            "XTR",
            [{ label: "Stars", amount: amount }]
        );

        res.json({ url: invoiceLink }); // Отправляем ссылку обратно в WebApp
    } catch (e) {
        console.error("Ошибка счета:", e);
        res.status(500).json({ error: "Ошибка создания счета" });
    }
});

// --- ТЕЛЕГРАМ БОТ ---
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = { username: ctx.from.username || 'unknown', balance: 1000, tradeLink: '', withdrawRequests: [] };
        saveDB();
    }
    ctx.reply(`Баланс: ${users[userId].balance} NC. С 1 апреля! 🃏`);
});

bot.command('setbal', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const [_, id, amount] = ctx.message.text.split(' ');
    if (users[id]) {
        users[id].balance = parseInt(amount);
        saveDB();
        ctx.reply(`✅ @${users[id].username}: ${amount} NC`);
    }
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000; // Render использует 10000 по умолчанию

app.listen(PORT, '0.0.0.0', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 СЕРВЕР LIVE И ДОСТУПЕН`);
    console.log(`🔗 Адрес: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    bot.launch()
        .then(() => console.log('🤖 Бот в сети'))
        .catch(err => console.error('❌ Ошибка бота:', err));
});