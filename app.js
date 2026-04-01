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
        console.log("❌ Ошибка базы");
        users = {};
    }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

// --- ОБРАБОТКА ПЛАТЕЖЕЙ STARS ---

// 1. Подтверждение (ОБЯЗАТЕЛЬНО для появления синей кнопки)
bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
        console.log(`[STARS] PreCheckout OK для @${ctx.from.username}`);
    } catch (e) {
        console.error("❌ Ошибка PreCheckout:", e);
    }
});

// 2. Успешная оплата (начисление монет)
bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        // Мы передавали userId как payload строку
        const userId = payment.invoice_payload;
        const starsAmount = payment.total_amount;
        const bonusNC = starsAmount * 100;

        if (users[userId]) {
            users[userId].balance += bonusNC;
            saveDB();
            console.log(`💰 ОПЛАТА ЗАЧИСЛЕНА: @${users[userId].username} +${bonusNC} NC`);
            await ctx.reply(`✅ Успешно! Зачислено ${bonusNC.toLocaleString()} NC.\nБаланс: ${users[userId].balance.toLocaleString()} NC`);
        }
    } catch (e) {
        console.error("❌ Ошибка в successful_payment:", e);
    }
});

// --- КОМАНДЫ ---
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = { username: ctx.from.username || 'unknown', balance: 100000, usedPromos: [] };
        saveDB();
    }
    ctx.reply(`С 1 апреля! Твой баланс: ${users[userId].balance.toLocaleString()} NC. 🃏`);
});

// --- API ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { username: req.body.username || 'unknown', balance: 1000000, usedPromos: [] };
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId?.toString();
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
        if (users[userId].usedPromos.includes(promo)) return res.status(400).json({ error: 'Уже юзал!' });

        let bonus = 0;
        if (promo === 'WELCOME') bonus = 1000;
        if (promo === 'CYGAN') bonus = 1670; // 1670 коинов, как просил

        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo);
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Код неверный' });
});

// ФУНКЦИЯ СОЗДАНИЯ ИНВОЙСА (ИСПРАВЛЕНА)
app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    if (!userId || !stars) return res.status(400).json({ error: "Нет данных" });

    try {
        const amount = parseInt(stars);

        // Создаем ссылку на оплату
        const invoiceLink = await bot.telegram.createInvoiceLink(
            "Обмен Stars на монеты",         // title
            `Покупка ${amount * 100} NC`,   // description
            userId.toString(),               // payload (просто ID строкой!)
            "",                              // provider_token (пусто для Stars)
            "XTR",                           // currency
            [{ label: "Stars", amount: amount }] // prices
        );

        console.log(`[LINK] Ссылка создана для ${userId} на ${amount} звезд`);
        res.json({ url: invoiceLink });
    } catch (e) {
        console.error("❌ ОШИБКА TELEGRAM API:", e);
        res.status(500).json({ error: "Telegram не принял запрос на оплату" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 СЕРВЕР LIVE | ПОРТ ${PORT}`);
    bot.launch().then(() => console.log('🤖 БОТ ЗАПУЩЕН'));
});