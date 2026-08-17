// backend/tgPoll.js
const axios = require('axios');
const store = require('./store');
const { sendMessage } = require('./telegram');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let offset = 0;

async function poll(tgLinkCodes) {
  if (!TOKEN) return;

  try {
    const res = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
      params: { offset, timeout: 25 }
    });

    for (const upd of res.data.result || []) {
      offset = upd.update_id + 1;
      const msg = upd.message;
      if (!msg?.text || !msg.chat) continue;

      const chatId = msg.chat.id;
      const text = msg.text.trim();

      if (text.startsWith('/start')) {
        const code = text.split(/\s+/)[1];

        if (!code) {
          await sendMessage(
            chatId,
            'Привет! Чтобы привязать аккаунт, нажми Connect Telegram в приложении и перейди по ссылке.'
          );
          continue;
        }

        const entry = tgLinkCodes.get(code.toUpperCase());
        if (!entry || entry.expires < Date.now()) {
          await sendMessage(chatId, 'Код недействителен или истёк. Создай новую ссылку в приложении.');
          continue;
        }

        await store.linkTelegram({ id: entry.userId, plan: entry.plan }, chatId);
        tgLinkCodes.delete(code.toUpperCase());
        await sendMessage(
          chatId,
          '✅ Telegram успешно привязан к Crypto AI Scanner.\nВы будете получать уведомления по алертам.'
        );
      }

      if (text === '/status') {
        await sendMessage(chatId, 'Бот работает. Алерты проверяются каждую минуту.');
      }
    }
  } catch (e) {
    console.error('[TG poll]', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }

  setImmediate(() => poll(tgLinkCodes));
}

function startTelegramPolling(tgLinkCodes) {
  if (!TOKEN) {
    console.log('[TG] No TELEGRAM_BOT_TOKEN, polling disabled');
    return;
  }
  console.log('[TG] Long polling started');
  poll(tgLinkCodes);
}

module.exports = { startTelegramPolling };