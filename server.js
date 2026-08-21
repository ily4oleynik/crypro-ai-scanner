require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const aiService = require('./services/ai.js');
const { initDb } = require('./db');
const store = require('./store');
const { startAlertWorker } = require('./alertWorker');
const { startTelegramPolling } = require('./tgPoll');
const { startDigestWorker, runDailyDigest } = require('./digestWorker');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'crypto-ai-scanner-secret-key-change-me-in-production';

app.use(cors());
app.use(express.json());

// Раздача frontend из корня репозитория (index.html, app.js, style.css)
app.use(express.static(__dirname));

const tgLinkCodes = new Map();

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

function createBybitSignature(apiSecret, payload) {
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await store.findUserByEmail(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, plan: user.plan }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/register', async (req, res) => {
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
      { id: user.id, email: user.email, plan: user.plan },
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
});

// ===== SCAN =====
app.get('/api/scan/:tokenAddress', authMiddleware, async (req, res) => {
  const { tokenAddress } = req.params;
  const plan = (req.query.plan || req.user?.plan || 'free').toLowerCase();

  try {
    const usage = await store.canScan(req.user);
    if (!usage.allowed) {
      return res.status(429).json({
        success: false,
        error: `Лимит сканов на сегодня исчерпан (${usage.used}/${usage.limit}). Обновите тариф.`,
        usage
      });
    }

    const dexResponse = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
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
      twitter: pair.info?.socials?.find(s => s.type === 'twitter')?.url || null,
      telegram: pair.info?.socials?.find(s => s.type === 'telegram')?.url || null
    };

    let riskScore = 58;
    let riskLevel = 'MEDIUM';
    let confidence = 55;
    let aiText = 'Краткий анализ: средние показатели. Полный отчёт в Premium.';
    let aiVerdict = 'Ограниченный доступ';

    if (plan === 'premium' || plan === 'pro') {
      riskScore = plan === 'pro' ? 74 : 67;
      riskLevel = plan === 'pro' ? 'LOW' : 'MEDIUM';
      const ai = await aiService.analyzeToken(base, { riskScore, riskLevel });
      aiText = ai.text;
      aiVerdict = ai.verdict;
      confidence = ai.confidence || (plan === 'pro' ? 89 : 78);
    }

    await store.incrementScan(req.user);
    await store.addHistory(req.user, {
      address: tokenAddress,
      symbol: base.symbol,
      name: base.name,
      price: base.price,
      riskScore,
      plan
    });

    const currentUsage = await store.canScan(req.user);

    if (plan === 'free') {
      return res.json({
        success: true,
        plan: 'Free',
        token: {
          symbol: base.symbol,
          name: base.name,
          price: base.price,
          liquidity: base.liquidity,
          volume24h: base.volume24h
        },
        risk: { riskScore, riskLevel, confidence },
        ai: { text: aiText, confidence, verdict: aiVerdict },
        locked: true,
        usage: currentUsage
      });
    }

    if (plan === 'premium') {
      return res.json({
        success: true,
        plan: 'Premium',
        token: base,
        risk: { riskScore, riskLevel, confidence },
        ai: { text: aiText, confidence, verdict: aiVerdict },
        security: {
          contractVerified: base.isVerified,
          liquidityLock: false,
          scamProbability: 22
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
      risk: { riskScore, riskLevel, confidence },
      ai: { text: aiText, confidence, verdict: aiVerdict },
      security: {
        contractVerified: base.isVerified,
        liquidityLock: false,
        scamProbability: 14
      },
      projectLinks: {
        website: base.website,
        twitter: base.twitter,
        telegram: base.telegram
      },
      advanced: {
        whaleConcentration: '19%',
        buySellRatio: '1.38',
        volatility: '16.2%',
        holderCount: '2 140+'
      },
      usage: currentUsage
    });
  } catch (error) {
    console.error(error.message);
    res.json({
      success: true,
      plan,
      token: { symbol: tokenAddress.slice(0, 8) + '...' },
      risk: { riskScore: 50, riskLevel: 'MEDIUM', confidence: 40 },
      ai: { text: 'Не удалось загрузить данные', confidence: 30, verdict: 'Ошибка' },
      usage: await store.canScan(req.user)
    });
  }
});

app.get('/api/usage', authMiddleware, async (req, res) => {
  res.json({ success: true, usage: await store.canScan(req.user) });
});

app.get('/api/history', authMiddleware, async (req, res) => {
  res.json({ success: true, history: await store.getHistory(req.user) });
});

app.get('/api/watchlist', authMiddleware, async (req, res) => {
  res.json({ success: true, watchlist: await store.getWatchlist(req.user) });
});

app.post('/api/watchlist', authMiddleware, async (req, res) => {
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
  const { addresses } = req.body;
  if (!Array.isArray(addresses) || addresses.length < 2 || addresses.length > 3) {
    return res.status(400).json({ success: false, error: 'Передайте 2–3 адреса' });
  }
  try {
    const results = [];
    for (const addr of addresses) {
      const dex = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
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

// ===== TELEGRAM =====
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
    expiresIn: 600
  });
});

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
  const chatId = await store.getTelegramChatId(req.user);
  res.json({ success: true, linked: !!chatId, chatId: chatId || null });
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
    const response = await axios.get(
      'https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news&limit=10'
    );
    const news = (response.data.results || []).map(item => ({
      title: item.title,
      source: item.source?.title || 'CryptoPanic',
      url: item.url,
      time: new Date(item.published_at).toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
    }));
    res.json({ success: true, news });
  } catch (e) {
    res.json({
      success: true,
      news: [{ title: 'Bitcoin consolidates above key support', source: 'CoinDesk', time: '2h ago', url: '#' }]
    });
  }
});

app.get('/api/portfolio/:address', authMiddleware, async (req, res) => {
  const plan = (req.user?.plan || 'free').toLowerCase();
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
  const highRiskCount = tokens.filter(t => t.riskLevel === 'HIGH').length;
  const avgRisk = Math.round(tokens.reduce((s, t) => s + t.riskScore, 0) / tokens.length);
  res.json({
    success: true,
    plan,
    totalValue,
    tokenCount: tokens.length,
    highRiskCount,
    portfolioRisk: avgRisk,
    riskLevel: avgRisk > 60 ? 'HIGH' : avgRisk > 35 ? 'MEDIUM' : 'LOW',
    tokens,
    source: 'demo'
  });
});

app.post('/api/exchanges/bybit', authMiddleware, async (req, res) => {
  const { apiKey, apiSecret, cursor = '', limit = 20 } = req.body;
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ success: false, error: 'API Key и Secret обязательны' });
  }
  try {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const balanceQuery = 'accountType=UNIFIED';
    const balanceSign = createBybitSignature(apiSecret, timestamp + apiKey + recvWindow + balanceQuery);
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
    const tradesSign = createBybitSignature(apiSecret, timestamp + apiKey + recvWindow + tradesQuery);
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
      .filter(c => parseFloat(c.equity) > 0)
      .map(c => ({
        coin: c.coin,
        equity: parseFloat(c.equity).toFixed(6),
        available: parseFloat(c.availableToWithdraw || c.walletBalance || 0).toFixed(6)
      }));
    const totalEquity = coins.reduce((sum, c) => sum + parseFloat(c.usdValue || 0), 0);
    const rawTrades = tradesRes.data?.result?.list || [];
    const nextCursor = tradesRes.data?.result?.nextPageCursor || null;
    const trades = rawTrades.map(t => ({
      symbol: t.symbol,
      side: t.side,
      price: parseFloat(t.execPrice),
      qty: parseFloat(t.execQty),
      value: parseFloat(t.execValue || t.execPrice * t.execQty),
      fee: parseFloat(t.execFee || 0),
      time: new Date(parseInt(t.execTime)).toLocaleString('ru-RU'),
      orderId: t.orderId
    }));
    res.json({
      success: true,
      exchange: 'Bybit',
      totalEquityUsd: Math.round(totalEquity * 100) / 100,
      balances,
      trades,
      nextCursor,
      hasMore: !!nextCursor
    });
  } catch (error) {
    console.error('Bybit error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.retMsg || error.message || 'Ошибка Bybit'
    });
  }
});

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  if ((req.user?.plan || 'free').toLowerCase() !== 'pro') {
    return res.status(403).json({ success: false, error: 'AI-чат доступен только на тарифе Pro' });
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

// SPA fallback — ПОСЛЕ всех /api маршрутов
// SPA fallback (совместимо с Express 5)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  // статика (css/js) уже отдаётся express.static
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
