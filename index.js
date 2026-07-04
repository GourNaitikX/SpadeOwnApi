require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { checkCard, classifyResponse } = require("./shopify");

// ==========================================
// CONFIG — CHANGE HERE
// ==========================================
const BOT_TOKEN  = process.env.BOT_TOKEN  || "YOUR_BOT_TOKEN_HERE";
const ADMIN_ID   = parseInt(process.env.ADMIN_ID || "YOUR_CHAT_ID_HERE");
const BOT_NAME   = process.env.BOT_NAME   || "Spade CHKR";
// ==========================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send(BOT_NAME + " API is running!"));
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Server started on port " + (process.env.PORT || 3000));
});

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Default store
let shopifyStore = "https://touch-of-finland.myshopify.com";

// Active checks — to prevent spam
const activeChecks = new Set();

// Result keyboard
function getKeyboard(category) {
  if (category === "approved") {
    return { inline_keyboard: [[{ text: "✅ APPROVED", callback_data: "noop" }]] };
  } else if (category === "charged") {
    return { inline_keyboard: [[{ text: "💙 CHARGED", callback_data: "noop" }]] };
  }
  return { inline_keyboard: [[{ text: "🔴 DECLINED", callback_data: "noop" }]] };
}

// Format final result
function formatResult(ccInput, result) {
  const si = (result.category === "approved" || result.category === "charged")
    ? "<tg-emoji emoji-id=\"6138803821394009204\">✅</tg-emoji>"
    : "<tg-emoji emoji-id=\"5402104393396931859\">❌</tg-emoji>";

  const statusText = result.category === "approved"
    ? "APPROVED ✅"
    : result.category === "charged"
    ? "CHARGED 💳"
    : "DECLINED ❌";

  return (
    si + " <b>Status</b> ➠ " + statusText + "\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card</b> ➠ <code>" + escapeHTML(ccInput) + "</code>\n" +
    "<tg-emoji emoji-id=\"6136204644625423818\">⚡</tg-emoji> <b>Gateway</b> ➠ Shopify " + (result.product ? "$" + result.product.price : "1$") + "\n" +
    "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Response</b> ➠ " + escapeHTML(result.response) + "\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"6159080241739342919\">🏦</tg-emoji> <b>Brand</b> ➠ " + escapeHTML(result.binInfo.brand) + "\n" +
    "<tg-emoji emoji-id=\"6159080241739342919\">🏛</tg-emoji> <b>Issuer</b> ➠ " + escapeHTML(result.binInfo.issuer) + "\n" +
    "<tg-emoji emoji-id=\"4956560549287560231\">🌍</tg-emoji> <b>Country</b> ➠ " + escapeHTML(result.binInfo.country) + " " + result.binInfo.flag + "\n" +
    "━━━━━━━━━━━━━━━\n" +
    "⏱ <b>Time</b> ➠ " + result.timeTaken + "s\n" +
    "<tg-emoji emoji-id=\"4956420911310832630\">💎</tg-emoji> <b>Dev</b> ➠ @ZeroSpade"
  );
}

// /start
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    "<tg-emoji emoji-id=\"6138869285285537620\">♠️</tg-emoji> <b>WELCOME TO " + escapeHTML(BOT_NAME) + "</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"6138961691506907344\">⚙️</tg-emoji> <b>Commands:</b>\n" +
    "/sh <code>cc|mm|yy|cvv</code> — Check card\n" +
    "/setstore <code>url</code> — Set store (Admin)\n" +
    "/store — Current store\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"4956420911310832630\">💎</tg-emoji> Dev: @ZeroSpade",
    { parse_mode: "HTML" }
  );
});

// /store
bot.onText(/^\/store/, (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id,
    "🏪 <b>Current Store:</b>\n<code>" + shopifyStore + "</code>",
    { parse_mode: "HTML" }
  );
});

// /setstore
bot.onText(/^\/setstore (.+)/, (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return;
  let url = match[1].trim();
  if (!url.startsWith("http")) url = "https://" + url;
  shopifyStore = url;
  bot.sendMessage(msg.chat.id,
    "✅ <b>Store Updated!</b>\n<code>" + escapeHTML(url) + "</code>",
    { parse_mode: "HTML" }
  );
});

// /sh — MAIN CHECK COMMAND
bot.onText(/^\/sh(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!match || !match[1]) {
    return bot.sendMessage(chatId,
      "⚠️ <b>Format:</b> <code>/sh cc|mm|yy|cvv</code>\n\n<i>Example:\n/sh 4111111111111111|01|26|123</i>",
      { parse_mode: "HTML" }
    );
  }

  // Prevent duplicate check
  if (activeChecks.has(chatId)) {
    return bot.sendMessage(chatId, "⚠️ Please wait — previous check is running!");
  }
  activeChecks.add(chatId);

  const ccInput = match[1].trim();

  // Send initial message
  const pm = await bot.sendMessage(chatId,
    "⏳ <b>Initializing checker...</b>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "<tg-emoji emoji-id=\"5195072744798051557\">💳</tg-emoji> <b>Card:</b> <code>" + escapeHTML(ccInput) + "</code>\n" +
    "━━━━━━━━━━━━━━━\n" +
    "⬜⬜⬜⬜⬜",
    { parse_mode: "HTML" }
  );

  try {
    // onStep callback — live updates
    const onStep = async (text) => {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: pm.message_id,
          parse_mode: "HTML"
        });
        await new Promise(r => setTimeout(r, 800));
      } catch(e) {}
    };

    const result = await checkCard(ccInput, shopifyStore, onStep);

    // Final result
    const finalMsg = formatResult(ccInput, result);
    const keyboard = getKeyboard(result.category);

    await bot.editMessageText(finalMsg, {
      chat_id: chatId,
      message_id: pm.message_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard
    });

    // Notify admin on hit
    if ((result.category === "approved" || result.category === "charged") && chatId !== ADMIN_ID) {
      bot.sendMessage(ADMIN_ID,
        "🟢 <b>HIT!</b>\nBy: <a href=\"tg://user?id=" + chatId + "\">" + escapeHTML(msg.from.first_name) + "</a>\n━━━━━━━━━━━━━━━\n" + finalMsg,
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    }

  } catch(err) {
    console.error("Check Error:", err);
    bot.editMessageText(
      "❌ <b>Error occurred!</b>\n<code>" + escapeHTML(err.message) + "</code>",
      { chat_id: chatId, message_id: pm.message_id, parse_mode: "HTML" }
    );
  } finally {
    activeChecks.delete(chatId);
  }
});

// Callback noop
bot.on("callback_query", (cb) => {
  bot.answerCallbackQuery(cb.id).catch(() => {});
});

process.on("uncaughtException", err => console.error("Uncaught:", err));
process.on("unhandledRejection", r => console.error("Rejection:", r));

console.log(BOT_NAME + " is running...");
