// frontend/app.js
let currentPlan = 'free';
let user = null;
let token = localStorage.getItem('token') || null;
let candleChart = null;
let candleSeries = null;
let volumeSeries = null;
let currentTimeframe = '1H';
let chatHistory = [];
let currentTokenContext = null;
let bybitApiKey = null;
let bybitApiSecret = null;
let bybitNextCursor = null;
let lastScannedToken = null;

document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      user = { id: payload.id, email: payload.email, plan: payload.plan };
      currentPlan = payload.plan || 'free';
      updateAuthUI();
    } catch (e) {
      localStorage.removeItem('token');
      token = null;
    }
  }

  document.getElementById('nav-home')?.addEventListener('click', e => { e.preventDefault(); showPage('home'); });
  document.getElementById('nav-scanner')?.addEventListener('click', e => { e.preventDefault(); showPage('scanner'); });
  document.getElementById('nav-watchlist')?.addEventListener('click', e => { e.preventDefault(); showPage('watchlist'); loadWatchlist(); });
  document.getElementById('nav-history')?.addEventListener('click', e => { e.preventDefault(); showPage('history'); loadHistory(); });
  document.getElementById('nav-alerts')?.addEventListener('click', e => { e.preventDefault(); showPage('alerts'); loadAlerts(); });
  document.getElementById('nav-compare')?.addEventListener('click', e => { e.preventDefault(); showPage('compare'); });

  document.querySelectorAll('.plan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!user) return openAuthModal();
      document.querySelectorAll('.plan-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlan = btn.dataset.plan;
    });
  });

  document.getElementById('auth-btn')?.addEventListener('click', () => { if (user) logout(); else openAuthModal(); });
  document.getElementById('modal-close')?.addEventListener('click', closeAuthModal);
  document.getElementById('auth-form')?.addEventListener('submit', handleAuth);
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      document.getElementById('auth-title').textContent = mode === 'login' ? 'Login' : 'Register';
      document.getElementById('auth-submit').textContent = mode === 'login' ? 'Login' : 'Create Account';
    });
  });

  document.getElementById('connect-wallet')?.addEventListener('click', connectWallet);
  document.getElementById('connect-bybit-btn')?.addEventListener('click', () => {
    if (!user) return openAuthModal();
    document.getElementById('bybit-modal').style.display = 'flex';
  });
  document.getElementById('bybit-modal-close')?.addEventListener('click', () => {
    document.getElementById('bybit-modal').style.display = 'none';
  });
  document.getElementById('bybit-form')?.addEventListener('submit', connectBybit);

  document.getElementById('scan-button')?.addEventListener('click', startScan);
  document.getElementById('token-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') startScan(); });

  document.getElementById('toggle-chat')?.addEventListener('click', toggleChat);
  document.getElementById('chat-send')?.addEventListener('click', sendChatMessage);
  document.getElementById('chat-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendChatMessage(); });

  document.getElementById('alert-create')?.addEventListener('click', createAlert);
  document.getElementById('cmp-btn')?.addEventListener('click', runCompare);
  document.getElementById('tg-connect-btn')?.addEventListener('click', connectTelegram);

  document.getElementById('try-link-btn')?.addEventListener('click', () => {
    showPage('scanner');
    document.getElementById('token-input').value = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
    startScan();
  });
  document.getElementById('go-scanner-btn')?.addEventListener('click', () => {
    showPage('scanner');
    document.getElementById('token-input')?.focus();
  });
  document.getElementById('home-watchlist-all')?.addEventListener('click', e => {
    e.preventDefault();
    showPage('watchlist');
    loadWatchlist();
  });
  document.getElementById('home-history-all')?.addEventListener('click', e => {
    e.preventDefault();
    showPage('history');
    loadHistory();
  });

  loadNews();
  updateAuthUI();
  refreshUsage();
  loadHomeWidgets();
});

function openAuthModal() { document.getElementById('auth-modal').style.display = 'flex'; }
function closeAuthModal() { document.getElementById('auth-modal').style.display = 'none'; }

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const isLogin = document.querySelector('.auth-tab.active').dataset.mode === 'login';
  try {
    const res = await fetch('http://localhost:3000/api/auth/' + (isLogin ? 'login' : 'register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Ошибка');
    token = data.token;
    user = data.user;
    currentPlan = data.user.plan;
    localStorage.setItem('token', token);
    closeAuthModal();
    updateAuthUI();
    refreshUsage();
    loadHomeWidgets();
    alert('Успешно! Тариф: ' + data.user.plan.toUpperCase());
  } catch (err) {
    alert('Ошибка соединения');
  }
}

function logout() {
  token = null;
  user = null;
  currentPlan = 'free';
  localStorage.removeItem('token');
  updateAuthUI();
  document.getElementById('portfolio-section').style.display = 'none';
  const ex = document.getElementById('connected-exchanges');
  if (ex) ex.innerHTML = '<p style="color:#777;">Nothing connected</p>';
  const chat = document.getElementById('ai-chat-section');
  if (chat) chat.style.display = 'none';
  refreshUsage();
  loadHomeWidgets();
}

function updateAuthUI() {
  const authBtn = document.getElementById('auth-btn');
  const planLabel = document.getElementById('user-plan');
  const walletBtn = document.getElementById('connect-wallet');
  if (!authBtn) return;
  if (user) {
    authBtn.textContent = 'Logout';
    if (planLabel) { planLabel.textContent = user.plan.toUpperCase(); planLabel.style.display = 'inline-block'; }
    if (walletBtn) walletBtn.style.display = 'inline-block';
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.plan === user.plan);
    });
  } else {
    authBtn.textContent = 'Login';
    if (planLabel) planLabel.style.display = 'none';
    if (walletBtn) walletBtn.style.display = 'none';
  }
}

function showPage(page) {
  ['home', 'scanner', 'watchlist', 'history', 'alerts', 'compare'].forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.style.display = p === page ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const nav = document.getElementById('nav-' + page);
  if (nav) nav.classList.add('active');
  if (page === 'home') loadHomeWidgets();
}

async function refreshUsage() {
  try {
    const res = await fetch('http://localhost:3000/api/usage', {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (data.success && data.usage) {
      const el = document.getElementById('scan-usage');
      if (el) {
        const lim = data.usage.limit === 999999 ? '∞' : data.usage.limit;
        el.textContent = 'Scans: ' + data.usage.used + '/' + lim;
      }
    }
  } catch (e) {}
}

async function loadHomeWidgets() {
  loadHomeWatchlist();
  loadHomeHistory();
}

async function loadHomeWatchlist() {
  const box = document.getElementById('home-watchlist');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state">Войдите и добавьте токены из Scanner</div>';
    return;
  }
  try {
    const res = await fetch('http://localhost:3000/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state">Watchlist пуст. Отсканируйте токен и нажмите + Watchlist</div>';
      return;
    }
    box.innerHTML = '<div class="home-chip-row">' + data.watchlist.slice(0, 8).map(t =>
      '<button class="home-chip" onclick="rescan(\'' + t.address + '\')"><strong>' +
      (t.symbol || 'TOKEN') + '</strong> <span style="color:#666;font-size:0.75rem;">' +
      t.address.slice(0, 6) + '…</span></button>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Не удалось загрузить</div>';
  }
}

async function loadHomeHistory() {
  const box = document.getElementById('home-history');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state">Войдите, чтобы видеть недавние сканы</div>';
    return;
  }
  try {
    const res = await fetch('http://localhost:3000/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state">Пока нет сканов — нажмите Try example: LINK</div>';
      return;
    }
    box.innerHTML = data.history.slice(0, 5).map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>Risk ' + h.riskScore + ' · ' + new Date(h.scannedAt).toLocaleString('ru-RU') +
      '</small></div><div class="list-actions"><button class="btn-sm" onclick="rescan(\'' + h.address +
      '\')">Open</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Не удалось загрузить</div>';
  }
}
// ====================== WALLET ======================
async function connectWallet() {
  if (typeof window.ethereum === 'undefined') return alert('Install MetaMask');
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    document.getElementById('connect-wallet').textContent =
      accounts[0].slice(0, 6) + '...' + accounts[0].slice(-4);
    document.getElementById('portfolio-section').style.display = 'block';
    analyzePortfolio(accounts[0]);
  } catch (e) {
    alert('Wallet connection failed');
  }
}

async function analyzePortfolio(address) {
  const content = document.getElementById('portfolio-content');
  content.innerHTML = '<div class="loading">Analyzing portfolio...</div>';
  try {
    const res = await fetch('http://localhost:3000/api/portfolio/' + address, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (data.locked) {
      content.innerHTML =
        '<div class="locked-message glass"><h3>Portfolio available on Premium+</h3>' +
        '<button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>';
      return;
    }
    const riskClass = (data.riskLevel || 'medium').toLowerCase();
    content.innerHTML =
      '<div class="portfolio-summary">' +
      '<div class="portfolio-stat glass"><div class="label">Value</div><div class="value">$' + data.totalValue.toLocaleString() + '</div></div>' +
      '<div class="portfolio-stat glass"><div class="label">Risk</div><div class="value risk-' + riskClass + '">' + data.portfolioRisk + '/100</div></div>' +
      '<div class="portfolio-stat glass"><div class="label">Tokens</div><div class="value">' + data.tokenCount + '</div></div>' +
      '<div class="portfolio-stat glass"><div class="label">High Risk</div><div class="value risk-high">' + data.highRiskCount + '</div></div></div>' +
      '<div class="glass" style="margin-top:1.5rem;padding:1.3rem;"><h3 style="margin-bottom:1rem;">Holdings</h3>' +
      '<div class="token-table-header"><span>Token</span><span>Value</span><span>Risk</span></div>' +
      data.tokens.map(t =>
        '<div class="token-row"><div class="token-info"><strong>' + t.symbol + '</strong><small>' + t.name +
        '</small></div><div>$' + t.value.toLocaleString() + '</div><div class="risk-' + t.riskLevel.toLowerCase() +
        '">' + t.riskLevel + '</div></div>'
      ).join('') + '</div>';
  } catch (e) {
    content.innerHTML = '<div class="error-card">Portfolio error</div>';
  }
}

// ====================== BYBIT ======================
async function connectBybit(e) {
  e.preventDefault();
  const apiKey = document.getElementById('bybit-api-key').value.trim();
  const apiSecret = document.getElementById('bybit-api-secret').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Connecting...';
  submitBtn.disabled = true;
  try {
    const res = await fetch('http://localhost:3000/api/exchanges/bybit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ apiKey, apiSecret, limit: 15 })
    });
    const data = await res.json();
    if (!data.success) { alert(data.error || 'Error'); return; }
    bybitApiKey = apiKey;
    bybitApiSecret = apiSecret;
    bybitNextCursor = data.nextCursor;
    document.getElementById('bybit-modal').style.display = 'none';
    document.getElementById('bybit-form').reset();
    renderBybitData(data);
  } catch (err) {
    alert('Bybit connection failed');
  } finally {
    submitBtn.textContent = 'Connect';
    submitBtn.disabled = false;
  }
}

function renderBybitData(data, append) {
  const container = document.getElementById('connected-exchanges');
  const balancesHtml = (data.balances || []).map(b =>
    '<span style="margin-right:1.2rem;">' + b.coin + ': <strong>' + b.equity + '</strong></span>'
  ).join('') || 'No assets';

  let tradesHtml = '';
  if (data.trades && data.trades.length) {
    const rows = data.trades.map(t =>
      '<div class="trade-row"><span>' + t.time + '</span><span>' + t.symbol +
      '</span><span class="' + (t.side === 'Buy' ? 'side-buy' : 'side-sell') + '">' + t.side +
      '</span><span>' + t.price + '</span><span>' + t.qty + '</span><span>$' + Number(t.value).toFixed(2) + '</span></div>'
    ).join('');
    if (append) {
      const existing = container.querySelector('.trades-body');
      if (existing) existing.insertAdjacentHTML('beforeend', rows);
    } else {
      tradesHtml =
        '<div style="margin-top:1.8rem;"><h3 style="margin-bottom:1rem;font-size:1.05rem;">Trades</h3>' +
        '<div class="trades-table"><div class="trades-header">' +
        '<span>Time</span><span>Pair</span><span>Side</span><span>Price</span><span>Qty</span><span>Value</span></div>' +
        '<div class="trades-body">' + rows + '</div></div>' +
        (data.hasMore ? '<button id="load-more-trades" class="connect-btn" style="margin-top:1.2rem;">Load more</button>' : '') +
        '</div>';
    }
  } else if (!append) {
    tradesHtml = '<p style="margin-top:1.5rem;color:#777;">No trades</p>';
  }

  if (!append) {
    container.innerHTML =
      '<div class="exchange-card glass" style="padding:1.4rem;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<strong style="font-size:1.15rem;">Bybit</strong><span style="color:#00ffc8;">Connected</span></div>' +
      '<div style="margin-top:1rem;color:#aaa;">Total Equity: <strong style="color:#fff;font-size:1.25rem;">$' +
      Number(data.totalEquityUsd).toLocaleString() + '</strong></div>' +
      '<div style="margin-top:0.8rem;font-size:0.95rem;color:#bbb;line-height:1.7;">' + balancesHtml + '</div>' +
      tradesHtml + '</div>';
  }
  const loadMoreBtn = document.getElementById('load-more-trades');
  if (loadMoreBtn) loadMoreBtn.onclick = loadMoreTrades;
}

async function loadMoreTrades() {
  if (!bybitApiKey || !bybitApiSecret || !bybitNextCursor) return;
  const btn = document.getElementById('load-more-trades');
  btn.textContent = 'Loading...';
  btn.disabled = true;
  try {
    const res = await fetch('http://localhost:3000/api/exchanges/bybit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ apiKey: bybitApiKey, apiSecret: bybitApiSecret, cursor: bybitNextCursor, limit: 15 })
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    bybitNextCursor = data.nextCursor;
    renderBybitData(data, true);
    if (!data.hasMore) btn.remove();
    else { btn.textContent = 'Load more'; btn.disabled = false; }
  } catch (e) {
    alert('Load failed');
    btn.textContent = 'Load more';
    btn.disabled = false;
  }
}

// ====================== NEWS ======================
async function loadNews() {
  const grid = document.getElementById('news-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1">Loading news...</div>';
  try {
    const res = await fetch('http://localhost:3000/api/news');
    const data = await res.json();
    if (!data.success || !data.news?.length) {
      grid.innerHTML = '<div class="error-card">Failed to load news</div>';
      return;
    }
    grid.innerHTML = data.news.map(item =>
      '<a href="' + (item.url || '#') + '" target="_blank" class="news-card glass" style="text-decoration:none;color:inherit;">' +
      '<h3 class="news-title">' + item.title + '</h3><div class="news-meta">' + item.source + ' · ' + item.time + '</div></a>'
    ).join('');
  } catch (e) {
    grid.innerHTML = '<div class="error-card">News error</div>';
  }
}

// ====================== SCANNER ======================
async function startScan() {
  const address = document.getElementById('token-input').value.trim();
  if (!address) return alert('Enter contract address');
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading">Analyzing token...</div>';
  const chatSec = document.getElementById('ai-chat-section');
  if (chatSec) chatSec.style.display = 'none';
  chatHistory = [];
  try {
    const res = await fetch('http://localhost:3000/api/scan/' + address + '?plan=' + currentPlan, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (res.status === 429 || (data.error && String(data.error).indexOf('Лимит') !== -1)) {
      results.innerHTML = '<div class="error-card">' + (data.error || 'Scan limit reached') + '</div>';
      refreshUsage();
      return;
    }
    if (data.usage) {
      const el = document.getElementById('scan-usage');
      if (el) {
        const lim = data.usage.limit === 999999 ? '∞' : data.usage.limit;
        el.textContent = 'Scans: ' + data.usage.used + '/' + lim;
      }
    }
    lastScannedToken = { address: address, symbol: data.token?.symbol, name: data.token?.name };
    renderTokenPage(data);
    refreshUsage();
  } catch (e) {
    results.innerHTML = '<div class="error-card">Connection error</div>';
  }
}

function safe(v, fb) {
  if (fb === undefined) fb = '—';
  if (v === null || v === undefined || Number.isNaN(v) || typeof v === 'object') return fb;
  return v;
}

function formatNum(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Number(n).toFixed(4);
}

function generateCandleAndVolumeData(currentPrice, timeframe) {
  timeframe = timeframe || '1H';
  const now = Math.floor(Date.now() / 1000);
  const intervals = { '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800 };
  const step = intervals[timeframe] || 3600;
  const candles = [];
  const volumes = [];
  let price = currentPrice * 0.87;
  for (let i = 80; i >= 0; i--) {
    const time = now - i * step;
    const open = price;
    const change = (Math.random() - 0.48) * currentPrice * 0.022;
    const close = Math.max(0.000001, open + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    candles.push({ time, open, high, low, close });
    volumes.push({
      time,
      value: Math.abs(close - open) * (90000 + Math.random() * 450000),
      color: close >= open ? 'rgba(0, 255, 200, 0.55)' : 'rgba(255, 77, 106, 0.55)'
    });
    price = close;
  }
  candles[candles.length - 1].close = currentPrice;
  candles[candles.length - 1].high = Math.max(candles[candles.length - 1].high, currentPrice);
  candles[candles.length - 1].low = Math.min(candles[candles.length - 1].low, currentPrice);
  return { candles, volumes };
}

function initCandleChart(currentPrice) {
  const container = document.getElementById('candle-chart');
  if (!container || typeof LightweightCharts === 'undefined') return;
  container.innerHTML = '';
  candleChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 400,
    layout: { background: { color: '#141825' }, textColor: '#888' },
    grid: { vertLines: { color: '#1e2438' }, horzLines: { color: '#1e2438' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1e2438' },
    timeScale: { borderColor: '#1e2438', timeVisible: true }
  });
  candleSeries = candleChart.addCandlestickSeries({
    upColor: '#00ffc8', downColor: '#ff4d6a',
    borderUpColor: '#00ffc8', borderDownColor: '#ff4d6a',
    wickUpColor: '#00ffc8', wickDownColor: '#ff4d6a'
  });
  volumeSeries = candleChart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    scaleMargins: { top: 0.75, bottom: 0 }
  });
  candleChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
  const data = generateCandleAndVolumeData(currentPrice, currentTimeframe);
  candleSeries.setData(data.candles);
  volumeSeries.setData(data.volumes);
  candleChart.timeScale().fitContent();
  window.addEventListener('resize', function () {
    if (candleChart && container) candleChart.applyOptions({ width: container.clientWidth });
  });
}

function updateCandleData(currentPrice) {
  if (!candleSeries || !volumeSeries) return;
  const data = generateCandleAndVolumeData(currentPrice, currentTimeframe);
  candleSeries.setData(data.candles);
  volumeSeries.setData(data.volumes);
  candleChart.timeScale().fitContent();
}

function renderTokenPage(data) {
  const t = data.token || {};
  const r = data.risk || {};
  const ai = data.ai || {};
  const isPrem = data.plan === 'Premium' || data.plan === 'Pro';
  const isPro = data.plan === 'Pro';
  const addr = lastScannedToken?.address || '';
  const adv = data.advanced || {};
  const whale = typeof adv.whaleConcentration === 'object' ? (adv.whaleConcentration?.percent || '—') : (adv.whaleConcentration || '—');
  const buySell = typeof adv.buySellRatio === 'object' ? (adv.buySellRatio?.value || '—') : (adv.buySellRatio || '—');
  const volatility = typeof adv.volatility === 'object' ? (adv.volatility?.value || '—') : (adv.volatility || '—');
  const holders = typeof adv.holderCount === 'object' ? (adv.holderCount?.value || '—') : (adv.holderCount || '—');

  document.getElementById('results').innerHTML =
    '<div class="token-header glass"><div class="token-left"><div class="token-icon">' + (t.symbol || 'TK').slice(0, 2) +
    '</div><div><h1 class="token-title">' + safe(t.symbol) + ' <span class="token-name">' + safe(t.name) +
    '</span></h1><div class="token-price">$' + safe(t.price) + '</div></div></div><div class="token-right">' +
    '<div class="risk-pill risk-' + (r.riskLevel || 'medium').toLowerCase() + '">Risk ' + safe(r.riskScore) + '/100</div>' +
    '<div class="plan-label">' + safe(data.plan) + '</div>' +
    '<button class="btn-sm" style="margin-top:0.5rem;" onclick="addWatch(\'' + addr + '\',\'' + (t.symbol || '') + '\',\'' + (t.name || '') + '\')">+ Watchlist</button>' +
    '</div></div>' +
    '<div class="metrics-grid">' +
    '<div class="metric-card glass"><div class="metric-label">Market Cap</div><div class="metric-value">' + formatNum(t.marketCap || t.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">FDV</div><div class="metric-value">' + formatNum(t.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Volume 24h</div><div class="metric-value">' + formatNum(t.volume24h) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Liquidity</div><div class="metric-value">' + formatNum(t.liquidity) + '</div></div></div>' +
    '<div class="tabs">' +
    '<button class="tab active" data-tab="overview">Overview</button>' +
    '<button class="tab" data-tab="security">Security</button>' +
    '<button class="tab" data-tab="ai">AI Analysis</button>' +
    '<button class="tab" data-tab="links">Links</button></div><div class="tab-content">' +
    '<div class="tab-pane active" id="overview">' +
    (isPrem
      ? '<div class="chart-wrapper glass"><div class="timeframe-switcher">' +
        '<button class="tf-btn active" data-tf="1H">1H</button><button class="tf-btn" data-tf="4H">4H</button>' +
        '<button class="tf-btn" data-tf="1D">1D</button><button class="tf-btn" data-tf="1W">1W</button></div>' +
        '<div id="candle-chart" class="candle-chart"></div></div>'
      : '<div class="locked-message glass"><h3>Chart available on Premium</h3><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    (isPro
      ? '<div class="advanced-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Whale Concentration</div><div class="metric-value">' + whale + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Buy / Sell Ratio</div><div class="metric-value">' + buySell + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Volatility</div><div class="metric-value">' + volatility + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Holders</div><div class="metric-value">' + holders + '</div></div></div>'
      : isPrem
      ? '<div class="locked-message glass" style="margin-top:1rem;"><h3>Advanced Metrics — Pro only</h3><button class="upgrade-btn" onclick="openAuthModal()">Upgrade to Pro</button></div>'
      : '') +
    '</div><div class="tab-pane" id="security">' +
    (isPrem
      ? '<div class="info-grid">' +
        '<div class="info-card glass"><h3>Contract</h3><p>' + (data.security?.contractVerified ? '✅ Verified' : '⚠️ Not verified') + '</p></div>' +
        '<div class="info-card glass"><h3>Liquidity Lock</h3><p>' + (data.security?.liquidityLock ? '✅ Locked' : '⚠️ Unlocked') + '</p></div>' +
        '<div class="info-card glass"><h3>Scam Probability</h3><p>' + safe(data.security?.scamProbability) + '%</p></div>' +
        '<div class="info-card glass"><h3>Risk Level</h3><p class="risk-' + (r.riskLevel || '').toLowerCase() + '">' + safe(r.riskLevel) + '</p></div></div>'
      : '<div class="locked-message glass"><h3>Security — Premium</h3><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    '</div><div class="tab-pane" id="ai"><div class="ai-card glass">' +
    '<h3>AI Verdict: <span class="verdict">' + safe(ai.verdict) + '</span></h3>' +
    '<p style="line-height:1.65;margin:1rem 0;">' + safe(ai.text) + '</p>' +
    '<div class="ai-meta">Confidence: ' + safe(ai.confidence) + '%</div></div></div>' +
    '<div class="tab-pane" id="links">' +
    (isPrem && data.projectLinks
      ? '<div class="links-grid">' +
        (data.projectLinks.website ? '<a class="link-card glass" href="' + data.projectLinks.website + '" target="_blank">🌐 Website</a>' : '') +
        (data.projectLinks.twitter ? '<a class="link-card glass" href="' + data.projectLinks.twitter + '" target="_blank">🐦 Twitter</a>' : '') +
        (data.projectLinks.telegram ? '<a class="link-card glass" href="' + data.projectLinks.telegram + '" target="_blank">✈️ Telegram</a>' : '') +
        '</div>'
      : '<div class="locked-message glass"><h3>Links — Premium</h3><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    '</div></div>';

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  if (isPrem) {
    setTimeout(() => {
      initCandleChart(Number(t.price) || 1);
      document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentTimeframe = btn.dataset.tf;
          updateCandleData(Number(t.price) || 1);
        });
      });
    }, 100);
  }
  initAIChat(data);
}

function initAIChat(data) {
  const section = document.getElementById('ai-chat-section');
  if (!section) return;
  if (data.plan === 'Pro' || currentPlan === 'pro') {
    section.style.display = 'block';
    currentTokenContext = { token: data.token, risk: data.risk, plan: data.plan };
    document.getElementById('chat-messages').innerHTML = '';
    chatHistory = [];
  } else {
    section.style.display = 'none';
  }
}

function toggleChat() {
  const windowEl = document.getElementById('chat-window');
  const btn = document.getElementById('toggle-chat');
  if (windowEl.style.display === 'none') {
    windowEl.style.display = 'flex';
    btn.textContent = 'Hide chat';
  } else {
    windowEl.style.display = 'none';
    btn.textContent = 'Open chat';
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  addChatMessage('user', text);
  input.value = '';
  chatHistory.push({ role: 'user', content: text });
  const loadingId = addChatMessage('ai', 'Thinking...');
  try {
    const res = await fetch('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '' },
      body: JSON.stringify({ messages: chatHistory, context: currentTokenContext })
    });
    const data = await res.json();
    removeChatMessage(loadingId);
    if (!data.success) { addChatMessage('ai', data.error || 'Chat is Pro only'); return; }
    addChatMessage('ai', data.reply);
    chatHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    removeChatMessage(loadingId);
    addChatMessage('ai', 'AI connection failed');
  }
}

function addChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const id = 'msg-' + Date.now() + Math.random();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-msg ' + role;
  div.innerHTML = '<div class="msg-bubble">' + text + '</div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeChatMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ====================== HISTORY / WATCHLIST ======================
async function loadHistory() {
  const box = document.getElementById('history-content');
  if (!user) { box.innerHTML = '<div class="empty-state">Login to see history</div>'; return; }
  try {
    const res = await fetch('http://localhost:3000/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) { box.innerHTML = '<div class="empty-state">No scans yet</div>'; return; }
    box.innerHTML = data.history.map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>' + (h.address || '').slice(0, 12) + '... · Risk ' + h.riskScore + ' · ' +
      new Date(h.scannedAt).toLocaleString('ru-RU') + '</small></div><div class="list-actions">' +
      '<button class="btn-sm" onclick="rescan(\'' + h.address + '\')">Scan</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

function rescan(address) {
  showPage('scanner');
  document.getElementById('token-input').value = address;
  startScan();
}

async function loadWatchlist() {
  const box = document.getElementById('watchlist-content');
  if (!user) { box.innerHTML = '<div class="empty-state">Login to use watchlist</div>'; return; }
  try {
    const res = await fetch('http://localhost:3000/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) { box.innerHTML = '<div class="empty-state">Watchlist is empty</div>'; return; }
    box.innerHTML = data.watchlist.map(t =>
      '<div class="list-row"><div class="list-info"><strong>' + t.symbol +
      '</strong><small>' + t.address + '</small></div><div class="list-actions">' +
      '<button class="btn-sm" onclick="rescan(\'' + t.address + '\')">Scan</button>' +
      '<button class="btn-sm danger" onclick="removeWatch(\'' + t.address + '\')">Remove</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

async function addWatch(address, symbol, name) {
  if (!user) return openAuthModal();
  if (!address) return;
  try {
    const res = await fetch('http://localhost:3000/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ address, symbol, name })
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    alert('Added to watchlist');
    loadHomeWatchlist();
  } catch (e) {
    alert('Failed to add');
  }
}

async function removeWatch(address) {
  await fetch('http://localhost:3000/api/watchlist/' + address, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadWatchlist();
  loadHomeWatchlist();
}

// ====================== ALERTS + TELEGRAM ======================
async function loadAlerts() {
  const box = document.getElementById('alerts-content');
  if (!user) { box.innerHTML = '<div class="empty-state">Login to manage alerts</div>'; return; }
  try {
    const res = await fetch('http://localhost:3000/api/alerts', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.alerts?.length) {
      box.innerHTML = '<div class="empty-state">No alerts yet</div>';
    } else {
      box.innerHTML = data.alerts.map(a =>
        '<div class="list-row"><div class="list-info"><strong>' + a.symbol + ' · ' + a.type.replace('_', ' ') +
        '</strong><small>' + a.address.slice(0, 12) + '... · value: ' + a.value +
        '</small></div><div class="list-actions">' +
        '<button class="btn-sm danger" onclick="removeAlertItem(\'' + a.id + '\')">Delete</button></div></div>'
      ).join('');
    }
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
  refreshTelegramStatus();
}

async function createAlert() {
  if (!user) return openAuthModal();
  const address = document.getElementById('alert-address').value.trim();
  const symbol = document.getElementById('alert-symbol').value.trim();
  const type = document.getElementById('alert-type').value;
  const value = document.getElementById('alert-value').value;
  if (!address || value === '') return alert('Fill address and value');
  const res = await fetch('http://localhost:3000/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type, address, symbol, value })
  });
  const data = await res.json();
  if (!data.success) return alert(data.error || 'Error');
  document.getElementById('alert-address').value = '';
  document.getElementById('alert-value').value = '';
  loadAlerts();
}

async function removeAlertItem(id) {
  await fetch('http://localhost:3000/api/alerts/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadAlerts();
}

async function refreshTelegramStatus() {
  if (!token) return;
  try {
    const res = await fetch('http://localhost:3000/api/telegram/status', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    const st = document.getElementById('tg-status');
    const btn = document.getElementById('tg-connect-btn');
    if (!st || !btn) return;
    if (data.linked) {
      st.textContent = 'Подключено ✓';
      st.style.color = '#00ffc8';
      btn.textContent = 'Disconnect';
      btn.onclick = disconnectTelegram;
    } else {
      st.textContent = 'Не подключено';
      st.style.color = '#888';
      btn.textContent = 'Connect Telegram';
      btn.onclick = connectTelegram;
    }
  } catch (e) {}
}

async function connectTelegram() {
  if (!user) return openAuthModal();
  try {
    const res = await fetch('http://localhost:3000/api/telegram/link', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    document.getElementById('tg-link-area').style.display = 'block';
    document.getElementById('tg-deep-link').href = data.deepLink;
    document.getElementById('tg-code').textContent = data.code;
  } catch (e) {
    alert('Не удалось создать ссылку');
  }
}

async function disconnectTelegram() {
  try {
    await fetch('http://localhost:3000/api/telegram/link', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
    document.getElementById('tg-link-area').style.display = 'none';
    refreshTelegramStatus();
  } catch (e) {
    alert('Ошибка отключения');
  }
}

// ====================== COMPARE ======================
async function runCompare() {
  const a1 = document.getElementById('cmp-1').value.trim();
  const a2 = document.getElementById('cmp-2').value.trim();
  const a3 = document.getElementById('cmp-3').value.trim();
  const addresses = [a1, a2, a3].filter(Boolean);
  if (addresses.length < 2) return alert('Enter at least 2 addresses');
  const box = document.getElementById('compare-content');
  box.innerHTML = '<div class="loading">Comparing...</div>';
  try {
    const res = await fetch('http://localhost:3000/api/compare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? 'Bearer ' + token : ''
      },
      body: JSON.stringify({ addresses })
    });
    const data = await res.json();
    if (!data.success) {
      box.innerHTML = '<div class="error-card">' + data.error + '</div>';
      return;
    }
    box.innerHTML = '<div class="compare-grid">' + data.tokens.map(t =>
      '<div class="compare-card glass"><h3>' + t.symbol + '</h3>' +
      '<div class="compare-metric"><span>Price</span><span>$' + Number(t.price).toFixed(6) + '</span></div>' +
      '<div class="compare-metric"><span>Liquidity</span><span>' + formatNum(t.liquidity) + '</span></div>' +
      '<div class="compare-metric"><span>Volume 24h</span><span>' + formatNum(t.volume24h) + '</span></div>' +
      '<div class="compare-metric"><span>FDV</span><span>' + formatNum(t.fdv) + '</span></div>' +
      '<button class="btn-sm" style="margin-top:0.8rem;" onclick="rescan(\'' + t.address + '\')">Full scan</button></div>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="error-card">Compare failed</div>';
  }
}