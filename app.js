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
    } catch (e) {
        console.log("❌ Ошибка базы, создаем новую");
        users = {};
    }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
let activeSessions = new Set();

// --- ОБРАБОТКА ПЛАТЕЖЕЙ STARS (ВЫНЕСЕНО ИЗ LISTEN) ---

// 1. Подтверждение (PreCheckout)
bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
        console.log(`[STARS] Проверка платежа для @${ctx.from.username} - OK`);
    } catch (e) {
        console.error("❌ Ошибка PreCheckout:", e);
    }
});

// 2. Успешная оплата
bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const payload = JSON.parse(payment.invoice_payload);
        const userId = payload.uId;
        const starsAmount = payment.total_amount;
        const bonusNC = starsAmount * 100;

        if (users[userId]) {
            users[userId].balance += bonusNC;
            saveDB();
            console.log(`💰 ОПЛАТА: @${users[userId].username} +${bonusNC} NC`);
            await ctx.reply(`💎 Успешно! Зачислено ${bonusNC.toLocaleString()} NC.\nБаланс: ${users[userId].balance.toLocaleString()} NC`);
        }
    } catch (e) {
        console.error("❌ Ошибка обработки платежа:", e);
    }
});

// --- КОМАНДЫ БОТА ---

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = {
            username: ctx.from.username || 'unknown',
            balance: 1000000, // 1 апреля!
            tradeLink: '',
            withdrawRequests: [],
            usedPromos: []
        };
        saveDB();
    }
    ctx.reply(`С 1 апреля! Твой баланс: ${users[userId].balance.toLocaleString()} NC. Удачи в кейсах! 🃏`);
});

bot.command('setbal', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const parts = ctx.message.text.split(' ');
    const id = parts[1];
    const amount = parseInt(parts[2]);
    if (users[id]) {
        users[id].balance = amount;
        saveDB();
        ctx.reply(`✅ Баланс @${users[id].username} изменен на ${amount} NC`);
    }
});

// --- API ЭНДПОИНТЫ ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const username = req.body.username || 'unknown';
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { username, balance: 1000000, tradeLink: '', withdrawRequests: [], usedPromos: [] };
        console.log(`[НОВЫЙ ЮЗЕР] @${username}`);
    } else {
        users[userId].username = username;
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
        if (users[userId].usedPromos.includes(promo)) {
            return res.status(400).json({ error: 'Уже использован!' });
        }

        let bonus = 0;
        if (promo === 'WELCOME') bonus = 1000000;
        if (promo === 'CYGAN') bonus = 1670; // Тот самый бонус

        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo);
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Неверный код' });
});

app.post('/update-balance', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    if (userId && users[userId]) {
        users[userId].balance = req.body.balance;
        saveDB();
        res.json({ success: true });
    }
});

app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const invoiceLink = await bot.telegram.createInvoiceLink(
            "Пополнение NotCase",
            `Покупка ${stars * 100} NC`,
            JSON.stringify({ uId: userId.toString(), amt: parseInt(stars) }),
            "", "XTR", [{ label: "Stars", amount: parseInt(stars) }]
        );
        res.json({ url: invoiceLink });
    } catch (e) {
        res.status(500).json({ error: "Ошибка инвойса" });
    }
});

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 СЕРВЕР LIVE | ПОРТ ${PORT}`);

    bot.launch()
        .then(() => console.log('🤖 БОТ ЗАПУЩЕН'))
        .catch(err => console.error('❌ ОШИБКА БОТА:', err));
});