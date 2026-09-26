/**
 * Alert worker: price / risk / liquidity thresholds → Telegram
 */
const axios = require('axios');
const store = require('./store');

let sendMessage = null;
try {
  sendMessage = require('./telegram').sendMessage;
} catch (e) {
  console.warn('[Alerts] telegram.js missing');
}

const INTERVAL_MS = Number(process.env.ALERT_INTERVAL_MS || 60000);

async function fetchDexPair(address) {
  const res = await axios.get(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    { timeout: 10000 }
  );
  return res.data?.pairs?.[0] || null;
}

async function estimateRisk(pair) {
  if (!pair) return null;
  const liq = Number(pair.liquidity?.usd) || 0;
  const vol = Number(pair.volume?.h24) || 0;
  const fdv = Number(pair.fdv) || 0;
  let score = 35;
  if (liq < 10000) score += 30;
  else if (liq < 50000) score += 18;
  else if (liq < 200000) score += 8;
  if (fdv > 0 && liq > 0 && fdv / liq > 50 && liq < 500000) score += 15;
  if (vol < 5000 && liq < 100000) score += 8;
  return Math.max(5, Math.min(95, score));
}

async function checkAlerts() {
  if (!sendMessage) return;
  let users = [];
  try {
    users = await store.getAllAlertUsers();
  } catch (e) {
    console.error('[Alerts]', e.message);
    return;
  }
  for (const user of users || []) {
    const chatId = user.telegramChatId || user.telegram_chat_id;
    if (!chatId) continue;
    const alerts = user.alerts || [];
    for (const alert of alerts) {
      if (alert.active === false) continue;
      try {
        const pair = await fetchDexPair(alert.address);
        if (!pair) continue;
        const price = Number(pair.priceUsd) || 0;
        const liq = Number(pair.liquidity?.usd) || 0;
        const riskScore = await estimateRisk(pair);
        const type = String(alert.type || '');
        const value = Number(alert.value);
        let hit = false;
        let detail = '';

        if (type === 'price_above' && price >= value) {
          hit = true;
          detail = `Price $${price} ≥ $${value}`;
        } else if (type === 'price_below' && price > 0 && price <= value) {
          hit = true;
          detail = `Price $${price} ≤ $${value}`;
        } else if (type === 'risk_above' && riskScore != null && riskScore >= value) {
          hit = true;
          detail = `Risk ${riskScore}/100 ≥ ${value}`;
        } else if (type === 'liquidity_below' && liq > 0 && liq <= value) {
          hit = true;
          detail = `Liquidity $${Math.round(liq)} ≤ $${value}`;
        }

        if (!hit) continue;

        // de-dupe via store if available
        if (typeof store.wasAlertFired === 'function') {
          const fired = await store.wasAlertFired(user, alert.id);
          if (fired) continue;
          await store.markAlertFired(user, alert.id);
        }

        const sym = alert.symbol || pair.baseToken?.symbol || 'TOKEN';
        await sendMessage(
          chatId,
          `🚨 <b>Alert · ${sym}</b>\n` +
            `${detail}\n` +
            `Type: <code>${type}</code>\n` +
            `<code>${alert.address}</code>\n\n` +
            `<i>Not financial advice.</i>`
        );
      } catch (e) {
        console.error('[Alerts] item', e.message);
      }
    }
  }
}

function startAlertWorker() {
  console.log('[Alerts] Worker started, interval', INTERVAL_MS, 'ms');
  setTimeout(() => {
    checkAlerts().catch(() => {});
  }, 5000);
  setInterval(() => {
    checkAlerts().catch(() => {});
  }, INTERVAL_MS);
}

module.exports = { startAlertWorker, checkAlerts };
