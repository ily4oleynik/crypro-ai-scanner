const API_BASE = window.API_BASE || window.location.origin;

let currentPlan = 'free';
let user = null;
let token = localStorage.getItem('token') || null;
let candleChart = null;
let candleSeries = null;
let volumeSeries = null;
let currentTimeframe = '1H';
let chatHistory = [];
let currentTokenContext = null;
let lastScannedToken = null;
let lastPairMeta = null;
let pendingPlan = null;
let newsSource = 'all';

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
      const plan = btn.dataset.plan;
      if (plan === 'free') {
        currentPlan = 'free';
        document.querySelectorAll('.plan-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }
      openPricing(plan);
    });
  });

  document.getElementById('auth-btn')?.addEventListener('click', () => {
    if (user) logout();
    else openAuthModal();
  });
  document.getElementById('modal-close')?.addEventListener('click', closeAuthModal);
  document.getElementById('auth-form')?.addEventListener('submit', handleAuth);
  document.getElementById('acc-logout')?.addEventListener('click', () => logout());

  document.getElementById('pricing-close')?.addEventListener('click', closePricing);
  document.querySelectorAll('.pricing-pick').forEach(btn => {
    btn.addEventListener('click', () => selectPlan(btn.dataset.plan));
  });

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      const title = document.getElementById('auth-title');
      const submit = document.getElementById('auth-submit');
      const pass2 = document.getElementById('auth-password2');
      const terms = document.getElementById('auth-terms-wrap');
      const err = document.getElementById('auth-error');
      if (err) { err.style.display = 'none'; err.textContent = ''; }
      const loginLabel = typeof t === 'function' ? t('auth.login') : 'Login';
      const regLabel = typeof t === 'function' ? t('auth.register') : 'Create account';
      if (title) title.textContent = mode === 'login' ? loginLabel : regLabel;
      if (submit) submit.textContent = mode === 'login' ? loginLabel : regLabel;
      if (pass2) pass2.style.display = mode === 'register' ? 'block' : 'none';
      if (terms) terms.style.display = mode === 'register' ? 'flex' : 'none';
      const p1 = document.getElementById('auth-password');
      if (p1) p1.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    });
  });

  document.getElementById('connect-wallet')?.addEventListener('click', connectWallet);
  document.getElementById('connect-bybit-btn')?.addEventListener('click', () => {
    if (!user) return openAuthModal('Sign in to connect Bybit');
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
    document.getElementById('token-input').value = '';
    document.getElementById('token-input')?.focus();
  });
  document.getElementById('go-scanner-btn')?.addEventListener('click', () => {
    showPage('scanner');
    document.getElementById('token-input').value = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
    startScan();
  });
  document.getElementById('example-report-btn')?.addEventListener('click', showExampleReport);

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

  document.getElementById('news-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-source]');
    if (!btn) return;
    document.querySelectorAll('#news-filters .tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadNews(btn.dataset.source);
  });

  document.getElementById('refresh-trending')?.addEventListener('click', loadTrending);
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  if (typeof setLanguage === 'function') {
    setLanguage(localStorage.getItem('lang') || 'ru');
  }

  initTheme();
  initBurger();
  initOnboarding();
  loadTicker();
  loadTrending();
  loadNews('all');
  updateAuthUI();
  refreshUsage();
  loadHomeWidgets();
  setInterval(loadTicker, 60000);
});

function showExampleReport() {
  showPage('scanner');
  const results = document.getElementById('results');
  if (!results) return;
  results.innerHTML =
    '<div class="example-report glass">' +
    '<h3>Premium analysis example</h3>' +
    '<p class="muted small">Demo report. Real numbers depend on the token.</p>' +
    '<div class="ex-block"><div class="ex-label">Risk Score</div><div class="metric-value risk-MEDIUM">67 / 100 · MEDIUM</div></div>' +
    '<div class="ex-block"><div class="ex-label">Security</div>Contract: Verified · Scam probability: ~22%</div>' +
    '<div class="ex-block"><div class="ex-label">AI Summary</div>Liquidity is moderate, 24h volume is not anomalous. DYOR.</div>' +
    '<div class="ex-block"><div class="ex-label">Verdict</div><span class="verdict">Cautious interest</span></div>' +
    '<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Get reports like this — Premium</button>' +
    '</div>';
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.body.classList.toggle('theme-light', saved === 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = saved === 'light' ? '☀' : '☾';
}

function toggleTheme() {
  const light = !document.body.classList.contains('theme-light');
  document.body.classList.toggle('theme-light', light);
  localStorage.setItem('theme', light ? 'light' : 'dark');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = light ? '☀' : '☾';
}

function initBurger() {
  const burger = document.getElementById('nav-burger');
  const links = document.getElementById('nav-links');
  if (!burger || !links) return;
  burger.addEventListener('click', () => links.classList.toggle('open'));
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => links.classList.remove('open'));
  });
}

function initOnboarding() {
  if (localStorage.getItem('ob_done') === '1') return;
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  let step = 1;
  const show = (n) => {
    document.querySelectorAll('.ob-step').forEach(s => {
      s.classList.toggle('active', Number(s.dataset.step) === n);
    });
    const next = document.getElementById('ob-next');
    if (next) next.textContent = n >= 3 ? 'Start' : 'Next';
  };
  document.getElementById('ob-next')?.addEventListener('click', () => {
    if (step >= 3) {
      localStorage.setItem('ob_done', '1');
      modal.style.display = 'none';
      showPage('scanner');
      return;
    }
    step += 1;
    show(step);
  });
  document.getElementById('ob-skip')?.addEventListener('click', () => {
    localStorage.setItem('ob_done', '1');
    modal.style.display = 'none';
  });
}

async function loadTicker() {
  const inner = document.getElementById('ticker-inner');
  if (!inner) return;
  try {
    const res = await fetch(API_BASE + '/api/ticker');
    const data = await res.json();
    const items = data.ticker || [];
    if (!items.length) {
      inner.innerHTML = '<span class="ticker-item">Markets unavailable</span>';
      return;
    }
    const html = items.map((t) => {
      const ch = t.change24h;
      const cls = ch > 0 ? 'ticker-up' : ch < 0 ? 'ticker-down' : '';
      const sign = ch > 0 ? '+' : '';
      const price = t.price == null ? '—' : t.price >= 100
        ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : t.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
      const chStr = ch == null ? '' : '<span class="' + cls + '">' + sign + Number(ch).toFixed(2) + '%</span>';
      return '<span class="ticker-item"><strong>' + t.symbol + '</strong><span>$' + price + '</span>' + chStr + '</span>';
    }).join('');
    inner.innerHTML = html + html;
  } catch (e) {
    inner.innerHTML = '<span class="ticker-item">Ticker unavailable</span>';
  }
}

async function loadTrending() {
  const grid = document.getElementById('trending-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const res = await fetch(API_BASE + '/api/trending');
    const data = await res.json();
    const tokens = data.tokens || [];
    if (!tokens.length) {
      grid.innerHTML = '<div class="empty-state-cta"><p>No trending</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scanner</button></div>';
      return;
    }
    grid.innerHTML = tokens.map(t => {
      const price = t.price == null ? '—' : '$' + Number(t.price).toPrecision(5);
      return '<div class="trend-card" onclick="rescan(\'' + t.address + '\')">' +
        '<div class="trend-sym">' + (t.symbol || 'TOKEN') + '</div>' +
        '<div class="trend-price">' + price + '</div>' +
        '<div class="trend-meta">' + (t.name || t.chainId || '') + '</div></div>';
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state-cta"><p>Error</p><button type="button" class="connect-btn" onclick="loadTrending()">Retry</button></div>';
  }
}

function openPricing(highlightPlan) {
  pendingPlan = highlightPlan || null;
  const modal = document.getElementById('pricing-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  document.querySelectorAll('.price-card').forEach(card => {
    card.classList.toggle('featured', !!highlightPlan && card.dataset.plan === highlightPlan);
  });
}

function closePricing() {
  const modal = document.getElementById('pricing-modal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

async function selectPlan(plan) {
  pendingPlan = plan;
  if (plan === 'free') {
    currentPlan = 'free';
    document.querySelectorAll('.plan-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.plan === 'free');
    });
    closePricing();
    return;
  }
  if (!user) {
    closePricing();
    openAuthModal('Sign in or create an account to activate ' + plan.toUpperCase());
    return;
  }
  await activatePlanDemo(plan);
}

async function activatePlanDemo(plan) {
  try {
    const res = await fetch(API_BASE + '/api/user/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ plan })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Could not change plan');
      return;
    }
    if (data.token) {
      token = data.token;
      localStorage.setItem('token', token);
    }
    currentPlan = data.plan || plan;
    if (user) user.plan = currentPlan;
    document.querySelectorAll('.plan-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.plan === currentPlan);
    });
    updateAuthUI();
    closePricing();
    refreshAccountPage();
    refreshUsage();
    alert(currentPlan.toUpperCase() + ' saved (demo until payments).');
  } catch (e) {
    alert('Network error');
  }
}

function openAuthModal(hintText) {
  const modal = document.getElementById('auth-modal');
  const hint = document.getElementById('auth-hint');
  if (hint) {
    if (hintText) {
      hint.textContent = hintText;
      hint.style.display = 'block';
      hint.dataset.custom = '1';
    } else {
      hint.textContent = typeof t === 'function' ? t('auth.hint') : '';
      hint.style.display = hint.textContent ? 'block' : 'none';
      delete hint.dataset.custom;
    }
  }
  if (modal) modal.style.display = 'flex';
  document.body.classList.add('modal-open');
  if (typeof applyTranslations === 'function') applyTranslations();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  const hint = document.getElementById('auth-hint');
  if (hint) {
    hint.textContent = '';
    hint.style.display = 'none';
    delete hint.dataset.custom;
  }
  const err = document.getElementById('auth-error');
  if (err) {
    err.textContent = '';
    err.style.display = 'none';
  }
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const isLogin = document.querySelector('.auth-tab.active')?.dataset?.mode !== 'register';
  const errEl = document.getElementById('auth-error');
  const showErr = (msg) => {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    } else alert(msg);
  };
  if (errEl) errEl.style.display = 'none';

  if (!isLogin) {
    const password2 = document.getElementById('auth-password2')?.value || '';
    const acceptTerms = !!document.getElementById('auth-terms')?.checked;
    if (password.length < 8) return showErr('Password: at least 8 characters');
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return showErr('Password: at least one letter and one number');
    }
    if (password !== password2) return showErr('Passwords do not match');
    if (!acceptTerms) return showErr('Please accept Terms and Privacy Policy');
  }

  try {
    const body = isLogin
      ? { email, password }
      : { email, password, acceptTerms: true };

    const res = await fetch(API_BASE + '/api/auth/' + (isLogin ? 'login' : 'register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.success) return showErr(data.error || 'Error');

    token = data.token;
    user = data.user;
    currentPlan = data.user.plan || 'free';
    localStorage.setItem('token', token);
    closeAuthModal();
    updateAuthUI();
    refreshUsage();
    loadHomeWidgets();
    refreshAccountPage();

    if (pendingPlan && pendingPlan !== 'free') {
      const p = pendingPlan;
      pendingPlan = null;
      await activatePlanDemo(p);
    }
  } catch (err) {
    showErr('Connection error');
  }
}

function logout() {
  token = null;
  user = null;
  currentPlan = 'free';
  pendingPlan = null;
  localStorage.removeItem('token');
  updateAuthUI();
  document.querySelectorAll('.plan-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.plan === 'free');
  });
  const portfolio = document.getElementById('portfolio-section');
  if (portfolio) portfolio.style.display = 'none';
  const ex = document.getElementById('connected-exchanges');
  if (ex) ex.innerHTML = '<p class="muted">Nothing connected</p>';
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
    authBtn.textContent = typeof t === 'function' ? t('btn.logout') : 'Logout';
    if (planLabel) {
      planLabel.textContent = (user.plan || currentPlan || 'free').toUpperCase();
      planLabel.style.display = 'inline-block';
    }
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.plan === (user.plan || currentPlan));
    });
    currentPlan = user.plan || currentPlan || 'free';
  } else {
    authBtn.textContent = typeof t === 'function' ? t('btn.login') : 'Login';
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
  document.getElementById('nav-links')?.classList.remove('open');
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
  if (planEl) planEl.textContent = (user.plan || currentPlan || 'free').toUpperCase();
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
  refreshTelegramStatus();
}

async function loadHomeWidgets() {
  loadHomeWatchlist();
  loadHomeHistory();
}

async function loadHomeWatchlist() {
  const box = document.getElementById('home-watchlist');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state-cta"><p>Sign in to save favorites</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">Login</button></div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>Empty</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scanner</button></div>';
      return;
    }
    box.innerHTML = '<div class="home-chip-row">' + data.watchlist.slice(0, 8).map(item =>
      '<button type="button" class="home-chip" onclick="rescan(\'' + item.address + '\')"><strong>' + (item.symbol || 'TOKEN') + '</strong></button>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

async function loadHomeHistory() {
  const box = document.getElementById('home-history');
  if (!box) return;
  if (!user || !token) {
    box.innerHTML = '<div class="empty-state-cta"><p>Sign in to see history</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">Login</button></div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>No scans yet</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scan</button></div>';
      return;
    }
    box.innerHTML = data.history.slice(0, 5).map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>Risk ' + h.riskScore + ' · ' + new Date(h.scannedAt).toLocaleString() +
      '</small></div><div class="list-actions"><button type="button" class="btn-sm" onclick="rescan(\'' + h.address + '\')">Open</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

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
      content.innerHTML = '<div class="locked-message"><p>Portfolio — Premium+</p><button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>';
      return;
    }
    content.innerHTML =
      '<div class="metrics-grid">' +
      '<div class="metric-card glass"><div class="metric-label">Value</div><div class="metric-value">$' + data.totalValue.toLocaleString() + '</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Risk</div><div class="metric-value">' + data.portfolioRisk + '/100</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Tokens</div><div class="metric-value">' + data.tokenCount + '</div></div></div>';
  } catch (e) {
    content.innerHTML = '<div class="error-card">Portfolio error</div>';
  }
}

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
    if (res.status === 403) {
      if (confirm((data.error || 'Pro required') + '\n\nOpen plans?')) openPricing(data.upsell || 'pro');
      return;
    }
    if (!data.success) { alert(data.error || 'Error'); return; }
    document.getElementById('bybit-modal').style.display = 'none';
    document.getElementById('bybit-form').reset();
    const container = document.getElementById('connected-exchanges');
    if (container) {
      const balancesHtml = (data.balances || []).map(b =>
        '<span style="margin-right:1rem;">' + b.coin + ': <strong>' + b.equity + '</strong></span>'
      ).join('') || 'No assets';
      container.innerHTML =
        '<div><strong>Bybit</strong> · $' + Number(data.totalEquityUsd).toLocaleString() + '</div>' +
        '<div class="muted" style="margin-top:0.5rem;">' + balancesHtml + '</div>';
    }
  } catch (err) {
    alert('Bybit connection failed');
  } finally {
    submitBtn.textContent = 'Connect';
    submitBtn.disabled = false;
  }
}

async function loadNews(source) {
  if (source) newsSource = source;
  const grid = document.getElementById('news-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const res = await fetch(API_BASE + '/api/news?source=' + encodeURIComponent(newsSource));
    const data = await res.json();
    if (!data.success || !data.news?.length) {
      grid.innerHTML = '<div class="error-card">No news</div>';
      return;
    }
    grid.innerHTML = data.news.map(item =>
      '<a href="' + (item.url || '#') + '" target="_blank" rel="noopener" class="news-card glass">' +
      '<div class="news-meta">' + (item.source || '') + (item.time ? ' · ' + item.time : '') + '</div>' +
      '<h3 class="news-title">' + item.title + '</h3></a>'
    ).join('');
  } catch (e) {
    grid.innerHTML = '<div class="error-card">News error</div>';
  }
}

async function startScan() {
  const address = document.getElementById('token-input').value.trim();
  if (!address) return alert('Enter contract address');
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading">Analyzing...</div>';
  const chatSec = document.getElementById('ai-chat-section');
  if (chatSec) chatSec.style.display = 'none';
  chatHistory = [];
  try {
    const res = await fetch(API_BASE + '/api/scan/' + address + '?plan=' + currentPlan, {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await res.json();
    if (res.status === 429 || (data.error && String(data.error).toLowerCase().includes('limit'))) {
      results.innerHTML =
        '<div class="error-card limit-upsell glass">' +
        '<h3>Free scan limit reached</h3>' +
        '<p>Full risk report and alerts are on Premium.</p>' +
        '<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>';
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
    lastPairMeta = {
      pairAddress: data.token?.pairAddress || null,
      chainId: data.token?.chainId || 'ethereum'
    };
    renderTokenPage(data);
    refreshUsage();
  } catch (e) {
    results.innerHTML = '<div class="error-card">Connection error</div>';
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

async function fetchRealCandles(pairAddress, chainId, tf) {
  if (!pairAddress) return null;
  const map = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };
  try {
    const res = await fetch(
      API_BASE + '/api/chart/' + encodeURIComponent(pairAddress) +
      '?chain=' + encodeURIComponent(chainId || 'eth') +
      '&tf=' + (map[tf] || '1h')
    );
    const data = await res.json();
    if (!data.success || !data.candles?.length) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function initCandleChart(currentPrice) {
  const container = document.getElementById('candle-chart');
  if (!container || typeof LightweightCharts === 'undefined') return;
  container.innerHTML = '';
  const bg = getComputedStyle(document.body).getPropertyValue('--bg2').trim() || '#141825';
  candleChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 400,
    layout: { background: { color: bg }, textColor: '#888' },
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

  let used = false;
  if (lastPairMeta?.pairAddress) {
    const real = await fetchRealCandles(lastPairMeta.pairAddress, lastPairMeta.chainId, currentTimeframe);
    if (real?.candles?.length) {
      candleSeries.setData(real.candles);
      if (real.volumes?.length) volumeSeries.setData(real.volumes);
      used = true;
    }
  }
  if (!used) {
    const data = generateCandleAndVolumeData(currentPrice || 1, currentTimeframe);
    candleSeries.setData(data.candles);
    volumeSeries.setData(data.volumes);
  }
  candleChart.timeScale().fitContent();
  window.addEventListener('resize', () => {
    if (candleChart && container) candleChart.applyOptions({ width: container.clientWidth });
  });
}

async function updateCandleData(currentPrice) {
  if (!candleSeries || !volumeSeries) return;
  if (lastPairMeta?.pairAddress) {
    const real = await fetchRealCandles(lastPairMeta.pairAddress, lastPairMeta.chainId, currentTimeframe);
    if (real?.candles?.length) {
      candleSeries.setData(real.candles);
      if (real.volumes?.length) volumeSeries.setData(real.volumes);
      candleChart.timeScale().fitContent();
      return;
    }
  }
  const data = generateCandleAndVolumeData(currentPrice || 1, currentTimeframe);
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
  const reasons = Array.isArray(r.reasons) ? r.reasons : [];

  lastPairMeta = {
    pairAddress: tok.pairAddress || lastPairMeta?.pairAddress || null,
    chainId: tok.chainId || lastPairMeta?.chainId || 'ethereum'
  };

  document.getElementById('results').innerHTML =
    '<div class="token-header glass">' +
    '<div class="token-left"><div class="token-icon">' + (tok.symbol || 'TK').slice(0, 2) + '</div>' +
    '<div><h1 class="token-title">' + safe(tok.symbol) + ' <span class="token-name">' + safe(tok.name) + '</span></h1>' +
    '<div class="token-price">$' + safe(tok.price) + '</div></div></div>' +
    '<div class="token-right">' +
    '<div class="risk-pill risk-' + (r.riskLevel || 'medium').toLowerCase() + '">Risk ' + safe(r.riskScore) + '/100</div>' +
    '<div class="plan-badge" style="display:inline-block;margin-top:0.4rem;">' + safe(data.plan) + '</div>' +
    '<button type="button" class="btn-sm" style="margin-top:0.5rem;" onclick="addWatch(\'' + addr + '\',\'' + (tok.symbol || '') + '\',\'' + (tok.name || '') + '\')">+ Watchlist</button>' +
    '</div></div>' +
    (reasons.length
      ? '<div class="glass panel" style="margin-bottom:1rem;"><div class="muted small">Risk factors</div><ul style="margin:0.4rem 0 0 1.1rem;color:var(--muted);">' +
        reasons.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>'
      : '') +
    '<div class="metrics-grid">' +
    '<div class="metric-card glass"><div class="metric-label">Market Cap</div><div class="metric-value">' + formatNum(tok.marketCap || tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">FDV</div><div class="metric-value">' + formatNum(tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Volume 24h</div><div class="metric-value">' + formatNum(tok.volume24h) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">Liquidity</div><div class="metric-value">' + formatNum(tok.liquidity) + '</div></div></div>' +
    '<div class="tabs">' +
    '<button type="button" class="tab active" data-tab="overview">Overview</button>' +
    '<button type="button" class="tab" data-tab="security">Security</button>' +
    '<button type="button" class="tab" data-tab="ai">AI</button>' +
    '<button type="button" class="tab" data-tab="links">Links</button></div>' +
    '<div class="tab-content">' +
    '<div class="tab-pane active" id="overview">' +
    (isPrem
      ? '<div class="chart-wrapper glass"><div class="timeframe-switcher">' +
        '<button type="button" class="tf-btn active" data-tf="1H">1H</button>' +
        '<button type="button" class="tf-btn" data-tf="4H">4H</button>' +
        '<button type="button" class="tf-btn" data-tf="1D">1D</button>' +
        '<button type="button" class="tf-btn" data-tf="1W">1W</button></div>' +
        '<div id="candle-chart" class="candle-chart"></div></div>'
      : '<div class="locked-message glass"><p><strong>Free shows a short verdict.</strong><br>Full AI + chart on Premium.</p>' +
        '<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>') +
    (isPro
      ? '<div class="advanced-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Whale</div><div class="metric-value">' + safe(adv.whaleConcentration) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Buy/Sell</div><div class="metric-value">' + safe(adv.buySellRatio) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Volatility</div><div class="metric-value">' + safe(adv.volatility) + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Holders</div><div class="metric-value">' + safe(adv.holderCount) + '</div></div></div>'
      : (isPrem
        ? '<div class="locked-message glass" style="margin-top:1rem;"><p>Whale metrics — Pro</p><button type="button" class="upgrade-btn" onclick="openPricing(\'pro\')">Open Pro</button></div>'
        : '')) +
    '</div>' +
    '<div class="tab-pane" id="security">' +
    (isPrem
      ? '<div class="metrics-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Contract</div><div class="metric-value">' + (data.security?.contractVerified ? 'Verified' : 'Not verified') + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Scam %</div><div class="metric-value">' + safe(data.security?.scamProbability) + '%</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Risk</div><div class="metric-value risk-' + (r.riskLevel || '').toLowerCase() + '">' + safe(r.riskLevel) + '</div></div></div>'
      : '<div class="locked-message glass"><p>Security — Premium</p><button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>') +
    '</div>' +
    '<div class="tab-pane" id="ai"><div class="ai-card glass">' +
    '<h3>AI: <span class="verdict">' + safe(ai.verdict) + '</span></h3>' +
    '<p style="margin:1rem 0;line-height:1.65;">' + safe(ai.text) + '</p>' +
    (Array.isArray(ai.risks) && ai.risks.length
      ? '<div style="margin-top:0.8rem;"><div class="muted">Key risks</div><ul style="margin:0.4rem 0 0 1.1rem;color:var(--muted);">' +
        ai.risks.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>'
      : '') +
    (Array.isArray(ai.positives) && ai.positives.length
      ? '<div style="margin-top:0.8rem;"><div class="muted">Positive signals</div><ul style="margin:0.4rem 0 0 1.1rem;color:var(--muted);">' +
        ai.positives.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>'
      : '') +
    '<div class="muted" style="margin-top:0.8rem;">Confidence: ' + safe(ai.confidence) + '%</div>' +
    (!isPrem
      ? '<div style="margin-top:1rem;"><button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Full AI — Premium</button></div>'
      : '') +
    '</div></div>' +
    '<div class="tab-pane" id="links">' +
    (isPrem && data.projectLinks
      ? '<div class="home-chip-row">' +
        (data.projectLinks.website ? '<a class="home-chip" href="' + data.projectLinks.website + '" target="_blank">Website</a>' : '') +
        (data.projectLinks.twitter ? '<a class="home-chip" href="' + data.projectLinks.twitter + '" target="_blank">Twitter</a>' : '') +
        (data.projectLinks.telegram ? '<a class="home-chip" href="' + data.projectLinks.telegram + '" target="_blank">Telegram</a>' : '') +
        '</div>'
      : '<div class="locked-message glass"><p>Links — Premium</p><button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>') +
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

async function loadHistory() {
  const box = document.getElementById('history-content');
  if (!box) return;
  if (!user) {
    box.innerHTML = '<div class="empty-state-cta"><p>Login</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">Login</button></div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/history', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>Empty</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scan</button></div>';
      return;
    }
    box.innerHTML = data.history.map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>' + (h.address || '').slice(0, 12) + '... · Risk ' + h.riskScore +
      '</small></div><div class="list-actions"><button type="button" class="btn-sm" onclick="rescan(\'' + h.address + '\')">Scan</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
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
    box.innerHTML = '<div class="empty-state-cta"><p>Login</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">Login</button></div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>Empty</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scanner</button></div>';
      return;
    }
    box.innerHTML = data.watchlist.map(item =>
      '<div class="list-row"><div class="list-info"><strong>' + item.symbol +
      '</strong><small>' + item.address + '</small></div><div class="list-actions">' +
      '<button type="button" class="btn-sm" onclick="rescan(\'' + item.address + '\')">Scan</button>' +
      '<button type="button" class="btn-sm danger" onclick="removeWatch(\'' + item.address + '\')">Remove</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

async function addWatch(address, symbol, name) {
  if (!user) return openAuthModal('Sign in to save Watchlist');
  if (!address) return;
  try {
    const res = await fetch(API_BASE + '/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ address, symbol, name })
    });
    const data = await res.json();
    if (res.status === 403) {
      if (confirm((data.error || 'Limit') + '\n\nOpen plans?')) openPricing(data.upsell || 'premium');
      return;
    }
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

async function loadAlerts() {
  const box = document.getElementById('alerts-content');
  if (!box) return;
  if (!user) {
    box.innerHTML = '<div class="empty-state-cta"><p>Login</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">Login</button></div>';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/alerts', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (!data.alerts?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>No alerts yet</p></div>';
    } else {
      box.innerHTML = data.alerts.map(a =>
        '<div class="list-row"><div class="list-info"><strong>' + a.symbol + ' · ' + a.type +
        '</strong><small>' + a.address.slice(0, 12) + '... · ' + a.value +
        '</small></div><div class="list-actions">' +
        '<button type="button" class="btn-sm danger" onclick="removeAlertItem(\'' + a.id + '\')">Delete</button></div></div>'
      ).join('');
    }
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

async function createAlert() {
  if (!user) return openAuthModal('Sign in to create alerts');
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
  if (res.status === 403) {
    if (confirm((data.error || 'Premium required') + '\n\nOpen plans?')) openPricing(data.upsell || 'premium');
    return;
  }
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
    const cta = document.getElementById('tg-channel-cta');
    if (cta) {
      cta.innerHTML =
        'Channels: <a class="link-more" href="https://t.me/Crypto_AI_Scanner" target="_blank" rel="noopener">RU</a> · ' +
        '<a class="link-more" href="https://t.me/crypto_ai_scanner_en" target="_blank" rel="noopener">EN</a>';
    }
    if (data.linked) {
      st.textContent = 'Connected ✓';
      st.style.color = '#00ffc8';
      btn.textContent = 'Disconnect';
      btn.onclick = disconnectTelegram;
    } else {
      st.textContent = 'Not connected';
      st.style.color = '';
      btn.textContent = 'Connect Telegram';
      btn.onclick = connectTelegram;
    }
  } catch (e) {}
}

async function connectTelegram() {
  if (!user) return openAuthModal('Sign in to connect Telegram');
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

async function runCompare() {
  const a1 = document.getElementById('cmp-1').value.trim();
  const a2 = document.getElementById('cmp-2').value.trim();
  const a3 = document.getElementById('cmp-3').value.trim();
  const addresses = [a1, a2, a3].filter(Boolean);
  if (addresses.length < 2) return alert('Need 2 addresses');
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
    if (res.status === 403) {
      box.innerHTML =
        '<div class="error-card limit-upsell glass">' +
        '<h3>Compare — Premium</h3>' +
        '<p>' + (data.error || '') + '</p>' +
        '<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">Open Premium</button></div>';
      return;
    }
    if (!data.success) {
      box.innerHTML = '<div class="error-card">' + (data.error || 'Error') + '</div>';
      return;
    }
    box.innerHTML = '<div class="compare-grid">' + data.tokens.map(tok =>
      '<div class="compare-card glass"><h3>' + tok.symbol + '</h3>' +
      '<div class="compare-metric"><span>Price</span><span>$' + Number(tok.price).toFixed(6) + '</span></div>' +
      '<div class="compare-metric"><span>Liquidity</span><span>' + formatNum(tok.liquidity) + '</span></div>' +
      '<div class="compare-metric"><span>Volume</span><span>' + formatNum(tok.volume24h) + '</span></div>' +
      '<div class="compare-metric"><span>FDV</span><span>' + formatNum(tok.fdv) + '</span></div>' +
      '<button type="button" class="btn-sm" style="margin-top:0.8rem;" onclick="rescan(\'' + tok.address + '\')">Scan</button></div>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="error-card">Compare failed</div>';
  }
}
