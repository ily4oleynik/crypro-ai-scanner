// frontend/app.js
const API_BASE = window.API_BASE || 'http://localhost:3000';

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
  document.getElementById('nav-account')?.addEventListener('click', e => { e.preventDefault(); showPage('account'); });

  document.querySelectorAll('.plan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!user) return openAuthModal();
      document.querySelectorAll('.plan-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlan = btn.dataset.plan;
    });
  });

  document.getElementById('auth-btn')?.addEventListener('click', () => {
    if (user) logout();
    else openAuthModal();
  });
  document.getElementById('modal-close')?.addEventListener('click', closeAuthModal);
  document.getElementById('auth-form')?.addEventListener('submit', handleAuth);
  document.getElementById('acc-logout')?.addEventListener('click', () => logout());

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      const title = document.getElementById('auth-title');
      const submit = document.getElementById('auth-submit');
      if (typeof t === 'function') {
        if (title) title.textContent = mode === 'login' ? t('auth.login') : t('auth.register');
        if (submit) submit.textContent = mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister');
      } else {
        if (title) title.textContent = mode === 'login' ? 'Login' : 'Register';
        if (submit) submit.textContent = mode === 'login' ? 'Login' : 'Create Account';
      }
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
  document.getElementById('token-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') startScan();
  });

  document.getElementById('toggle-chat')?.addEventListener('click', toggleChat);
  document.getElementById('chat-send')?.addEventListener('click', sendChatMessage);
  document.getElementById('chat-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendChatMessage();
  });

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

  if (typeof setLanguage === 'function') {
    setLanguage(localStorage.getItem('lang') || 'ru');
  }

  loadNews();
  updateAuthUI();
  refreshUsage();
  loadHomeWidgets();
});

function openAuthModal() {
  document.getElementById('auth-modal').style.display = 'flex';
}
function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const isLogin = document.querySelector('.auth-tab.active')?.dataset?.mode !== 'register';
  try {
    const res = await fetch(API_BASE + '/api/auth/' + (isLogin ? 'login' : 'register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    token = data.token;
    user = data.user;
    currentPlan = data.user.plan;
    localStorage.setItem('token', token);
    closeAuthModal();
    updateAuthUI();
    refreshUsage();
    loadHomeWidgets();
    refreshAccountPage();
    alert('OK · ' + (data.user.plan || '').toUpperCase());
  } catch (err) {
    alert(typeof t === 'function' ? t('scanner.connectionError') : 'Connection error');
  }
}

function logout() {
  token = null;
  user = null;
  currentPlan = 'free';
  localStorage.removeItem('token');
  updateAuthUI();
  const portfolio = document.getElementById('portfolio-section');
  if (portfolio) portfolio.style.display = 'none';
  const ex = document.getElementById('connected-exchanges');
  if (ex) ex.innerHTML = '<p class="muted">' + (typeof t === 'function' ? t('home.nothingConnected') : 'Nothing connected') + '</p>';
  const chat = document.getElementById('ai-chat-section');
  if (chat) chat.style.display = 'none';
  refreshUsage();
  loadHomeWidgets();
  refreshAccountPage();
}

function updateAuthUI() {
  const authBtn = document.getElementById('auth-btn');
  const planLabel = document.getElementById('user-plan');
  if (!authBtn) return;
  if (user) {
    authBtn.textContent = typeof t === 'function' ? t('nav.logout') : 'Logout';
    if (planLabel) {
      planLabel.textContent = (user.plan || 'free').toUpperCase();
      planLabel.style.display = 'inline-block';
    }
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.plan === user.plan);
    });
    currentPlan = user.plan || 'free';
  } else {
    authBtn.textContent = typeof t === 'function' ? t('nav.login') : 'Login';
    if (planLabel) planLabel.style.display = 'none';
  }
}

function showPage(page) {
  ['home', 'scanner', 'watchlist', 'history', 'alerts', 'compare', 'account'].forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.style.display = p === page ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('nav-' + page)?.classList.add('active');
  if (page === 'home') loadHomeWidgets();
  if (page === 'account') refreshAccountPage();
}

async function refreshUsage() {
  try {
    const res = await fetch(API_BASE + '/api/usage', {
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

async function refreshAccountPage() {
  const emailEl = document.getElementById('acc-email');
  const planEl = document.getElementById('acc-plan');
  const scansEl = document.getElementById('acc-scans');
  if (!user) {
    if (emailEl) emailEl.textContent = '—';
    if (planEl) planEl.textContent = 'FREE';
    if (scansEl) scansEl.textContent = '—';
    return;
  }
  if (emailEl) emailEl.textContent = user.email || '—';
  if (planEl) planEl.textContent = (user.plan || 'free').toUpperCase();
  try {
    const res = await fetch(API_BASE + '/api/usage', {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (data.success && data.usage && scansEl) {
      const lim = data.usage.limit === 999999 ? '∞' : data.usage.limit;
      scansEl.textContent = data.usage.used + ' / ' + lim;
    }
  } catch (e) {}
  if (typeof refreshTelegramStatus === 'function') refreshTelegramStatus();
}

async function loadHomeWidgets() {
  loadHomeWatchlist();
  loadHomeHistory();
}

async function loadHomeWatchlist() {
  const box = document.getElementById('home-watchlist');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state">' + (typeof t === 'function' ? t('home.watchlistEmpty') : 'Login and add tokens') + '</div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state">' + (typeof t === 'function' ? t('home.watchlistEmpty') : 'Watchlist empty') + '</div>';
      return;
    }
    box.innerHTML = '<div class="home-chip-row">' + data.watchlist.slice(0, 8).map(item =>
      '<button class="home-chip" onclick="rescan(\'' + item.address + '\')"><strong>' +
      (item.symbol || 'TOKEN') + '</strong></button>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Error</div>';
  }
}

async function loadHomeHistory() {
  const box = document.getElementById('home-history');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state">' + (typeof t === 'function' ? t('home.historyEmpty') : 'No scans') + '</div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state">' + (typeof t === 'function' ? t('home.historyEmpty') : 'No scans') + '</div>';
      return;
    }
    box.innerHTML = data.history.slice(0, 5).map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>Risk ' + h.riskScore + ' · ' + new Date(h.scannedAt).toLocaleString() +
      '</small></div><div class="list-actions"><button class="btn-sm" onclick="rescan(\'' + h.address +
      '\')">' + (typeof t === 'function' ? t('common.open') || 'Open' : 'Open') + '</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Error</div>';
  }
}

// WALLET
async function connectWallet() {
  if (typeof window.ethereum === 'undefined') return alert('Install MetaMask');
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const btn = document.getElementById('connect-wallet');
    if (btn) btn.textContent = accounts[0].slice(0, 6) + '...' + accounts[0].slice(-4);
    const section = document.getElementById('portfolio-section');
    if (section) section.style.display = 'block';
    analyzePortfolio(accounts[0]);
  } catch (e) {
    alert('Wallet connection failed');
  }
}

async function analyzePortfolio(address) {
  const content = document.getElementById('portfolio-content');
  if (!content) return;
  content.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const res = await fetch(API_BASE + '/api/portfolio/' + address, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (data.locked) {
      content.innerHTML = '<div class="locked-message"><p>Portfolio — Premium+</p><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>';
      return;
    }
    content.innerHTML =
      '<div class="metrics-grid">' +
      '<div class="metric-card glass"><div class="metric-label">Value</div><div class="metric-value">$' + data.totalValue.toLocaleString() + '</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Risk</div><div class="metric-value">' + data.portfolioRisk + '/100</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Tokens</div><div class="metric-value">' + data.tokenCount + '</div></div>' +
      '</div>';
  } catch (e) {
    content.innerHTML = '<div class="error-card">Portfolio error</div>';
  }
}

// BYBIT
async function connectBybit(e) {
  e.preventDefault();
  const apiKey = document.getElementById('bybit-api-key').value.trim();
  const apiSecret = document.getElementById('bybit-api-secret').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Connecting...';
  submitBtn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/exchanges/bybit', {
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

function renderBybitData(data) {
  const container = document.getElementById('connected-exchanges');
  if (!container) return;
  const balancesHtml = (data.balances || []).map(b =>
    '<span style="margin-right:1rem;">' + b.coin + ': <strong>' + b.equity + '</strong></span>'
  ).join('') || 'No assets';
  container.innerHTML =
    '<div><strong>Bybit</strong> · $' + Number(data.totalEquityUsd).toLocaleString() + '</div>' +
    '<div class="muted" style="margin-top:0.5rem;">' + balancesHtml + '</div>';
}

// NEWS
async function loadNews() {
  const grid = document.getElementById('news-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const res = await fetch(API_BASE + '/api/news');
    const data = await res.json();
    if (!data.success || !data.news?.length) {
      grid.innerHTML = '<div class="error-card">No news</div>';
      return;
    }
    grid.innerHTML = data.news.map(item =>
      '<a href="' + (item.url || '#') + '" target="_blank" class="news-card glass">' +
      '<h3 class="news-title">' + item.title + '</h3>' +
      '<div class="news-meta">' + item.source + ' · ' + item.time + '</div></a>'
    ).join('');
  } catch (e) {
    grid.innerHTML = '<div class="error-card">News error</div>';
  }
}

// SCANNER
async function startScan() {
  const address = document.getElementById('token-input').value.trim();
  if (!address) return alert(typeof t === 'function' ? t('scanner.enterAddress') : 'Enter address');
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading">' + (typeof t === 'function' ? t('scanner.loading') : 'Loading...') + '</div>';
  const chatSec = document.getElementById('ai-chat-section');
  if (chatSec) chatSec.style.display = 'none';
  chatHistory = [];
  try {
    const res = await fetch(API_BASE + '/api/scan/' + address + '?plan=' + currentPlan, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (res.status === 429 || (data.error && String(data.error).includes('Лимит'))) {
      results.innerHTML = '<div class="error-card">' + (data.error || 'Limit reached') + '</div>';
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
    lastScannedToken = { address, symbol: data.token?.symbol, name: data.token?.name };
    renderTokenPage(data);
    refreshUsage();
  } catch (e) {
    results.innerHTML = '<div class="error-card">' + (typeof t === 'function' ? t('scanner.connectionError') : 'Error') + '</div>';
  }
}

function safe(v, fb) {
  if (fb === undefined) fb = '—';
  if (v === null || v === undefined || Number.isNaN(v)) return fb;
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
    rightPriceScale: { borderColor: '#1e2438' },
    timeScale: { borderColor: '#1e2438', timeVisible: true }
  });
  candleSeries = candleChart.addCandlestickSeries({
    upColor: '#00ffc8', downColor: '#ff4d6a',
    borderUpColor: '#00ffc8', borderDownColor: '#ff4d6a',
    wickUpColor: '#00ffc8', wickDownColor: '#ff4d6a'
  });
  volumeSeries = candleChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.75, bottom: 0 }
  });
  candleChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
  const data = generateCandleAndVolumeData(currentPrice, currentTimeframe);
  candleSeries.setData(data.candles);
  volumeSeries.setData(data.volumes);
  candleChart.timeScale().fitContent();
  window.addEventListener('resize', () => {
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
  const tok = data.token || {};
  const r = data.risk || {};
  const ai = data.ai || {};
  const isPrem = data.plan === 'Premium' || data.plan === 'Pro';
  const isPro = data.plan === 'Pro';
  const addr = lastScannedToken?.address || '';
  const adv = data.advanced || {};

  document.getElementById('results').innerHTML =
    '<div class="token-header glass">' +
    '<div class="token-left"><div class="token-icon">' + (tok.symbol || 'TK').slice(0, 2) + '</div>' +
    '<div><h1 class="token-title">' + safe(tok.symbol) + ' <span class="token-name">' + safe(tok.name) + '</span></h1>' +
    '<div class="token-price">$' + safe(tok.price) + '</div></div></div>' +
    '<div class="token-right">' +
    '<div class="risk-pill risk-' + (r.riskLevel || 'medium').toLowerCase() + '">Risk ' + safe(r.riskScore) + '/100</div>' +
    '<div class="plan-badge" style="display:inline-block;margin-top:0.4rem;">' + safe(data.plan) + '</div>' +
    '<button class="btn-sm" style="margin-top:0.5rem;" onclick="addWatch(\'' + addr + '\',\'' + (tok.symbol || '') + '\',\'' + (tok.name || '') + '\')">+ Watchlist</button>' +
    '</div></div>' +
    '<div class="metrics-grid">' +
    '<div class="metric-card glass"><div class="metric-label">Market Cap</div><div class="metric-value">' + formatNum(tok.marketCap || tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">FDV</div><div class="metric-value">' + formatNum(tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Volume 24h</div><div class="metric-value">' + formatNum(tok.volume24h) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Liquidity</div><div class="metric-value">' + formatNum(tok.liquidity) + '</div></div>' +
    '</div>' +
    '<div class="tabs">' +
    '<button class="tab active" data-tab="overview">Overview</button>' +
    '<button class="tab" data-tab="security">Security</button>' +
    '<button class="tab" data-tab="ai">AI</button>' +
    '<button class="tab" data-tab="links">Links</button></div>' +
    '<div class="tab-content">' +
    '<div class="tab-pane active" id="overview">' +
    (isPrem
      ? '<div class="chart-wrapper glass"><div class="timeframe-switcher">' +
        '<button class="tf-btn active" data-tf="1H">1H</button>' +
        '<button class="tf-btn" data-tf="4H">4H</button>' +
        '<button class="tf-btn" data-tf="1D">1D</button>' +
        '<button class="tf-btn" data-tf="1W">1W</button></div>' +
        '<div id="candle-chart" class="candle-chart"></div></div>'
      : '<div class="locked-message glass"><p>Chart — Premium</p><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    (isPro
      ? '<div class="advanced-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Whale</div><div class="metric-value">' + safe(adv.whaleConcentration) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Buy/Sell</div><div class="metric-value">' + safe(adv.buySellRatio) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Volatility</div><div class="metric-value">' + safe(adv.volatility) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Holders</div><div class="metric-value">' + safe(adv.holderCount) + '</div></div></div>'
      : '') +
    '</div>' +
    '<div class="tab-pane" id="security">' +
    (isPrem
      ? '<div class="metrics-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Contract</div><div class="metric-value">' + (data.security?.contractVerified ? 'Verified' : 'Not verified') + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Scam %</div><div class="metric-value">' + safe(data.security?.scamProbability) + '%</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Risk</div><div class="metric-value risk-' + (r.riskLevel || '').toLowerCase() + '">' + safe(r.riskLevel) + '</div></div></div>'
      : '<div class="locked-message glass"><p>Security — Premium</p><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    '</div>' +
    '<div class="tab-pane" id="ai"><div class="ai-card glass">' +
    '<h3>AI: <span class="verdict">' + safe(ai.verdict) + '</span></h3>' +
    '<p style="margin:1rem 0;line-height:1.65;">' + safe(ai.text) + '</p>' +
    '<div class="muted">Confidence: ' + safe(ai.confidence) + '%</div></div></div>' +
    '<div class="tab-pane" id="links">' +
    (isPrem && data.projectLinks
      ? '<div class="home-chip-row">' +
        (data.projectLinks.website ? '<a class="home-chip" href="' + data.projectLinks.website + '" target="_blank">Website</a>' : '') +
        (data.projectLinks.twitter ? '<a class="home-chip" href="' + data.projectLinks.twitter + '" target="_blank">Twitter</a>' : '') +
        (data.projectLinks.telegram ? '<a class="home-chip" href="' + data.projectLinks.telegram + '" target="_blank">Telegram</a>' : '') +
        '</div>'
      : '<div class="locked-message glass"><p>Links — Premium</p><button class="upgrade-btn" onclick="openAuthModal()">Upgrade</button></div>') +
    '</div></div>';

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab)?.classList.add('active');
    });
  });

  if (isPrem) {
    setTimeout(() => {
      initCandleChart(Number(tok.price) || 1);
      document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentTimeframe = btn.dataset.tf;
          updateCandleData(Number(tok.price) || 1);
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
  if (!windowEl) return;
  if (windowEl.style.display === 'none' || !windowEl.style.display) {
    windowEl.style.display = 'flex';
    if (btn) btn.textContent = 'Hide';
  } else {
    windowEl.style.display = 'none';
    if (btn) btn.textContent = 'Open chat';
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  addChatMessage('user', text);
  input.value = '';
  chatHistory.push({ role: 'user', content: text });
  const loadingId = addChatMessage('ai', '...');
  try {
    const res = await fetch(API_BASE + '/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? 'Bearer ' + token : ''
      },
      body: JSON.stringify({ messages: chatHistory, context: currentTokenContext })
    });
    const data = await res.json();
    removeChatMessage(loadingId);
    if (!data.success) {
      addChatMessage('ai', data.error || 'Pro only');
      return;
    }
    addChatMessage('ai', data.reply);
    chatHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    removeChatMessage(loadingId);
    addChatMessage('ai', 'AI error');
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
  document.getElementById(id)?.remove();
}

// HISTORY / WATCHLIST
async function loadHistory() {
  const box = document.getElementById('history-content');
  if (!box) return;
  if (!user) {
    box.innerHTML = '<div class="empty-state">Login</div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state">Empty</div>';
      return;
    }
    box.innerHTML = data.history.map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>' + (h.address || '').slice(0, 12) + '... · Risk ' + h.riskScore +
      '</small></div><div class="list-actions"><button class="btn-sm" onclick="rescan(\'' + h.address + '\')">Scan</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Error</div>';
  }
}

function rescan(address) {
  showPage('scanner');
  document.getElementById('token-input').value = address;
  startScan();
}

async function loadWatchlist() {
  const box = document.getElementById('watchlist-content');
  if (!box) return;
  if (!user) {
    box.innerHTML = '<div class="empty-state">Login</div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state">Empty</div>';
      return;
    }
    box.innerHTML = data.watchlist.map(item =>
      '<div class="list-row"><div class="list-info"><strong>' + item.symbol +
      '</strong><small>' + item.address + '</small></div><div class="list-actions">' +
      '<button class="btn-sm" onclick="rescan(\'' + item.address + '\')">Scan</button>' +
      '<button class="btn-sm danger" onclick="removeWatch(\'' + item.address + '\')">Remove</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Error</div>';
  }
}

async function addWatch(address, symbol, name) {
  if (!user) return openAuthModal();
  if (!address) return;
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ address, symbol, name })
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    alert('Added to watchlist');
    loadHomeWatchlist();
  } catch (e) {
    alert('Failed');
  }
}

async function removeWatch(address) {
  await fetch(API_BASE + '/api/watchlist/' + address, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadWatchlist();
  loadHomeWatchlist();
}

// ALERTS + TELEGRAM
async function loadAlerts() {
  const box = document.getElementById('alerts-content');
  if (!box) return;
  if (!user) {
    box.innerHTML = '<div class="empty-state">Login</div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/alerts', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.alerts?.length) {
      box.innerHTML = '<div class="empty-state">' + (typeof t === 'function' ? t('alerts.empty') : 'No alerts') + '</div>';
    } else {
      box.innerHTML = data.alerts.map(a =>
        '<div class="list-row"><div class="list-info"><strong>' + a.symbol + ' · ' + a.type +
        '</strong><small>' + a.address.slice(0, 12) + '... · ' + a.value +
        '</small></div><div class="list-actions">' +
        '<button class="btn-sm danger" onclick="removeAlertItem(\'' + a.id + '\')">Delete</button></div></div>'
      ).join('');
    }
  } catch (e) {
    box.innerHTML = '<div class="empty-state">Error</div>';
  }
}

async function createAlert() {
  if (!user) return openAuthModal();
  const address = document.getElementById('alert-address').value.trim();
  const symbol = document.getElementById('alert-symbol').value.trim();
  const type = document.getElementById('alert-type').value;
  const value = document.getElementById('alert-value').value;
  if (!address || value === '') return alert('Fill address and value');
  const res = await fetch(API_BASE + '/api/alerts', {
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
  await fetch(API_BASE + '/api/alerts/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadAlerts();
}

async function refreshTelegramStatus() {
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/telegram/status', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    const st = document.getElementById('tg-status');
    const btn = document.getElementById('tg-connect-btn');
    if (!st || !btn) return;
    if (data.linked) {
      st.textContent = typeof t === 'function' ? t('alerts.linked') : 'Connected ✓';
      st.style.color = '#00ffc8';
      btn.textContent = typeof t === 'function' ? t('alerts.disconnectTg') : 'Disconnect';
      btn.onclick = disconnectTelegram;
    } else {
      st.textContent = typeof t === 'function' ? t('alerts.notLinked') : 'Not connected';
      st.style.color = '#888';
      btn.textContent = typeof t === 'function' ? t('alerts.connectTg') : 'Connect Telegram';
      btn.onclick = connectTelegram;
    }
  } catch (e) {}
}

async function connectTelegram() {
  if (!user) return openAuthModal();
  try {
    const res = await fetch(API_BASE + '/api/telegram/link', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'Error');
    const area = document.getElementById('tg-link-area');
    if (area) area.style.display = 'block';
    const link = document.getElementById('tg-deep-link');
    if (link) link.href = data.deepLink;
    const code = document.getElementById('tg-code');
    if (code) code.textContent = data.code;
  } catch (e) {
    alert('Telegram link failed');
  }
}

async function disconnectTelegram() {
  try {
    await fetch(API_BASE + '/api/telegram/link', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
    const area = document.getElementById('tg-link-area');
    if (area) area.style.display = 'none';
    refreshTelegramStatus();
  } catch (e) {
    alert('Error');
  }
}

// COMPARE
async function runCompare() {
  const a1 = document.getElementById('cmp-1').value.trim();
  const a2 = document.getElementById('cmp-2').value.trim();
  const a3 = document.getElementById('cmp-3').value.trim();
  const addresses = [a1, a2, a3].filter(Boolean);
  if (addresses.length < 2) {
    return alert(typeof t === 'function' ? t('compare.need2') : 'Need 2 addresses');
  }
  const box = document.getElementById('compare-content');
  box.innerHTML = '<div class="loading">...</div>';
  try {
    const res = await fetch(API_BASE + '/api/compare', {
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
    box.innerHTML = '<div class="compare-grid">' + data.tokens.map(tok =>
      '<div class="compare-card glass"><h3>' + tok.symbol + '</h3>' +
      '<div class="compare-metric"><span>Price</span><span>$' + Number(tok.price).toFixed(6) + '</span></div>' +
      '<div class="compare-metric"><span>Liquidity</span><span>' + formatNum(tok.liquidity) + '</span></div>' +
      '<div class="compare-metric"><span>Volume</span><span>' + formatNum(tok.volume24h) + '</span></div>' +
      '<div class="compare-metric"><span>FDV</span><span>' + formatNum(tok.fdv) + '</span></div>' +
      '<button class="btn-sm" style="margin-top:0.8rem;" onclick="rescan(\'' + tok.address + '\')">Scan</button></div>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="error-card">Compare failed</div>';
  }
}
