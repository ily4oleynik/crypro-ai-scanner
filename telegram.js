// backend/telegram.js
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

async function sendMessage(chatId, text) {
  if (!API) {
    console.log('[TG] No TELEGRAM_BOT_TOKEN, skip:', text.slice(0, 80));
    return { ok: false, error: 'No bot token' };
  }
  try {
    const res = await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    return { ok: true, data: res.data };
  } catch (e) {
    console.error('[TG] send error:', e.response?.data || e.message);
    return { ok: false, error: e.response?.data || e.message };
  }
}

function formatAlertMessage(alert, currentValue) {
  const typeLabel = {
    price_above: 'Цена выше',
    price_below: 'Цена ниже',
    risk_above: 'Risk выше'
  }[alert.type] || alert.type;

  return (
    `🔔 <b>Алерт сработал</b>\n\n` +
    `Токен: <b>${alert.symbol || 'TOKEN'}</b>\n` +
    `Условие: ${typeLabel} <b>${alert.value}</b>\n` +
    `Сейчас: <b>${currentValue}</b>\n` +
    `Адрес: <code>${alert.address}</code>\n\n` +
    `Crypto AI Scanner`
  );
}

module.exports = { sendMessage, formatAlertMessage, hasToken: !!TOKEN };