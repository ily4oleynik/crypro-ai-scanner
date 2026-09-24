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
  if (typeof openDemoReport === "function") openDemoReport();
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
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-drawer-overlay');
  const closeBtn = document.getElementById('nav-drawer-close');
  if (!burger || !drawer) {
    console.warn('[nav] burger or drawer missing');
    return;
  }

  function openDrawer() {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add('open');
    }
    burger.setAttribute('aria-expanded', 'true');
    burger.textContent = '✕';
    document.body.classList.add('drawer-open');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.hidden = true;
    }
    burger.setAttribute('aria-expanded', 'false');
    burger.textContent = '☰';
    document.body.classList.remove('drawer-open');
  }

  function toggleDrawer(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (drawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  }

  burger.addEventListener('click', toggleDrawer);
  closeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeDrawer();
  });
  overlay?.addEventListener('click', closeDrawer);

  drawer.querySelectorAll('.drawer-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.dataset.page;
      closeDrawer();
      if (page && typeof showPage === 'function') {
        showPage(page);
        if (page === 'watchlist' && typeof loadWatchlist === 'function') loadWatchlist();
        if (page === 'history' && typeof loadHistory === 'function') loadHistory();
        if (page === 'alerts' && typeof loadAlerts === 'function') loadAlerts();
      }
    });
  });

  document.getElementById('drawer-auth')?.addEventListener('click', () => {
    closeDrawer();
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.click();
  });
  document.getElementById('drawer-theme')?.addEventListener('click', () => {
    if (typeof toggleTheme === 'function') toggleTheme();
  });
  document.getElementById('drawer-upgrade')?.addEventListener('click', () => {
    closeDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
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
      inner.style.animation = 'none';
      return;
    }
    const block = items.map((t) => {
      const ch = t.change24h;
      const cls = ch > 0 ? 'ticker-up' : ch < 0 ? 'ticker-down' : '';
      const sign = ch > 0 ? '+' : '';
      const price = t.price == null ? '—' : t.price >= 100
        ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : t.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
      const chStr = ch == null ? '' : '<span class="' + cls + '">' + sign + Number(ch).toFixed(2) + '%</span>';
      return '<span class="ticker-item"><strong>' + (t.symbol || '') + '</strong><span>$' + price + '</span>' + chStr + '</span>';
    }).join('');

    // Fill until at least ~2 screen widths, then double for seamless -50% loop
    let filled = block;
    inner.innerHTML = filled;
    let guard = 0;
    const target = Math.max(window.innerWidth * 2, 800);
    while (inner.scrollWidth < target && guard++ < 30) {
      filled += block;
      inner.innerHTML = filled;
    }
    inner.innerHTML = filled + filled;
    // Speed ~40px/sec — slow professional tape (not frantic)
    const half = inner.scrollWidth / 2;
    const sec = Math.max(100, Math.min(200, half / 18));
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = 'ticker-marquee ' + sec.toFixed(1) + 's linear infinite';
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
  if (page === 'history') loadHistory();
  if (page === 'watchlist') typeof loadWatchlist === 'function' && loadWatchlist();
  if (page === 'scanner') typeof renderScannerEmpty === 'function' && renderScannerEmpty();
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
  results.innerHTML = '<div class="scan-progress glass">' +
    '<div class="scan-step active" id="sp1">On-chain</div>' +
    '<div class="scan-step" id="sp2">Liquidity</div>' +
    '<div class="scan-step" id="sp3">Security</div>' +
    '<div class="scan-step" id="sp4">AI</div>' +
    '</div>';
  let sp = 1;
  const spTimer = setInterval(function () {
    sp += 1;
    const el = document.getElementById('sp' + sp);
    if (el) el.classList.add('active');
    if (sp >= 4) clearInterval(spTimer);
  }, 700);
  window._scanProgressTimer = spTimer;
  const chatSec = document.getElementById('ai-chat-section');
  if (chatSec) chatSec.style.display = 'none';
  chatHistory = [];
  try {
    const res = await fetch(API_BASE + '/api/scan/' + encodeURIComponent(address) + '?plan=' + encodeURIComponent(currentPlan || 'free'), {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      results.innerHTML = '<div class="error-card glass">Server returned non-JSON (HTTP ' + res.status + '). Check backend logs.</div>';
      return;
    }
    if (!res.ok && !data.token) {
      results.innerHTML = '<div class="error-card glass">' + (data.error || data.message || ('HTTP ' + res.status)) + '</div>';
      return;
    }
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
    if (window._scanProgressTimer) clearInterval(window._scanProgressTimer);
    try {
      data = await enrichTokenMarket(data, address);
      data = await enrichSecurity(data, address);
    } catch (enr) { console.warn(enr); }
    window.__lastScanData = data;
    try {
      renderTokenPage(data);
    } catch (renderErr) {
      console.error(renderErr);
      results.innerHTML = '<div class="error-card glass">Render error: ' + (renderErr.message || renderErr) + '</div>';
      return;
    }
    if (token && data.token) {
      try {
        const histItem = {
          address: address,
          symbol: data.token.symbol,
          name: data.token.name,
          price: data.token.price,
          riskScore: data.risk && data.risk.riskScore,
          chainId: data.token.chainId,
          plan: data.plan || currentPlan || 'free',
          scannedAt: new Date().toISOString()
        };
        await fetch(API_BASE + '/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(histItem)
        });
        // local fallback so History works even if API lacks POST
        try {
          const key = 'scan_history_' + (user && user.id ? user.id : 'guest');
          const prev = JSON.parse(localStorage.getItem(key) || '[]');
          prev.unshift(histItem);
          localStorage.setItem(key, JSON.stringify(prev.slice(0, 50)));
        } catch (ls) {}
      } catch (hErr) {
        console.warn(hErr);
        try {
          const key = 'scan_history_' + (user && user.id ? user.id : 'guest');
          const prev = JSON.parse(localStorage.getItem(key) || '[]');
          prev.unshift({
            address: address,
            symbol: data.token && data.token.symbol,
            name: data.token && data.token.name,
            riskScore: data.risk && data.risk.riskScore,
            chainId: data.token && data.token.chainId,
            scannedAt: new Date().toISOString()
          });
          localStorage.setItem(key, JSON.stringify(prev.slice(0, 50)));
        } catch (ls2) {}
      }
    }
    await refreshUsage();
    if (typeof refreshAccountPage === 'function') refreshAccountPage();
    results.insertAdjacentHTML('beforeend',
      '<div style="text-align:center;margin-top:1rem;">' +
      '<button type="button" class="connect-btn" id="scan-another-btn">Scan another token</button></div>');
    document.getElementById('scan-another-btn')?.addEventListener('click', function () {
      const input = document.getElementById('token-input');
      if (input) { input.value = ''; input.focus(); }
      results.innerHTML = '';
      if (typeof renderScannerEmpty === 'function') renderScannerEmpty();
    });
  } catch (e) {
    console.error(e);
    results.innerHTML = '<div class="error-card glass">Connection error: ' + (e && e.message ? e.message : 'network') + '</div>';
  }
}

function formatPrice(p) {
  const n = Number(p);
  if (p == null || p === '' || isNaN(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}
function safe(v, fb) {
  if (fb === undefined) fb = '—';
  if (v === null || v === undefined || Number.isNaN(v)) return fb;
  return v;
}

function formatNum(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!isFinite(v) || v === 0) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  if (v >= 1) return '$' + v.toFixed(2);
  return '$' + v.toFixed(6);
}

function riskBarHtml(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  let color = '#00f0a0';
  if (s >= 70) color = '#ff4d6a';
  else if (s >= 40) color = '#f5a623';
  return '<div class="risk-bar-wrap"><div class="risk-bar-track"><div class="risk-bar-fill" style="width:' + s + '%;background:' + color + '"></div></div>' +
    '<div class="risk-bar-labels"><span>Low</span><span>Med</span><span>High</span></div></div>';
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


function formatAiVerdict(ai, risk) {
  ai = ai || {};
  risk = risk || {};
  let raw = String(ai.text || ai.summary || '').trim();
  // strip garbage model/name prefixes like "JEANJAK:", "ASSISTANT:"
  raw = raw.replace(/^[A-Z]{3,20}:\s*/i, '');
  raw = raw.replace(/\*\*/g, '').replace(/#{1,3}\s*/g, '');
  // shorten wall of text for overview card
  const score = risk.riskScore != null ? risk.riskScore : (ai.score || '—');
  let verdict = ai.verdict || '';
  if (!verdict) {
    const s = Number(score);
    if (s >= 70) verdict = 'High risk';
    else if (s >= 40) verdict = 'Caution';
    else verdict = 'Relatively OK';
  }
  // build short bullets from text
  const sentences = raw.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const short = sentences.slice(0, 3);
  const why = short[0] || ('Risk score ' + score + '/100.');
  const extra = short.slice(1);
  return {
    verdict: verdict,
    score: score,
    why: why,
    points: extra,
    full: raw,
    confidence: ai.confidence || null,
    risks: Array.isArray(ai.risks) ? ai.risks : [],
    positives: Array.isArray(ai.positives) ? ai.positives : []
  };
}

function aiOverviewHtml(ai, risk) {
  const f = formatAiVerdict(ai, risk);
  const vColor = Number(f.score) >= 70 ? '#ff4d6a' : Number(f.score) >= 40 ? '#f5a623' : '#00f0a0';
  let html = '<div class="ai-verdict-card">';
  html += '<div class="ai-verdict-head">';
  html += '<span class="ai-verdict-badge" style="border-color:' + vColor + ';color:' + vColor + '">' + safe(f.verdict) + '</span>';
  html += '<span class="ai-verdict-score">' + safe(f.score) + '<small>/100</small></span>';
  html += '</div>';
  html += '<p class="ai-verdict-why">' + safe(f.why) + '</p>';
  if (f.points.length) {
    html += '<ul class="ai-verdict-points">';
    f.points.forEach(function (p) { html += '<li>' + safe(p) + '</li>'; });
    html += '</ul>';
  }
  if (f.risks.length) {
    html += '<div class="ai-mini-label">Key risks</div><ul class="ai-verdict-points risk">';
    f.risks.slice(0, 3).forEach(function (p) { html += '<li>' + safe(p) + '</li>'; });
    html += '</ul>';
  }
  html += '</div>';
  return html;
}


function buildRiskBreakdown(tok, risk, address) {
  tok = tok || {};
  risk = risk || {};
  const liq = Number(tok.liquidity) || 0;
  const vol = Number(tok.volume24h) || 0;
  const mcap = Number(tok.marketCap || tok.fdv) || 0;
  const fdv = Number(tok.fdv || tok.marketCap) || 0;
  const chain = String(tok.chainId || detectChainFromAddress(address) || '').toLowerCase();
  const sym = String(tok.symbol || '').toUpperCase();
  const name = String(tok.name || '').toLowerCase();
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const en = lang === 'en';

  let contract = 25;
  let liquidity = 25;
  let holders = 20;
  let market = 20;
  let marketHint = en ? 'FDV vs pool liquidity' : 'FDV к ликвидности пула';

  // Liquidity — absolute depth
  if (liq <= 0) liquidity = 85;
  else if (liq < 10000) liquidity = 75;
  else if (liq < 50000) liquidity = 55;
  else if (liq < 200000) liquidity = 35;
  else if (liq < 1000000) liquidity = 18;
  else liquidity = 8;

  // Market = concentration / exit friction on THIS pool, NOT "token is scam"
  // High FDV/liq is normal for blue-chips (LINK, UNI) when pair liquidity is only a slice of total market
  if (fdv > 0 && liq > 0) {
    const ratio = fdv / liq;
    const ratioLabel = ratio >= 1000 ? (ratio / 1000).toFixed(1) + 'k×' : Math.round(ratio) + '×';
    marketHint = en
      ? 'FDV/pool ' + ratioLabel + (liq >= 1e6 ? ' · normal for large caps' : '')
      : 'FDV/пул ' + ratioLabel + (liq >= 1e6 ? ' · нормально для large-cap' : '');
    if (liq >= 1000000) {
      // Deep pool: ratio alone is not a red flag
      if (ratio > 500) market = 28;
      else if (ratio > 100) market = 20;
      else market = 12;
    } else if (liq >= 200000) {
      if (ratio > 200) market = 45;
      else if (ratio > 50) market = 32;
      else market = 18;
    } else {
      if (ratio > 100) market = 70;
      else if (ratio > 50) market = 55;
      else if (ratio > 20) market = 40;
      else market = 25;
    }
  }
  if (vol > 0 && liq > 0 && vol / liq < 0.02 && liq < 500000) {
    market = Math.min(80, market + 12);
    marketHint += en ? ' · low turnover' : ' · низкий оборот';
  }

  const isImposter =
    ((sym === 'BTC' || name.indexOf('bitcoin') >= 0) && chain && chain !== 'bitcoin') ||
    (sym === 'ETH' && chain && chain !== 'ethereum' && !/eth/.test(chain)) ||
    (sym === 'SOL' && chain && chain !== 'solana');
  if (isImposter) {
    contract = 80;
  } else if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(address || ''))) {
    contract = 35;
  } else if (mcap > 1e9 && liq > 1e6) {
    contract = 12;
  } else if (mcap > 1e8) {
    contract = 18;
  } else {
    contract = 30;
  }

  if (mcap > 5e9) holders = 10;
  else if (mcap > 5e8) holders = 16;
  else holders = 28;

  // Soft-align to overall score WITHOUT blowing up Market for liquid blue-chips
  const target = Number(risk.riskScore);
  if (isFinite(target) && target >= 0) {
    const avg = (contract + liquidity + holders + market) / 4;
    if (avg > 1) {
      const k = target / avg;
      contract = Math.round(Math.min(95, Math.max(5, contract * k)));
      liquidity = Math.round(Math.min(95, Math.max(5, liquidity * k)));
      holders = Math.round(Math.min(95, Math.max(5, holders * k)));
      // Market: only mild pull toward target; never force >40 when pool is deep
      let m2 = Math.round(market * (0.55 + 0.45 * Math.min(k, 1.4)));
      if (liq >= 1000000) m2 = Math.min(m2, 35);
      market = Math.round(Math.min(90, Math.max(8, m2)));
    }
  }

  return [
    {
      key: 'contract',
      label: en ? 'Contract' : 'Контракт',
      score: contract,
      hint: isImposter
        ? (en ? 'Name/network mismatch' : 'Имя не совпадает с сетью')
        : (en ? 'Identity / proxy heuristic' : 'Идентичность / proxy')
    },
    {
      key: 'liquidity',
      label: en ? 'Liquidity' : 'Ликвидность',
      score: liquidity,
      hint: liq
        ? (liq >= 1e6 ? '$' + (liq / 1e6).toFixed(2) + 'M' : '$' + (liq / 1e3).toFixed(0) + 'K')
        : 'n/a'
    },
    {
      key: 'holders',
      label: en ? 'Holders' : 'Холдеры',
      score: holders,
      hint: en ? 'Limited without full on-chain' : 'Без полного on-chain'
    },
    {
      key: 'market',
      label: en ? 'Exit friction' : 'Выход из позиции',
      score: market,
      hint: marketHint
    }
  ];
}

function riskBreakdownHtml(tok, risk, address) {
  const parts = buildRiskBreakdown(tok, risk, address);
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const en = lang === 'en';
  const title = en ? 'Risk breakdown' : 'Разбивка риска';
  const scale = en
    ? 'Bars = risk in that area (not a scam verdict). Exit friction ≠ token quality.'
    : 'Полосы = риск в зоне (не «токен = скам»). «Выход» ≠ качество проекта.';
  let html = '<div class="risk-breakdown glass panel">';
  html += '<div class="risk-breakdown-head"><span>' + title + '</span></div>';
  html += '<p class="risk-breakdown-note muted small">' + scale + '</p>';
  parts.forEach(function (p) {
    const color = p.score >= 61 ? '#ff4d6a' : p.score >= 31 ? '#f5a623' : '#00f0a0';
    html += '<div class="risk-factor-row">';
    html += '<div class="risk-factor-label"><strong>' + p.label + '</strong><span class="muted small">' + p.hint + '</span></div>';
    html += '<div class="risk-factor-bar"><div style="width:' + p.score + '%;background:' + color + '"></div></div>';
    html += '<div class="risk-factor-score" style="color:' + color + '">' + p.score + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function buildSecurityFlags(tok, risk, address) {
  tok = tok || {};
  const chain = String(tok.chainId || detectChainFromAddress(address) || '').toLowerCase();
  const sym = String(tok.symbol || '').toUpperCase();
  const name = String(tok.name || '').toLowerCase();
  const liq = Number(tok.liquidity) || 0;
  const mcap = Number(tok.marketCap || tok.fdv) || 0;
  const isImposter =
    ((sym === 'BTC' || name.indexOf('bitcoin') >= 0) && chain && chain !== 'bitcoin') ||
    (sym === 'ETH' && chain && !/ethereum|eth/.test(chain));

  // Heuristic flags — honest about unknown
  const knownBluechip = ['LINK', 'UNI', 'AAVE', 'MKR', 'CRV', 'SNX', 'COMP'].indexOf(sym) >= 0 && /ethereum|eth/.test(chain);
  return [
    {
      id: 'network',
      label: 'Network',
      status: chain ? 'ok' : 'warn',
      text: chain ? chainLabel(chain) : 'Unknown'
    },
    {
      id: 'identity',
      label: 'Identity',
      status: isImposter ? 'bad' : (knownBluechip ? 'ok' : 'warn'),
      text: isImposter
        ? 'Not native ' + (sym || 'asset') + ' on this chain'
        : (knownBluechip ? 'Known protocol token' : 'Verify contract in explorer')
    },
    {
      id: 'liquidity',
      label: 'Liquidity',
      status: liq >= 200000 ? 'ok' : liq >= 50000 ? 'warn' : 'bad',
      text: liq ? (liq >= 1e6 ? '$' + (liq/1e6).toFixed(2) + 'M' : '$' + (liq/1e3).toFixed(0) + 'K') : 'Very low / n/a'
    },
    {
      id: 'verified',
      label: 'Verified',
      status: knownBluechip ? 'ok' : 'warn',
      text: knownBluechip ? 'Likely verified source' : 'Not checked on-chain (Free)'
    },
    {
      id: 'honeypot',
      label: 'Honeypot',
      status: 'warn',
      text: 'Simulation on Premium'
    },
    {
      id: 'mint',
      label: 'Mint / Own',
      status: 'warn',
      text: 'Ownership scan on Premium'
    }
  ];
}

function scoreColor(score) {
  const s = Number(score) || 0;
  if (s >= 61) return '#ff4d6a';
  if (s >= 31) return '#f5a623';
  return '#00f0a0';
}



async function enrichSecurity(data, address) {
  if (!data) return data;
  const chain = (data.token && data.token.chainId) || detectChainFromAddress(address) || 'ethereum';
  try {
    const res = await fetch(
      API_BASE + '/api/security/' + encodeURIComponent(chain) + '/' + encodeURIComponent(address)
    );
    if (!res.ok) throw new Error('security ' + res.status);
    const body = await res.json();
    if (body.success && body.security) {
      data.security = body.security;
      if (body.security.riskBonus && data.risk) {
        data.risk.riskScore = Math.min(
          99,
          Number(data.risk.riskScore || 50) + Number(body.security.riskBonus || 0)
        );
        if (data.risk.riskScore >= 70) data.risk.riskLevel = 'HIGH';
        else if (data.risk.riskScore >= 40) data.risk.riskLevel = 'MEDIUM';
        else data.risk.riskLevel = 'LOW';
      }
    }
  } catch (e) {
    console.warn('[security]', e.message);
    // client-side fallback attempt (may fail CORS)
    try {
      data.security = data.security || { available: false, flags: [] };
    } catch (e2) {}
  }
  return data;
}

function securityFlagsHtml(tok, risk, address, security) {
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const title = lang === 'en' ? 'Security snapshot' : 'Снимок безопасности';
  const source =
    security && security.available
      ? 'GoPlus'
      : lang === 'en'
        ? 'Heuristic'
        : 'Эвристика';

  let flags;
  if (security && security.available && Array.isArray(security.flags) && security.flags.length) {
    flags = security.flags;
  } else {
    flags = buildSecurityFlags(tok, risk, address);
  }

  let html = '<div class="security-flags glass panel">';
  html +=
    '<div class="sec-head"><span class="muted small">' +
    title +
    '</span><span class="muted small">Source: ' +
    source +
    '</span></div>';
  html += '<div class="security-flags-grid">';
  flags.forEach(function (f) {
    const icon = f.status === 'ok' ? '✓' : f.status === 'bad' ? '!' : '·';
    html += '<div class="sec-flag sec-' + (f.status || 'warn') + '">';
    html += '<span class="sec-icon">' + icon + '</span>';
    html +=
      '<div><div class="sec-label">' +
      (f.label || '') +
      '</div><div class="sec-text">' +
      (f.text || '') +
      '</div></div>';
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

function shareReport() {
  const data = window.__lastScanData;
  if (!data || !data.token) {
    alert('Scan a token first');
    return;
  }
  const tok = data.token;
  const r = data.risk || {};
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  // background
  ctx.fillStyle = '#0b0e11';
  ctx.fillRect(0, 0, 900, 480);
  // card
  ctx.fillStyle = '#12161c';
  roundRect(ctx, 40, 40, 820, 400, 20);
  ctx.fill();
  ctx.strokeStyle = '#1e2438';
  ctx.lineWidth = 2;
  ctx.stroke();
  // accent line
  ctx.fillStyle = '#00f0a0';
  ctx.fillRect(40, 40, 8, 400);

  ctx.fillStyle = '#e4e4f0';
  ctx.font = 'bold 28px Inter, system-ui, sans-serif';
  ctx.fillText((tok.symbol || 'TOKEN') + '  ' + (tok.name || ''), 70, 100);

  ctx.fillStyle = '#888';
  ctx.font = '16px Inter, system-ui, sans-serif';
  const chain = tok.chainId ? String(tok.chainId).toUpperCase() : '';
  ctx.fillText(chain + (tok.pairAddress ? '  ·  ' + String(tok.pairAddress).slice(0, 10) + '…' : ''), 70, 130);

  const score = Number(r.riskScore) || 0;
  const col = score >= 61 ? '#ff4d6a' : score >= 31 ? '#f5a623' : '#00f0a0';
  ctx.fillStyle = col;
  ctx.font = 'bold 64px Inter, system-ui, sans-serif';
  ctx.fillText(String(score), 70, 220);
  ctx.fillStyle = '#888';
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText('/ 100 risk', 70 + ctx.measureText(String(score)).width + 12, 220);

  ctx.fillStyle = '#e4e4f0';
  ctx.font = '20px Inter, system-ui, sans-serif';
  ctx.fillText('Price  $' + (tok.price != null ? formatPrice(tok.price) : '—'), 70, 280);
  ctx.fillText('Liquidity  ' + formatNum(tok.liquidity), 70, 315);
  ctx.fillText('Volume 24h  ' + formatNum(tok.volume24h), 70, 350);

  ctx.fillStyle = '#00f0a0';
  ctx.font = 'bold 18px Inter, system-ui, sans-serif';
  ctx.fillText('Crypto AI Scanner', 70, 400);
  ctx.fillStyle = '#666';
  ctx.font = '14px Inter, system-ui, sans-serif';
  ctx.fillText('Not financial advice · DYOR', 250, 400);

  canvas.toBlob(function (blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tok.symbol || 'token') + '-risk-report.png';
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Report saved as PNG');
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
    '<div class="token-meta-row">' + chainBadgeHtml(tok, addr) +
    (tok.pairAddress ? '<span class="muted small">Pair ' + safe(String(tok.pairAddress).slice(0, 8)) + '…</span>' : '') +
    '</div>' +
    '<div class="token-price">$' + formatPrice(tok.price) + '</div></div></div>' +
    '<div class="token-right">' +
    '<div class="risk-pill" style="border-color:' + scoreColor(r.riskScore) + ';color:' + scoreColor(r.riskScore) + '">Risk ' + safe(r.riskScore) + '/100</div>' +
    '<div class="plan-badge" style="display:inline-block;margin-top:0.4rem;">' + safe(data.plan) + '</div>' +
    '<button type="button" class="btn-sm" style="margin-top:0.5rem;" onclick="addWatch(\'' + addr + '\',\'' + (tok.symbol || '') + '\',\'' + (tok.name || '') + '\')">+ Watchlist</button>' +
    '<button type="button" class="btn-sm share-btn" style="margin-top:0.35rem;" onclick="shareReport()">Share report</button>' +
    '</div></div>' +
    riskBreakdownHtml(tok, r, addr) +
    securityFlagsHtml(tok, r, addr, data.security) +
    (reasons.length
      ? '<div class="glass panel risk-factors-panel"><div class="muted small">Risk factors</div><ul class="risk-factors-list">' +
        reasons.filter(function (x) {
      var s = String(x || '');
      if (/residual smart-contract|always remains|остаточный риск/i.test(s)) return false;
      return s.trim().length > 0;
    }).map(function (x) {
      var w = /⚠|NOT native|не нативный|wrapper|imposter|Network:|honeypot|GoPlus/i.test(String(x));
      return '<li class="' + (w ? 'risk-reason-warn' : '') + '">' + x + '</li>';
    }).join('') + '</ul></div>'
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
      : '<div class="glass panel" style="margin-bottom:1rem;">' +
        '<div class="muted small" style="margin-bottom:0.5rem;">Risk scale</div>' +
        riskBarHtml(r.riskScore) +
        aiOverviewHtml(ai, r) +
        '<p class="muted small" style="margin-top:0.75rem;">Charts and deep security checks on Premium.</p>' +
        '<button type="button" class="connect-btn" style="margin-top:0.5rem;" onclick="openPricing(\'premium\')">See Premium report</button></div>') +
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
      : '<div class="metrics-grid">' +
        '<div class="metric-card glass"><div class="metric-label">Risk level</div><div class="metric-value risk-' + (r.riskLevel || 'medium').toLowerCase() + '">' + safe(r.riskLevel || 'MEDIUM') + '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Score</div><div class="metric-value">' + safe(r.riskScore) + '/100</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Scam signal</div><div class="metric-value">' + safe(data.security?.scamProbability || '—') + (data.security?.scamProbability != null ? '%' : '') + '</div></div>' +
        '</div>' +
        '<p class="muted small" style="margin-top:0.75rem;">Verified contract, honeypot and ownership checks — Premium.</p>' +
        '<button type="button" class="connect-btn" onclick="openPricing(\'premium\')">Unlock full security</button>') +
    '</div>' +
    '<div class="tab-pane" id="ai"><div class="ai-card glass">' +
    aiOverviewHtml(ai, r) +
    (formatAiVerdict(ai, r).full
      ? '<details class="ai-full-details"><summary>Full AI text</summary><p class="ai-full-text">' + safe(formatAiVerdict(ai, r).full) + '</p></details>'
      : '') +
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
      ? '<div class="glass panel" style="margin-top:1rem;padding:1rem;border-color:rgba(0,240,160,0.25);">' +
        '<p style="margin:0 0 0.5rem;font-size:0.9rem;">Free AI is a solid first pass. Premium adds contract findings, holder concentration and actionable recommendations.</p>' +
        '<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">See full AI report</button>' +
        '<button type="button" class="connect-btn" style="margin-left:0.5rem;" onclick="openDemoReport()">View sample Premium report</button></div>'
      : '') +
    '</div></div>' +
    '<div class="tab-pane" id="links">' +
    (isPrem && data.projectLinks
      ? '<div class="home-chip-row">' +
        (data.projectLinks.website ? '<a class="home-chip" href="' + data.projectLinks.website + '" target="_blank">Website</a>' : '') +
        (data.projectLinks.twitter ? '<a class="home-chip" href="' + data.projectLinks.twitter + '" target="_blank">Twitter</a>' : '') +
        (data.projectLinks.telegram ? '<a class="home-chip" href="' + data.projectLinks.telegram + '" target="_blank">Telegram</a>' : '') +
        '</div>'
      : '<div class="home-chip-row">' +
        (addr ? '<a class="home-chip" href="https://dexscreener.com/search?q=' + encodeURIComponent(addr) + '" target="_blank" rel="noopener">DexScreener</a>' : '') +
        (addr ? '<a class="home-chip" href="https://etherscan.io/token/' + encodeURIComponent(addr) + '" target="_blank" rel="noopener">Explorer</a>' : '') +
        '</div><p class="muted small" style="margin-top:0.6rem;">Official website / socials — Premium when available from the pair.</p>') +
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
  if (data.plan === 'Pro' || data.plan === 'Premium' || currentPlan === 'pro' || currentPlan === 'premium') {
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
      addChatMessage('ai', data.error || 'AI chat requires Premium or Pro');
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
    let history = (data && data.history) || [];
    try {
      const key = 'scan_history_' + (user && user.id ? user.id : 'guest');
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      if (local.length) {
        const seen = {};
        history = local.concat(history).filter(function (h) {
          const k = String(h.address || '') + String(h.scannedAt || h.scanned_at || '');
          if (seen[k]) return false;
          seen[k] = true;
          return !!h.address;
        });
      }
    } catch (e) {}
    if (!history.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>Empty</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scan</button></div>';
      return;
    }
    box.innerHTML = history.map(function (h) {
      const risk = h.riskScore != null ? h.riskScore : (h.risk_score != null ? h.risk_score : '—');
      const chain = h.chainId || h.chain_id || '';
      const addr = String(h.address || '').replace(/'/g, '');
      return '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
        '</strong><small>' + (chain ? chainLabel(chain) + ' · ' : '') + addr.slice(0, 12) +
        '... · Risk ' + risk + '</small></div>' +
        '<button type="button" class="btn-sm" data-addr="' + addr + '" onclick="document.getElementById(\'token-input\').value=this.dataset.addr;showPage(\'scanner\');startScan();">Rescan</button></div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="error-card glass">Failed to load history</div>';
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
    if (typeof showToast === 'function') showToast('Added to Watchlist');
    else alert('Added to watchlist');
    loadHomeWatchlist();
    if (typeof loadWatchlist === 'function') loadWatchlist();
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

document.getElementById('footer-pricing')?.addEventListener('click', function (e) {
  e.preventDefault();
  if (typeof openPricing === 'function') openPricing();
  else if (typeof showPlans === 'function') showPlans();
  else document.querySelector('.plan-btn[data-plan="premium"]')?.click();
});

function openDemoReport() {
  let modal = document.getElementById('demo-report-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'demo-report-modal';
    modal.className = 'pricing-modal';
    modal.innerHTML =
      '<div class="modal-content glass" style="max-width:560px;max-height:85vh;overflow-y:auto;">' +
      '<button type="button" class="modal-close" id="demo-report-close">&times;</button>' +
      '<h2 style="margin-bottom:0.5rem;">Sample Premium report</h2>' +
      '<p class="muted small" style="margin-bottom:1rem;">Example of what a full analysis looks like (illustrative, not a live token).</p>' +
      '<div class="risk-pill risk-medium" style="display:inline-block;margin-bottom:0.8rem;">Risk 38 / 100 · MEDIUM</div>' +
      '<div class="metrics-grid" style="margin-bottom:1rem;">' +
      '<div class="metric-card glass"><div class="metric-label">Market Cap</div><div class="metric-value">$4.2B</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Liquidity</div><div class="metric-value">$48M</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Holders</div><div class="metric-value">~680k</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Top 10</div><div class="metric-value">22%</div></div></div>' +
      '<h3 style="margin:0.5rem 0;">AI verdict: Cautious OK</h3>' +
      '<p style="line-height:1.65;margin-bottom:0.8rem;">Liquidity is deep enough for mid-size orders. Contract is verified; no obvious mint/honeypot flags in the scanned pair. Concentration in the top wallets is moderate for a large-cap token. Volatility over 24h is within normal range for the sector.</p>' +
      '<p style="line-height:1.65;margin-bottom:0.8rem;"><strong>Why the score is not lower:</strong> residual smart-contract and oracle risk always remains; large holder moves can still move the book. This is risk scoring, not investment advice.</p>' +
      '<div class="muted small">Key risks</div><ul style="margin:0.3rem 0 0.8rem 1.1rem;color:var(--muted);"><li>Market-wide drawdowns</li><li>Bridge / L2 dependency if applicable</li><li>Always DYOR on latest contract changes</li></ul>' +
      '<div class="muted small">Positive signals</div><ul style="margin:0.3rem 0 1rem 1.1rem;color:var(--muted);"><li>Verified contract</li><li>Healthy 24h volume vs liquidity</li><li>No honeypot heuristics triggered</li></ul>' +
      '<button type="button" class="upgrade-btn" onclick="document.getElementById(\'demo-report-modal\').remove();openPricing(\'premium\');">Get reports like this</button>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('demo-report-close').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
  document.body.classList.add('modal-open');
  modal.style.display = 'flex';
}


async function enrichTokenMarket(data, address) {
  if (!data || !data.token) return data;
  const tok = data.token;
  try {
    const url = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address);
    const res = await fetch(url);
    const j = await res.json();
    const pairs = Array.isArray(j.pairs) ? j.pairs.slice() : [];
    if (pairs.length) {
      pairs.sort(function (a, b) {
        return (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0);
      });
      const p = pairs[0];
      tok.marketCap = numOr(tok.marketCap, p.marketCap, p.fdv);
      tok.fdv = numOr(tok.fdv, p.fdv, p.marketCap);
      tok.liquidity = numOr(tok.liquidity, p.liquidity && p.liquidity.usd);
      tok.volume24h = numOr(tok.volume24h, p.volume && p.volume.h24);
      tok.price = tok.price || p.priceUsd || null;
      tok.pairAddress = tok.pairAddress || p.pairAddress || null;
      tok.chainId = (p.chainId || tok.chainId || detectChainFromAddress(address) || 'unknown').toLowerCase();
      tok.dexId = p.dexId || tok.dexId || null;
      tok.pairUrl = p.url || null;
      if (p.baseToken) {
        tok.symbol = tok.symbol || p.baseToken.symbol;
        tok.name = tok.name || p.baseToken.name;
      }
    } else {
      tok.chainId = (tok.chainId || detectChainFromAddress(address) || 'unknown').toLowerCase();
    }
  } catch (e) {
    tok.chainId = (tok.chainId || detectChainFromAddress(address) || 'unknown').toLowerCase();
  }
  data.token = tok;
  data.risk = data.risk || {};
  data.risk.reasons = mergeReasons(data.risk.reasons, buildChainRiskReasons(tok, address));
  // bump score slightly if imposter
  const hasImposter = (data.risk.reasons || []).some(function (x) {
    return /not native|обёртк|wrapper|imposter|не нативный|TRC20|поддел/i.test(String(x));
  });
  if (hasImposter && data.risk.riskScore != null) {
    data.risk.riskScore = Math.min(95, Number(data.risk.riskScore) + 15);
    if (data.risk.riskScore >= 70) data.risk.riskLevel = 'HIGH';
    else if (data.risk.riskScore >= 40) data.risk.riskLevel = 'MEDIUM';
  }
  return data;
}

function numOr() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v == null || v === '') continue;
    var n = Number(v);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function detectChainFromAddress(address) {
  const a = String(address || '').trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'ethereum'; // could be BSC/Base — DexScreener chainId preferred
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'tron';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && !a.startsWith('0x')) return 'solana';
  return 'unknown';
}

function chainLabel(chainId) {
  const c = String(chainId || '').toLowerCase();
  const map = {
    ethereum: 'Ethereum', eth: 'Ethereum',
    bsc: 'BNB Chain', bnbt: 'BNB Chain',
    base: 'Base', arbitrum: 'Arbitrum', polygon: 'Polygon',
    avalanche: 'Avalanche', optimism: 'Optimism',
    tron: 'Tron', solana: 'Solana', sui: 'Sui', ton: 'TON'
  };
  return map[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Unknown chain');
}

function buildChainRiskReasons(tok, address) {
  const reasons = [];
  const chain = String(tok.chainId || detectChainFromAddress(address) || '').toLowerCase();
  const sym = String(tok.symbol || '').toUpperCase();
  const name = String(tok.name || '').toLowerCase();
  const nativeChains = {
    BTC: ['bitcoin'],
    ETH: ['ethereum'],
    SOL: ['solana'],
    TRX: ['tron'],
    BNB: ['bsc', 'bnb']
  };

  if (chain) {
    reasons.push('Network: ' + chainLabel(chain));
  }

  // Imposter / wrapped major assets
  ['BTC', 'ETH', 'SOL', 'BNB', 'USDT', 'USDC'].forEach(function (asset) {
    const isNameMatch =
      sym === asset ||
      name === asset.toLowerCase() ||
      name.indexOf(asset.toLowerCase()) >= 0 ||
      (asset === 'BTC' && (name.indexOf('bitcoin') >= 0 || sym.indexOf('BTC') >= 0));
    if (!isNameMatch) return;
    const allowed = nativeChains[asset];
    if (allowed && allowed.indexOf(chain) === -1) {
      if (asset === 'BTC') {
        reasons.unshift(
          '⚠ This is NOT native Bitcoin. Contract is on ' +
            chainLabel(chain) +
            ' (e.g. TRC20/bridged «BTC»). High confusion & issuer/bridge risk.'
        );
      } else {
        reasons.unshift(
          '⚠ «' +
            asset +
            '» on ' +
            chainLabel(chain) +
            ' is not the native asset — verify bridge/issuer before buying.'
        );
      }
    }
  });

  if (tok.fdv && tok.liquidity && Number(tok.fdv) > Number(tok.liquidity) * 50) {
    reasons.push('FDV is much higher than liquidity — exit risk if you need size.');
  }
  if (tok.liquidity != null && Number(tok.liquidity) < 50000) {
    reasons.push('Low liquidity (< $50k) — high slippage risk.');
  }
  return reasons;
}

function mergeReasons(existing, extra) {
  const out = [];
  const seen = {};
  (Array.isArray(existing) ? existing : []).concat(Array.isArray(extra) ? extra : []).forEach(function (r) {
    const k = String(r).toLowerCase();
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push(r);
  });
  return out;
}

function chainBadgeHtml(tok, address) {
  const chain = tok.chainId || detectChainFromAddress(address) || 'unknown';
  const label = chainLabel(chain);
  const danger =
    /NOT native|не нативный|⚠/i.test(JSON.stringify(tok)) ||
    (String(tok.symbol || '').toUpperCase() === 'BTC' && chain !== 'bitcoin');
  const cls = danger || chain === 'tron' && /btc|bitcoin/i.test(String(tok.symbol) + String(tok.name))
    ? 'chain-badge chain-badge-warn'
    : 'chain-badge';
  return '<span class="' + cls + '">' + safe(label) + '</span>';
}


function renderScannerEmpty() {
  const results = document.getElementById('results');
  if (!results || results.innerHTML.trim()) return;
  results.innerHTML =
    '<div class="scanner-empty glass">' +
    '<p class="muted" style="margin-bottom:0.75rem;">Paste a contract address or try an example:</p>' +
    '<div class="home-chip-row" style="justify-content:center;flex-wrap:wrap;gap:0.5rem;">' +
    '<button type="button" class="home-chip example-token" data-addr="0x514910771AF9Ca656af840dff83E8264EcF986CA">LINK</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48">USDC</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0xdAC17F958D2ee523a2206206994597C13D831ec7">USDT</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984">UNI</button>' +
    '</div>' +
    '<p class="muted small" style="margin-top:0.75rem;text-align:center;">Free includes Risk Score, market metrics and a first-pass AI verdict.</p>' +
    '</div>';
  results.querySelectorAll('.example-token').forEach(btn => {
    btn.addEventListener('click', function () {
      const input = document.getElementById('token-input');
      if (input) input.value = btn.getAttribute('data-addr');
      startScan();
    });
  });
}

function showToast(msg) {
  let t = document.getElementById('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'app-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

document.getElementById('forgot-password')?.addEventListener('click', function (e) {
  e.preventDefault();
  alert('Password reset will be available soon. For now contact support via Telegram channel.');
});
document.getElementById('auth-password')?.addEventListener('input', function () {
  const hint = document.getElementById('auth-pass-hint');
  const mode = document.querySelector('.auth-tab.active')?.dataset?.mode;
  if (!hint) return;
  if (mode !== 'register') { hint.style.display = 'none'; return; }
  hint.style.display = 'block';
  const v = this.value || '';
  const okLen = v.length >= 8;
  const okMix = /[A-Za-z]/.test(v) && /[0-9]/.test(v);
  hint.textContent = (!okLen ? 'Min 8 characters. ' : '') + (!okMix ? 'Need letter + number.' : (okLen ? 'Password looks ok.' : ''));
  hint.style.color = okLen && okMix ? 'var(--accent, #00f0a0)' : 'var(--muted)';
});
