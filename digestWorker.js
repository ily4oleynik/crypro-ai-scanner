// backend/digestWorker.js
const axios = require('axios');
const store = require('./store');
const { sendMessage } = require('./telegram');

async function fetchPrice(address) {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 8000 }
    );
    const pair = res.data.pairs?.[0];
    if (!pair) return null;
    return {
      symbol: pair.baseToken?.symbol || 'TOKEN',
      price: parseFloat(pair.priceUsd || 0),
      change24h: pair.priceChange?.h24 != null ? Number(pair.priceChange.h24) : null
    };
  } catch (e) {
    return null;
  }
}

function formatChange(ch) {
  if (ch === null || ch === undefined || isNaN(ch)) return '—';
  const sign = ch > 0 ? '+' : '';
  return sign + ch.toFixed(2) + '%';
}

async function sendDigestForUser(userId, chatId, watchlist) {
  if (!watchlist.length) {
    await sendMessage(
      chatId,
      '📋 <b>Дневной дайджест</b>\n\nWatchlist пуст. Добавьте токены в Crypto AI Scanner.'
    );
    return;
  }

  const lines = [];
  for (const item of watchlist.slice(0, 8)) {
    const data = await fetchPrice(item.address);
    if (!data) {
      lines.push(`• <b>${item.symbol || 'TOKEN'}</b> — нет данных`);
      continue;
    }
    const priceStr = data.price < 1 ? data.price.toFixed(6) : data.price.toFixed(4);
    lines.push(
      `• <b>${data.symbol}</b>  $${priceStr}  (${formatChange(data.change24h)})`
    );
  }

  const text =
    `📋 <b>Дневной дайджест Watchlist</b>\n\n` +
    lines.join('\n') +
    `\n\nОткройте Scanner, чтобы разобрать риски.\nCrypto AI Scanner`;

  await sendMessage(chatId, text);
}

async function runDailyDigest() {
  const users = await store.getDigestUsers();
  console.log('[Digest] users:', users.length);
  for (const { userId, chatId, watchlist } of users) {
    try {
      await sendDigestForUser(userId, chatId, watchlist);
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      console.error('[Digest] user', userId, e.message);
    }
  }
}

function startDigestWorker() {
  const TWO_MIN = 2 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  console.log('[Digest] Worker scheduled: first in 2 min, then every 24h');
  setTimeout(() => {
    runDailyDigest().catch(e => console.error('[Digest]', e.message));
    setInterval(() => {
      runDailyDigest().catch(e => console.error('[Digest]', e.message));
    }, DAY);
  }, TWO_MIN);
}

module.exports = { startDigestWorker, runDailyDigest };