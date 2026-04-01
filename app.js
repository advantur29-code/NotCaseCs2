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
const DB_FILE = './database.json';

// Загрузка базы
let users = {};
if (fs.existsSync(DB_FILE)) {
    users = JSON.parse(fs.readFileSync(DB_FILE));
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

// Переменная для тихих логов входа
let activeSessions = new Set();

// --- ЭНДПОИНТЫ API ---

// 1. Синхронизация (Вход) - ТЕПЕРЬ БЕЗ СПАМА
app.post('/sync-user', (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = { username: username || 'unknown', balance: 0, tradeLink: '', withdrawRequests: [] };
        console.log(`[НОВЫЙ ЮЗЕР] @${username} (ID: ${userId}) зарегистрирован`);
    } else {
        users[userId].username = username || users[userId].username;

        // Пишем в консоль только один раз за запуск сервера
        if (!activeSessions.has(userId.toString())) {
            console.log(`[ВХОД] @${users[userId].username} открыл WebApp`);
            activeSessions.add(userId.toString());
        }
    }
    saveDB();
    res.json(users[userId]);
});

// 2. Логирование действий (Кейсы и продажи)
app.post('/log-action', (req, res) => {
    const { userId, action, caseType, item, price } = req.body;
    const user = users[userId] ? `@${users[userId].username}` : `ID: ${userId}`;
    const time = new Date().toLocaleTimeString();

    if (action === 'open_case') {
        const status = item === 'Ничего' ? '❌ ПУСТО' : `🎁 ВЫПАЛО: ${item}`;
        console.log(`[КЕЙС] ${time} | ${user} открыл ${caseType} (${price} NC) -> ${status}`);
    } else if (action === 'sell_item') {
        console.log(`[ПРОДАЖА] ${time} | ${user} продал ${item} за ${price} NC`);
    }
    res.json({ success: true });
});

// 3. Тихое обновление баланса (вызывай это в HTML вместо sync-user после кейса)
app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    if (users[userId]) {
        users[userId].balance = balance;
        saveDB();
        res.json({ success: true });
    }
});

// 4. Трейд-ссылка
app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    if (users[userId]) {
        users[userId].tradeLink = tradeLink;
        saveDB();
        console.log(`[ТРЕЙД] @${users[userId].username} обновил ссылку`);
        res.json({ success: true });
    }
});

// 5. Вывод
app.post('/withdraw-item', (req, res) => {
    const { userId, item } = req.body;
    if (users[userId]) {
        users[userId].withdrawRequests.push({ item, date: new Date().toLocaleString() });
        saveDB();
        console.log(`[ВЫВОД] @${users[userId].username} заказал ${item}`);
        bot.telegram.sendMessage(ADMIN_ID, `📦 ЗАЯВКА: @${users[userId].username} -> ${item}`);
        res.json({ success: true });
    }
});

// 6. Промокоды
app.post('/apply-promo', async (req, res) => {
    const { userId, promo } = req.body;
    const promoUpper = promo.toUpperCase();
    let bonus = (promoUpper === 'WELCOME') ? 1000 : (promoUpper === 'CYGAN' ? 1670 : 0);

    if (bonus > 0 && users[userId]) {
        users[userId].balance += bonus;
        saveDB();
        console.log(`[ПРОМО] @${users[userId].username} +${bonus} NC (${promoUpper})`);
        return res.status(200).json({ ok: true, newBalance: users[userId].balance });
    }
    res.status(400).json({ error: 'Ошибка промокода' });
});

// --- ТЕЛЕГРАМ БОТ ---

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || 'unknown';
    const payload = ctx.message.text.split(' ')[1];

    if (!users[userId]) {
        users[userId] = { username, balance: 0, tradeLink: '', withdrawRequests: [] };
        if (payload && users[payload]) {
            users[payload].balance += 500;
            console.log(`[РЕФЕРАЛ] @${username} приглашен пользователем @${users[payload].username}`);
        }
    }
    saveDB();
    ctx.reply(`Баланс: ${users[userId].balance} NC`);
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

app.listen(3000, () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 СЕРВЕР ОБНОВЛЕН: СПАМ УБРАН');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    bot.launch();
});