const axios = require('axios');
const store = require('./store');
const { sendMessage, getChannelUrl } = require('./telegram');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let offset = 0;
let polling = false;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function handleUpdate(update, tgLinkCodes) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const channelUrl = getChannelUrl();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1];

    if (!code) {
      await sendMessage(
        chatId,
        `👋 <b>Crypto AI Scanner Bot</b>\n\n` +
          `1. Открой сайт → <b>Account</b> → Connect Telegram\n` +
          `2. Перейди по ссылке с кодом и нажми Start\n\n` +
          `<b>Команды</b>\n` +
          `/status — статус привязки\n` +
          `/news — последние новости\n` +
          (channelUrl ? `\n📢 Канал: ${channelUrl}` : '')
      );
      return;
    }

    const entry = tgLinkCodes.get(String(code).toUpperCase());
    if (!entry || entry.expires < Date.now()) {
      await sendMessage(
        chatId,
        '❌ Код недействителен или истёк.\nСгенерируй новый на сайте: Account → Connect Telegram.'
      );
      return;
    }

    try {
      await store.linkTelegram({ id: entry.userId, plan: entry.plan }, String(chatId));
      tgLinkCodes.delete(String(code).toUpperCase());
      await sendMessage(
        chatId,
        `✅ <b>Аккаунт привязан</b>\n\n` +
          `Алерты и ежедневный дайджест будут приходить сюда.\n` +
          (channelUrl ? `\n📢 Подпишись на канал:\n${channelUrl}` : '')
      );
    } catch (e) {
      console.error('[TG] link error:', e.message);
      await sendMessage(chatId, '❌ Ошибка привязки. Попробуй ещё раз с новым кодом.');
    }
    return;
  }

  if (text === '/status' || text.startsWith('/status')) {
    await sendMessage(
      chatId,
      `🤖 Бот активен\n` +
        `Chat ID: <code>${chatId}</code>\n` +
        (channelUrl ? `Канал: ${channelUrl}` : 'Канал пока не настроен')
    );
    return;
  }

  if (text === '/news' || text.startsWith('/news')) {
    try {
      const newsMod = require('./news');
      const items = await newsMod.fetchNews(5);
      if (!items.length) {
        await sendMessage(chatId, '📰 Новостей пока нет.');
        return;
      }
      const body = items
        .map(
          (n, i) =>
            `${i + 1}. <a href="${n.url}">${escapeHtml(n.title)}</a>\n<i>${escapeHtml(n.source)}</i>`
        )
        .join('\n\n');
      await sendMessage(chatId, `📰 <b>Последние новости</b>\n\n${body}`);
    } catch (e) {
      console.error('[TG] /news error:', e.message);
      await sendMessage(chatId, '❌ Не удалось загрузить новости.');
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
  console.log('[TG] Long polling started');

  const loop = async () => {
    try {
      const res = await axios.get(`${API}/getUpdates`, {
        params: { offset, timeout: 25 },
        timeout: 35000
      });
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
      console.error('[TG] poll error:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
    setImmediate(loop);
  };

  loop();
}

module.exports = { startTelegramPolling };
