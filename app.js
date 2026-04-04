const { Telegraf, Markup } = require('telegraf'); // Добавили Markup для кнопок
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const bot = new Telegraf('8297728079:AAEubM12zGW6QYrVSRhzZCspHzFqw7tLrIM');
const app = express();

app.use(cors());
app.use(bodyParser.json());

const ADMIN_ID = 8019223768; // Твой ID
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

// --- АДМИН ПАНЕЛЬ (ЛОГИКА) ---

// Проверка на админа
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

bot.command('admin', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ У тебя нет прав администратора.");
    
    const userCount = Object.keys(users).length;
    ctx.reply(`🛠 **Админ-панель NotCase**\n\nВсего пользователей в базе: ${userCount}`, 
    Markup.inlineKeyboard([
        [Markup.button.callback("📢 Сделать рассылку", "admin_broadcast")],
        [Markup.button.callback("💰 Выдать всем 1.000.000 NC", "admin_give_money")],
        [Markup.button.callback("📊 Статистика базы", "admin_stats")]
    ]));
});

// Обработка кнопок админки
bot.action('admin_stats', (ctx) => {
    if (!isAdmin(ctx)) return;
    const userCount = Object.keys(users).length;
    let totalBalance = 0;
    Object.values(users).forEach(u => totalBalance += (u.balance || 0));
    
    ctx.answerCbQuery();
    ctx.reply(`📊 **Статистика:**\nЮзеров: ${userCount}\nОбщий банк NC: ${totalBalance.toLocaleString()}`);
});

bot.action('admin_give_money', (ctx) => {
    if (!isAdmin(ctx)) return;
    Object.keys(users).forEach(id => {
        users[id].balance += 1000000;
    });
    saveDB();
    ctx.answerCbQuery("Баланс выдан!");
    ctx.reply("✅ Всем пользователям начислено по 1,000,000 NC!");
});

bot.action('admin_broadcast', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.answerCbQuery();
    ctx.reply("Напиши текст рассылки в ответ на это сообщение (используй команду /send текст)");
});

// Команда для рассылки: /send Привет всем!
bot.command('send', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const text = ctx.message.text.replace('/send', '').trim();
    if (!text) return ctx.reply("Введите текст после команды /send");

    const userIds = Object.keys(users);
    let success = 0;

    ctx.reply(`🚀 Начинаю рассылку на ${userIds.length} человек...`);

    for (let id of userIds) {
        try {
            await bot.telegram.sendMessage(id, text);
            success++;
        } catch (e) {
            console.log(`Не удалось отправить пользователю ${id}`);
        }
    }
    ctx.reply(`✅ Рассылка завершена!\nДоставлено: ${success} из ${userIds.length}`);
});

// --- ОБРАБОТКА ПЛАТЕЖЕЙ STARS ---

bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
        console.error("❌ Ошибка PreCheckout:", e);
    }
});

bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const userId = payment.invoice_payload;
        const starsAmount = payment.total_amount;
        const bonusNC = starsAmount * 100;

        if (users[userId]) {
            users[userId].balance += bonusNC;
            saveDB();
            await ctx.reply(`✅ Успешно! Зачислено ${bonusNC.toLocaleString()} NC.`);
        }
    } catch (e) {
        console.error("❌ Ошибка в successful_payment:", e);
    }
});

// --- КОМАНДЫ ПОЛЬЗОВАТЕЛЯ ---
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = { 
            username: ctx.from.username || 'unknown', 
            balance: 1000000, // Даем лям на старте как ты просил в sync-user
            usedPromos: [] 
        };
        saveDB();
    }
    ctx.reply(`Добро пожаловать в NotCase! Твой баланс: ${users[userId].balance.toLocaleString()} NC. 💎\nОткрывай кейсы в приложении!`);
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
        if (promo === 'CYGAN') bonus = 1670;

        if (bonus > 0) {
            users[userId].balance += bonus;
            users[userId].usedPromos.push(promo);
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Код неверный' });
});

app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    if (!userId || !stars) return res.status(400).json({ error: "Нет ID или суммы" });

    try {
        const amount = parseInt(stars);
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: "Пополнение баланса NotCase",
            description: `Обмен ${amount} Stars на игровые монеты NC`,
            payload: userId.toString(),
            provider_token: "", 
            currency: "XTR",
            prices: [{ label: "Telegram Stars", amount: amount }]
        });
        res.json({ url: invoiceLink });
    } catch (e) {
        res.status(500).json({ error: "Ошибка создания счета" });
    }
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 СЕРВЕР LIVE | ПОРТ ${PORT}`);
    bot.launch().then(() => console.log('🤖 БОТ ЗАПУЩЕН. Напиши /admin в ТГ.'));
});
