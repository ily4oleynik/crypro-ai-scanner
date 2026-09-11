const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || '';

async function sendMessage(chatId, text, extra = {}) {
  if (!API || !chatId) {
    return { ok: false, error: 'No token or chatId' };
  }
  try {
    const res = await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...extra
    });
    return res.data;
  } catch (e) {
    console.error('[TG] sendMessage:', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

async function sendAlert(chatId, alert, price) {
  const dir = alert.type === 'price_above' ? 'выше' : 'ниже';
  const text =
    `🚨 <b>Алерт сработал</b>\n\n` +
    `<b>${alert.symbol || 'TOKEN'}</b>\n` +
    `Условие: цена ${dir} <b>${alert.value}</b>\n` +
    `Сейчас: <b>$${Number(price).toPrecision(6)}</b>\n` +
    `<code>${alert.address}</code>\n\n` +
    `Crypto AI Scanner`;
  return sendMessage(chatId, text);
}

async function sendDigest(chatId, lines) {
  const text =
    `📰 <b>Ежедневный дайджест Watchlist</b>\n\n` +
    (Array.isArray(lines) ? lines.join('\n') : String(lines || '')) +
    `\n\nCrypto AI Scanner`;
  return sendMessage(chatId, text);
}

async function postToChannel(text) {
  if (!CHANNEL_ID) {
    return { ok: false, error: 'No TELEGRAM_CHANNEL_ID' };
  }
  return sendMessage(CHANNEL_ID, text);
}

function hasChannel() {
  return !!CHANNEL_ID;
}

function getChannelUrl() {
  return CHANNEL_URL || '';
}

module.exports = {
  sendMessage,
  sendAlert,
  sendDigest,
  postToChannel,
  hasChannel,
  getChannelUrl
};
