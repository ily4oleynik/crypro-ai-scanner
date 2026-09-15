const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || '';
const CHANNEL_URL_RU = process.env.TELEGRAM_CHANNEL_URL_RU || CHANNEL_URL || '';
const CHANNEL_URL_EN = process.env.TELEGRAM_CHANNEL_URL_EN || '';

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
  const dir = alert.type === 'price_above' ? 'above' : 'below';
  const text =
    `🚨 <b>Alert triggered</b>\n\n` +
    `<b>${alert.symbol || 'TOKEN'}</b>\n` +
    `Condition: price ${dir} <b>${alert.value}</b>\n` +
    `Now: <b>$${Number(price).toPrecision(6)}</b>\n` +
    `<code>${alert.address}</code>\n\n` +
    `Crypto AI Scanner`;
  return sendMessage(chatId, text);
}

async function sendDigest(chatId, lines) {
  const text =
    `📰 <b>Watchlist digest</b>\n\n` +
    (Array.isArray(lines) ? lines.join('\n') : String(lines || '')) +
    `\n\nCrypto AI Scanner`;
  return sendMessage(chatId, text);
}

async function postToChannel(text, which = 'ru') {
  const id =
    which === 'en'
      ? process.env.TELEGRAM_CHANNEL_ID_EN || CHANNEL_ID
      : process.env.TELEGRAM_CHANNEL_ID_RU || CHANNEL_ID;
  if (!id) return { ok: false, error: 'No channel id' };
  return sendMessage(id, text);
}

function hasChannel() {
  return !!(CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID_RU);
}

function getChannelUrl() {
  return CHANNEL_URL_RU || CHANNEL_URL || '';
}

function getChannelUrlRu() {
  return CHANNEL_URL_RU || CHANNEL_URL || '';
}

function getChannelUrlEn() {
  return CHANNEL_URL_EN || '';
}

module.exports = {
  sendMessage,
  sendAlert,
  sendDigest,
  postToChannel,
  hasChannel,
  getChannelUrl,
  getChannelUrlRu,
  getChannelUrlEn
};
