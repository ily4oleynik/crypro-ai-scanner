// backend/alertWorker.js
const axios = require('axios');
const store = require('./store');
const { sendMessage, formatAlertMessage } = require('./telegram');

async function getTokenPrice(address) {
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      timeout: 8000
    });
    const pair = res.data.pairs?.[0];
    return {
      price: parseFloat(pair?.priceUsd || 0),
      symbol: pair?.baseToken?.symbol || 'TOKEN'
    };
  } catch (e) {
    return null;
  }
}

function isTriggered(alert, price) {
  if (!price && price !== 0) return false;
  if (alert.type === 'price_above') return price >= alert.value;
  if (alert.type === 'price_below') return price <= alert.value;
  // risk_above — упрощённо: пока нет live risk, пропускаем или используй своё
  if (alert.type === 'risk_above') return false;
  return false;
}

async function checkAlerts() {
  const users = store.getAllAlertUsers();
  if (!users.length) return;

  for (const { userId, chatId, alerts } of users) {
    for (const alert of alerts) {
      if (store.wasAlertFired(userId, alert.id)) continue;

      const data = await getTokenPrice(alert.address);
      if (!data) continue;

      if (isTriggered(alert, data.price)) {
        const text = formatAlertMessage(
          { ...alert, symbol: alert.symbol || data.symbol },
          data.price
        );
        const result = await sendMessage(chatId, text);
        if (result.ok) {
          store.markAlertFired(userId, alert.id);
          console.log(`[Alerts] Fired ${alert.id} -> chat ${chatId}`);
        }
      }
    }
  }
}

function startAlertWorker(intervalMs = 60000) {
  console.log('[Alerts] Worker started, interval', intervalMs, 'ms');
  checkAlerts();
  setInterval(checkAlerts, intervalMs);
}

module.exports = { startAlertWorker, checkAlerts };