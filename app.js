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
    const userCount = Object.keys(users).length;
    ctx.answerCbQuery();
    ctx.reply(`Юзеров: ${userCount}`);
});

bot.action('admin_give_money', (ctx) => {
    if (!isAdmin(ctx)) return;
    Object.keys(users).forEach(id => { users[id].balance += 1000000; });
    saveDB();
    ctx.answerCbQuery("Выдано!");
});

// --- API ДЛЯ КЛИЕНТА ---

// ИСПРАВЛЕНО: Теперь sync-user не затирает данные о промокодах
app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { 
            username: req.body.username || 'unknown', 
            balance: 1000000, 
            usedPromos: [], // Создаем пустой список при регистрации
            tradeLink: "" 
        };
    } else {
        // Если юзер есть, проверяем наличие массива промокодов (на случай старой базы)
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
    }
    
    saveDB();
    res.json(users[userId]);
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId?.toString();
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (!users[userId].usedPromos) users[userId].usedPromos = [];
        
        if (users[userId].usedPromos.includes(promo)) {
            return res.status(400).json({ error: 'Уже использовано!' });
        }

        let bonus = 0;
        if (promo === 'WELCOME') bonus = 1000;
        if (promo === 'CYGAN') bonus = 1670;

        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo); // Сохраняем использование
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Неверный код' });
});

// ДОБАВЛЕНО: Обработка вывода (теперь сообщения будут приходить тебе)
app.post('/withdraw-item', async (req, res) => {
    const { userId, item } = req.body;
    const id = userId?.toString();

    if (id && users[id]) {
        const username = users[id].username || "Неизвестно";
        const trade = users[id].tradeLink || "Ссылка не указана";

        try {
            // Отправляем сообщение тебе в личку
            await bot.telegram.sendMessage(ADMIN_ID, 
                `📦 **ЗАЯВКА НА ВЫВОД**\n\n` +
                `👤 Юзер: @${username} (ID: ${id})\n` +
                `🔫 Предмет: ${item}\n` +
                `🔗 Трейд: ${trade}`
            );
            res.json({ ok: true });
        } catch (e) {
            console.error("Ошибка отправки в бот:", e);
            res.status(500).json({ error: "Ошибка при уведомлении админа" });
        }
    } else {
        res.status(404).json({ error: "User not found" });
    }
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
        res.status(400).send("Error");
    }
});

app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "Пополнение",
            description: "Stars -> NC",
            payload: userId.toString(),
            provider_token: "",
            currency: "XTR",
            prices: [{ label: "Stars", amount: parseInt(stars) }]
        });
        res.json({ url: link });
    } catch (e) { res.status(500).json({ error: "API Error" }); }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', (ctx) => {
    const userId = ctx.message.successful_payment.invoice_payload;
    const amount = ctx.message.successful_payment.total_amount * 100;
    if (users[userId]) {
        users[userId].balance += amount;
        saveDB();
        ctx.reply("Зачислено!");
    }
});

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = { username: ctx.from.username || 'unknown', balance: 1000000, usedPromos: [] };
        saveDB();
    }
    ctx.reply("Привет! Заходи в приложение.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Live on ${PORT}`);
    bot.launch();
});
