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

let goplus = null;
try {
  goplus = require('./services/goplus');
} catch (e) {
  console.warn('[GoPlus] services/goplus.js not found — security flags disabled');
}

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

/** DexScreener helpers
 * IMPORTANT: /latest/dex/tokens/0xdac17f… returns ONLY pulsechain pairs
 * (same address on Pulse). Real ETH USDT needs:
 *   /token-pairs/v1/ethereum/{address}
 */
const dexCache = new Map();
const ETH_CANON_ADDR = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': true,
  '0xdac17f958d2ee523a2206206994597c13d831ec7': true,
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': true,
  '0x514910771af9ca656af840dff83e8264ecf986ca': true,
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': true,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': true
};

async function fetchDexPairs(tokenAddress, preferredChain) {
  const addr = String(tokenAddress || '').trim();
  const keyBase = addr.toLowerCase();
  const chainHint = String(preferredChain || '').toLowerCase().trim();
  const forceEth =
    !!ETH_CANON_ADDR[keyBase] || chainHint === 'ethereum' || chainHint === 'eth';
  const cacheKey = keyBase + '|' + (forceEth ? 'eth' : chainHint || 'any');
  const hit = dexCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 90_000) return hit.pairs;

  async function getPairs(url) {
    const dexResponse = await axios.get(url, {
      timeout: 14000,
      headers: { Accept: 'application/json' }
    });
    const data = dexResponse.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data && data.pairs)) return data.pairs;
    return [];
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(function (r) {
          setTimeout(r, 700 * attempt + Math.floor(Math.random() * 400));
        });
      }
      let pairs = [];

      if (forceEth) {
        try {
          pairs = await getPairs(
            'https://api.dexscreener.com/token-pairs/v1/ethereum/' +
              encodeURIComponent(addr)
          );
        } catch (e1) {
          console.warn('[dex] eth token-pairs', e1.response && e1.response.status || e1.message);
        }
      } else if (chainHint && chainHint !== 'auto') {
        try {
          pairs = await getPairs(
            'https://api.dexscreener.com/token-pairs/v1/' +
              encodeURIComponent(chainHint) +
              '/' +
              encodeURIComponent(addr)
          );
        } catch (e1) {
          console.warn('[dex] chain token-pairs', e1.response && e1.response.status || e1.message);
        }
      }

      if (!pairs.length) {
        pairs = await getPairs(
          'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(addr)
        );
        if (forceEth) {
          const ethOnly = pairs.filter(function (p) {
            const c = String(p.chainId || '').toLowerCase();
            return c === 'ethereum' || c === 'eth';
          });
          pairs = ethOnly.length
            ? ethOnly
            : pairs.filter(function (p) {
                const c = String(p.chainId || '').toLowerCase();
                return c !== 'pulsechain' && c !== 'pulse';
              });
        }
      }

      if (pairs.length) {
        dexCache.set(cacheKey, { ts: Date.now(), pairs: pairs });
        if (dexCache.size > 200) {
          const first = dexCache.keys().next().value;
          dexCache.delete(first);
        }
      }
      return pairs;
    } catch (e) {
      lastErr = e;
      const st = e.response && e.response.status;
      if (st !== 429 && st !== 503) break;
      console.warn('[dex] retry', attempt + 1, st || e.message);
    }
  }
  if (hit && hit.pairs) {
    console.warn('[dex] using stale cache after errors');
    return hit.pairs;
  }
  throw lastErr || new Error('DexScreener unavailable');
}
const _jwtEnv = process.env.JWT_SECRET || '';
if (!_jwtEnv && (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT)) {
  console.error('[FATAL] JWT_SECRET is required in production. Set it in Railway Variables.');
  process.exit(1);
}
const JWT_SECRET = _jwtEnv || 'dev-only-insecure-secret-change-me';

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
app.use(
  cors(
    allowedOrigins.length
      ? {
          origin: function (origin, cb) {
            if (!origin || allowedOrigins.indexOf(origin) !== -1) cb(null, true);
            else cb(null, false);
          },
          credentials: true
        }
      : undefined
  )
);
app.use(express.json({ limit: '256kb' }));
app.use(function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' https://fonts.gstatic.com data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' https://telegram.org https://unpkg.com https://cdn.jsdelivr.net",
      "connect-src 'self' https://api.dexscreener.com https://api.gopluslabs.io https://api.honeypot.is https://api.telegram.org https://api.groq.com https://openrouter.ai https://*.railway.app",
      "frame-src https://oauth.telegram.org https://telegram.org"
    ].join('; ')
  );
  next();
});

// CRITICAL: never serve backend sources or node_modules
app.use(function blockBackendSources(req, res, next) {
  const p = String(req.path || '').toLowerCase();
  const blocked =
    p === '/server.js' ||
    p === '/store.js' ||
    p === '/db.js' ||
    p === '/tgpoll.js' ||
    p === '/telegram.js' ||
    p === '/alertworker.js' ||
    p === '/digestworker.js' ||
    p === '/news.js' ||
    p === '/routes-extras.js' ||
    p === '/package.json' ||
    p === '/package-lock.json' ||
    p === '/.env' ||
    p === '/dockerfile' ||
    p.startsWith('/node_modules') ||
    p.startsWith('/services/') ||
    p.startsWith('/backend/');
  if (blocked) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
// Prefer public/; if missing on deploy, serve allowlisted frontend from root
// (backend files still blocked by blockBackendSources above)
const staticRoot = fs.existsSync(path.join(publicDir, 'index.html'))
  ? publicDir
  : __dirname;
console.log('[static] serving from', staticRoot === publicDir ? 'public/' : 'project root (fallback)');
app.use(
  express.static(staticRoot, {
    index: false,
    dotfiles: 'deny',
    fallthrough: true
  })
);

const tgLinkCodes = new Map();
const rateBuckets = new Map();

const PLAN_LIMITS = {
  free: { watchlist: 5, historyDays: 7 },
  premium: { watchlist: 30, historyDays: null },
  pro: { watchlist: 999999, historyDays: null }
};

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (e) {
      out[k] = v;
    }
  });
  return out;
}

function signUserToken(user) {
  const owner = isOwnerEmail(user.email);
  return jwt.sign(
    {
      id: user.id,
      email: user.email || null,
      plan: owner ? 'pro' : String(user.plan || 'free').toLowerCase(),
      isOwner: owner
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(res, tokenJwt) {
  const secure =
    String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ||
    process.env.NODE_ENV === 'production';
  const parts = [
    'cas_token=' + encodeURIComponent(tokenJwt),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + String(7 * 24 * 60 * 60)
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
  const secure =
    String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ||
    process.env.NODE_ENV === 'production';
  const parts = [
    'cas_token=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return null;
}

function authMiddleware(req, res, next) {
  let raw = extractBearer(req);
  // Ignore bogus client headers like "Bearer null" / "Bearer undefined"
  if (raw === 'null' || raw === 'undefined' || raw === '') raw = null;

  const cookies = parseCookies(req);
  const cookieTok = cookies.cas_token || null;

  // Prefer valid JWT from header; on failure fall back to cookie
  let user = null;
  if (raw) {
    try {
      user = jwt.verify(raw, JWT_SECRET);
    } catch (e) {
      user = null;
    }
  }
  if (!user && cookieTok) {
    try {
      user = jwt.verify(cookieTok, JWT_SECRET);
    } catch (e) {
      user = null;
    }
  }
  if (!user) {
    req.user = { plan: 'free' };
    return next();
  }
  req.user = user;
  if (req.user && isOwnerEmail(req.user.email)) {
    req.user.plan = 'pro';
    req.user.isOwner = true;
  }
  next();
}

function ownerEmails() {
  return String(process.env.OWNER_EMAILS || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(function (e) {
      return e.trim().toLowerCase();
    })
    .filter(Boolean);
}

function isOwnerEmail(email) {
  if (!email) return false;
  return ownerEmails().includes(String(email).trim().toLowerCase());
}

function getPlan(user) {
  if (!user) return 'free';
  if (user.isOwner || isOwnerEmail(user.email)) return 'pro';
  const p = String(user.plan || 'free').toLowerCase();
  if (p === 'owner' || p === 'admin') return 'pro';
  return p;
}

/** Ensure creator accounts stay on Pro in DB */
async function ensureOwnerPlan(user) {
  if (!user || !user.email || !isOwnerEmail(user.email)) return user;
  try {
    if (store.updateUserPlan) {
      await store.updateUserPlan(user, 'pro');
    }
  } catch (e) {
    console.warn('[owner] plan update:', e.message);
  }
  return Object.assign({}, user, { plan: 'pro', isOwner: true });
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


/* ===================== BILLING (skeleton — enable with PAYMENTS_ENABLED=true) ===================== */
app.get('/api/billing/status', authMiddleware, (req, res) => {
  const paymentsEnabled =
    String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true' &&
    !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
  const plan = getPlan(req.user);
  res.json({
    success: true,
    paymentsEnabled,
    provider: paymentsEnabled ? 'yookassa' : null,
    plan: plan,
    canCancel: !!(req.user?.id) && plan !== 'free' && !isOwnerEmail(req.user?.email),
    prices: { premium: '19', pro: '39', currency: 'USD', rub: { premium: '1900.00', pro: '3900.00' } },
    message: paymentsEnabled
      ? 'Payments ready'
      : 'Payments not enabled — use waitlist'
  });
});

app.post(
  '/api/billing/create-payment',
  authMiddleware,
  rateLimit({ windowMs: 60_000, max: 5, keyFn: (req) => 'pay:' + clientIp(req) }),
  async (req, res) => {
    const paymentsEnabled =
      String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true' &&
      !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
    if (!paymentsEnabled) {
      return res.status(503).json({
        success: false,
        error: 'Оплата ещё не подключена. Оставьте email в waitlist.',
        waitlist: true
      });
    }
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Войдите в аккаунт' });
    }
    const plan = String(req.body.plan || '').toLowerCase();
    const prices = { premium: 1900, pro: 3900 }; // display helper; actual charge via amounts
    // YooKassa amount value is string major units "29.00"
    const amounts = { premium: '1900.00', pro: '3900.00' }; // RUB ≈ $19 / $39
    if (!amounts[plan]) {
      return res.status(400).json({ success: false, error: 'Неверный тариф' });
    }
    try {
      const idempotenceKey = crypto.randomUUID();
      const shopId = process.env.YOOKASSA_SHOP_ID;
      const secret = process.env.YOOKASSA_SECRET_KEY;
      const returnUrl =
        process.env.PAYMENT_RETURN_URL ||
        process.env.PUBLIC_URL ||
        'https://crypro-ai-scanner-production-6ecd.up.railway.app/';
      const auth = Buffer.from(shopId + ':' + secret).toString('base64');
      const customerEmail = String(req.user.email || req.body.email || '').trim();
      if (!customerEmail || !customerEmail.includes('@')) {
        return res.status(400).json({
          success: false,
          error: 'Для чека нужен email в аккаунте. Укажите email при регистрации или в кабинете.'
        });
      }
      // 54-FZ receipt required when "Чеки от ЮKassa" is enabled
      // vat_code 1 = без НДС (типично для УСН)
      const itemTitle =
        plan === 'pro'
          ? 'Подписка Crypto AI Scanner Pro, 30 дней'
          : 'Подписка Crypto AI Scanner Premium, 30 дней';
      const payload = {
        amount: { value: amounts[plan], currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: String(returnUrl).replace(/\/?$/, '/') + '?paid=1&plan=' + plan
        },
        capture: true,
        description: itemTitle,
        metadata: {
          userId: String(req.user.id),
          plan: plan,
          email: customerEmail
        },
        receipt: {
          customer: { email: customerEmail },
          items: [
            {
              description: itemTitle.slice(0, 128),
              quantity: '1.00',
              amount: { value: amounts[plan], currency: 'RUB' },
              vat_code: 1,
              payment_mode: 'full_payment',
              payment_subject: 'service'
            }
          ]
        }
      };
      const r = await axios.post('https://api.yookassa.ru/v3/payments', payload, {
        headers: {
          Authorization: 'Basic ' + auth,
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey
        },
        timeout: 15000
      });
      const conf = r.data && r.data.confirmation;
      res.json({
        success: true,
        paymentId: r.data.id,
        confirmationUrl: conf && conf.confirmation_url
      });
    } catch (e) {
      console.error('[billing]', e.response?.data || e.message);
      const yooErr =
        e.response?.data?.description ||
        (e.response?.data?.code ? String(e.response.data.code) : null) ||
        e.message;
      res.status(500).json({
        success: false,
        error: yooErr || 'Payment error'
      });
    }
  }
);

async function yookassaAuthHeader() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secret) return null;
  return 'Basic ' + Buffer.from(shopId + ':' + secret).toString('base64');
}

/** Fetch payment from YooKassa and activate plan if succeeded */
async function activatePlanFromYooPayment(paymentId, expectedUserId) {
  const auth = await yookassaAuthHeader();
  if (!auth || !paymentId) return { ok: false, error: 'no_payment' };
  const r = await axios.get('https://api.yookassa.ru/v3/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: auth },
    timeout: 12000
  });
  const pay = r.data || {};
  if (pay.status !== 'succeeded') {
    return { ok: false, status: pay.status || 'unknown', error: 'not_succeeded' };
  }
  const meta = pay.metadata || {};
  const userId = String(meta.userId || '');
  const plan = String(meta.plan || '').toLowerCase();
  if (expectedUserId && userId && String(expectedUserId) !== userId) {
    return { ok: false, error: 'user_mismatch' };
  }
  if (!userId || (plan !== 'premium' && plan !== 'pro')) {
    return { ok: false, error: 'bad_metadata' };
  }
  await store.updateUserPlan({ id: userId }, plan);
  console.log('[billing] plan activated', userId, plan, paymentId);
  return { ok: true, plan: plan, userId: userId, paymentId: paymentId };
}

app.post('/api/billing/webhook', express.json(), async (req, res) => {
  try {
    const allowIps = String(process.env.YOOKASSA_WEBHOOK_IPS || '')
      .split(',')
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (allowIps.length) {
      const ip = clientIp(req);
      if (allowIps.indexOf(ip) === -1) {
        console.warn('[billing webhook] rejected IP', ip);
        return res.status(403).json({ ok: false });
      }
    }
    const hookSecret = process.env.YOOKASSA_WEBHOOK_SECRET || '';
    if (hookSecret) {
      const given = String(req.headers['x-webhook-secret'] || req.query.secret || '');
      if (given !== hookSecret) {
        console.warn('[billing webhook] bad secret');
        return res.status(403).json({ ok: false });
      }
    }
    const event = req.body || {};
    const obj = event.object || {};
    const eventName = String(event.event || '');
    // Activate on succeeded; also try if object already succeeded
    if (
      eventName === 'payment.succeeded' ||
      (obj && obj.status === 'succeeded')
    ) {
      const paymentId = obj.id;
      if (paymentId) {
        try {
          await activatePlanFromYooPayment(paymentId, null);
        } catch (e) {
          // Fallback: trust webhook body metadata if API re-fetch fails
          console.warn('[billing webhook] re-fetch failed, metadata fallback', e.message);
          const userId = obj.metadata && obj.metadata.userId;
          const plan = String((obj.metadata && obj.metadata.plan) || '').toLowerCase();
          if (userId && (plan === 'premium' || plan === 'pro')) {
            await store.updateUserPlan({ id: userId }, plan);
            console.log('[billing] plan updated (fallback)', userId, plan);
          }
        }
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[billing webhook]', e.message);
    res.status(200).json({ ok: true });
  }
});

/** Client return from YooKassa: confirm payment by id and set plan (webhook backup) */
app.post(
  '/api/billing/sync',
  authMiddleware,
  rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => 'paysync:' + clientIp(req) }),
  async (req, res) => {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Login required' });
    }
    const paymentId = String(req.body?.paymentId || req.query.paymentId || '').trim();
    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'paymentId required' });
    }
    try {
      const result = await activatePlanFromYooPayment(paymentId, String(req.user.id));
      if (!result.ok) {
        // Still allow: if payment succeeded for this user after retries
        return res.json({
          success: false,
          pending: result.status === 'pending' || result.status === 'waiting_for_capture',
          status: result.status || null,
          error: result.error || 'not_activated',
          plan: getPlan(req.user)
        });
      }
      const plan = result.plan;
      const tokenJwt = jwt.sign(
        {
          id: req.user.id,
          email: req.user.email || '',
          plan: plan,
          isOwner: isOwnerEmail(req.user.email)
        },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      setAuthCookie(res, tokenJwt);
      res.json({
        success: true,
        plan: plan,
        paymentId: paymentId,
        user: { id: req.user.id, email: req.user.email, plan: plan }
      });
    } catch (e) {
      console.error('[billing sync]', e.response?.data || e.message);
      res.status(500).json({
        success: false,
        error: e.response?.data?.description || e.message
      });
    }
  }
);



app.post(
  '/api/billing/cancel',
  authMiddleware,
  rateLimit({ windowMs: 60_000, max: 5, keyFn: (req) => 'paycancel:' + clientIp(req) }),
  async (req, res) => {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Login required' });
    }
    try {
      // Soft cancel: downgrade to free at end of period (we store plan only — immediate free)
      await store.updateUserPlan(req.user, 'free');
      const tokenJwt = jwt.sign(
        {
          id: req.user.id,
          email: req.user.email || '',
          plan: 'free',
          isOwner: isOwnerEmail(req.user.email)
        },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      setAuthCookie(res, tokenJwt);
      console.log('[billing] cancelled plan for', req.user.id);
      res.json({
        success: true,
        plan: 'free',
        message: 'Subscription cancelled. Plan set to Free.'
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

/* ===================== PUBLIC ===================== */

app.get('/api/config/public', (req, res) => {
  const paymentsEnabled =
    String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true' &&
    !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
  res.json({
    success: true,
    paymentsEnabled,
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || 'aicryptoscreenerbot',
    usdtTrc20: process.env.USDT_TRC20_ADDRESS || 'TLZS82t13Qvvo9egwu7LXE8VJQgFduMFNp',
    pricesUsd: { premium: 19, pro: 39 },
    channelRu: process.env.TELEGRAM_CHANNEL_URL_RU || 'https://t.me/Crypto_AI_Scanner',
    channelEn: process.env.TELEGRAM_CHANNEL_URL_EN || 'https://t.me/crypto_ai_scanner_en',
    allowDemoPlans: String(process.env.ALLOW_DEMO_PLANS || '').toLowerCase() === 'true'
  });
});

/* ===================== GOPLUS SECURITY ===================== */

app.get(
  '/api/security/:chain/:address',
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyFn: (req) => 'sec:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      if (!goplus) {
        return res.json({
          success: true,
          security: { available: false, error: 'GoPlus module not loaded', flags: [] }
        });
      }
      const chain = req.params.chain;
      const address = req.params.address;
      if (!address || address.length < 4) {
        return res.status(400).json({ success: false, error: 'Invalid address' });
      }
      const security = await goplus.fetchTokenSecurity(chain, address);
      res.json({ success: true, security });
    } catch (e) {
      console.error('[security]', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

app.post('/api/security/check', async (req, res) => {
  try {
    if (!goplus) {
      return res.json({
        success: true,
        security: { available: false, flags: [] }
      });
    }
    const { chain, address } = req.body || {};
    if (!address) {
      return res.status(400).json({ success: false, error: 'address required' });
    }
    const security = await goplus.fetchTokenSecurity(chain || 'ethereum', address);
    res.json({ success: true, security });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ===================== AUTH ===================== */

app.post(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60_000,
    max: 8,
    keyFn: (req) => 'login:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await store.findUserByEmail(email);
      if (!user || !(await store.verifyPassword(user, password))) {
        return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
      }
      const owner = isOwnerEmail(user.email);
      if (owner) {
        try {
          await store.updateUserPlan(user, 'pro');
          user.plan = 'pro';
        } catch (e) {}
      }
      const plan = owner ? 'pro' : user.plan || 'free';
      const tokenJwt = signUserToken({
        id: user.id,
        email: user.email,
        plan: plan
      });
      setAuthCookie(res, tokenJwt);
      res.json({
        success: true,
        token: tokenJwt,
        user: { id: user.id, email: user.email, plan: plan, isOwner: owner },
        auth: 'cookie'
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
      let { email, password, acceptTerms } = req.body || {};
      email = String(email || '')
        .trim()
        .toLowerCase();
      password = String(password || '');
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Укажите email и пароль' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Некорректный email' });
      }
      if (password.length < 8) {
        return res.status(400).json({ success: false, error: 'Пароль не короче 8 символов' });
      }
      if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          success: false,
          error: 'Пароль: хотя бы одна буква и одна цифра'
        });
      }
      if (!acceptTerms) {
        return res.status(400).json({
          success: false,
          error: 'Нужно принять условия использования'
        });
      }
      if (await store.findUserByEmail(email)) {
        return res.status(400).json({
          success: false,
          error: 'Аккаунт с таким email уже есть. Войдите.'
        });
      }
      const owner = isOwnerEmail(email);
      const startPlan = owner ? 'pro' : 'free';
      const user = await store.createUser(email, password, startPlan);
      if (owner) {
        try {
          await store.updateUserPlan(user, 'pro');
        } catch (e) {}
      }
      const tokenJwt = signUserToken({
        id: user.id,
        email: user.email,
        plan: startPlan
      });
      setAuthCookie(res, tokenJwt);
      res.json({
        success: true,
        token: tokenJwt,
        user: {
          id: user.id,
          email: user.email,
          plan: startPlan,
          isOwner: owner
        },
        auth: 'cookie'
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: 'Ошибка регистрации' });
    }
  }
);




/** One-time owner password reset — requires OWNER_SECRET, no login */
app.post(
  '/api/admin/reset-password',
  rateLimit({ windowMs: 60 * 60_000, max: 5, keyFn: (req) => 'pwreset:' + clientIp(req) }),
  async (req, res) => {
    const secret = process.env.OWNER_SECRET || process.env.ADMIN_SECRET || '';
    const given = String(req.body?.secret || req.headers['x-owner-secret'] || '');
    if (!secret || given !== secret) {
      return res.status(403).json({ success: false, error: 'Invalid owner secret' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || req.body?.newPassword || '');
    if (!email || password.length < 8) {
      return res.status(400).json({ success: false, error: 'email + password (min 8) required' });
    }
    if (!store.setUserPassword) {
      return res.status(500).json({ success: false, error: 'setUserPassword not available' });
    }
    try {
      const result = await store.setUserPassword(email, password);
      if (!result.success) {
        return res.status(404).json(result);
      }
      console.log('[owner] password reset for', email);
      res.json({ success: true, message: 'Password updated. You can login now.', email: result.email });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
);

/** Creator claim: set plan=pro for logged-in user if OWNER_SECRET matches */
app.post(
  '/api/admin/claim-owner',
  rateLimit({ windowMs: 60 * 60_000, max: 5, keyFn: (req) => 'owner:' + (typeof clientIp === 'function' ? clientIp(req) : req.ip) }),
  authMiddleware,
  async (req, res) => {
  const secret = process.env.OWNER_SECRET || process.env.ADMIN_SECRET || '';
  const given = String(req.body?.secret || req.headers['x-owner-secret'] || '');
  if (!secret || given !== secret) {
    return res.status(403).json({ success: false, error: 'Invalid owner secret' });
  }
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Login first' });
  }
  try {
    await store.updateUserPlan(req.user, 'pro');
    const email = req.user.email || '';
    console.log('[owner] claimed by', email || req.user.id);
    const tokenJwt = jwt.sign(
      {
        id: req.user.id,
        email: email,
        plan: 'pro',
        isOwner: true
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    setAuthCookie(res, tokenJwt);
    res.json({
      success: true,
      user: { id: req.user.id, email: email, plan: 'pro', isOwner: true },
      message: 'Owner access granted (Pro forever until you change OWNER_EMAILS)'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.json({ success: true, user: null });
  }
  try {
    let plan = req.user.plan || 'free';
    let email = req.user.email || null;
    let isOwner = false;
    if (email) {
      const u = await store.findUserByEmail(email);
      if (u) {
        plan = u.plan || plan;
        email = u.email || email;
      }
    }
    if (isOwnerEmail(email)) {
      isOwner = true;
      plan = 'pro';
      try {
        await store.updateUserPlan({ id: req.user.id, email: email }, 'pro');
      } catch (e) {}
    }
    res.json({
      success: true,
      user: { id: req.user.id, email: email, plan: plan, isOwner: isOwner }
    });
  } catch (e) {
    const email = req.user.email || null;
    const isOwner = isOwnerEmail(email);
    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: email,
        plan: isOwner ? 'pro' : req.user.plan || 'free',
        isOwner: isOwner
      }
    });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

/** Verify Telegram Login Widget payload (HMAC-SHA256) */
function verifyTelegramLogin(data) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!botToken || !data || !data.hash) return false;
  const check = { ...data };
  delete check.hash;
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const str = Object.keys(check)
    .sort()
    .map((k) => k + '=' + check[k])
    .join('\n');
  const hmac = crypto.createHmac('sha256', secret).update(str).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(String(data.hash), 'hex'));
  } catch (e) {
    return hmac === data.hash;
  }
}

app.post(
  '/api/auth/telegram',
  rateLimit({
    windowMs: 15 * 60_000,
    max: 40,
    keyFn: (req) => 'tgauth:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      const data = req.body || {};
      if (!verifyTelegramLogin(data)) {
        return res.status(401).json({ success: false, error: 'Неверная подпись Telegram' });
      }
      const authDate = Number(data.auth_date) || 0;
      if (!authDate || Date.now() / 1000 - authDate > 86400) {
        return res.status(401).json({ success: false, error: 'Сессия Telegram устарела, войдите снова' });
      }
      if (!data.id) {
        return res.status(400).json({ success: false, error: 'Нет Telegram id' });
      }

      const user = await store.createUserFromTelegram({
        telegramId: data.id,
        username: data.username || '',
        firstName: data.first_name || '',
        lastName: data.last_name || ''
      });
      if (!user) {
        return res.status(500).json({ success: false, error: 'Не удалось создать аккаунт' });
      }

      const tokenJwt = signUserToken({
        id: user.id,
        email: user.email,
        plan: isOwnerEmail(user.email) ? 'pro' : (user.plan || 'free')
      });
      setAuthCookie(res, tokenJwt);
      res.json({
        success: true,
        token: tokenJwt,
        auth: 'cookie',
        user: {
          id: user.id,
          email: user.email,
          plan: isOwnerEmail(user.email) ? 'pro' : (user.plan || 'free'),
          telegramId: String(data.id),
          name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || ''
        }
      });
    } catch (e) {
      console.error('[auth/telegram]', e.message);
      res.status(500).json({ success: false, error: 'Ошибка входа через Telegram' });
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
  // Production: disable free self-upgrade to paid until payments
  const allowDemo = String(process.env.ALLOW_DEMO_PLANS || '').toLowerCase() === 'true';
  if (!allowDemo && plan !== 'free') {
    return res.status(403).json({
      success: false,
      error: 'Демо-тарифы отключены. Оставьте email в waitlist — оплата скоро.',
      waitlist: true
    });
  }
  try {
    const updated = await store.updateUserPlan(req.user, plan);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Не удалось обновить тариф' });
    }
    const tokenJwt = signUserToken({
      id: updated.id,
      email: updated.email,
      plan: updated.plan
    });
    setAuthCookie(res, tokenJwt);
    res.json({
      success: true,
      plan: updated.plan,
      token: tokenJwt,
      user: { id: updated.id, email: updated.email, plan: updated.plan },
      note: allowDemo ? 'Демо-активация (ALLOW_DEMO_PLANS=true)' : undefined,
      auth: 'cookie'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

function buildHeuristicSecurity(base, identity) {
  const liq = Number(base.liquidity) || 0;
  const flags = [
    {
      id: 'source',
      label: 'Data source',
      status: 'warn',
      text: 'GoPlus unavailable — heuristic only (not a honeypot simulation)'
    },
    {
      id: 'liquidity',
      label: 'Liquidity',
      status: liq < 10000 ? 'bad' : liq < 50000 ? 'warn' : 'ok',
      text: liq > 0 ? '$' + Math.round(liq).toLocaleString('en-US') : 'Unknown'
    },
    {
      id: 'honeypot',
      label: 'Honeypot',
      status: 'warn',
      text: 'Simulation N/A — verify sell on explorer/simulator'
    },
    {
      id: 'mint',
      label: 'Mint / Own',
      status: 'warn',
      text: 'Unknown without GoPlus — check contract'
    }
  ];
  if (identity && identity.warnings) {
    identity.warnings.forEach(function (w) {
      flags.unshift({
        id: w.id,
        label: w.title,
        status: 'bad',
        text: w.text
      });
    });
  }
  return {
    available: true,
    source: 'heuristic',
    flags: flags,
    identityWarnings: (identity && identity.warnings) || [],
    meta: {
      isHoneypot: null,
      isMintable: null,
      heuristic: true
    }
  };
}

function detectIdentityRisks(base, tokenAddress) {
  const reasons = [];
  const warnings = [];
  const sym = String(base.symbol || '').toUpperCase();
  const name = String(base.name || '').toLowerCase();
  const chain = String(base.chainId || '').toLowerCase();
  const isBtcName =
    sym === 'BTC' ||
    sym === 'WBTC' ||
    name.includes('bitcoin') ||
    name === 'btc';
  const isEthName = sym === 'ETH' || name === 'ethereum' || name === 'ether';
  const isSolName = sym === 'SOL' || name === 'solana';
  if (isBtcName && chain && chain !== 'bitcoin' && !chain.includes('bitcoin')) {
    const msg =
      '⚠ IDENTITY: «' +
      (base.symbol || 'BTC') +
      '» on ' +
      chain +
      ' is NOT native Bitcoin (token/wrapper/bridge). Verify contract.';
    reasons.push(msg);
    warnings.push({
      id: 'identity_btc',
      severity: 'high',
      title: 'Not native Bitcoin',
      text: msg
    });
  }
  if (isEthName && chain && chain !== 'ethereum' && !chain.startsWith('eth')) {
    const msg =
      '⚠ IDENTITY: «ETH» on ' + chain + ' is not native Ether on Ethereum L1.';
    reasons.push(msg);
    warnings.push({
      id: 'identity_eth',
      severity: 'high',
      title: 'Not native ETH',
      text: msg
    });
  }
  if (isSolName && chain && chain !== 'solana') {
    const msg = '⚠ IDENTITY: «SOL» on ' + chain + ' is not native Solana SOL.';
    reasons.push(msg);
    warnings.push({
      id: 'identity_sol',
      severity: 'high',
      title: 'Not native SOL',
      text: msg
    });
  }
  const isStable = sym === 'USDT' || sym === 'USDC' || sym === 'DAI' || name.includes('tether') || name.includes('usd coin');
  if (isStable && chain && (chain === 'pulsechain' || chain === 'pulse' || chain.includes('pulse'))) {
    const msg =
      '⚠ IDENTITY: «' +
      (base.symbol || 'USDT') +
      '» on PulseChain is NOT canonical Tether/USDC on Ethereum. Price/risk can be meaningless — verify contract.';
    reasons.push(msg);
    warnings.push({
      id: 'identity_stable_pulse',
      severity: 'high',
      title: 'Not Ethereum USDT/USDC',
      text: msg
    });
  }
  return { reasons, warnings, bonus: warnings.length ? 25 : 0 };
}

/* ===================== SCAN ===================== */

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
    const lang = String(req.query.lang || req.headers['accept-language'] || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
    const preferredChain = String(req.query.chain || '')
      .toLowerCase()
      .trim();
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

      let pairs = await fetchDexPairs(tokenAddress, preferredChain);
      if (preferredChain && preferredChain !== 'auto') {
        const filtered = pairs.filter(function (p) {
          const c = String(p.chainId || '').toLowerCase();
          if (preferredChain === 'ethereum' || preferredChain === 'eth') {
            return c === 'ethereum' || c === 'eth';
          }
          return c === preferredChain || c.indexOf(preferredChain) !== -1;
        });
        if (filtered.length) pairs = filtered;
      }
      const pair = pickBestDexPair(pairs, tokenAddress, preferredChain);
      if (!pair || !pair.pairAddress) {
        return res.status(404).json({
          success: false,
          degraded: true,
          error:
            lang === 'en'
              ? 'No DEX pool found for this address. Check contract / network.'
              : 'Пул на DEX не найден. Проверьте адрес и сеть контракта.',
          tokenAddress
        });
      }
      const scanned = resolveScannedToken(pair, tokenAddress);
      let priceUsd = pair.priceUsd != null ? Number(pair.priceUsd) : 0;
      // When scanned token is quote side, priceUsd is the OTHER token — use ~1 for known stables
      if (scanned.side === 'quote') {
        const sym = String(scanned.symbol || '').toUpperCase();
        if (sym === 'USDT' || sym === 'USDC' || sym === 'DAI') priceUsd = 1;
        else if (priceUsd > 0) priceUsd = 1 / priceUsd; // rough invert
      }
      // Known blue-chip floors
      const symU = String(scanned.symbol || '').toUpperCase();
      if (
        (symU === 'USDT' || symU === 'USDC') &&
        String(pair.chainId || '').toLowerCase().indexOf('eth') === 0
      ) {
        if (!priceUsd || priceUsd < 0.95 || priceUsd > 1.05) priceUsd = Number(pair.priceUsd) > 0.95 && Number(pair.priceUsd) < 1.05 ? Number(pair.priceUsd) : 1;
      }
      const base = {
        symbol: scanned.symbol || 'TOKEN',
        name: scanned.name || '',
        address: scanned.address || tokenAddress,
        price: priceUsd,
        liquidity: pair.liquidity?.usd != null ? Number(pair.liquidity.usd) : 0,
        volume24h: pair.volume?.h24 != null ? Number(pair.volume.h24) : 0,
        fdv: pair.fdv != null ? Number(pair.fdv) : 0,
        marketCap:
          pair.marketCap != null
            ? Number(pair.marketCap)
            : pair.fdv != null
              ? Number(pair.fdv)
              : 0,
        isVerified: !!pair.info?.imageUrl,
        website: pair.info?.websites?.[0]?.url || null,
        twitter: pair.info?.socials?.find((s) => s.type === 'twitter')?.url || null,
        telegram: pair.info?.socials?.find((s) => s.type === 'telegram')?.url || null,
        pairAddress: pair.pairAddress || null,
        chainId: pair.chainId || 'ethereum',
        dexId: pair.dexId || null
      };

      let risk = computeRiskFromPair(pair, base);
      let riskScore = risk.riskScore;
      let riskLevel = risk.riskLevel;
      const reasons = Array.isArray(risk.reasons) ? [...risk.reasons] : [];
      const identity = detectIdentityRisks(base, tokenAddress);
      if (identity.reasons.length) {
        identity.reasons.forEach((r) => reasons.unshift(r));
        riskScore = Math.min(95, riskScore + identity.bonus);
        if (riskScore >= 70) riskLevel = 'HIGH';
        else if (riskScore >= 40) riskLevel = 'MEDIUM';
      }
      // Canonical ETH blue-chips — pair heuristics must not mark USDT as risk 80+
      const canonAddr = String(tokenAddress || '').toLowerCase();
      if (typeof ETH_CANON_ADDR !== 'undefined' && ETH_CANON_ADDR[canonAddr] && !(identity.warnings || []).length) {
        riskScore = Math.min(riskScore, 35);
        if (riskScore < 40) riskLevel = 'LOW';
        reasons.unshift(
          lang === 'en'
            ? 'Known Ethereum blue-chip contract (canonical address)'
            : 'Известный blue-chip контракт Ethereum (канонический адрес)'
        );
      }

      // GoPlus on-chain (best-effort, does not fail the scan)
      let securityOnchain = null;
      if (goplus) {
        try {
          // Prefer pair base token address; map dex chain names for GoPlus
          const secAddr = base.address || tokenAddress;
          securityOnchain = await goplus.fetchTokenSecurity(base.chainId, secAddr);
          if (securityOnchain?.riskBonus) {
            riskScore = Math.min(95, riskScore + Number(securityOnchain.riskBonus));
            if (riskScore >= 70) riskLevel = 'HIGH';
            else if (riskScore >= 40) riskLevel = 'MEDIUM';
            else riskLevel = 'LOW';
          }
          if (securityOnchain?.available && securityOnchain.meta) {
            const m = securityOnchain.meta;
            if (m.isHoneypot) reasons.unshift('GoPlus: honeypot flag');
            if (m.isMintable) reasons.push('GoPlus: mintable');
            if (m.isOpenSource === false) reasons.push('GoPlus: source not verified');
            if (m.sellTax != null && m.sellTax > 10) {
              reasons.push('GoPlus: high sell tax ' + m.sellTax + '%');
            }
          }
        } catch (e) {
          console.warn('[scan goplus]', e.message);
        }
      }

      // If GoPlus empty — still return heuristic flags (honest, not marketed as GoPlus)
      if (!securityOnchain || !securityOnchain.available) {
        securityOnchain = buildHeuristicSecurity(base, identity);
      } else if (identity.warnings && identity.warnings.length) {
        securityOnchain.identityWarnings = identity.warnings;
        securityOnchain.flags = (securityOnchain.flags || []).concat(
          identity.warnings.map(function (w) {
            return {
              id: w.id,
              label: w.title,
              status: 'bad',
              text: w.text
            };
          })
        );
      }

      const aiPlan = plan === 'pro' ? 'pro' : plan === 'premium' ? 'premium' : 'free';
      const ai = await aiService.analyzeToken(
        base,
        { riskScore, riskLevel, reasons },
        aiPlan,
        lang
      );

      if (req.user?.id) {
        await store.incrementScan(req.user);
        await store.addHistory(req.user, {
          address: tokenAddress,
          symbol: base.symbol,
          name: base.name,
          price: base.price,
          riskScore,
          plan
        });
      }
      // Global risk history for charts (throttled in store)
      try {
        if (store.addRiskSnapshot) {
          await store.addRiskSnapshot({
            address: base.address || tokenAddress,
            chainId: base.chainId,
            symbol: base.symbol,
            riskScore,
            riskLevel,
            liquidity: base.liquidity,
            price: base.price
          });
        }
      } catch (e) {
        console.warn('[risk snapshot]', e.message);
      }

      const currentUsage = await store.canScan({
        ...req.user,
        plan: req.user?.plan || plan
      });

      const aiPayload = {
        text: ai.text,
        confidence: ai.confidence,
        verdict: ai.verdict,
        risks: ai.risks || [],
        positives: ai.positives || [],
        checklist: ai.checklist || []
      };

      const riskPayload = {
        riskScore,
        riskLevel,
        confidence: ai.confidence || risk.confidence,
        reasons: reasons.slice(0, 8)
      };

      // Full token for all plans (MC/FDV needed on Free too)
      const tokenFull = {
        symbol: base.symbol,
        name: base.name,
        address: base.address,
        price: base.price,
        liquidity: base.liquidity,
        volume24h: base.volume24h,
        fdv: base.fdv,
        marketCap: base.marketCap,
        pairAddress: base.pairAddress,
        chainId: base.chainId,
        dexId: base.dexId
      };

      if (plan === 'free') {
        return res.json({
          success: true,
          plan: 'Free',
          token: tokenFull,
          risk: riskPayload,
          ai: aiPayload,
          // Full GoPlus first-pass on Free (honeypot/tax/mint/ownership/LP)
          security: Object.assign(
            {
              available: false,
              contractVerified: base.isVerified,
              flags: [],
              identityWarnings: identity.warnings || []
            },
            securityOnchain || {},
            { identityWarnings: identity.warnings || [] }
          ),
          locked: {
            charts: true,
            advancedHolders: true,
            deepAi: true
          },
          usage: currentUsage
        });
      }

      if (plan === 'premium') {
        return res.json({
          success: true,
          plan: 'Premium',
          token: { ...base },
          risk: riskPayload,
          ai: aiPayload,
          security: securityOnchain || {
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
        token: { ...base },
        risk: riskPayload,
        ai: aiPayload,
        security: securityOnchain || {
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
          whaleConcentration:
            securityOnchain?.meta?.top10Pct != null
              ? securityOnchain.meta.top10Pct + '% top10'
              : 'n/a',
          buySellRatio: pair.txns?.h24
            ? (
                (Number(pair.txns.h24.buys || 0) + 1) /
                (Number(pair.txns.h24.sells || 0) + 1)
              ).toFixed(2)
            : '—',
          volatility:
            pair.priceChange?.h24 != null
              ? Number(pair.priceChange.h24).toFixed(1) + '%'
              : '—',
          holderCount:
            securityOnchain?.meta?.holderCount != null
              ? String(securityOnchain.meta.holderCount)
              : '—'
        },
        usage: currentUsage
      });
    } catch (error) {
      const st = error.response?.status;
      console.error('[scan]', st || error.message, error.stack?.split('\n')[1] || '');
      let usage = { used: 0, limit: 5, allowed: true };
      try {
        usage = await store.canScan(req.user);
      } catch (e2) {}
      const rateLimited = st === 429 || /429/.test(String(error.message || ''));
      res.status(rateLimited ? 429 : 503).json({
        success: false,
        degraded: true,
        error: rateLimited
          ? lang === 'en'
            ? 'Market data rate limit — wait 20–40 seconds and scan again.'
            : 'Лимит запросов к рынку — подождите 20–40 сек и сканируйте снова.'
          : lang === 'en'
            ? 'Provider temporarily unavailable. Please retry in a moment.'
            : 'Провайдер временно недоступен. Повторите через минуту.',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
        plan: plan || 'free',
        usage
      });
    }
  }
);

app.get('/api/usage', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  const usage = await store.canScan(req.user);
  const chat = getChatQuota(req, plan);
  let watchCount = 0;
  let alertCount = 0;
  try {
    if (req.user?.id) {
      const wl = await store.getWatchlist(req.user);
      watchCount = (wl || []).length;
      const al = await store.getAlerts(req.user);
      alertCount = (al || []).length;
    }
  } catch (e) {}
  res.json({
    success: true,
    usage: usage,
    chat: { used: chat.used, limit: chat.limit, remaining: chat.remaining },
    watchCount,
    alertCount,
    plan
  });
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


/** Prefer major chains for well-known addresses; else highest liquidity */
function pickBestDexPair(pairs, address, preferredChain) {
  let list = Array.isArray(pairs) ? pairs.filter(Boolean) : [];
  if (!list.length) return {};
  const addr = String(address || '').toLowerCase();
  const chainHint = String(preferredChain || '').toLowerCase().trim();

  const ETH_CANON = {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': true,
    '0xdac17f958d2ee523a2206206994597c13d831ec7': true,
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': true,
    '0x514910771af9ca656af840dff83e8264ecf986ca': true,
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': true,
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': true
  };

  // Quotes that usually give a sane USD price for the base token
  const MAJOR_QUOTE = {
    WETH: true, ETH: true, USDC: true, USDT: true, DAI: true, WBTC: true,
    USDe: true, USD1: true, FRAX: true,
    WBNB: true, BNB: true, BUSD: true,
    WMATIC: true, MATIC: true, POL: true,
    WAVAX: true, AVAX: true,
    SOL: true, WSOL: true,
    TRX: true, WTRX: true,
    TON: true
  };

  const MAJOR_CHAIN = {
    ethereum: true, eth: true, bsc: true, base: true, arbitrum: true,
    optimism: true, polygon: true, avalanche: true, solana: true, tron: true
  };

  // 1) User-selected chain
  if (chainHint && chainHint !== 'auto') {
    const byChain = list.filter(function (p) {
      const c = String(p.chainId || '').toLowerCase();
      if (chainHint === 'ethereum' || chainHint === 'eth') return c === 'ethereum' || c === 'eth';
      return c === chainHint || c.indexOf(chainHint) !== -1;
    });
    if (byChain.length) list = byChain;
  }

  // 2) Canonical ETH contracts → ethereum only
  if (ETH_CANON[addr]) {
    const ethOnly = list.filter(function (p) {
      const c = String(p.chainId || '').toLowerCase();
      return c === 'ethereum' || c === 'eth';
    });
    if (ethOnly.length) list = ethOnly;
  }

  // 3) Drop PulseChain / low-trust when alternatives exist
  const nonPulse = list.filter(function (p) {
    const c = String(p.chainId || '').toLowerCase();
    return c !== 'pulsechain' && c !== 'pulse';
  });
  if (nonPulse.length) list = nonPulse;

  // 4) Prefer major chains when mixed
  const majorChain = list.filter(function (p) {
    return MAJOR_CHAIN[String(p.chainId || '').toLowerCase()];
  });
  if (majorChain.length) list = majorChain;

  // 5) Prefer scanned token as BASE (priceUsd ≈ token price)
  const asBase = list.filter(function (p) {
    return String((p.baseToken && p.baseToken.address) || '').toLowerCase() === addr;
  });
  if (asBase.length) list = asBase;

  // 6) Prefer major quote assets (kills UNI/REN @ 8.5M style pools)
  const withMajor = list.filter(function (p) {
    const q = String((p.quoteToken && p.quoteToken.symbol) || '').toUpperCase();
    return MAJOR_QUOTE[q];
  });
  if (withMajor.length) list = withMajor;

  // 7) Price outlier filter vs median
  const prices = list
    .map(function (p) { return Number(p.priceUsd) || 0; })
    .filter(function (x) { return x > 0; })
    .sort(function (a, b) { return a - b; });
  if (prices.length >= 3) {
    const mid = prices[Math.floor(prices.length / 2)];
    const filtered = list.filter(function (p) {
      const pr = Number(p.priceUsd) || 0;
      if (pr <= 0) return false;
      return pr < mid * 20 && pr > mid / 20;
    });
    if (filtered.length) list = filtered;
  }

  // 8) Highest liquidity wins
  list.sort(function (a, b) {
    const liqA = Number(a.liquidity && a.liquidity.usd) || 0;
    const liqB = Number(b.liquidity && b.liquidity.usd) || 0;
    return liqB - liqA;
  });
  return list[0] || {};
}

function resolveScannedToken(pair, tokenAddress) {
  const addr = String(tokenAddress || '').toLowerCase();
  const b = (pair && pair.baseToken) || {};
  const q = (pair && pair.quoteToken) || {};
  if (String(b.address || '').toLowerCase() === addr) {
    return {
      symbol: b.symbol || 'TOKEN',
      name: b.name || '',
      address: b.address || tokenAddress,
      side: 'base'
    };
  }
  if (String(q.address || '').toLowerCase() === addr) {
    return {
      symbol: q.symbol || 'TOKEN',
      name: q.name || '',
      address: q.address || tokenAddress,
      side: 'quote'
    };
  }
  return {
    symbol: b.symbol || 'TOKEN',
    name: b.name || '',
    address: b.address || tokenAddress,
    side: 'base'
  };
}


app.post('/api/compare', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  const isPrem = plan === 'premium' || plan === 'pro';
  const { addresses } = req.body;
  if (!Array.isArray(addresses) || addresses.length < 2 || addresses.length > 3) {
    return res.status(400).json({ success: false, error: 'Передайте 2–3 адреса' });
  }
  try {
    const results = [];
    for (const addr of addresses) {
      const address = String(addr || '').trim();
      if (!address) continue;
      const dex = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
        { timeout: 8000 }
      );
      const pair = pickBestDexPair(dex.data.pairs || [], address);
      const liq = Number(pair.liquidity?.usd) || 0;
      const vol = Number(pair.volume?.h24) || 0;
      const fdv = Number(pair.fdv) || 0;
      const price = Number(pair.priceUsd) || 0;
      let riskScore = 35;
      if (liq < 10000) riskScore += 30;
      else if (liq < 50000) riskScore += 18;
      else if (liq < 200000) riskScore += 8;
      if (fdv > 0 && liq > 0 && fdv / liq > 50 && liq < 500000) riskScore += 15;
      if (vol < 5000 && liq < 100000) riskScore += 8;
      riskScore = Math.max(5, Math.min(95, riskScore));
      const fdvLiq = liq > 0 && fdv > 0 ? Math.round((fdv / liq) * 10) / 10 : null;

      let security = { available: false, meta: {} };
      if (goplus && isPrem) {
        try {
          const chain = pair.chainId || 'ethereum';
          security = await goplus.fetchTokenSecurity(chain, address);
        } catch (e) {}
      } else if (goplus && !isPrem) {
        // Free: still try quick security for honesty of preview
        try {
          const chain = pair.chainId || 'ethereum';
          security = await goplus.fetchTokenSecurity(chain, address);
        } catch (e) {}
      }

      const meta = security.meta || {};
      results.push({
        address,
        symbol: pair.baseToken?.symbol || 'TOKEN',
        name: pair.baseToken?.name || '',
        chainId: pair.chainId || '',
        price,
        liquidity: liq,
        volume24h: vol,
        fdv,
        fdvLiqRatio: fdvLiq,
        riskScore,
        riskLevel: riskScore > 60 ? 'HIGH' : riskScore > 35 ? 'MEDIUM' : 'LOW',
        honeypot: meta.isHoneypot,
        mintable: meta.isMintable,
        renounced: meta.renounced,
        buyTax: meta.buyTax,
        sellTax: meta.sellTax,
        top10Pct: meta.top10Pct,
        securityAvailable: !!security.available
      });
    }

    // winner by lowest risk then highest liq
    let winnerIdx = 0;
    results.forEach((t, i) => {
      const w = results[winnerIdx];
      if (t.riskScore < w.riskScore) winnerIdx = i;
      else if (t.riskScore === w.riskScore && t.liquidity > w.liquidity) winnerIdx = i;
    });

    const payload = {
      success: true,
      plan,
      full: isPrem,
      tokens: results,
      winnerIndex: winnerIdx,
      summary: isPrem
        ? null
        : 'Preview: risk + liquidity. Full flags & FDV detail on Premium.'
    };
    if (!isPrem) {
      // mark locked fields for client blur
      payload.lockedFields = ['fdv', 'top10Pct', 'buyTax', 'sellTax', 'renounced'];
      payload.upsell = 'premium';
    }
    res.json(payload);
  } catch (e) {
    console.error('[compare]', e.message);
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
  if (typeof store.saveTgLinkCode === 'function') {
    await store.saveTgLinkCode(code, req.user.id, req.user.plan, 10 * 60 * 1000);
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'aicryptoscreenerbot';
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
    channelEn: process.env.TELEGRAM_CHANNEL_URL_EN || 'https://t.me/crypto_ai_scanner_en',
    allowDemoPlans: String(process.env.ALLOW_DEMO_PLANS || '').toLowerCase() === 'true'
  });
});

app.delete('/api/telegram/link', authMiddleware, async (req, res) => {
  res.json(await store.unlinkTelegram(req.user));
});


app.post('/api/telegram/alert-ack', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Login required' });
  }
  try {
    const chatId = await store.getTelegramChatId(req.user);
    if (!chatId) {
      return res.json({ success: true, sent: false, reason: 'not_linked' });
    }
    const { sendMessage } = require('./telegram');
    const body = req.body || {};
    const sym = body.symbol || 'TOKEN';
    const type = body.type || 'alert';
    const val = body.value != null ? body.value : '';
    const addr = body.address || '';
    const text =
      `✅ <b>Alert saved</b>\n` +
      `${sym} · ${type} · ${val}\n` +
      (addr ? `<code>${addr}</code>\n` : '') +
      `We will notify this chat when the condition hits.`;
    await sendMessage(chatId, text);
    res.json({ success: true, sent: true });
  } catch (e) {
    console.error('[alert-ack]', e.message);
    res.json({ success: true, sent: false, error: e.message });
  }
});

app.post('/api/telegram/digest-test', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Login required' });
  }
  try {
    const chatId = await store.getTelegramChatId(req.user);
    if (!chatId) {
      return res.status(400).json({
        success: false,
        error: 'Telegram not connected. Connect bot first.'
      });
    }
    const { sendMessage } = require('./telegram');
    const lang = String(req.body?.lang || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
    const text =
      lang === 'en'
        ? `🔔 <b>Test alert · Crypto AI Scanner</b>\n\n` +
          `Example: LINK price went <b>below</b> $15.00\n` +
          `Current ≈ sample · Risk 42/100\n\n` +
          `When a real alert fires, it will look like this.\n` +
          `Not financial advice.`
        : `🔔 <b>Тестовый алерт · Crypto AI Scanner</b>\n\n` +
          `Пример: LINK цена <b>ниже</b> $15.00\n` +
          `Сейчас ≈ sample · Risk 42/100\n\n` +
          `Когда сработает настоящий алерт, сообщение будет похожим.\n` +
          `Не финансовый совет.`;
    await sendMessage(chatId, text);
    res.json({ success: true, message: lang === 'en' ? 'Test alert sent' : 'Тестовый алерт отправлен' });
  } catch (e) {
    console.error('[digest-test]', e.message);
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
        url: item.url || item.original_url || 'https://cryptopanic.com/',
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
      const src = String(source).toLowerCase();
      news = news.filter((n) => {
        const platform = String(n.platform || '').toLowerCase();
        const name = String(n.source || '').toLowerCase();
        if (src === 'x' || src === 'twitter') {
          return platform === 'x' || name.includes('twitter') || name.includes('x.com');
        }
        if (src === 'crypto' || src === 'cripto') {
          return (
            platform === 'crypto' ||
            platform === 'rss' ||
            platform === 'cryptopanic' ||
            /cointelegraph|coindesk|decrypt|bitcoin|panic|block/i.test(name)
          );
        }
        return platform === src || name.includes(src);
      });
    }
    res.json({ success: true, news });
  } catch (e) {
    res.json({
      success: true,
      news: [
        {
          title: 'News temporarily unavailable — try CoinDesk / The Block',
          source: 'System',
          url: 'https://www.coindesk.com/',
          time: '',
          platform: 'system'
        }
      ]
    });
  }
});

app.get('/api/risk-history/:address', async (req, res) => {
  try {
    const address = req.params.address;
    const hours = Number(req.query.hours) || 48;
    if (!address || address.length < 8) {
      return res.status(400).json({ success: false, points: [] });
    }
    const points = store.getRiskHistory
      ? await store.getRiskHistory(address, hours)
      : [];
    res.json({ success: true, address, hours, points });
  } catch (e) {
    res.json({ success: false, points: [], error: e.message });
  }
});

app.get('/api/ticker', async (req, res) => {
  async function fromCoinGecko() {
    const r = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin,ethereum,solana',
        vs_currencies: 'usd',
        include_24hr_change: 'true'
      },
      timeout: 8000
    });
    const d = r.data || {};
    return [
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
    ];
  }
  async function fromDex() {
    // Popular liquid pairs as fallback when CoinGecko rate-limits
    const urls = [
      ['btc', 'BTC', 'https://api.dexscreener.com/latest/dex/tokens/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'],
      ['eth', 'ETH', 'https://api.dexscreener.com/latest/dex/tokens/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
      ['sol', 'SOL', 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112']
    ];
    const out = [];
    for (const [id, symbol, url] of urls) {
      try {
        const r = await axios.get(url, { timeout: 6000 });
        const pair = (r.data && r.data.pairs && r.data.pairs[0]) || {};
        out.push({
          id,
          symbol,
          price: pair.priceUsd != null ? Number(pair.priceUsd) : null,
          change24h: pair.priceChange && pair.priceChange.h24 != null ? Number(pair.priceChange.h24) : null
        });
      } catch (e) {
        out.push({ id, symbol, price: null, change24h: null });
      }
    }
    return out;
  }
  try {
    let ticker = await fromCoinGecko();
    const ok = ticker.some((t) => t.price != null && t.price > 0);
    if (!ok) ticker = await fromDex();
    res.json({ success: true, ticker });
  } catch (e) {
    try {
      const ticker = await fromDex();
      res.json({ success: true, ticker, source: 'dexscreener' });
    } catch (e2) {
      res.json({ success: false, ticker: [], error: 'ticker_unavailable' });
    }
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
  const pairAddress = String(req.params.pairAddress || '').trim();
  const chainRaw = String(req.query.chain || 'eth').toLowerCase();
  const tf = String(req.query.tf || '1h').toLowerCase();
  const priceHint = Number(req.query.price) || 0;

  function syntheticCandles(basePrice, timeframe) {
    const p0 = basePrice > 0 ? basePrice : 1;
    const now = Math.floor(Date.now() / 1000);
    const step =
      timeframe === '1w'
        ? 604800
        : timeframe === '1d'
          ? 86400
          : timeframe === '4h'
            ? 14400
            : 3600;
    const candles = [];
    const volumes = [];
    let walk = p0 * 0.94;
    for (let i = 90; i >= 0; i--) {
      const time = now - i * step;
      const open = walk;
      const change = (Math.random() - 0.48) * p0 * 0.015;
      const close = Math.max(p0 * 0.0001, open + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.006);
      const low = Math.min(open, close) * (1 - Math.random() * 0.006);
      candles.push({ time: time, open: open, high: high, low: low, close: close });
      volumes.push({
        time: time,
        value: Math.abs(close - open) * (40000 + Math.random() * 180000) + 500,
        color: close >= open ? 'rgba(0, 255, 200, 0.55)' : 'rgba(255, 77, 106, 0.55)'
      });
      walk = close;
    }
    const last = candles[candles.length - 1];
    last.close = p0;
    last.high = Math.max(last.high, p0);
    last.low = Math.min(last.low, p0);
    return { candles: candles, volumes: volumes };
  }

  function scaleOk(candles, hint) {
    if (!(hint > 0) || !candles || !candles.length) return true;
    const last = candles[candles.length - 1].close;
    const mid = candles[Math.floor(candles.length / 2)].close;
    const ref = last || mid;
    return !(ref > hint * 40 || ref < hint / 40);
  }

  const chainMap = {
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    base: 'base',
    arbitrum: 'arbitrum',
    polygon: 'polygon_pos',
    solana: 'solana',
    tron: 'tron'
  };
  const network = chainMap[chainRaw] || 'eth';

  // GeckoTerminal timeframe combos to try (hour often 429; day more reliable)
  const attempts = [];
  if (tf === '1w') {
    attempts.push({ path: 'day', aggregate: 7 });
    attempts.push({ path: 'day', aggregate: 1 });
  } else if (tf === '1d') {
    attempts.push({ path: 'day', aggregate: 1 });
    attempts.push({ path: 'hour', aggregate: 24 });
  } else if (tf === '4h') {
    attempts.push({ path: 'hour', aggregate: 4 });
    attempts.push({ path: 'hour', aggregate: 1 });
    attempts.push({ path: 'day', aggregate: 1 });
  } else {
    // 1h
    attempts.push({ path: 'hour', aggregate: 1 });
    attempts.push({ path: 'minute', aggregate: 15 });
    attempts.push({ path: 'minute', aggregate: 5 });
    attempts.push({ path: 'day', aggregate: 1 });
  }

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const url =
        'https://api.geckoterminal.com/api/v2/networks/' +
        network +
        '/pools/' +
        encodeURIComponent(pairAddress) +
        '/ohlcv/' +
        a.path +
        '?aggregate=' +
        a.aggregate +
        '&limit=100';
      const r = await axios.get(url, {
        timeout: 12000,
        headers: { Accept: 'application/json' }
      });
      const raw = (r.data && r.data.data && r.data.data.attributes && r.data.data.attributes.ohlcv_list) || [];
      const candles = raw
        .map(function (row) {
          return {
            time: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4])
          };
        })
        .filter(function (c) {
          return c.time && isFinite(c.close) && c.close > 0;
        })
        .sort(function (a, b) {
          return a.time - b.time;
        });
      if (candles.length >= 5 && scaleOk(candles, priceHint)) {
        const volumes = raw.map(function (row) {
          return {
            time: Number(row[0]),
            value: Number(row[5]) || 0,
            color:
              Number(row[4]) >= Number(row[1])
                ? 'rgba(0, 255, 200, 0.55)'
                : 'rgba(255, 77, 106, 0.55)'
          };
        });
        return res.json({
          success: true,
          source: 'geckoterminal',
          tf: tf,
          candles: candles,
          volumes: volumes
        });
      }
      if (candles.length >= 5 && !scaleOk(candles, priceHint)) {
        console.warn('[Chart] scale mismatch', { tf: tf, pair: pairAddress, priceHint: priceHint });
      }
    } catch (e) {
      console.warn('[Chart] gecko', a.path, a.aggregate, e.response && e.response.status || e.message);
    }
  }

  // Always return drawable series (never empty chart on 1H/4H/1D)
  const syn = syntheticCandles(priceHint > 0 ? priceHint : 1, tf);
  return res.json({
    success: true,
    source: 'synthetic',
    note: 'Indicative series from last Dex USD price',
    tf: tf,
    candles: syn.candles,
    volumes: syn.volumes
  });
});


/* ===================== PRO: Portfolio Risk Desk ===================== */
app.get('/api/portfolio/desk', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  if (plan !== 'pro') {
    return res.status(403).json({
      success: false,
      locked: true,
      upsell: 'pro',
      error: 'Portfolio Risk Desk is Pro-only'
    });
  }
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Login required' });
  }
  try {
    const positions = (await store.getPortfolio(req.user)) || [];
    // optional light refresh of top positions
    const refreshed = [];
    for (const p of positions.slice(0, 15)) {
      let row = { ...p };
      try {
        const dx = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(p.address)}`,
          { timeout: 5000 }
        );
        const pair = dx.data?.pairs?.[0];
        if (pair) {
          const liq = Number(pair.liquidity?.usd) || 0;
          const price = Number(pair.priceUsd) || 0;
          let riskScore = 35;
          if (liq < 10000) riskScore += 30;
          else if (liq < 50000) riskScore += 18;
          else if (liq < 200000) riskScore += 8;
          const fdv = Number(pair.fdv) || 0;
          if (fdv > 0 && liq > 0 && fdv / liq > 50 && liq < 500000) riskScore += 15;
          riskScore = Math.max(5, Math.min(95, riskScore));
          row = {
            ...row,
            symbol: pair.baseToken?.symbol || row.symbol,
            name: pair.baseToken?.name || row.name,
            chainId: pair.chainId || row.chainId,
            lastRisk: riskScore,
            lastLiq: liq,
            lastPrice: price,
            riskLevel: riskScore > 60 ? 'HIGH' : riskScore > 35 ? 'MEDIUM' : 'LOW'
          };
          if (store.updatePortfolioSnapshot) {
            await store.updatePortfolioSnapshot(req.user, p.address, {
              riskScore,
              liquidity: liq,
              price,
              symbol: row.symbol,
              name: row.name,
              chainId: row.chainId
            });
          }
        }
      } catch (e) {
        row.riskLevel =
          (row.lastRisk || 0) > 60 ? 'HIGH' : (row.lastRisk || 0) > 35 ? 'MEDIUM' : 'LOW';
      }
      refreshed.push(row);
    }
    // append rest without refresh
    for (const p of positions.slice(15)) {
      refreshed.push({
        ...p,
        riskLevel: (p.lastRisk || 0) > 60 ? 'HIGH' : (p.lastRisk || 0) > 35 ? 'MEDIUM' : 'LOW'
      });
    }
    const scores = refreshed.map((t) => Number(t.lastRisk) || 50);
    const avgRisk = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const worst = [...refreshed]
      .sort((a, b) => (b.lastRisk || 0) - (a.lastRisk || 0))
      .slice(0, 3);
    // Pro: 30-day risk history for worst positions
    const historyByAddress = {};
    if (store.getRiskHistory) {
      for (const w of worst) {
        try {
          historyByAddress[w.address] = await store.getRiskHistory(w.address, 720);
        } catch (e) {
          historyByAddress[w.address] = [];
        }
      }
    }
    res.json({
      success: true,
      plan: 'pro',
      tokenCount: refreshed.length,
      portfolioRisk: avgRisk,
      riskLevel: avgRisk > 60 ? 'HIGH' : avgRisk > 35 ? 'MEDIUM' : 'LOW',
      highRiskCount: refreshed.filter((t) => (t.lastRisk || 0) > 60).length,
      worst,
      historyByAddress,
      portfolioAlertDelta: Number(process.env.PORTFOLIO_RISK_DELTA || 15),
      tokens: refreshed,
      source: 'portfolio'
    });
  } catch (e) {
    console.error('[portfolio desk]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/portfolio/positions', authMiddleware, async (req, res) => {
  if (getPlan(req.user) !== 'pro') {
    return res.status(403).json({ success: false, upsell: 'pro', error: 'Pro only' });
  }
  if (!req.user?.id) return res.status(401).json({ success: false, error: 'Login required' });
  const address = String(req.body?.address || '').trim();
  if (!address || address.length < 8) {
    return res.status(400).json({ success: false, error: 'Invalid address' });
  }
  try {
    await store.addPortfolioPosition(req.user, {
      address,
      chainId: req.body.chainId,
      symbol: req.body.symbol,
      name: req.body.name,
      note: req.body.note,
      lastRisk: req.body.riskScore,
      lastLiq: req.body.liquidity,
      lastPrice: req.body.price
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/portfolio/positions/:address', authMiddleware, async (req, res) => {
  if (getPlan(req.user) !== 'pro') {
    return res.status(403).json({ success: false, upsell: 'pro' });
  }
  await store.removePortfolioPosition(req.user, req.params.address);
  res.json({ success: true });
});

/** Legacy wallet demo — Premium+ still gets mock if not Pro desk */
app.get('/api/portfolio/:address', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  if (plan === 'free') {
    return res.json({ success: true, locked: true, message: 'Портфель доступен с Premium' });
  }
  if (plan === 'pro' && store.getPortfolio) {
    // redirect semantics: use desk
    return res.json({
      success: true,
      plan,
      message: 'Use /api/portfolio/desk for Risk Desk',
      redirect: '/api/portfolio/desk'
    });
  }
  const tokens = [
    { symbol: 'ETH', name: 'Ethereum', value: 6420, riskLevel: 'LOW', riskScore: 15 },
    { symbol: 'USDC', name: 'USD Coin', value: 2800, riskLevel: 'LOW', riskScore: 8 },
    { symbol: 'LINK', name: 'Chainlink', value: 1950, riskLevel: 'LOW', riskScore: 27 }
  ];
  const totalValue = tokens.reduce((s, t) => s + t.value, 0);
  const avgRisk = Math.round(tokens.reduce((s, t) => s + t.riskScore, 0) / tokens.length);
  res.json({
    success: true,
    plan,
    totalValue,
    tokenCount: tokens.length,
    highRiskCount: 0,
    portfolioRisk: avgRisk,
    riskLevel: 'LOW',
    tokens,
    source: 'demo'
  });
});

/** Pro: batch scan up to 25 addresses */
app.post(
  '/api/batch-scan',
  authMiddleware,
  rateLimit({ windowMs: 60_000, max: 5, keyFn: (req) => 'batch:' + clientIp(req) }),
  async (req, res) => {
    if (getPlan(req.user) !== 'pro') {
      return res.status(403).json({ success: false, upsell: 'pro', error: 'Batch scan is Pro-only' });
    }
    let addresses = req.body?.addresses;
    if (typeof addresses === 'string') {
      addresses = addresses.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
    }
    if (!Array.isArray(addresses) || !addresses.length) {
      return res.status(400).json({ success: false, error: 'addresses[] required' });
    }
    addresses = [...new Set(addresses.map((a) => String(a).trim()))].slice(0, 25);
    const results = [];
    for (const address of addresses) {
      try {
        const dx = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
          { timeout: 6000 }
        );
        const pair = dx.data?.pairs?.[0];
        if (!pair) {
          results.push({ address, ok: false, error: 'not_found' });
          continue;
        }
        const liq = Number(pair.liquidity?.usd) || 0;
        const price = Number(pair.priceUsd) || 0;
        let riskScore = 35;
        if (liq < 10000) riskScore += 30;
        else if (liq < 50000) riskScore += 18;
        else if (liq < 200000) riskScore += 8;
        const fdv = Number(pair.fdv) || 0;
        if (fdv > 0 && liq > 0 && fdv / liq > 50 && liq < 500000) riskScore += 15;
        riskScore = Math.max(5, Math.min(95, riskScore));
        results.push({
          address,
          ok: true,
          symbol: pair.baseToken?.symbol,
          name: pair.baseToken?.name,
          chainId: pair.chainId,
          price,
          liquidity: liq,
          riskScore,
          riskLevel: riskScore > 60 ? 'HIGH' : riskScore > 35 ? 'MEDIUM' : 'LOW'
        });
      } catch (e) {
        results.push({ address, ok: false, error: e.message });
      }
    }
    res.json({ success: true, count: results.length, results });
  }
);

/** Pro: early / new pairs feed (DexScreener boosts + new) */
app.get('/api/new-pairs', authMiddleware, async (req, res) => {
  if (getPlan(req.user) !== 'pro') {
    return res.status(403).json({
      success: false,
      upsell: 'pro',
      error: 'Early pairs feed is Pro-only'
    });
  }
  try {
    const r = await axios.get('https://api.dexscreener.com/token-boosts/top/v1', {
      timeout: 8000
    });
    const list = Array.isArray(r.data) ? r.data : [];
    const out = [];
    for (const item of list.slice(0, 12)) {
      const address = item.tokenAddress;
      if (!address) continue;
      try {
        const dx = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${address}`,
          { timeout: 5000 }
        );
        const pair = dx.data?.pairs?.[0];
        if (!pair) continue;
        const liq = Number(pair.liquidity?.usd) || 0;
        let riskScore = 40;
        if (liq < 20000) riskScore += 25;
        else if (liq < 100000) riskScore += 12;
        out.push({
          address,
          chainId: item.chainId || pair.chainId,
          symbol: pair.baseToken?.symbol,
          name: pair.baseToken?.name,
          price: pair.priceUsd,
          liquidity: liq,
          volume24h: pair.volume?.h24,
          riskScore: Math.min(95, riskScore),
          riskLevel: riskScore > 60 ? 'HIGH' : 'MEDIUM'
        });
      } catch (_) {}
    }
    res.json({ success: true, pairs: out, pro: true });
  } catch (e) {
    res.json({ success: false, pairs: [], error: e.message });
  }
});


app.post('/api/exchanges/bybit', authMiddleware, async (req, res) => {
  if (getPlan(req.user) !== 'pro') {
    return res.status(403).json({
      success: false,
      error: 'Bybit is a Pro portfolio source',
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

/** Chat quotas: free trial 2/day, premium 20/day, pro unlimited */
const chatQuota = new Map();
function chatQuotaKey(req) {
  if (req.user && req.user.id) return 'u:' + req.user.id;
  return 'ip:' + clientIp(req);
}
function getChatQuota(req, plan) {
  if (plan === 'pro') return { limit: 9999, used: 0, remaining: 9999, key: 'pro' };
  const limit = plan === 'premium' ? 20 : 2;
  const day = new Date().toISOString().slice(0, 10);
  const key = chatQuotaKey(req) + ':' + day;
  const used = chatQuota.get(key) || 0;
  return { limit: limit, used: used, remaining: Math.max(0, limit - used), key: key };
}
function bumpChatQuota(key) {
  if (!key || key === 'pro') return;
  chatQuota.set(key, (chatQuota.get(key) || 0) + 1);
}

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  const plan = getPlan(req.user);
  const { messages, context, lang: bodyLang } = req.body || {};
  const lang = String(bodyLang || (context && context.lang) || 'ru').toLowerCase().startsWith('en') ? 'en' : 'ru';
  if (!messages || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ success: false, error: 'Нет сообщений' });
  }
  const quota = getChatQuota(req, plan);
  if (quota.remaining <= 0) {
    return res.status(403).json({
      success: false,
      error:
        plan === 'free'
          ? (String((req.body || {}).lang || '').startsWith('en')
              ? 'Free trial chat limit (2/day) reached. Premium — 20 messages/day.'
              : 'Лимит Free trial чата (2/день) исчерпан. Premium — 20 сообщений/день.')
          : (String((req.body || {}).lang || '').startsWith('en')
              ? 'Daily chat limit reached.'
              : 'Дневной лимит чата исчерпан.'),
      upsell: 'premium',
      remaining: 0,
      limit: quota.limit
    });
  }
  const maxMsgs = plan === 'pro' ? 12 : plan === 'premium' ? 8 : 4;
  try {
    let ctx = Object.assign({}, context || {});
    // Ensure security snapshot is complete for chat grounding
    const addr =
      (ctx.token && ctx.token.address) ||
      ctx.address ||
      (ctx.token && ctx.token.contract);
    const chain =
      (ctx.token && ctx.token.chainId) || ctx.chainId || 'ethereum';
    const secThin =
      !ctx.security ||
      ctx.security.available !== true ||
      !(ctx.security.meta && Object.keys(ctx.security.meta).length);
    if (goplus && addr && secThin) {
      try {
        const sec = await goplus.fetchTokenSecurity(chain, addr);
        if (sec && sec.available) ctx.security = sec;
      } catch (e) {
        console.warn('[chat goplus]', e.message);
      }
    }
    const result = await aiService.chat(messages.slice(-maxMsgs), {
      ...ctx,
      lang,
      plan: plan === 'free' ? 'free_trial' : plan,
      whatIf: plan === 'pro',
      portfolioAware: plan === 'pro'
    });
    bumpChatQuota(quota.key);
    const after = getChatQuota(req, plan);
    res.json({
      success: true,
      reply: result.reply,
      demo: result.demo || false,
      plan: plan,
      remaining: after.remaining,
      limit: after.limit,
      limitNote:
        plan === 'free'
          ? (lang === 'en'
              ? 'Free trial: ' + after.remaining + '/' + after.limit + ' today'
              : 'Free trial: ' + after.remaining + '/' + after.limit + ' сегодня')
          : plan === 'premium'
            ? (lang === 'en'
                ? 'Premium: ' + after.remaining + '/' + after.limit + ' today'
                : 'Premium: ' + after.remaining + '/' + after.limit + ' сегодня')
            : null
    });
  } catch (error) {
    console.error('[chat]', error.message);
    res.status(500).json({ success: false, error: 'Ошибка AI: ' + (error.message || '') });
  }
});

/** Waitlist for paid plans (until payments are live) */
app.post(
  '/api/waitlist',
  rateLimit({
    windowMs: 60 * 60_000,
    max: 8,
    keyFn: (req) => 'wl:' + clientIp(req)
  }),
  async (req, res) => {
    try {
      const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();
      const plan = String(req.body?.plan || 'premium').toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Укажите корректный email' });
      }
      if (typeof store.addWaitlist === 'function') {
        await store.addWaitlist(email, plan);
      } else {
        console.log('[waitlist]', email, plan);
      }
      res.json({
        success: true,
        message: 'Вы в waitlist. Напишем, когда оплата будет доступна.'
      });
    } catch (e) {
      console.error('[waitlist]', e.message);
      res.status(500).json({ success: false, error: 'Не удалось сохранить' });
    }
  }
);

/** Explicit history save (also written on scan when logged in) */
app.post('/api/history', authMiddleware, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Войдите в аккаунт' });
  }
  try {
    const body = req.body || {};
    await store.addHistory(req.user, {
      address: body.address || '',
      symbol: body.symbol || '',
      name: body.name || '',
      price: body.price || 0,
      riskScore: body.riskScore != null ? body.riskScore : body.risk_score,
      plan: body.plan || getPlan(req.user)
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[history POST]', e.message);
    res.status(500).json({ success: false, error: 'Не удалось сохранить историю' });
  }
});

/** Public Premium sample report — no paywall demo */
app.get('/api/sample/premium', async (req, res) => {
  const address = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
  try {
    const dexResponse = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 10000 }
    );
    const pair = pickBestDexPair(dexResponse.data.pairs || [], address);
    const base = {
      symbol: pair.baseToken?.symbol || 'LINK',
      name: pair.baseToken?.name || 'Chainlink',
      address: pair.baseToken?.address || address,
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
      pairAddress: pair.pairAddress || null,
      chainId: pair.chainId || 'ethereum',
      dexId: pair.dexId || null,
      website: pair.info?.websites?.[0]?.url || 'https://chain.link',
      twitter: 'https://twitter.com/chainlink',
      telegram: null,
      isVerified: true
    };
    let risk = computeRiskFromPair(pair, base);
    let securityOnchain = null;
    if (goplus) {
      try {
        securityOnchain = await goplus.fetchTokenSecurity(base.chainId, address);
      } catch (e) {}
    }
    const ai = await aiService.analyzeToken(
      base,
      { riskScore: risk.riskScore, riskLevel: risk.riskLevel, reasons: risk.reasons || [] },
      'premium'
    );
    res.json({
      success: true,
      sample: true,
      plan: 'Premium',
      token: base,
      risk: {
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        confidence: ai.confidence || 75,
        reasons: (risk.reasons || []).slice(0, 8)
      },
      ai: {
        text: ai.text,
        confidence: ai.confidence,
        verdict: ai.verdict,
        risks: ai.risks || [],
        positives: ai.positives || []
      },
      security: securityOnchain || {
        available: false,
        contractVerified: true,
        scamProbability: Math.min(25, Math.max(5, (risk.riskScore || 40) - 20))
      },
      projectLinks: {
        website: base.website,
        twitter: base.twitter,
        telegram: base.telegram
      },
      checklist: [
        'Сверить адрес контракта в официальных каналах проекта',
        'Проверить mint / ownership в эксплорере',
        'Оценить top holders и заблокированную LP',
        'Сравнить ликвидность с размером планируемой сделки',
        'Не путать одноимённые токены на разных сетях'
      ]
    });
  } catch (e) {
    console.error('[sample]', e.message);
    res.status(500).json({ success: false, error: 'Sample unavailable' });
  }
});

// SPA fallback (Express 5 compatible — no app.get('*'))
app.use(function spaFallback(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  const candidates = [
    path.join(publicDir, 'index.html'),
    path.join(__dirname, 'index.html')
  ];
  for (const indexPath of candidates) {
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  }
  return res.status(404).send('Not found');
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
