const axios = require('axios');
const store = require('./store');
const { sendMessage, getChannelUrl } = require('./telegram');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let offset = 0;
let polling = false;
let backoffMs = 1000;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function clearWebhook() {
  if (!API) return;
  try {
    await axios.get(`${API}/deleteWebhook`, {
      params: { drop_pending_updates: false },
      timeout: 10000
    });
    console.log('[TG] Webhook cleared (long polling mode)');
  } catch (e) {
    console.error('[TG] deleteWebhook:', e.message);
  }
}

async function handleUpdate(update, tgLinkCodes) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const channelUrl = getChannelUrl();
  const channelRu = process.env.TELEGRAM_CHANNEL_URL_RU || channelUrl || '';
  const channelEn = process.env.TELEGRAM_CHANNEL_URL_EN || '';

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1];

    if (!code) {
      let channels = '';
      if (channelRu) channels += `\nRU: ${channelRu}`;
      if (channelEn) channels += `\nEN: ${channelEn}`;

      await sendMessage(
        chatId,
        `👋 <b>Crypto AI Scanner Bot</b>\n\n` +
          `1. Open the site → <b>Account</b> → Connect Telegram\n` +
          `2. Open the link with the code and press Start\n\n` +
          `<b>Commands</b>\n` +
          `/status — link status\n` +
          `/news — latest news\n` +
          (channels ? `\n📢 Channels:${channels}` : '')
      );
      return;
    }

    const entry = tgLinkCodes.get(String(code).toUpperCase());
    if (!entry || entry.expires < Date.now()) {
      await sendMessage(
        chatId,
        '❌ Code invalid or expired.\nGenerate a new one: Account → Connect Telegram.'
      );
      return;
    }

    try {
      await store.linkTelegram({ id: entry.userId, plan: entry.plan }, String(chatId));
      tgLinkCodes.delete(String(code).toUpperCase());

      let channels = '';
      if (channelRu) channels += `\nRU: ${channelRu}`;
      if (channelEn) channels += `\nEN: ${channelEn}`;

      await sendMessage(
        chatId,
        `✅ <b>Account linked</b>\n\n` +
          `Alerts and digest will arrive here.` +
          (channels ? `\n\n📢 Channels:${channels}` : '')
      );
    } catch (e) {
      console.error('[TG] link error:', e.message);
      await sendMessage(chatId, '❌ Link failed. Try a new code from the site.');
    }
    return;
  }

  if (text === '/status' || text.startsWith('/status')) {
    await sendMessage(
      chatId,
      `🤖 Bot is online\n` +
        `Chat ID: <code>${chatId}</code>\n` +
        (channelRu ? `RU channel: ${channelRu}\n` : '') +
        (channelEn ? `EN channel: ${channelEn}\n` : '') +
        (!channelRu && !channelEn ? 'Channels not configured yet' : '')
    );
    return;
  }

  if (text === '/news' || text.startsWith('/news')) {
    try {
      const newsMod = require('./news');
      const items = await newsMod.fetchNews(5);
      if (!items.length) {
        await sendMessage(chatId, '📰 No news yet.');
        return;
      }
      const body = items
        .map(
          (n, i) =>
            `${i + 1}. <a href="${n.url}">${escapeHtml(n.title)}</a>\n<i>${escapeHtml(n.source)}</i>`
        )
        .join('\n\n');
      await sendMessage(chatId, `📰 <b>Latest news</b>\n\n${body}`);
    } catch (e) {
      console.error('[TG] /news error:', e.message);
      await sendMessage(chatId, '❌ Failed to load news.');
    }
  }
}

function startTelegramPolling(tgLinkCodes) {
  if (!API) {
    console.log('[TG] No TELEGRAM_BOT_TOKEN — polling off');
    return;
  }
  if (polling) return;
  polling = true;

  (async () => {
    await clearWebhook();
    console.log('[TG] Long polling started');

    const loop = async () => {
      try {
        const res = await axios.get(`${API}/getUpdates`, {
          params: { offset, timeout: 25 },
          timeout: 35000
        });
        backoffMs = 1000;
        const updates = res.data.result || [];
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handleUpdate(u, tgLinkCodes);
          } catch (err) {
            console.error('[TG] handleUpdate:', err.message);
          }
        }
      } catch (e) {
        const status = e.response?.status;
        if (status === 409) {
          console.error(
            '[TG] 409 Conflict: another getUpdates is running with this bot token. ' +
              'Stop local server OR other Railway replica. Only one poller allowed.'
          );
          backoffMs = Math.min(backoffMs * 2, 60000);
          await clearWebhook();
        } else {
          console.error('[TG] poll error:', e.message);
          backoffMs = Math.min(backoffMs * 2, 30000);
        }
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      setImmediate(loop);
    };

    loop();
  })();
}

module.exports = { startTelegramPolling };
