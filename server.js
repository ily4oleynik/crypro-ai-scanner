require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const aiService = require('./services/ai.js');
const { computeRiskFromPair } = require('./services/scoring.js');
const { initDb } = require('./db');
const store = require('./store');
const { startAlertWorker } = require('./alertWorker');
const { startTelegramPolling } = require('./tgPoll');
const { startDigestWorker, runDailyDigest } = require('./digestWorker');
const { getChannelUrl } = require('./telegram');

let newsService = null;
try {
  newsService = require('./news');
} catch (e) {
  console.warn('[News] news.js not found — fallback');
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crypto-ai-scanner-secret-key-change-me-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const tgLinkCodes = new Map();
const rateBuckets = new Map();

const PLAN_LIMITS = {
  free: { watchlist: 5, historyDays: 7 },
  premium: { watchlist: 30, historyDays: null },
  pro: { watchlist: 999999, historyDays: null }
};

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    req.user = { plan: 'free' };
    return next();
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch (e) {
    req.user = { plan: 'free' };
  }
  next();
}

function getPlan(user) {
  return String(user?.plan || 'free').toLowerCase();
}

function createBybitSignature(apiSecret, payload) {
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function rateLimit({ windowMs = 60_000, max = 30, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        error: 'Слишком много запросов. Подождите минуту.',
        upsell: 'premium'
      });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets.entries()) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
}, 10 * 60 * 1000);

app.get('/api/config/public', (req, res) => {
  res.json({
    success: true,
    channelRu: process.env.TELEGRAM_CHANNEL_URL_RU || 'https://t.me/Crypto_AI_Scanner',
    channelEn: process.env.TELEGRAM_CHANNEL_URL_EN || 'https://t.me/crypto_ai_scanner_en'
  });
});

app.post(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60_000,
    max: 30,
    keyFn: (req) => 'login:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await store.findUserByEmail(email);
      if (!user || !(await store.verifyPassword(user, password))) {
        return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
      }
      const token = jwt.sign(
        { id: user.id, email: user.email, plan: user.plan || 'free' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({
        success: true,
        token,
        user: { id: user.id, email: user.email, plan: user.plan || 'free' }
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
  }
);

app.post(
  '/api/auth/register',
  rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    keyFn: (req) => 'reg:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Минимум 6 символов в пароле' });
      }
      if (await store.findUserByEmail(email)) {
        return res.status(400).json({ success: false, error: 'Email уже зарегистрирован' });
      }
      const user = await store.createUser(email, password, 'free');
      const token = jwt.sign(
        { id: user.id, email: user.email, plan: 'free' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({
        success: true,
        token,
        user: { id: user.id, email: user.email, plan: 'free' }
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: 'Ошибка регистрации' });
    }
  }
);

app.post('/api/user/plan', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Войдите в аккаунт' });
  }
  const plan = String(req.body.plan || '').toLowerCase();
  if (!['free', 'premium', 'pro'].includes(plan)) {
    return res.status(400).json({ success: false, error: 'Неверный тариф' });
  }
  try {
    const updated = await store.updateUserPlan(req.user, plan);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить тариф' });
    }
    const tokenJwt = jwt.sign(
      { id: updated.id, email: updated.email, plan: updated.plan },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      success: true,
      plan: updated.plan,
      token: tokenJwt,
      user: { id: updated.id, email: updated.email, plan: updated.plan },
      note: 'Демо-активация до оплаты'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.get(
  '/api/scan/:tokenAddress',
  rateLimit({
    windowMs: 60_000,
    max: 20,
    keyFn: (req) => 'scan:' + clientIp(req)
  }),
  authMiddleware,
  async (req, res) => {
    const { tokenAddress } = req.params;
    const plan = (req.query.plan || getPlan(req.user) || 'free').toLowerCase();

    if (!tokenAddress || tokenAddress.length < 8 || tokenAddress.length > 128) {
      return res.status(400).json({ success: false, error: 'Некорректный адрес' });
    }

    try {
      const usage = await store.canScan({ ...req.user, plan: req.user?.plan || plan });
      if (!usage.allowed) {
        return res.status(429).json({
          success: false,
          error: `Лимит сканов на сегодня исчерпан (${usage.used}/${usage.limit}). Обновите тариф.`,
          usage,
          upsell: 'premium'
        });
      }

      const dexResponse = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 10000 }
      );
      const pair = dexResponse.data.pairs?.[0] || {};

      const base = {
        symbol: pair.baseToken?.symbol || 'TOKEN',
        name: pair.baseToken?.name || '',
        price: pair.priceUsd || 0,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24 || 0,
        fdv: pair.fdv || 0,
        marketCap: pair.fdv || 0,
        isVerified: !!pair.info?.imageUrl,
        website: pair.info?.websites?.[0]?.url || null,
        twitter: pair.info?.socials?.find((s) => s.type === 'twitter')?.url || null,
        telegram: pair.info?.socials?.find((s) => s.type === 'telegram')?.url || null,
        pairAddress: pair.pairAddress || null,
        chainId: pair.chainId || 'ethereum',
        dexId: pair.dexId || null
      };

      const risk = computeRiskFromPair(pair, base);
      const riskScore = risk.riskScore;
      const riskLevel = risk.riskLevel;

      const aiPlan = plan === 'pro' ? 'pro' : plan === 'premium' ? 'premium' : 'free';
      const ai = await aiService.analyzeToken(
        base,
        { riskScore, riskLevel, reasons: risk.reasons },
        aiPlan
      );

      await store.incrementScan(req.user);
      await store.addHistory(req.user, {
        address: tokenAddress,
        symbol: base.symbol,
        name: base.name,
        price: base.price,
        riskScore,
        plan
      });

      const currentUsage = await store.canScan({ ...req.user, plan: req.user?.plan || plan });
      const aiPayload = {
        text: ai.text,
        confidence: ai.confidence,
        verdict: ai.verdict,
        risks: ai.risks || [],
        positives: ai.positives || []
      };
      const riskPayload = {
        riskScore,
        riskLevel,
        confidence: ai.confidence || risk.confidence,
        reasons: risk.reasons || []
      };

      if (plan === 'free') {
        return res.json({
          success: true,
          plan: 'Free',
          token: {
            symbol: base.symbol,
            name: base.name,
            price: base.price,
            liquidity: base.liquidity,
            volume24h: base.volume24h,
            pairAddress: base.pairAddress,
            chainId: base.chainId
          },
          risk: riskPayload,
          ai: aiPayload,
          locked: true,
          usage: currentUsage
        });
      }

      if (plan === 'premium') {
        return res.json({
          success: true,
          plan: 'Premium',
          token: base,
          risk: riskPayload,
          ai: aiPayload,
          security: {
            contractVerified: base.isVerified,
            liquidityLock: false,
            scamProbability: Math.min(90, Math.max(5, riskScore - 10))
          },
          projectLinks: {
            website: base.website,
            twitter: base.twitter,
            telegram: base.telegram
          },
          usage: currentUsage
        });
      }

      return res.json({
        success: true,
        plan: 'Pro',
        token: base,
        risk: riskPayload,
        ai: aiPayload,
        security: {
          contractVerified: base.isVerified,
          liquidityLock: false,
          scamProbability: Math.min(90, Math.max(5, riskScore - 15))
        },
        projectLinks: {
          website: base.website,
          twitter: base.twitter,
          telegram: base.telegram
        },
        advanced: {
          whaleConcentration: 'n/a',
          buySellRatio:
            pair.txns?.h24
              ? (
                  (Number(pair.txns.h24.buys || 0) + 1) /
                  (Number(pair.txns.h24.sells || 0) + 1)
                ).toFixed(2)
              : '—',
          volatility: pair.priceChange?.h24 != null ? Number(pair.priceChange.h24).toFixed(1) + '%' : '—',
          holderCount: '—'
        },
        usage: currentUsage
      });
    } catch (error) {
      console.error(error.message);
      res.json({
        success: true,
        plan,
        token: { symbol: String(tokenAddress).slice(0, 8) + '...' },
        risk: { riskScore: 50, riskLevel: 'MEDIUM', confidence: 40, reasons: [] },
        ai: {
          text: 'Не удалось загрузить данные',
          confidence: 30,
          verdict: 'Ошибка',
          risks: [],
          positives: []
        },
        usage: await store.canScan(req.user)
      });
    }
  }
);

app.get('/api/usage', authMiddleware, async (req, res) => {
  res.json({ success: true, usage: await store.canScan(req.user) });
});

app.get('/api/history', authMiddleware, async (req, res) => {
  let history = await store.getHistory(req.user);
  const plan = getPlan(req.user);
  const days = PLAN_LIMITS[plan]?.historyDays;
  if (days) {
    const from = Date.now() - days * 24 * 60 * 60 * 1000;
    history = (history || []).filter((h) => {
      const t = new Date(h.scannedAt || 0).getTime();
      return t >= from;
    });
  }
  res.json({ success: true, history: history || [] });
});

app.get('/api/watchlist', authMiddleware, async (req, res) => {
  res.json({ success: true, watchlist: await store.getWatchlist(req.user) });
});

app.post('/api/watchlist', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  const max = PLAN_LIMITS[plan]?.watchlist ?? 5;
  const list = (await store.getWatchlist(req.user)) || [];
  if (list.length >= max) {
    return res.status(403).json({
      success: false,
      error:
        plan === 'free'
          ? 'На Free — до 5 токенов в Watchlist. Premium — до 30.'
          : 'Лимит Watchlist исчерпан',
      upsell: plan === 'free' ? 'premium' : 'pro'
    });
  }
  const { address, symbol, name } = req.body;
  if (!address) return res.status(400).json({ success: false, error: 'address required' });
  res.json(await store.addToWatchlist(req.user, { address, symbol, name }));
});

app.delete('/api/watchlist/:address', authMiddleware, async (req, res) => {
  res.json(await store.removeFromWatchlist(req.user, req.params.address));
});

app.get('/api/alerts', authMiddleware, async (req, res) => {
  res.json({ success: true, alerts: await store.getAlerts(req.user) });
});

app.post('/api/alerts', authMiddleware, async (req, res) => {
  if (getPlan(req.user) === 'free') {
    return res.status(403).json({
      success: false,
      error: 'Алерты доступны с Premium',
      upsell: 'premium'
    });
  }
  const { type, address, symbol, value } = req.body;
  if (!type || !address || value === undefined) {
    return res.status(400).json({ success: false, error: 'type, address, value required' });
  }
  res.json(await store.addAlert(req.user, { type, address, symbol, value }));
});

app.delete('/api/alerts/:id', authMiddleware, async (req, res) => {
  res.json(await store.removeAlert(req.user, req.params.id));
});

app.post('/api/compare', authMiddleware, async (req, res) => {
  if (getPlan(req.user) === 'free') {
    return res.status(403).json({
      success: false,
      error: 'Сравнение токенов доступно с Premium',
      upsell: 'premium'
    });
  }
  const { addresses } = req.body;
  if (!Array.isArray(addresses) || addresses.length < 2 || addresses.length > 3) {
    return res.status(400).json({ success: false, error: 'Передайте 2–3 адреса' });
  }
  try {
    const results = [];
    for (const addr of addresses) {
      const dex = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, {
        timeout: 8000
      });
      const pair = dex.data.pairs?.[0] || {};
      results.push({
        address: addr,
        symbol: pair.baseToken?.symbol || 'TOKEN',
        name: pair.baseToken?.name || '',
        price: pair.priceUsd || 0,
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24 || 0,
        fdv: pair.fdv || 0
      });
    }
    res.json({ success: true, tokens: results });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Ошибка сравнения' });
  }
});

app.post('/api/telegram/link', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Войдите в аккаунт' });
  }
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  tgLinkCodes.set(code, {
    userId: req.user.id,
    plan: req.user.plan,
    expires: Date.now() + 10 * 60 * 1000
  });
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YourBotUsername';
  res.json({
    success: true,
    code,
    deepLink: `https://t.me/${botUsername}?start=${code}`,
    expiresIn: 600,
    channelUrl: getChannelUrl() || 'https://t.me/Crypto_AI_Scanner'
  });
});

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
  const chatId = await store.getTelegramChatId(req.user);
  res.json({
    success: true,
    linked: !!chatId,
    chatId: chatId || null,
    channelUrl: getChannelUrl() || 'https://t.me/Crypto_AI_Scanner',
    channelRu: process.env.TELEGRAM_CHANNEL_URL_RU || 'https://t.me/Crypto_AI_Scanner',
    channelEn: process.env.TELEGRAM_CHANNEL_URL_EN || 'https://t.me/crypto_ai_scanner_en'
  });
});

app.delete('/api/telegram/link', authMiddleware, async (req, res) => {
  res.json(await store.unlinkTelegram(req.user));
});

app.post('/api/telegram/digest-test', authMiddleware, async (req, res) => {
  try {
    await runDailyDigest();
    res.json({ success: true, message: 'Digest sent' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const source = (req.query.source || 'all').toLowerCase();
    let news = [];
    if (newsService && typeof newsService.fetchNews === 'function') {
      news = await newsService.fetchNews(30);
    } else {
      const response = await axios.get(
        'https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news&limit=15',
        { timeout: 8000 }
      );
      news = (response.data.results || []).map((item) => ({
        title: item.title,
        source: item.source?.title || 'CryptoPanic',
        url: item.url,
        time: new Date(item.published_at).toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }),
        platform: 'cryptopanic'
      }));
    }
    if (source !== 'all') {
      news = news.filter(
        (n) =>
          (n.platform && n.platform === source) ||
          (n.source && String(n.source).toLowerCase().includes(source))
      );
    }
    res.json({ success: true, news });
  } catch (e) {
    res.json({
      success: true,
      news: [
        {
          title: 'News temporarily unavailable',
          source: 'System',
          url: '#',
          time: '',
          platform: 'system'
        }
      ]
    });
  }
});

app.get('/api/ticker', async (req, res) => {
  try {
    const r = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin,ethereum,solana',
        vs_currencies: 'usd',
        include_24hr_change: 'true'
      },
      timeout: 8000
    });
    const d = r.data || {};
    res.json({
      success: true,
      ticker: [
        {
          id: 'btc',
          symbol: 'BTC',
          price: d.bitcoin?.usd ?? null,
          change24h: d.bitcoin?.usd_24h_change ?? null
        },
        {
          id: 'eth',
          symbol: 'ETH',
          price: d.ethereum?.usd ?? null,
          change24h: d.ethereum?.usd_24h_change ?? null
        },
        {
          id: 'sol',
          symbol: 'SOL',
          price: d.solana?.usd ?? null,
          change24h: d.solana?.usd_24h_change ?? null
        }
      ]
    });
  } catch (e) {
    res.json({
      success: true,
      ticker: [
        { id: 'btc', symbol: 'BTC', price: null, change24h: null },
        { id: 'eth', symbol: 'ETH', price: null, change24h: null },
        { id: 'sol', symbol: 'SOL', price: null, change24h: null }
      ]
    });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const r = await axios.get('https://api.dexscreener.com/token-boosts/top/v1', {
      timeout: 8000
    });
    const list = Array.isArray(r.data) ? r.data : [];
    const tokens = list.slice(0, 12).map((item) => ({
      address: item.tokenAddress || '',
      chainId: item.chainId || ''
    }));
    if (!tokens.length) {
      return res.json({
        success: true,
        tokens: [
          {
            address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
            symbol: 'LINK',
            name: 'Chainlink',
            chainId: 'ethereum',
            price: null
          }
        ]
      });
    }
    const enriched = [];
    for (const t of tokens.slice(0, 8)) {
      try {
        const dx = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${t.address}`,
          { timeout: 5000 }
        );
        const pair = dx.data?.pairs?.[0];
        enriched.push({
          address: t.address,
          chainId: t.chainId,
          symbol: pair?.baseToken?.symbol || 'TOKEN',
          name: pair?.baseToken?.name || '',
          price: pair?.priceUsd || null,
          volume24h: pair?.volume?.h24 || null,
          liquidity: pair?.liquidity?.usd || null
        });
      } catch {
        enriched.push({
          address: t.address,
          chainId: t.chainId,
          symbol: 'TOKEN',
          name: '',
          price: null
        });
      }
    }
    res.json({ success: true, tokens: enriched });
  } catch (e) {
    res.json({
      success: true,
      tokens: [
        {
          address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
          symbol: 'LINK',
          name: 'Chainlink',
          price: null
        }
      ]
    });
  }
});

app.get('/api/chart/:pairAddress', async (req, res) => {
  try {
    const pairAddress = req.params.pairAddress;
    const chainRaw = (req.query.chain || 'eth').toLowerCase();
    const tf = (req.query.tf || '1h').toLowerCase();
    const chainMap = {
      eth: 'eth',
      ethereum: 'eth',
      bsc: 'bsc',
      base: 'base',
      arbitrum: 'arbitrum',
      polygon: 'polygon_pos',
      solana: 'solana'
    };
    const network = chainMap[chainRaw] || 'eth';
    const gtTf = tf === '1d' || tf === '1w' ? 'day' : 'hour';
    const aggregate = tf === '4h' ? 4 : 1;
    const url =
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pairAddress}/ohlcv/${gtTf}` +
      `?aggregate=${aggregate}&limit=100`;
    const r = await axios.get(url, {
      timeout: 10000,
      headers: { Accept: 'application/json' }
    });
    const raw = r.data?.data?.attributes?.ohlcv_list || [];
    const candles = raw
      .map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4])
      }))
      .filter((c) => c.time && c.close)
      .sort((a, b) => a.time - b.time);
    const volumes = raw.map((row) => ({
      time: Number(row[0]),
      value: Number(row[5]) || 0,
      color:
        Number(row[4]) >= Number(row[1])
          ? 'rgba(0, 255, 200, 0.55)'
          : 'rgba(255, 77, 106, 0.55)'
    }));
    res.json({ success: true, source: 'geckoterminal', candles, volumes });
  } catch (e) {
    console.error('[Chart]', e.response?.status || e.message);
    res.json({ success: false, error: 'chart_unavailable', candles: [], volumes: [] });
  }
});

app.get('/api/portfolio/:address', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  if (plan === 'free') {
    return res.json({ success: true, locked: true, message: 'Портфель доступен с Premium' });
  }
  const tokens = [
    { symbol: 'ETH', name: 'Ethereum', value: 6420, riskLevel: 'LOW', riskScore: 15 },
    { symbol: 'USDC', name: 'USD Coin', value: 2800, riskLevel: 'LOW', riskScore: 8 },
    { symbol: 'LINK', name: 'Chainlink', value: 1950, riskLevel: 'LOW', riskScore: 27 },
    { symbol: 'ARB', name: 'Arbitrum', value: 870, riskLevel: 'MEDIUM', riskScore: 41 },
    { symbol: 'PEPE', name: 'Pepe', value: 480, riskLevel: 'HIGH', riskScore: 78 }
  ];
  const totalValue = tokens.reduce((s, t) => s + t.value, 0);
  const avgRisk = Math.round(tokens.reduce((s, t) => s + t.riskScore, 0) / tokens.length);
  res.json({
    success: true,
    plan,
    totalValue,
    tokenCount: tokens.length,
    highRiskCount: tokens.filter((t) => t.riskLevel === 'HIGH').length,
    portfolioRisk: avgRisk,
    riskLevel: avgRisk > 60 ? 'HIGH' : avgRisk > 35 ? 'MEDIUM' : 'LOW',
    tokens,
    source: 'demo'
  });
});

app.post('/api/exchanges/bybit', authMiddleware, async (req, res) => {
  if (getPlan(req.user) === 'free') {
    return res.status(403).json({
      success: false,
      error: 'Bybit доступен с Pro',
      upsell: 'pro'
    });
  }
  const { apiKey, apiSecret, cursor = '', limit = 20 } = req.body;
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ success: false, error: 'API Key и Secret обязательны' });
  }
  try {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const balanceQuery = 'accountType=UNIFIED';
    const balanceSign = createBybitSignature(
      apiSecret,
      timestamp + apiKey + recvWindow + balanceQuery
    );
    const balanceRes = await axios.get('https://api.bybit.com/v5/account/wallet-balance', {
      params: { accountType: 'UNIFIED' },
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': balanceSign,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow
      }
    });
    let tradesQuery = `category=linear&limit=${limit}`;
    if (cursor) tradesQuery += `&cursor=${cursor}`;
    const tradesSign = createBybitSignature(
      apiSecret,
      timestamp + apiKey + recvWindow + tradesQuery
    );
    const tradesParams = { category: 'linear', limit: Number(limit) };
    if (cursor) tradesParams.cursor = cursor;
    const tradesRes = await axios.get('https://api.bybit.com/v5/execution/list', {
      params: tradesParams,
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': tradesSign,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow
      }
    });
    const coins = balanceRes.data?.result?.list?.[0]?.coin || [];
    const balances = coins
      .filter((c) => parseFloat(c.equity) > 0)
      .map((c) => ({
        coin: c.coin,
        equity: parseFloat(c.equity).toFixed(6),
        available: parseFloat(c.availableToWithdraw || c.walletBalance || 0).toFixed(6)
      }));
    const totalEquity = coins.reduce((sum, c) => sum + parseFloat(c.usdValue || 0), 0);
    const rawTrades = tradesRes.data?.result?.list || [];
    const nextCursor = tradesRes.data?.result?.nextPageCursor || null;
    res.json({
      success: true,
      exchange: 'Bybit',
      totalEquityUsd: Math.round(totalEquity * 100) / 100,
      balances,
      trades: rawTrades.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        price: parseFloat(t.execPrice),
        qty: parseFloat(t.execQty),
        value: parseFloat(t.execValue || t.execPrice * t.execQty),
        fee: parseFloat(t.execFee || 0),
        time: new Date(parseInt(t.execTime)).toLocaleString('ru-RU'),
        orderId: t.orderId
      })),
      nextCursor,
      hasMore: !!nextCursor
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.retMsg || error.message || 'Ошибка Bybit'
    });
  }
});

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  if (getPlan(req.user) !== 'pro') {
    return res.status(403).json({
      success: false,
      error: 'AI-чат доступен только на тарифе Pro',
      upsell: 'pro'
    });
  }
  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ success: false, error: 'Нет сообщений' });
  }
  try {
    const result = await aiService.chat(messages.slice(-12), context || {});
    res.json({ success: true, reply: result.reply, demo: result.demo || false });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка AI' });
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Crypto AI Scanner backend running on http://localhost:${PORT}`);
      startAlertWorker(60000);
      startTelegramPolling(tgLinkCodes);
      startDigestWorker();
    });
  } catch (e) {
    console.error('[DB] Failed to start:', e.message);
    process.exit(1);
  }
}

start();
