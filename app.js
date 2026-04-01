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

// --- API ЭНДПОИНТЫ ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const username = req.body.username || 'unknown';
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        // Даем 1 000 000 NC новым игрокам
        users[userId] = {
            username,
            balance: 1000000,
            tradeLink: '',
            withdrawRequests: [],
            usedPromos: []
        };
        console.log(`[НОВЫЙ ЮЗЕР] @${username} (ID: ${userId})`);
    } else {
        users[userId].username = username;
        // Проверка на старые аккаунты, у которых нет поля usedPromos
        if (!users[userId].usedPromos) users[userId].usedPromos = [];

        if (!activeSessions.has(userId)) {
            console.log(`[ВХОД] @${username} | Баланс: ${users[userId].balance}`);
            activeSessions.add(userId);
        }
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/update-balance', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    if (userId && users[userId]) {
        users[userId].balance = req.body.balance;
        saveDB();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId ? req.body.userId.toString() : null;
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (!users[userId].usedPromos) users[userId].usedPromos = [];

        // Проверка: использовал ли уже?
        if (users[userId].usedPromos.includes(promo)) {
            return res.status(400).json({ error: 'Промокод уже использован!' });
        }

        let bonus = 0;
        if (promo === 'WELCOME') bonus = 1000000;
        if (promo === 'CYGAN') bonus = 1670;

        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo); // Записываем использование
            saveDB();
            console.log(`[ПРОМО] @${users[userId].username} активировал ${promo} (+${bonus} NC)`);
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Неверный промокод' });
});

app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    const amount = parseInt(stars);

    if (!userId || isNaN(amount)) return res.status(400).json({ error: "Ошибка данных" });

    try {
        const invoiceLink = await bot.telegram.createInvoiceLink(
            "Пополнение NotCase",
            `Покупка ${amount * 100} NC`,
            JSON.stringify({ uId: userId.toString(), amt: amount }),
            "",
            "XTR",
            [{ label: "Stars", amount: amount }]
        );
        res.json({ url: invoiceLink });
    } catch (e) {
        console.error("Ошибка счета:", e);
        res.status(500).json({ error: "Ошибка создания счета" });
    }
});

// --- ТЕЛЕГРАМ БОТ (Платежи и Команды) ---

// 1. Подтверждение платежа
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

// 2. Начисление после успешной оплаты Stars
bot.on('successful_payment', (ctx) => {
    const payload = JSON.parse(ctx.message.successful_payment.invoice_payload);
    const userId = payload.uId;
    const bonusNC = payload.amt * 100;

    if (users[userId]) {
        users[userId].balance += bonusNC;
        saveDB();
        ctx.reply(`✅ Оплата принята! Зачислено ${bonusNC} NC.`);
        console.log(`[STARS] @${users[userId].username} +${bonusNC} NC`);
    }
});

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = {
            username: ctx.from.username || 'unknown',
            balance: 1000000,
            tradeLink: '',
            withdrawRequests: [],
            usedPromos: []
        };
        saveDB();
    }
    ctx.reply(`С 1 апреля! Твой баланс: ${users[userId].balance} NC. Жми "Играть", чтобы открыть кейсы! 🃏`);
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

// --- ЗАПУСК ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    // 1. Этот обработчик ОБЯЗАТЕЛЕН. Без него кнопка "Оплатить" в Telegram будет выдавать ошибку
    bot.on('pre_checkout_query', async (ctx) => {
        console.log(`[CHECKOUT] Проверка платежа от @${ctx.from.username}...`);
        try {
            await ctx.answerPreCheckoutQuery(true);
            console.log(`[CHECKOUT] Разрешение дано!`);
        } catch (e) {
            console.error("❌ Ошибка PreCheckout:", e);
        }
    });

    // 2. Этот блок сработает ТОЛЬКО после того, как юзер ввел пароль и Telegram списал звезды
    bot.on('successful_payment', async (ctx) => {
        try {
            const payment = ctx.message.successful_payment;
            const payload = JSON.parse(payment.invoice_payload);
            const userId = payload.uId;
            const starsAmount = payment.total_amount; // Количество звезд
            const bonusNC = starsAmount * 100; // Твой курс: 1 звезда = 100 NC

            if (users[userId]) {
                users[userId].balance += bonusNC;
                saveDB();

                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`💰 УСПЕШНАЯ ОПЛАТА!`);
                console.log(`Юзер: @${users[userId].username} (ID: ${userId})`);
                console.log(`Списано: ${starsAmount} ⭐ | Начислено: ${bonusNC} NC`);
                console.log(`Новый баланс: ${users[userId].balance} NC`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

                await ctx.reply(`✅ Оплата прошла! На ваш баланс зачислено ${bonusNC.toLocaleString()} NC. Приятной игры!`);
            } else {
                console.error(`[!] Ошибка: Юзер ${userId} не найден в базе при оплате!`);
            }
        } catch (e) {
            console.error("❌ Критическая ошибка при обработке успешного платежа:", e);
        }
    });
    bot.launch()
        .then(() => console.log('🤖 Бот успешно запущен в Telegram'))
        .catch(err => console.error('❌ Ошибка старта бота:', err));
});