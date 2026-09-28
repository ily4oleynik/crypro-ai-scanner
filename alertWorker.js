/**
 * Alert worker: price / risk / liquidity + Pro portfolio risk-change → Telegram
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
const PORTFOLIO_DELTA = Number(process.env.PORTFOLIO_RISK_DELTA || 15);

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

async function fireOnce(userId, alertKey, chatId, text) {
  if (store.wasAlertFired && store.markAlertFired) {
    const fired = await store.wasAlertFired(String(userId), alertKey);
    if (fired) return false;
    await store.markAlertFired(String(userId), alertKey);
  }
  if (sendMessage) await sendMessage(chatId, text);
  return true;
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
        } else if (type === 'score_jump' && riskScore != null) {
          const baseline = Number(alert.baseline) || 40;
          const delta = riskScore - baseline;
          if (delta >= value) {
            hit = true;
            detail = `Risk jumped ${baseline} → ${riskScore} (+${delta})`;
          }
        }

        if (!hit) continue;

        const alertId = String(alert.id || alert.address + ':' + type);
        const sym = alert.symbol || pair.baseToken?.symbol || 'TOKEN';
        const text =
          `🚨 <b>Alert · ${sym}</b>\n` +
          `${detail}\n` +
          `<code>${alert.address}</code>\n` +
          `Crypto AI Scanner`;
        await fireOnce(user.id, alertId + ':' + Math.floor(Date.now() / 3600000), chatId, text);
      } catch (err) {
        console.error('[Alerts] item:', err.message);
      }
    }
  }

  // Pro: portfolio risk-change monitoring
  await checkPortfolioRiskChanges();
}

async function checkPortfolioRiskChanges() {
  if (!sendMessage || !store.getProPortfolioWatch) return;
  let watch = [];
  try {
    watch = await store.getProPortfolioWatch();
  } catch (e) {
    console.error('[Alerts] portfolio watch:', e.message);
    return;
  }
  for (const user of watch || []) {
    const chatId = user.telegramChatId;
    if (!chatId) continue;
    for (const pos of user.positions || []) {
      try {
        const pair = await fetchDexPair(pos.address);
        if (!pair) continue;
        const liq = Number(pair.liquidity?.usd) || 0;
        const price = Number(pair.priceUsd) || 0;
        const riskScore = await estimateRisk(pair);
        if (riskScore == null) continue;
        const prev = pos.lastRisk != null ? Number(pos.lastRisk) : null;
        const sym = pos.symbol || pair.baseToken?.symbol || 'TOKEN';

        if (store.updatePortfolioSnapshot) {
          await store.updatePortfolioSnapshot(
            { id: user.id },
            pos.address,
            {
              riskScore,
              liquidity: liq,
              price,
              symbol: sym,
              name: pair.baseToken?.name || pos.name,
              chainId: pair.chainId || pos.chainId
            }
          );
        }

        if (prev == null) continue;
        const delta = riskScore - prev;
        if (delta < PORTFOLIO_DELTA) continue;

        const key =
          'pf:' +
          String(user.id) +
          ':' +
          String(pos.address).toLowerCase() +
          ':' +
          Math.floor(Date.now() / (6 * 3600000));
        const text =
          `⚠️ <b>Portfolio risk ↑ · ${sym}</b>\n` +
          `Score ${prev} → <b>${riskScore}</b> (+${delta})\n` +
          `Liq $${Math.round(liq).toLocaleString('en-US')}\n` +
          `<code>${pos.address}</code>\n` +
          `Pro Risk Desk · Crypto AI Scanner`;
        await fireOnce(user.id, key, chatId, text);
      } catch (e) {
        console.error('[Alerts] portfolio pos:', e.message);
      }
    }
  }
}

function startAlertWorker() {
  if (!sendMessage) {
    console.log('[Alerts] No telegram sendMessage — worker idle');
    return;
  }
  console.log('[Alerts] Worker started, interval', INTERVAL_MS, 'ms');
  const loop = () => {
    checkAlerts().catch(() => {});
  };
  setTimeout(loop, 5000);
  setInterval(loop, INTERVAL_MS);
}

module.exports = { startAlertWorker, checkAlerts, checkPortfolioRiskChanges };
