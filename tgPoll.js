const axios = require('axios');
const store = require('./store');
const { sendMessage, getChannelUrl } = require('./telegram');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const SITE =
  process.env.PUBLIC_SITE_URL ||
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  'https://crypro-ai-scanner-production-6ecd.up.railway.app';

let offset = 0;
let polling = false;
let backoffMs = 1000;

let goplus = null;
try {
  goplus = require('./services/goplus');
} catch (e) {
  try {
    goplus = require('./goplus');
  } catch (e2) {
    /* optional */
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatUsd(n) {
  const x = Number(n) || 0;
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  if (x > 0) return '$' + x.toFixed(2);
  return '—';
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

async function scanTokenForBot(address) {
  const tokenAddress = String(address || '').trim();
  if (!tokenAddress || tokenAddress.length < 8) {
    return { error: 'Invalid address. Example: /scan 0x5149… or a Solana/Tron mint' };
  }

  const dexResponse = await axios.get(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`,
    { timeout: 12000 }
  );
  const pair = dexResponse.data?.pairs?.[0];
  if (!pair) {
    return {
      error:
        'No pool found on DexScreener for this address. Check network / contract.'
    };
  }

  const base = {
    symbol: pair.baseToken?.symbol || 'TOKEN',
    name: pair.baseToken?.name || '',
    address: pair.baseToken?.address || tokenAddress,
    price: pair.priceUsd != null ? Number(pair.priceUsd) : 0,
    liquidity: pair.liquidity?.usd != null ? Number(pair.liquidity.usd) : 0,
    volume24h: pair.volume?.h24 != null ? Number(pair.volume.h24) : 0,
    fdv: pair.fdv != null ? Number(pair.fdv) : 0,
    marketCap:
      pair.marketCap != null
        ? Number(pair.marketCap)
        : pair.fdv != null
          ? Number(pair.fdv)
          : 0,
    chainId: pair.chainId || 'unknown'
  };

  let riskScore = 40;
  const reasons = [];
  if (base.liquidity < 10000) {
    riskScore += 25;
    reasons.push('Very low liquidity');
  } else if (base.liquidity < 50000) {
    riskScore += 12;
    reasons.push('Thin liquidity');
  }
  if (base.fdv > 0 && base.liquidity > 0 && base.fdv / base.liquidity > 50) {
    riskScore += 15;
    reasons.push('FDV >> liquidity');
  }
  if (base.volume24h < 1000 && base.liquidity < 100000) {
    riskScore += 8;
    reasons.push('Low volume');
  }

  let securityLine = '';
  if (goplus && typeof goplus.fetchTokenSecurity === 'function') {
    try {
      const sec = await goplus.fetchTokenSecurity(base.chainId, tokenAddress);
      if (sec?.available) {
        if (sec.riskBonus) riskScore = Math.min(95, riskScore + Number(sec.riskBonus));
        const m = sec.meta || {};
        if (m.isHoneypot) {
          reasons.unshift('Honeypot flag');
          securityLine += ' · ⚠ honeypot';
        } else if (m.isHoneypot === false) {
          securityLine += ' · honeypot: no';
        }
        if (m.buyTax != null || m.sellTax != null) {
          securityLine +=
            ' · tax ' +
            (m.buyTax != null ? m.buyTax + '%' : '—') +
            '/' +
            (m.sellTax != null ? m.sellTax + '%' : '—');
        }
        if (m.isMintable) securityLine += ' · mintable';
        if (m.renounced) securityLine += ' · owner renounced';
        if (m.lpLockedPct != null) securityLine += ' · LP ~' + m.lpLockedPct + '%';
      }
    } catch (e) {
      console.warn('[TG /scan goplus]', e.message);
    }
  }

  riskScore = Math.max(5, Math.min(95, Math.round(riskScore)));
  const level = riskScore >= 70 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';
  const site = String(SITE).replace(/\/$/, '');
  if (!site.startsWith('http')) {
    /* railway domain without protocol */
  }
  const siteUrl = site.startsWith('http') ? site : 'https://' + site;

  const lines = [
    `<b>${escapeHtml(base.symbol)}</b> · ${escapeHtml(base.name || '')}`,
    `Network: <code>${escapeHtml(base.chainId)}</code>`,
    `Price: ${formatUsd(base.price)} · Liq: ${formatUsd(base.liquidity)} · Vol24: ${formatUsd(base.volume24h)}`,
    `Risk: <b>${riskScore}/100</b> (${level})${escapeHtml(securityLine)}`,
    reasons.length
      ? 'Flags: ' + reasons.slice(0, 4).map(escapeHtml).join(' · ')
      : 'Flags: none critical from quick scan',
    '',
    `<a href="${siteUrl}/?scan=${encodeURIComponent(tokenAddress)}">Full report on site</a>`,
    '<i>Not financial advice. DYOR.</i>'
  ];

  return { text: lines.join('\n') };
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
          `/scan 0x… — quick risk scan\n` +
          `/status — bot / link info\n` +
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

  if (text.startsWith('/scan')) {
    const parts = text.split(/\s+/);
    const addr = parts[1];
    if (!addr) {
      await sendMessage(
        chatId,
        'Usage:\n<code>/scan 0xContractAddress</code>\n\nExample:\n<code>/scan 0x514910771AF9Ca656af840dff83E8264EcF986CA</code>'
      );
      return;
    }
    await sendMessage(chatId, '⏳ Scanning…');
    try {
      const result = await scanTokenForBot(addr);
      if (result.error) {
        await sendMessage(chatId, '❌ ' + escapeHtml(result.error));
        return;
      }
      await sendMessage(chatId, result.text);
    } catch (e) {
      console.error('[TG] /scan error:', e.message);
      await sendMessage(chatId, '❌ Scan failed: ' + escapeHtml(e.message));
    }
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
