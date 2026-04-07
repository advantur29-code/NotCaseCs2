const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const bot = new Telegraf('8297728079:AAHb8-Sys7zF9ma68vLsa4Vzw2lOWerp8NM');
const app = express();
const ADMIN_ID = 8019223768;
const DB_FILE = 'database.json';

app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// ========== БАЗА ДАННЫХ ==========
let users = {};
let promoCodes = {};
let bonusPromoCodes = {};

const loadDB = () => {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            users = data.users || {};
            promoCodes = data.promoCodes || {};
            bonusPromoCodes = data.bonusPromoCodes || {};
            console.log(`[DB] Loaded: ${Object.keys(users).length} users, ${Object.keys(promoCodes).length} promos, ${Object.keys(bonusPromoCodes).length} bonus promos`);
        } catch (e) { 
            console.error("[DB] Load Error:", e);
            users = {};
            promoCodes = {};
            bonusPromoCodes = {};
        }
    }
};
loadDB();

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users, promoCodes, bonusPromoCodes }, null, 2), 'utf8');
    } catch (e) { console.error("[DB] Save Error:", e); }
};

const initUser = (id, username = 'unknown') => {
    if (!users[id]) {
        users[id] = {
            username: username,
            balance: 10000,
            usedPromos: [],
            usedBonusPromos: [],
            completedTasks: [],
            lastBonus: null,
            streak: 0,
            lastStreakDate: null,
            tradeLink: "",
            invitedBy: null,
            inventory: [],
            referrals: [],
            totalEarnedFromReferrals: 0,
            lastSeen: Date.now(),
            warnedForUnsub: false,
            unsubWarningDate: null,
            unsubExpired: false
        };
        saveDB();
    }
    return users[id];
};

const REF_REWARDS = [1000, 500, 250, 100, 50];

// ========== API ЭНДПОИНТЫ ==========

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).json({ error: "No ID" });
    const user = initUser(userId, req.body.username);
    user.lastSeen = Date.now();
    saveDB();
    res.json(user);
});

app.post('/online-count', (req, res) => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const onlineCount = Object.values(users).filter(u => u.lastSeen > fiveMinutesAgo).length;
    res.json({ online: onlineCount });
});

app.post('/save-trade', (req, res) => {
    const { userId, tradeLink } = req.body;
    const id = userId?.toString();
    if (users[id]) {
        users[id].tradeLink = tradeLink;
        saveDB();
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    const id = userId?.toString();
    if (users[id]) {
        users[id].balance = parseInt(balance) || 0;
        saveDB();
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/add-skin', (req, res) => {
    const { userId, skin } = req.body;
    const id = userId?.toString();
    const user = initUser(id);

    const newSkin = {
        id: Date.now() + Math.random(),
        name: skin.name,
        img: skin.img,
        price: skin.price,
        color: skin.color,
        factory: { active: false, incomeRate: 0, boostLevel: 0, breakAt: null, lastCollect: null }
    };
    if (!user.inventory) user.inventory = [];
    user.inventory.push(newSkin);
    saveDB();
    res.json({ ok: true });
});

app.post('/remove-skin', (req, res) => {
    const { userId, skinId } = req.body;
    const id = userId?.toString();
    const user = users[id];
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const index = user.inventory.findIndex(s => s.id == skinId);
    if (index === -1) return res.status(404).json({ error: "Skin not found" });
    
    user.inventory.splice(index, 1);
    saveDB();
    res.json({ ok: true });
});

app.post('/check-task', async (req, res) => {
    const { userId, taskId, chatId } = req.body;
    const id = userId?.toString();
    const user = initUser(id);

    if (!user.completedTasks) user.completedTasks = [];
    if (user.completedTasks.includes(taskId)) {
        return res.status(400).json({ error: "Already done" });
    }

    let reward = 0;
    let needCheck = false;
    let checkChatId = null;

    if (taskId === 'sub_tg') {
        reward = 25000;
        needCheck = true;
        checkChatId = '@TheCaseCs2';
    }
    if (taskId === 'join_chat') {
        reward = 10000;
        needCheck = true;
        checkChatId = '@+3Vp6w6MqO8FkNjEy';
    }
    if (taskId === 'boost_tg') {
        reward = 500000;
        needCheck = true;
        checkChatId = '@TheCaseCs2';
    }

    if (needCheck && chatId) {
        try {
            const chatMember = await bot.telegram.getChatMember(checkChatId, parseInt(id));
            const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
            if (!isMember) {
                return res.status(400).json({ error: "You are not subscribed!" });
            }
        } catch (e) {
            return res.status(400).json({ error: "Cannot verify subscription. Please join first!" });
        }
    }

    if (reward > 0) {
        user.balance += reward;
        user.completedTasks.push(taskId);
        saveDB();
        return res.json({ ok: true, newBalance: user.balance });
    }
    res.status(400).json({ error: "Unknown task" });
});

app.post('/daily-bonus', (req, res) => {
    const id = req.body.userId?.toString();
    const user = initUser(id);

    const now = new Date();
    const today = now.toDateString();
    const lastBonusDate = user.lastBonus ? new Date(user.lastBonus).toDateString() : null;

    let streak = user.streak || 0;
    let reward = 1000;

    if (lastBonusDate === today) {
        return res.status(400).json({ error: "Already claimed today" });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    if (lastBonusDate === yesterdayStr) {
        streak = Math.min(streak + 1, 10);
    } else {
        streak = 1;
    }

    if (streak <= 10) {
        reward = 1000 + (streak - 1) * 250;
    } else {
        reward = 3500;
    }

    user.balance += reward;
    user.lastBonus = now.toISOString();
    user.streak = streak;
    saveDB();

    res.json({ ok: true, newBalance: user.balance, streak: streak, reward: reward });
});

// ========== ПРОМОКОДЫ ==========

app.post('/apply-promo', (req, res) => {
    const id = req.body.userId?.toString();
    const { promo } = req.body;
    const user = initUser(id);

    if (!user.usedPromos) user.usedPromos = [];
    const code = promo?.toLowerCase();
    
    if (user.usedPromos.includes(code)) {
        return res.status(400).json({ error: "You already used this promo code" });
    }
    
    if (promoCodes[code]) {
        const bonus = promoCodes[code].amount || promoCodes[code];
        user.balance += bonus;
        user.usedPromos.push(code);
        
        if (promoCodes[code].usesLeft) {
            promoCodes[code].usesLeft--;
            if (promoCodes[code].usesLeft <= 0) {
                delete promoCodes[code];
            }
        } else {
            delete promoCodes[code];
        }
        
        saveDB();
        return res.json({ ok: true, newBalance: user.balance });
    }
    
    res.status(400).json({ error: "Invalid or expired promo code" });
});

app.post('/apply-bonus-promo', (req, res) => {
    const id = req.body.userId?.toString();
    const { promo, starsAmount } = req.body;
    const user = initUser(id);

    if (!user.usedBonusPromos) user.usedBonusPromos = [];
    const code = promo?.toLowerCase();
    
    if (user.usedBonusPromos.includes(code)) {
        return res.status(400).json({ error: "You already used this bonus code" });
    }
    
    if (bonusPromoCodes[code]) {
        const bonusPercent = bonusPromoCodes[code].percent;
        const bonusStars = Math.floor(starsAmount * bonusPercent / 100);
        const bonusNC = bonusStars * 1000;
        
        user.balance += bonusNC;
        user.usedBonusPromos.push(code);
        
        if (bonusPromoCodes[code].usesLeft) {
            bonusPromoCodes[code].usesLeft--;
            if (bonusPromoCodes[code].usesLeft <= 0) {
                delete bonusPromoCodes[code];
            }
        } else {
            delete bonusPromoCodes[code];
        }
        
        saveDB();
        return res.json({ ok: true, newBalance: user.balance, bonusNC: bonusNC, bonusPercent: bonusPercent });
    }
    
    res.status(400).json({ error: "Invalid or expired bonus code" });
});

app.post('/track-referral', (req, res) => {
    const { referrerId, newUserId } = req.body;
    const refId = referrerId?.toString();
    const newId = newUserId?.toString();

    if (!refId || !newId || refId === newId) return res.json({ ok: false });

    const newUser = initUser(newId);
    if (newUser.invitedBy) return res.json({ ok: false });

    newUser.invitedBy = refId;
    saveDB();

    let current = refId;
    let level = 0;

    while (current && level < REF_REWARDS.length) {
        const referrer = users[current];
        if (referrer) {
            const reward = REF_REWARDS[level];
            referrer.balance += reward;
            referrer.totalEarnedFromReferrals = (referrer.totalEarnedFromReferrals || 0) + reward;
            if (!referrer.referrals) referrer.referrals = [];
            if (!referrer.referrals.includes(newId)) referrer.referrals.push(newId);
            saveDB();

            bot.telegram.sendMessage(parseInt(current), `🎁 +${reward} NC for referral level ${level + 1}!`).catch(e => {});
        }
        current = referrer?.invitedBy;
        level++;
    }

    res.json({ ok: true, reward: REF_REWARDS[0] });
});

// ========== ФАБРИКА ==========

app.post('/factory-start', (req, res) => {
    const { userId, skinId } = req.body;
    const user = users[userId?.toString()];
    if (!user) return res.status(404).json({ error: "User not found" });

    const skin = user.inventory.find(s => s.id == skinId);
    if (!skin) return res.status(404).json({ error: "Skin not found" });
    if (skin.factory.active) return res.status(400).json({ error: "Already running" });

    const baseIncome = Math.floor(skin.price / 200);
    skin.factory.active = true;
    skin.factory.incomeRate = baseIncome;
    skin.factory.boostLevel = 0;
    skin.factory.breakAt = Date.now() + 72 * 60 * 60 * 1000;
    skin.factory.lastCollect = Date.now();
    saveDB();

    res.json({ ok: true, incomeRate: baseIncome, breakAt: skin.factory.breakAt });
});

app.post('/factory-collect', (req, res) => {
    const { userId, skinId } = req.body;
    const user = users[userId?.toString()];
    if (!user) return res.status(404).json({ error: "User not found" });

    const skinIndex = user.inventory.findIndex(s => s.id == skinId);
    if (skinIndex === -1) return res.status(404).json({ error: "Skin not found" });
    const skin = user.inventory[skinIndex];
    
    if (!skin.factory.active) return res.status(400).json({ error: "Factory not active" });

    const now = Date.now();
    let earned = 0;
    if (skin.factory.lastCollect) {
        const hoursPassed = (now - skin.factory.lastCollect) / (1000 * 60 * 60);
        earned = Math.floor(skin.factory.incomeRate * hoursPassed);
    } else {
        earned = skin.factory.incomeRate;
    }

    if (now >= skin.factory.breakAt) {
        user.inventory.splice(skinIndex, 1);
        earned += skin.factory.incomeRate;
        saveDB();
        return res.json({ ok: true, earned, broken: true, deleted: true });
    }

    skin.factory.lastCollect = now;
    user.balance += earned;
    saveDB();

    res.json({ ok: true, earned, broken: false, newBalance: user.balance, breakAt: skin.factory.breakAt });
});

app.post('/factory-boost', (req, res) => {
    const { userId, skinId } = req.body;
    const user = users[userId?.toString()];
    if (!user) return res.status(404).json({ error: "User not found" });

    const skinIndex = user.inventory.findIndex(s => s.id == skinId);
    if (skinIndex === -1) return res.status(404).json({ error: "Skin not found" });
    const skin = user.inventory[skinIndex];
    
    if (!skin.factory.active) return res.status(400).json({ error: "Factory not active" });

    const boostLevel = skin.factory.boostLevel || 0;
    const chances = [50, 25, 13, 5];
    if (boostLevel >= chances.length) return res.status(400).json({ error: "Max boost reached" });

    const success = Math.random() * 100 < chances[boostLevel];
    if (success) {
        skin.factory.incomeRate *= 2;
        skin.factory.boostLevel++;
        saveDB();
        res.json({ ok: true, success: true, newRate: skin.factory.incomeRate, level: skin.factory.boostLevel, breakAt: skin.factory.breakAt });
    } else {
        user.inventory.splice(skinIndex, 1);
        saveDB();
        res.json({ ok: true, success: false, broken: true, deleted: true });
    }
});

// ========== ВЫВОД СКИНОВ ==========

let pendingWithdraws = {};

app.post('/withdraw-skin', (req, res) => {
    const { userId, skinId } = req.body;
    const id = userId?.toString();
    const user = users[id];
    
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.tradeLink) return res.status(400).json({ error: "Set trade link first" });
    
    const skinIndex = user.inventory.findIndex(s => s.id == skinId);
    if (skinIndex === -1) return res.status(404).json({ error: "Skin not found" });
    
    const skin = user.inventory[skinIndex];
    if (skin.factory?.active) return res.status(400).json({ error: "Cannot withdraw active factory skin" });
    
    const requestId = Date.now() + Math.random();
    pendingWithdraws[requestId] = {
        userId: id,
        username: user.username,
        tradeLink: user.tradeLink,
        skin: skin,
        timestamp: new Date().toISOString()
    };
    
    bot.telegram.sendMessage(ADMIN_ID, 
        `🔔 NEW WITHDRAW REQUEST #${requestId}\n` +
        `👤 User: ${user.username} (${id})\n` +
        `🔗 Trade Link: ${user.tradeLink}\n` +
        `🎁 Skin: ${skin.name}\n` +
        `💰 Value: ${skin.price.toLocaleString()} NC\n` +
        `🖼 Image: ${skin.img}\n\n` +
        `To approve: /approve_${requestId}\n` +
        `To reject: /reject_${requestId}`
    );
    
    res.json({ ok: true, requestId: requestId });
});

// ========== ПРОВЕРКА ПОДПИСОК И СНЯТИЕ БАЛАНСА ==========

app.post('/check-user-subscription', async (req, res) => {
    const { userId } = req.body;
    const id = userId?.toString();
    
    if (!id) return res.status(400).json({ error: "No user ID" });
    
    const user = users[id];
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const channelsToCheck = [
        { name: '@TheCaseCs2', taskId: 'sub_tg' },
        { name: '@+3Vp6w6MqO8FkNjEy', taskId: 'join_chat' }
    ];
    
    let allSubscribed = true;
    let warnings = [];
    
    for (const channel of channelsToCheck) {
        try {
            const chatMember = await bot.telegram.getChatMember(channel.name, parseInt(id));
            const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
            
            if (!isMember) {
                allSubscribed = false;
                if (!user.warnedForUnsub) {
                    warnings.push(channel.name);
                }
            }
        } catch (e) {
            console.error(`Error checking ${channel.name}:`, e);
        }
    }
    
    if (!allSubscribed && !user.warnedForUnsub) {
        const penalty = 25000;
        user.balance -= penalty;
        user.warnedForUnsub = true;
        user.unsubWarningDate = Date.now();
        saveDB();
        
        try {
            await bot.telegram.sendMessage(parseInt(id), 
                `⚠️ ВНИМАНИЕ! ⚠️\n\n` +
                `Вы отписались от обязательных каналов:\n${warnings.join(', ')}\n\n` +
                `С вашего баланса снято ${penalty.toLocaleString()} NC!\n\n` +
                `❗ Если вы не подпишетесь снова в течение 24 часов, ваш баланс НЕ БУДЕТ ВОССТАНОВЛЕН, даже если он станет отрицательным!\n\n` +
                `Подпишитесь обратно, чтобы продолжить пользоваться ботом.`
            );
        } catch(e) {}
        
        return res.json({ 
            ok: false, 
            warned: true, 
            penalty: penalty, 
            newBalance: user.balance,
            message: `Вы отписались от каналов! Снято ${penalty.toLocaleString()} NC. Подпишитесь снова в течение 24 часов.`
        });
    }
    
    if (!allSubscribed && user.warnedForUnsub && !user.unsubExpired) {
        const timeSinceWarning = Date.now() - (user.unsubWarningDate || 0);
        const hoursLeft = Math.max(0, 24 - Math.floor(timeSinceWarning / (1000 * 60 * 60)));
        
        if (hoursLeft > 0) {
            return res.json({ 
                ok: false, 
                warned: true, 
                permanent: false,
                hoursLeft: hoursLeft,
                message: `⚠️ Вы всё ещё не подписаны! Баланс НЕ БУДЕТ ВОССТАНОВЛЕН. Осталось часов: ${hoursLeft}`
            });
        } else {
            user.unsubExpired = true;
            saveDB();
            return res.json({ 
                ok: false, 
                blocked: true,
                message: `❌ ДОСТУП ОГРАНИЧЕН! Вы не подписались в течение 24 часов. Баланс НЕ ВОССТАНАВЛИВАЕТСЯ. Обратитесь к администратору.`
            });
        }
    }
    
    if (allSubscribed && user.warnedForUnsub) {
        user.warnedForUnsub = false;
        user.unsubWarningDate = null;
        saveDB();
        return res.json({ 
            ok: true, 
            message: "✅ Спасибо что подписались! Баланс не возвращён, но вы можете продолжать играть."
        });
    }
    
    res.json({ ok: true, message: "✅ Вы подписаны на все каналы!" });
});

// Периодическая проверка всех пользователей (раз в час)
setInterval(async () => {
    console.log("[AutoCheck] Checking all users subscriptions...");
    let checked = 0;
    let penalized = 0;
    
    for (const [id, user] of Object.entries(users)) {
        if (user.unsubExpired) continue;
        
        const channelsToCheck = [
            { name: '@TheCaseCs2' },
            { name: '@+3Vp6w6MqO8FkNjEy' }
        ];
        
        let allSubscribed = true;
        
        for (const channel of channelsToCheck) {
            try {
                const chatMember = await bot.telegram.getChatMember(channel.name, parseInt(id));
                const isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
                if (!isMember) allSubscribed = false;
            } catch (e) {
                allSubscribed = false;
            }
        }
        
        if (!allSubscribed && !user.warnedForUnsub) {
            const penalty = 25000;
            user.balance -= penalty;
            user.warnedForUnsub = true;
            user.unsubWarningDate = Date.now();
            penalized++;
            
            try {
                await bot.telegram.sendMessage(parseInt(id), 
                    `⚠️ ВНИМАНИЕ! ⚠️\n\n` +
                    `Вы отписались от обязательных каналов!\n\n` +
                    `С вашего баланса снято ${penalty.toLocaleString()} NC!\n\n` +
                    `❗ Если вы не подпишетесь снова в течение 24 часов, ваш баланс НЕ БУДЕТ ВОССТАНОВЛЕН!\n\n` +
                    `Подпишитесь обратно, чтобы продолжить пользоваться ботом.`
                );
            } catch(e) {}
        }
        
        if (!allSubscribed && user.warnedForUnsub && !user.unsubExpired) {
            const timeSinceWarning = Date.now() - (user.unsubWarningDate || 0);
            if (timeSinceWarning > 24 * 60 * 60 * 1000) {
                user.unsubExpired = true;
                try {
                    await bot.telegram.sendMessage(parseInt(id), 
                        `❌ ДОСТУП ОГРАНИЧЕН! ❌\n\n` +
                        `Вы не подписались на каналы в течение 24 часов.\n` +
                        `Ваш баланс НЕ ВОССТАНАВЛИВАЕТСЯ, даже если он отрицательный.\n\n` +
                        `Для разблокировки обратитесь к администратору.`
                    );
                } catch(e) {}
            }
        }
        
        checked++;
    }
    
    if (penalized > 0) saveDB();
    console.log(`[AutoCheck] Checked: ${checked}, Penalized: ${penalized}`);
}, 60 * 60 * 1000);

// ========== АДМИН КОМАНДЫ ==========

bot.command(/approve_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const requestId = ctx.match[1];
    const request = pendingWithdraws[requestId];
    
    if (!request) return ctx.reply("❌ Request not found or already processed");
    
    const user = users[request.userId];
    if (!user) return ctx.reply("❌ User not found");
    
    const skinIndex = user.inventory.findIndex(s => s.id == request.skin.id);
    if (skinIndex === -1) return ctx.reply("❌ Skin already withdrawn");
    
    user.inventory.splice(skinIndex, 1);
    delete pendingWithdraws[requestId];
    saveDB();
    
    await ctx.reply(`✅ Withdraw approved! Skin "${request.skin.name}" sent to ${request.username}`);
    await bot.telegram.sendMessage(parseInt(request.userId), `✅ Your withdraw request for "${request.skin.name}" has been approved! The skin will be sent to your trade link shortly.`);
});

bot.command(/reject_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const requestId = ctx.match[1];
    const request = pendingWithdraws[requestId];
    
    if (!request) return ctx.reply("❌ Request not found");
    
    delete pendingWithdraws[requestId];
    await ctx.reply(`❌ Withdraw rejected for ${request.username}`);
    await bot.telegram.sendMessage(parseInt(request.userId), `❌ Your withdraw request for "${request.skin.name}" was rejected. Please contact support.`);
});

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const totalUsers = Object.keys(users).length;
    const totalBalance = Object.values(users).reduce((sum, u) => sum + (u.balance || 0), 0);
    const totalSkins = Object.values(users).reduce((sum, u) => sum + (u.inventory?.length || 0), 0);
    const pendingCount = Object.keys(pendingWithdraws).length;
    
    ctx.reply(
        `👑 ADMIN PANEL\n` +
        `━━━━━━━━━━━━━━━\n` +
        `👥 Users: ${totalUsers}\n` +
        `💰 Total NC: ${totalBalance.toLocaleString()}\n` +
        `🎁 Total Skins: ${totalSkins}\n` +
        `⏳ Pending withdraws: ${pendingCount}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Commands:\n` +
        `/give [amount] [userId] - give NC\n` +
        `/giveall [amount] - give NC to all\n` +
        `/promo [code] [amount] [uses] - create promo\n` +
        `/bonus [code] [percent] [uses] - create bonus promo\n` +
        `/listusers - show top users\n` +
        `/resetuser [userId] - reset user\n` +
        `/broadcast [message] - send to all\n` +
        `/stats - detailed stats\n` +
        `/unblock [userId] - unblock user`
    );
});

bot.command('give', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const parts = ctx.payload.split(' ');
    const amount = parseInt(parts[0]);
    const targetId = parts[1];
    if (isNaN(amount)) return ctx.reply("Usage: /give 5000 [userId]");

    if (targetId && users[targetId]) {
        users[targetId].balance += amount;
        saveDB();
        ctx.reply(`✅ Given ${amount} NC to user ${targetId}`);
    } else if (targetId) {
        ctx.reply(`❌ User ${targetId} not found`);
    } else {
        ctx.reply("❌ Specify user ID or use /giveall for everyone");
    }
});

bot.command('giveall', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const amount = parseInt(ctx.payload);
    if (isNaN(amount)) return ctx.reply("Usage: /giveall 5000");
    
    Object.keys(users).forEach(id => { users[id].balance += amount; });
    saveDB();
    ctx.reply(`✅ Given ${amount} NC to ALL ${Object.keys(users).length} users!`);
});

bot.command('promo', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const [code, amount, uses] = ctx.payload.split(' ');
    if (!code || !amount) return ctx.reply("Usage: /promo [code] [amount] [uses]");

    const usesCount = parseInt(uses) || 1;
    promoCodes[code.toLowerCase()] = {
        amount: parseInt(amount),
        usesLeft: usesCount
    };
    saveDB();
    ctx.reply(`✅ Promo code "${code}" created for ${parseInt(amount).toLocaleString()} NC (${usesCount} uses left!)`);
});

bot.command('bonus', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const [code, percent, uses] = ctx.payload.split(' ');
    if (!code || !percent) return ctx.reply("Usage: /bonus [code] [percent] [uses]");

    const usesCount = parseInt(uses) || 1;
    bonusPromoCodes[code.toLowerCase()] = {
        percent: parseInt(percent),
        usesLeft: usesCount
    };
    saveDB();
    ctx.reply(`✅ Bonus code "${code}" created for ${percent}% bonus on deposit (${usesCount} uses left!)`);
});

bot.command('listusers', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const sorted = Object.entries(users)
        .sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0))
        .slice(0, 10);
    
    let msg = "🏆 TOP USERS BY BALANCE:\n━━━━━━━━━━━━━━━\n";
    sorted.forEach(([id, user], i) => {
        msg += `${i+1}. ${user.username} (${id}): ${(user.balance || 0).toLocaleString()} NC\n`;
    });
    ctx.reply(msg);
});

bot.command('resetuser', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const targetId = ctx.payload.trim();
    if (!targetId || !users[targetId]) return ctx.reply("❌ User not found");
    
    users[targetId].balance = 0;
    users[targetId].inventory = [];
    users[targetId].warnedForUnsub = false;
    users[targetId].unsubWarningDate = null;
    users[targetId].unsubExpired = false;
    saveDB();
    ctx.reply(`✅ User ${targetId} reset (balance 0, inventory cleared, unsub flags cleared)`);
});

bot.command('unblock', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const targetId = ctx.payload.trim();
    if (!targetId || !users[targetId]) return ctx.reply("❌ User not found");
    
    users[targetId].unsubExpired = false;
    users[targetId].warnedForUnsub = false;
    users[targetId].unsubWarningDate = null;
    saveDB();
    ctx.reply(`✅ User ${targetId} unblocked!`);
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const message = ctx.payload;
    if (!message) return ctx.reply("Usage: /broadcast Hello everyone!");
    
    let sent = 0;
    let failed = 0;
    
    for (const id of Object.keys(users)) {
        try {
            await bot.telegram.sendMessage(parseInt(id), `📢 ANNOUNCEMENT:\n\n${message}`);
            sent++;
        } catch(e) {
            failed++;
        }
        await new Promise(r => setTimeout(r, 50));
    }
    ctx.reply(`✅ Broadcast sent to ${sent} users\n❌ Failed: ${failed}`);
});

bot.command('stats', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const totalUsers = Object.keys(users).length;
    const totalBalance = Object.values(users).reduce((sum, u) => sum + (u.balance || 0), 0);
    const totalSkins = Object.values(users).reduce((sum, u) => sum + (u.inventory?.length || 0), 0);
    const avgBalance = totalUsers > 0 ? Math.floor(totalBalance / totalUsers) : 0;
    const usersWithRef = Object.values(users).filter(u => u.referrals?.length > 0).length;
    const blockedUsers = Object.values(users).filter(u => u.unsubExpired).length;
    
    ctx.reply(
        `📊 DETAILED STATS\n` +
        `━━━━━━━━━━━━━━━\n` +
        `👥 Total Users: ${totalUsers}\n` +
        `💰 Total NC: ${totalBalance.toLocaleString()}\n` +
        `📊 Avg Balance: ${avgBalance.toLocaleString()}\n` +
        `🎁 Total Skins: ${totalSkins}\n` +
        `🤝 Users with referrals: ${usersWithRef}\n` +
        `⏳ Pending withdraws: ${Object.keys(pendingWithdraws).length}\n` +
        `🚫 Blocked users: ${blockedUsers}`
    );
});

// ========== STARS PAYMENTS ==========

app.post('/create-stars-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "NotCase Deposit",
            description: `${stars} Stars → ${parseInt(stars) * 1000} NC`,
            payload: `stars_${userId}_${stars}`,
            provider_token: "",
            currency: "XTR",
            prices: [{ label: "Stars", amount: parseInt(stars) }]
        });
        res.json({ ok: true, link: link });
    } catch (e) {
        console.error("Invoice Error:", e);
        res.status(500).json({ error: "Invoice error" });
    }
});

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [_, userId, stars] = payload.split('_');
    const user = initUser(userId);
    const amountNC = parseInt(stars) * 1000;
    user.balance += amountNC;
    saveDB();
    await ctx.reply(`✅ +${amountNC.toLocaleString()} NC credited!`);
});

// ========== БОТ СТАРТ ==========

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const startPayload = ctx.payload;

    const user = initUser(userId, ctx.from.username || ctx.from.first_name);

    if (startPayload && startPayload !== userId && !user.invitedBy && users[startPayload]) {
        fetch(`http://localhost:${PORT}/track-referral`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referrerId: startPayload, newUserId: userId })
        }).catch(e => console.error(e));
    }
    saveDB();

    ctx.reply("🎮 Welcome to NotCase CS2!\nOpen the app to start opening cases and earning skins!", Markup.inlineKeyboard([
        [Markup.button.webApp("🎲 OPEN NOTCASE", "https://advantur29-code.github.io/NotCaseCs2/")]
    ]));
});

// ========== ЗАПУСК СЕРВЕРА ==========

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server started on port ${PORT}`);
    bot.launch();
    console.log(`✅ Bot launched`);
});
