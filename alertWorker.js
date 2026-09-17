const axios = require('axios');
const store = require('./store');

let sendAlertFn = null;
try {
  const tg = require('./telegram');
  sendAlertFn = typeof tg.sendAlert === 'function' ? tg.sendAlert : null;
} catch (e) {
  console.warn('[Alerts] telegram module not loaded:', e.message);
}

async function fetchPrice(address) {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 8000 }
    );
    const pair = res.data?.pairs?.[0];
    const price = parseFloat(pair?.priceUsd);
    return Number.isFinite(price) ? price : null;
  } catch (e) {
    return null;
  }
}

function shouldTrigger(alert, price) {
  const value = parseFloat(alert.value);
  if (!Number.isFinite(value) || !Number.isFinite(price)) return false;
  if (alert.type === 'price_above') return price >= value;
  if (alert.type === 'price_below') return price <= value;
  return false;
}

async function checkAlerts() {
  if (typeof store.getAllAlertUsers !== 'function') {
    console.warn('[Alerts] getAllAlertUsers missing — skip');
    return;
  }

  let users = [];
  try {
    users = await store.getAllAlertUsers();
  } catch (e) {
    console.error('[Alerts] getAllAlertUsers error:', e.message);
    return;
  }

  if (!users || !users.length) return;

  for (const user of users) {
    const chatId = user.telegramChatId || user.telegram_chat_id;
    const alerts = user.alerts || [];
    if (!chatId || !alerts.length) continue;

    for (const alert of alerts) {
      try {
        const price = await fetchPrice(alert.address);
        if (price == null) continue;
        if (!shouldTrigger(alert, price)) continue;

        if (sendAlertFn) {
          await sendAlertFn(chatId, alert, price);
        } else {
          console.log(
            '[Alerts] triggered',
            alert.symbol || alert.address,
            price,
            'chat',
            chatId
          );
        }

        // опционально: удалить сработавший алерт
        // if (typeof store.removeAlert === 'function') {
        //   await store.removeAlert(user, alert.id);
        // }
      } catch (e) {
        console.error('[Alerts] item error:', e.message);
      }
    }
  }
}

function startAlertWorker(intervalMs) {
  const ms = intervalMs || 60000;
  console.log('[Alerts] Worker started, interval', ms, 'ms');

  const tick = async () => {
    try {
      await checkAlerts();
    } catch (e) {
      console.error('[Alerts] tick error:', e.message);
    }
  };

  // не блокируем старт сервера
  setTimeout(tick, 5000);
  setInterval(tick, ms);
}

module.exports = { startAlertWorker, checkAlerts };
