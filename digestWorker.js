/**
 * Daily Telegram digest — safe against empty/partial user rows.
 */
const store = require('./store');

let timer = null;
let running = false;

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function buildDigestText(user) {
  if (!user) return null;
  const plan = String(user.plan || 'free').toLowerCase();
  let lines = [];
  try {
    const wl =
      typeof store.getWatchlist === 'function'
        ? await store.getWatchlist(user)
        : [];
    const list = Array.isArray(wl) ? wl : [];
    if (list.length) {
      lines.push('Watchlist: ' + list.length + ' token(s)');
      list.slice(0, 5).forEach(function (t) {
        if (!t) return;
        lines.push(
          '· ' +
            (t.symbol || 'TOKEN') +
            ' ' +
            String(t.address || '').slice(0, 10) +
            '…'
        );
      });
    } else {
      lines.push('Watchlist empty — add tokens in the app.');
    }
  } catch (e) {
    lines.push('Watchlist unavailable');
  }
  return (
    '📰 <b>Crypto AI Scanner · digest</b>\n' +
    'Plan: ' +
    plan.toUpperCase() +
    '\n\n' +
    lines.join('\n') +
    '\n\nNot financial advice.'
  );
}

async function runDailyDigest() {
  if (running) return { ok: false, reason: 'busy' };
  running = true;
  try {
    let users = [];
    try {
      if (typeof store.getDigestUsers === 'function') {
        users = await store.getDigestUsers();
      } else if (typeof store.getUsersWithTelegram === 'function') {
        users = await store.getUsersWithTelegram();
      }
    } catch (e) {
      console.error('[Digest] load users:', e.message);
      users = [];
    }
    if (!Array.isArray(users)) users = [];
    console.log('[Digest] users:', users.length);

    let sendMessage = null;
    try {
      sendMessage = require('./telegram').sendMessage;
    } catch (e) {
      console.warn('[Digest] no telegram module');
      return { ok: false, sent: 0 };
    }

    let sent = 0;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (!user) continue;
      const chatId = user.telegramChatId || user.telegram_chat_id || user.chatId;
      if (!chatId) continue;
      try {
        const text = await buildDigestText(user);
        if (!text) continue;
        await sendMessage(chatId, text);
        sent++;
        await sleep(400);
      } catch (e) {
        console.error(
          '[Digest] user',
          user.id || user.email || i,
          e.message
        );
      }
    }
    return { ok: true, sent: sent };
  } finally {
    running = false;
  }
}

function startDigestWorker() {
  if (timer) return;
  const firstMs = 2 * 60 * 1000;
  const everyMs = 24 * 60 * 60 * 1000;
  console.log(
    '[Digest] Worker scheduled: first in 2 min, then every 24h'
  );
  setTimeout(function () {
    runDailyDigest().catch(function (e) {
      console.error('[Digest]', e.message);
    });
    timer = setInterval(function () {
      runDailyDigest().catch(function (e) {
        console.error('[Digest]', e.message);
      });
    }, everyMs);
  }, firstMs);
}

module.exports = { startDigestWorker, runDailyDigest };
