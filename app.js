const API_BASE = window.API_BASE || window.location.origin;

/** Same-origin fetches with httpOnly cookie session */
function apiFetch(path, options) {
  options = options || {};
  const headers = Object.assign({}, options.headers || {});
  // Cookie session is primary. Only attach real JWT, never "Bearer null".
  if (headers.Authorization) {
    const a = String(headers.Authorization);
    if (a === 'Bearer null' || a === 'Bearer undefined' || a === 'Bearer ') {
      delete headers.Authorization;
    }
  }
  if (token && token !== 'null' && token !== 'undefined' && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + token;
  }
  return fetch(API_BASE + path, Object.assign({}, options, {
    credentials: 'include',
    headers: headers
  }));
}

/** Ensure user from cookie before gated actions */
async function ensureSession() {
  if (user && user.id) return true;
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    if (data && data.success && data.user && data.user.id) {
      user = data.user;
      if (data.user.isOwner) user.isOwner = true;
      currentPlan = data.user.plan || 'free';
      token = null;
      updateAuthUI();
      return true;
    }
  } catch (e) {}
  return false;
}


let currentPlan = 'free';
let user = null;
let token = null;
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

async function syncPaymentAfterReturn(paymentId) {
  if (!paymentId) return null;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await apiFetch('/api/billing/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: paymentId })
      });
      const data = await res.json();
      if (data.success && data.plan) {
        currentPlan = data.plan;
        if (user) user.plan = data.plan;
        if (data.user) user = data.user;
        updateAuthUI();
        if (typeof refreshAccountPage === 'function') refreshAccountPage();
        if (typeof refreshUsage === 'function') refreshUsage();
        try { localStorage.removeItem('pendingPaymentId'); } catch (e) {}
        return data;
      }
      if (data.pending) {
        await new Promise(function (r) { setTimeout(r, 1500); });
        continue;
      }
      return data;
    } catch (e) {
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
  }
  return null;
}

(function handlePaidReturn() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    if (q.get('paid') === '1') {
      const planQ = q.get('plan') || '';
      history.replaceState({}, '', window.location.pathname);
      setTimeout(async function () {
        const paymentId = localStorage.getItem('pendingPaymentId') || '';
        const en = (localStorage.getItem('lang') || 'ru') === 'en';
        let synced = null;
        if (paymentId) {
          synced = await syncPaymentAfterReturn(paymentId);
        }
        try {
          const me = await apiFetch('/api/auth/me');
          const data = await me.json();
          if (data.user) {
            user = data.user;
            currentPlan = data.user.plan || currentPlan;
            updateAuthUI();
            if (typeof refreshAccountPage === 'function') refreshAccountPage();
            if (typeof refreshUsage === 'function') refreshUsage();
          }
        } catch (e) {}
        if (synced && synced.success) {
          alert(
            en
              ? ('Payment OK — plan: ' + (synced.plan || currentPlan || '').toUpperCase())
              : ('Оплата прошла — тариф: ' + (synced.plan || currentPlan || '').toUpperCase())
          );
        } else {
          alert(
            en
              ? ('Back from payment. Current plan: ' + (currentPlan || 'free') + (paymentId ? '. If still Free, wait 1 min or open Account.' : ''))
              : ('Возврат с оплаты. Сейчас: ' + (currentPlan || 'free') + (paymentId ? '. Если ещё Free — подожди минуту или открой Кабинет.' : ''))
          );
        }
      }, 400);
    }
  } catch (e) {}
})();
document.addEventListener('DOMContentLoaded', () => {
  // Migrate off localStorage JWT — cookie is source of truth
  if (token) {
    try {
      localStorage.removeItem('token');
    } catch (e) {}
    token = null;
  }
  restoreSession().then(function () {
    if (typeof refreshTelegramStatus === 'function') refreshTelegramStatus();
    if (typeof refreshAccountTelegram === 'function') refreshAccountTelegram();
  });
  setTimeout(handleDeepLinkScan, 600);

  document.getElementById('nav-home')?.addEventListener('click', e => { e.preventDefault(); showPage('home'); });
  document.getElementById('nav-scanner')?.addEventListener('click', e => { e.preventDefault(); showPage('scanner'); });
  document.getElementById('nav-watchlist')?.addEventListener('click', e => { e.preventDefault(); showPage('watchlist'); loadWatchlist(); });
  document.getElementById('nav-history')?.addEventListener('click', e => { e.preventDefault(); showPage('history'); loadHistory(); });
  document.getElementById('nav-alerts')?.addEventListener('click', e => {
    e.preventDefault();
    showPage('alerts');
    loadAlerts();
    if (typeof refreshTelegramStatus === 'function') refreshTelegramStatus();
  });
  document.getElementById('nav-portfolio')?.addEventListener('click', e => { e.preventDefault(); showPage('portfolio'); });
  document.getElementById('nav-compare')?.addEventListener('click', e => {
    e.preventDefault();
    showPage('compare');
    const box = document.getElementById('compare-content');
    if (box && !box.innerHTML.trim()) {
      const en = (localStorage.getItem('lang') || 'ru') === 'en';
      box.innerHTML =
        '<div class="glass panel cmp-empty-hint" style="padding:1.2rem">' +
        '<p><strong>' +
        (en ? 'Side-by-side risk' : 'Риск рядом') +
        '</strong></p>' +
        '<p class="muted small">' +
        (en
          ? 'Pick chips (LINK / USDC) or paste 2 addresses. Free shows risk + flags; Premium unlocks FDV/holders.'
          : 'Выберите чипы (LINK / USDC) или вставьте 2 адреса. Free — risk + flags; Premium — FDV/holders.') +
        '</p></div>';
    }
  });
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
  if (typeof bindPayButtons === 'function') bindPayButtons();
  document.querySelectorAll('.pricing-pick').forEach(btn => {
    btn.addEventListener('click', () => selectPlan(btn.dataset.plan));
  });
  let waitlistPlan = 'premium';
  document.querySelectorAll('.waitlist-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      waitlistPlan = btn.dataset.plan || 'premium';
      const box = document.getElementById('waitlist-box');
      if (box) box.style.display = 'block';
      const msg = document.getElementById('waitlist-msg');
      if (msg) msg.textContent = '';
    });
  });
  document.getElementById('waitlist-submit')?.addEventListener('click', async () => {
    const email = document.getElementById('waitlist-email')?.value?.trim();
    const msg = document.getElementById('waitlist-msg');
    if (!email) {
      if (msg) msg.textContent = 'Enter email';
      return;
    }
    try {
      const res = await apiFetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan: waitlistPlan })
      });
      const data = await res.json();
      if (msg) msg.textContent = data.success ? data.message || 'OK' : data.error || 'Error';
    } catch (e) {
      if (msg) msg.textContent = 'Network error';
    }
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
  document.getElementById('cmp-from-history')?.addEventListener('click', cmpFromHistory);
  document.getElementById('cmp-from-watch')?.addEventListener('click', cmpFromWatch);
  document.getElementById('cmp-swap')?.addEventListener('click', cmpSwapAB);
  document.querySelectorAll('#cmp-chips [data-cmp]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      fillCompareSlot(btn.getAttribute('data-cmp'));
    });
  });
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
  loadPublicConfig();
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
    const res = await apiFetch('/api/ticker');
    const data = await res.json();
    const items = (data.ticker || []).filter(function (t) {
      return t && t.price != null && Number(t.price) > 0;
    });
    if (!items.length) {
      inner.innerHTML = '<span class="ticker-item muted">Markets loading…</span>';
      inner.style.animation = 'none';
      return;
    }
    const block = items.map((t) => {
      const ch = t.change24h;
      const cls = ch > 0 ? 'ticker-up' : ch < 0 ? 'ticker-down' : '';
      const sign = ch > 0 ? '+' : '';
      const price = t.price >= 100
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
    const res = await apiFetch('/api/trending');
    const data = await res.json();
    const tokens = data.tokens || [];
    if (!tokens.length) {
      grid.innerHTML = '<div class="empty-state-cta"><p>No trending</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">Scanner</button></div>';
      return;
    }
    grid.innerHTML = tokens.map(t => {
      const price = t.price == null ? '—' : '$' + Number(t.price).toPrecision(5);
      return '<div class="trend-card" onclick="rescan(\'' + t.address + '\')\">' +
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
  document.querySelectorAll('.pay-plan-btn').forEach(function (b) {
    b.style.display = 'block';
  });
  if (typeof bindPayButtons === 'function') bindPayButtons();
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
    openAuthModal(
      (localStorage.getItem('lang') || 'ru') === 'en'
        ? 'Sign in to activate ' + plan.toUpperCase()
        : 'Войдите, чтобы активировать ' + plan.toUpperCase()
    );
    return;
  }
  // NEVER auto-redirect to payment from selectPlan / scroll / card tap.
  // User must explicitly press the pay button (bindPayButtons).
  if (window.__paymentsEnabled) {
    openPricing(plan);
    return;
  }
  // Demo only if explicitly allowed
  if (window.__allowDemoPlans) {
    return activatePlanDemo(plan);
  }
  // Default: waitlist
  const box = document.getElementById('waitlist-box');
  if (box) box.style.display = 'block';
  const msg = document.getElementById('waitlist-msg');
  if (msg) {
    msg.textContent =
      (localStorage.getItem('lang') || 'ru') === 'en'
        ? 'Payments coming soon — leave email in waitlist'
        : 'Оплата скоро — оставьте email в waitlist';
  }
}

async function activatePlanDemo(plan) {
  try {
    const res = await apiFetch('/api/user/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ plan })
    });
    const data = await res.json();
    if (!data.success) {
      if (data.waitlist) {
        const box = document.getElementById('waitlist-box');
        if (box) box.style.display = 'block';
        alert(data.error || 'Демо отключено. Используйте waitlist.');
        return;
      }
      alert(data.error || 'Could not change plan');
      return;
    }
    if (data.token) {
      token = null;
      try { localStorage.removeItem('token'); } catch (e) {}
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
    alert(currentPlan.toUpperCase() + ' активирован (demo mode).');
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
  const tgWrap = document.getElementById('tg-login-wrap');
  if (tgWrap) tgWrap.style.display = 'block';
  mountTelegramLoginWidget();
}


let tgBotUsername = localStorage.getItem('tg_bot_username') || 'aicryptoscreenerbot';

async function applyDemoPlanButtons(allow) {
  document.querySelectorAll('.demo-plan-btn').forEach(function (b) {
    b.style.display = allow ? 'block' : 'none';
  });
}

async function loadPublicConfig() {
  try {
    const res = await apiFetch('/api/config/public');
    const data = await res.json();
    if (!data || !data.success) return;
    if (data.telegramBotUsername) {
      tgBotUsername = data.telegramBotUsername;
      localStorage.setItem('tg_bot_username', tgBotUsername);
    }
    if (typeof mountTelegramLoginWidget === 'function') {
      mountTelegramLoginWidget();
    }
    window.__allowDemoPlans = !!data.allowDemoPlans;
    window.__paymentsEnabled = !!data.paymentsEnabled;
    if (data.usdtTrc20) usdtTrc20 = data.usdtTrc20;
    document.querySelectorAll('.demo-plan-btn').forEach(function (b) {
      b.style.display = window.__allowDemoPlans ? 'block' : 'none';
    });
    document.querySelectorAll('.pay-plan-btn').forEach(function (b) {
      b.style.display = window.__paymentsEnabled ? 'block' : 'none';
    });
  } catch (e) {}
}

async function startCheckout(plan) {
  plan = (plan || 'premium').toLowerCase();
  if (plan !== 'pro') plan = 'premium';
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  if (window.__checkoutInFlight) return;
  if (!user) {
    closePricing();
    openAuthModal(en ? 'Sign in to pay by card' : 'Войдите, чтобы оплатить картой');
    return;
  }
  // Visual feedback on all card buttons
  document.querySelectorAll('.pay-plan-btn').forEach(function (b) {
    b.disabled = true;
    b.dataset._old = b.textContent;
    if (b.getAttribute('data-plan') === plan) {
      b.textContent = en ? 'Opening payment…' : 'Открываем оплату…';
    }
  });
  window.__checkoutInFlight = true;
  try {
    const res = await apiFetch('/api/billing/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan })
    });
    const data = await res.json().catch(function () { return {}; });
    if (data.paymentId) {
      try {
        localStorage.setItem('pendingPaymentId', data.paymentId);
        localStorage.setItem('pendingPaymentPlan', plan);
      } catch (e) {}
    }
    if (data.confirmationUrl) {
      // Mobile Safari: assign more reliable than href in some webviews
      window.location.assign(data.confirmationUrl);
      return;
    }
    const err = data.error || (en ? 'Payment unavailable' : 'Оплата недоступна');
    alert(err + (en ? '\n\nYou can pay via Telegram (USDT).' : '\n\nМожно оплатить через Telegram (USDT).'));
  } catch (e) {
    alert(en ? 'Network error' : 'Ошибка сети');
  } finally {
    window.__checkoutInFlight = false;
    document.querySelectorAll('.pay-plan-btn').forEach(function (b) {
      b.disabled = false;
      if (b.dataset._old) b.textContent = b.dataset._old;
    });
  }
}
window.startCheckout = startCheckout;

function bindPayButtons() {
  document.querySelectorAll('.pay-plan-btn').forEach(function (btn) {
    if (btn.dataset.payBound) return;
    btn.dataset.payBound = '1';
    btn.style.display = 'block';
    btn.style.pointerEvents = 'auto';
    btn.style.position = 'relative';
    btn.style.zIndex = '5';
    var startX = 0;
    var startY = 0;
    var moved = false;
    btn.addEventListener(
      'touchstart',
      function (e) {
        moved = false;
        var t = e.changedTouches && e.changedTouches[0];
        if (t) {
          startX = t.clientX;
          startY = t.clientY;
        }
      },
      { passive: true }
    );
    btn.addEventListener(
      'touchmove',
      function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        if (Math.abs(t.clientX - startX) > 14 || Math.abs(t.clientY - startY) > 14) {
          moved = true;
        }
      },
      { passive: true }
    );
    // Only click — do NOT bind touchend (scroll lift was triggering payment)
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (moved) {
        moved = false;
        return;
      }
      var p = btn.getAttribute('data-plan') || 'premium';
      var en = (localStorage.getItem('lang') || 'ru') === 'en';
      var msg = en
        ? 'Open card payment for ' + String(p).toUpperCase() + '?'
        : 'Открыть оплату картой для тарифа ' + String(p).toUpperCase() + '?';
      if (!window.confirm(msg)) return;
      startCheckout(p);
    });
  });
}


let usdtTrc20 = 'TLZS82t13Qvvo9egwu7LXE8VJQgFduMFNp';

function payViaTelegram(plan) {
  plan = (plan || 'premium').toLowerCase();
  if (plan !== 'pro') plan = 'premium';
  const bot = (typeof tgBotUsername !== 'undefined' && tgBotUsername
    ? tgBotUsername
    : 'aicryptoscreenerbot'
  ).replace(/^@/, '');
  const startPayload = plan === 'pro' ? 'pay_pro' : 'pay_premium';
  window.open('https://t.me/' + bot + '?start=' + startPayload, '_blank', 'noopener');
}
window.payViaTelegram = payViaTelegram;


function mountTelegramLoginWidget() {
  const box = document.getElementById('tg-login-widget');
  const wrap = document.getElementById('tg-login-wrap');
  if (wrap) {
    wrap.style.display = 'block';
    wrap.style.visibility = 'visible';
  }
  const bot = String(tgBotUsername || 'aicryptoscreenerbot').replace(/^@/, '');
  const fb = document.getElementById('tg-login-fallback');
  if (fb) {
    fb.style.display = 'inline-flex';
    fb.onclick = function (e) {
      e.preventDefault();
      openTelegramLoginHelp(bot);
    };
  }
  if (!box) return;
  // clear previous widget scripts/iframes only
  box.querySelectorAll('script, iframe').forEach(function (n) {
    n.remove();
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://telegram.org/js/telegram-widget.js?22';
  s.setAttribute('data-telegram-login', bot);
  s.setAttribute('data-size', 'large');
  s.setAttribute('data-radius', '10');
  s.setAttribute('data-onauth', 'onTelegramAuth(user)');
  s.setAttribute('data-request-access', 'write');
  try {
    s.setAttribute('data-auth-url', window.location.origin + '/');
  } catch (err) {}
  s.onerror = function () {
    const hint = document.getElementById('tg-login-hint');
    if (hint) {
      hint.textContent =
        (localStorage.getItem('lang') || 'ru') === 'en'
          ? 'Telegram widget blocked. Use email or set BotFather domain.'
          : 'Виджет Telegram не загрузился. Email или Domain в BotFather.';
    }
  };
  s.onload = function () {
    setTimeout(function () {
      if (box.querySelector('iframe') && fb) {
        // official button visible — keep our blue button too for reliability
        fb.style.opacity = '0.95';
      }
    }, 600);
  };
  box.appendChild(s);
}

function openTelegramLoginHelp(bot) {
  bot = String(bot || tgBotUsername || 'aicryptoscreenerbot').replace(/^@/, '');
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  const host = (window.location.hostname || '').replace(/^www\./, '');
  const msg = en
    ? 'Telegram Login needs your site domain in BotFather.\n\n1) Open @BotFather\n2) Bot → Domain /setdomain\n3) Paste: ' +
      host +
      '\n4) Reload this page and open Login again.\n\nOfficial widget appears under the blue button when domain matches.\nBot: @' +
      bot
    : 'Вход через Telegram: домен сайта должен быть в BotFather.\n\n1) Открой @BotFather\n2) Бот → Domain /setdomain\n3) Вставь: ' +
      host +
      '\n4) Обнови страницу и снова Войти.\n\nОфициальная кнопка Telegram появится под синей, когда домен совпадёт.\nБот: @' +
      bot;
  alert(msg);
  // open BotFather for convenience
  try {
    window.open('https://t.me/BotFather', '_blank', 'noopener');
  } catch (e) {}
}
window.openTelegramLoginHelp = openTelegramLoginHelp;

async function onTelegramAuth(tgUser) {
  const errEl = document.getElementById('auth-error');
  const showErr = function (msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    } else alert(msg);
  };
  try {
    const res = await apiFetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgUser)
    });
    const data = await res.json();
    if (!data.success) {
      showErr(data.error || 'Telegram login failed');
      return;
    }
    token = null;
    try { localStorage.removeItem('token'); } catch (e) {}
    user = data.user;
      if (data.user && data.user.isOwner) user.isOwner = true;
    currentPlan = (user && user.plan) || 'free';
    updateAuthUI();
    closeAuthModal();
    refreshUsage();
    if (typeof refreshAccountPage === 'function') refreshAccountPage();
    if (typeof loadHomeWidgets === 'function') loadHomeWidgets();
    if (typeof showToast === 'function') showToast('Signed in via Telegram');
  } catch (e) {
    showErr('Network error');
  }
}
window.onTelegramAuth = onTelegramAuth;

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

    const res = await apiFetch('/api/auth/' + (isLogin ? 'login' : 'register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.success) return showErr(data.error || 'Error');

    token = null;
    user = data.user;
      if (data.user && data.user.isOwner) user.isOwner = true;
    currentPlan = (data.user && data.user.plan) || 'free';
    try { localStorage.removeItem('token'); } catch (e) {}
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

function handleDeepLinkScan() {
  try {
    const params = new URLSearchParams(window.location.search);
    const addr = params.get('scan') || params.get('address');
    if (!addr || addr.length < 8) return;
    const input = document.getElementById('token-input') || document.getElementById('home-token-input');
    if (input) input.value = addr;
    showPage('scanner');
    setTimeout(function () {
      if (typeof startScan === 'function') startScan();
      else {
        const btn = document.getElementById('scan-btn') || document.getElementById('analyze-btn');
        if (btn) btn.click();
      }
    }, 500);
  } catch (e) {}
}

async function restoreSession() {
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    if (data && data.success && data.user && data.user.id) {
      user = data.user;
      if (data.user && data.user.isOwner) user.isOwner = true;
      currentPlan = data.user.plan || 'free';
      token = null; // cookie carries session
      updateAuthUI();
      refreshUsage();
      if (typeof loadHomeWidgets === 'function') loadHomeWidgets();
      if (typeof refreshAccountPage === 'function') refreshAccountPage();
    } else {
      user = null;
      currentPlan = 'free';
      token = null;
      updateAuthUI();
      if (typeof loadHomeWidgets === 'function') loadHomeWidgets();
    }
  } catch (e) {
    user = null;
    token = null;
  }
}

function logout() {
  token = null;
  user = null;
  currentPlan = 'free';
  pendingPlan = null;
  try { localStorage.removeItem('token'); } catch (e) {}
  apiFetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
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
    authBtn.textContent = typeof t === 'function' ? t('btn.logout') : (typeof t === 'function' ? t('nav.logout') : 'Logout');
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
  ['home', 'scanner', 'watchlist', 'history', 'alerts', 'portfolio', 'compare', 'account'].forEach(p => {
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
  if (page === 'alerts') {
    loadAlerts();
    if (typeof refreshTelegramStatus === 'function') refreshTelegramStatus();
  }
  if (page === 'portfolio') {
    if (typeof loadPortfolioDesk === 'function') loadPortfolioDesk();
    if (typeof loadNewPairs === 'function') loadNewPairs();
  }
}

async function refreshUsage() {
  try {
    const res = await apiFetch('/api/usage', {
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

async function claimOwnerAccess() {
  const secret = prompt('Owner secret (from Railway OWNER_SECRET):');
  if (!secret) return;
  try {
    const res = await apiFetch('/api/admin/claim-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secret })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Denied');
      return;
    }
    if (data.user) {
      user = data.user;
      if (data.user && data.user.isOwner) user.isOwner = true;
      currentPlan = 'pro';
    }
    alert('Owner / Pro access OK');
    refreshAccountPage();
    refreshUsage();
  } catch (e) {
    alert('Network error');
  }
}
window.claimOwnerAccess = claimOwnerAccess;

async function refreshAccountPage() {
  const guest = document.getElementById('acc-guest');
  const hero = document.getElementById('acc-hero');
  const grid = document.getElementById('acc-grid');
  const emailEl = document.getElementById('acc-email');
  const planEl = document.getElementById('acc-plan');
  const scansEl = document.getElementById('acc-scans');
  const ownerWrap = document.getElementById('claim-owner-wrap');

  if (!user) {
    if (guest) guest.style.display = 'block';
    if (hero) hero.style.display = 'none';
    if (grid) grid.style.display = 'none';
    if (ownerWrap) ownerWrap.style.display = 'none';
    return;
  }
  if (guest) guest.style.display = 'none';
  if (hero) hero.style.display = 'block';
  if (grid) grid.style.display = 'grid';

  if (emailEl) emailEl.textContent = user.email || ('#' + (user.id || ''));
  const planName = (user.plan || currentPlan || 'free').toUpperCase();
  if (planEl) {
    planEl.textContent = user.isOwner ? 'OWNER · ' + planName : planName;
  }
  // Show creator only for owner session or if already owner
  if (ownerWrap) {
    ownerWrap.style.display = user.isOwner ? 'block' : 'none';
  }

  try {
    const res = await apiFetch('/api/usage');
    const data = await res.json();
    if (data.success && data.usage) {
      const lim = data.usage.limit === 999999 ? 999999 : Number(data.usage.limit) || 5;
      const used = Number(data.usage.used) || 0;
      if (scansEl) {
        scansEl.textContent =
          used + ' / ' + (lim >= 999999 ? '∞' : lim);
      }
      const scanBar = document.getElementById('acc-scan-bar');
      if (scanBar) {
        const pct = lim >= 999999 ? 5 : Math.min(100, Math.round((used / lim) * 100));
        scanBar.style.width = pct + '%';
      }
    }
    if (data.chat) {
      const cl = data.chat.limit >= 9999 ? 9999 : Number(data.chat.limit) || 2;
      const usedC = Number(data.chat.used) || 0;
      const chatBar = document.getElementById('acc-chat-bar');
      if (chatBar) {
        const pct = cl >= 9999 ? 5 : Math.min(100, Math.round((usedC / cl) * 100));
        chatBar.style.width = pct + '%';
      }
      const chatLab = document.getElementById('acc-chat-label');
      if (chatLab) {
        chatLab.textContent =
          usedC + ' / ' + (cl >= 9999 ? '∞' : cl) + ' messages today';
      }
    }
    const ac = document.getElementById('acc-alert-count');
    const wc = document.getElementById('acc-watch-count');
    if (ac) ac.textContent = String(data.alertCount != null ? data.alertCount : 0);
    if (wc) wc.textContent = String(data.watchCount != null ? data.watchCount : 0);
  } catch (e) {}

  // recent history
  try {
    const recent = document.getElementById('acc-recent');
    if (recent) {
      const res = await apiFetch('/api/history');
      const data = await res.json();
      const list = (data.history || []).slice(0, 5);
      if (!list.length) {
        recent.textContent =
          (localStorage.getItem('lang') || 'ru') === 'en'
            ? 'No scans yet'
            : 'Пока нет сканов';
      } else {
        recent.innerHTML = list
          .map(function (h) {
            const addr = String(h.address || '').replace(/'/g, '');
            return (
              '<div style="margin:0.25rem 0"><button type="button" class="text-link" onclick="rescan(\'' +
              addr +
              '\')">' +
              (h.symbol || addr.slice(0, 8)) +
              '</button> · risk ' +
              (h.riskScore != null ? h.riskScore : '—') +
              '</div>'
            );
          })
          .join('');
      }
    }
  } catch (e) {}

  // Telegram block on account
  await refreshAccountTelegram();
  refreshTelegramStatus();
}

async function refreshAccountTelegram() {
  const st = document.getElementById('acc-tg-status');
  const btn = document.getElementById('acc-tg-connect');
  const testBtn = document.getElementById('acc-tg-test');
  if (!st || !btn) return;
  if (!user) {
    st.textContent = '—';
    return;
  }
  try {
    const res = await apiFetch('/api/telegram/status');
    const data = await res.json();
    if (data.linked) {
      st.textContent =
        (localStorage.getItem('lang') || 'ru') === 'en'
          ? 'Connected · personal alerts via bot'
          : 'Подключён · личные алерты в боте';
      st.style.color = '#00f0a0';
      btn.textContent =
        (localStorage.getItem('lang') || 'ru') === 'en' ? 'Disconnect' : 'Отключить';
      btn.onclick = function () {
        if (typeof disconnectTelegram === 'function') disconnectTelegram();
      };
      if (testBtn) {
        testBtn.style.display = 'inline-block';
        testBtn.onclick = testTelegramAlert;
      }
    } else {
      st.textContent =
        (localStorage.getItem('lang') || 'ru') === 'en'
          ? 'Not connected'
          : 'Не подключён';
      st.style.color = '';
      btn.textContent = 'Connect';
      btn.onclick = function () {
        if (typeof connectTelegram === 'function') connectTelegram();
        else showPage('alerts');
      };
      if (testBtn) testBtn.style.display = 'none';
    }
  } catch (e) {
    st.textContent = '—';
  }
}

async function testTelegramAlert() {
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  try {
    if (!(await ensureSession())) {
      return openAuthModal(en ? 'Sign in first' : 'Сначала войдите');
    }
    const res = await apiFetch('/api/telegram/digest-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: en ? 'en' : 'ru' })
    });
    const data = await res.json();
    alert(
      data.success
        ? (en ? 'Test alert sent to Telegram — check the bot' : 'Тестовый алерт отправлен — проверьте бота')
        : data.error || 'Failed'
    );
  } catch (e) {
    alert(en ? 'Network error' : 'Ошибка сети');
  }
}


async function loadHomeWidgets() {
  loadHomeWatchlist();
  loadHomeHistory();
  loadHighRiskSignals();
}

async function loadHighRiskSignals() {
  const box = document.getElementById('high-risk-grid');
  if (!box) return;
  try {
    const res = await apiFetch('/api/trending');
    const data = await res.json();
    const list = (data.tokens || []).slice(0, 8);
    if (!list.length) {
      box.innerHTML = '<p class="muted small">No signals yet</p>';
      return;
    }
    const scored = list
      .map(function (t) {
        const liq = Number(t.liquidity) || 0;
        const vol = Number(t.volume24h) || 0;
        let signal = 40;
        if (liq > 0 && liq < 50000) signal += 25;
        else if (liq < 150000) signal += 12;
        if (vol > 0 && vol < 20000) signal += 15;
        if (liq > 0 && vol / Math.max(liq, 1) > 2) signal += 10;
        return Object.assign({}, t, { signal: Math.min(95, signal) });
      })
      .sort(function (a, b) {
        return b.signal - a.signal;
      })
      .slice(0, 5);
    box.innerHTML = scored
      .map(function (t) {
        const addr = String(t.address || '').replace(/'/g, '');
        const col = t.signal >= 70 ? '#ff4d6a' : t.signal >= 50 ? '#f5a623' : '#00f0a0';
        return (
          '<button type="button" class="high-risk-card glass" onclick="rescan(\'' +
          addr +
          '\')">' +
          '<strong>' +
          (t.symbol || 'TOKEN') +
          '</strong>' +
          '<span class="hr-score" style="color:' +
          col +
          '">~' +
          t.signal +
          '</span>' +
          '<span class="muted small">' +
          (t.chainId || '') +
          ' · liq ' +
          formatNum(t.liquidity) +
          '</span></button>'
        );
      })
      .join('');
  } catch (e) {
    box.innerHTML = '<p class="muted small">Unavailable</p>';
  }
}

async function loadHomeWatchlist() {
  const box = document.getElementById('home-watchlist');
  if (!box) return;
  // Session is cookie-based; token may be null after login
  if (!user || !user.id) {
    const msg = (typeof t === 'function' && t('empty.watchlist') && t('empty.watchlist') !== 'empty.watchlist')
      ? t('empty.watchlist')
      : ((localStorage.getItem('lang') || 'ru') === 'en' ? 'Sign in to save favorites' : 'Войдите, чтобы сохранять избранное');
    const btn = (typeof t === 'function' && t('nav.login') && t('nav.login') !== 'nav.login')
      ? t('nav.login')
      : ((localStorage.getItem('lang') || 'ru') === 'en' ? 'Login' : 'Войти');
    box.innerHTML = '<div class="empty-state-cta"><p>' + msg + '</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">' + btn + '</button></div>';
    return;
  }
  try {
    const res = await apiFetch('/api/watchlist');
    const data = await res.json();
    if (!data.watchlist?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>' + ((localStorage.getItem('lang') || 'ru') === 'en' ? 'Watchlist is empty' : 'Избранное пусто') + '</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">' + ((localStorage.getItem('lang') || 'ru') === 'en' ? 'Scanner' : 'Сканер') + '</button></div>';
      return;
    }
    box.innerHTML = '<div class="home-chip-row">' + data.watchlist.slice(0, 8).map(item =>
      '<button type="button" class="home-chip" onclick="rescan(\'' + item.address + '\')\"><strong>' + (item.symbol || 'TOKEN') + '</strong></button>'
    ).join('') + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

async function loadHomeHistory() {
  const box = document.getElementById('home-history');
  if (!box) return;
  if (!user || !user.id) {
    const en = (localStorage.getItem('lang') || 'ru') === 'en';
    const msg = en ? 'Sign in to see history' : 'Войдите, чтобы видеть историю';
    const btn = en ? 'Login' : 'Войти';
    box.innerHTML = '<div class="empty-state-cta"><p>' + msg + '</p><button type="button" class="upgrade-btn" onclick="openAuthModal()">' + btn + '</button></div>';
    return;
  }
  try {
    const res = await apiFetch('/api/history');
    const data = await res.json();
    if (!data.history?.length) {
      box.innerHTML = '<div class="empty-state-cta"><p>' + ((localStorage.getItem('lang') || 'ru') === 'en' ? 'No scans yet' : 'Пока нет сканов') + '</p><button type="button" class="upgrade-btn" onclick="showPage(\'scanner\')">' + ((localStorage.getItem('lang') || 'ru') === 'en' ? 'Scan' : 'Сканер') + '</button></div>';
      return;
    }
    box.innerHTML = data.history.slice(0, 5).map(h =>
      '<div class="list-row"><div class="list-info"><strong>' + (h.symbol || 'TOKEN') +
      '</strong><small>Risk ' + h.riskScore + ' · ' + new Date(h.scannedAt).toLocaleString() +
      '</small></div><div class="list-actions"><button type="button" class="btn-sm" onclick="rescan(\'' + h.address + '\')\">Open</button></div></div>'
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
    const res = await apiFetch('/api/portfolio/' + address, {
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
    const res = await apiFetch('/api/exchanges/bybit', {
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
  grid.innerHTML = '<div class="muted small" style="padding:1rem">Loading…</div>';
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function safeNewsUrl(raw) {
    let u = String(raw || '').trim();
    if (!u || u === '#' || u === 'null' || u === 'undefined') return null;
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u)) {
      // relative or bare domain → force https absolute
      if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
      else return null;
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch (e) {
      return null;
    }
  }
  try {
    const res = await apiFetch('/api/news?source=' + encodeURIComponent(newsSource));
    const data = await res.json();
    if (!data.success || !data.news || !data.news.length) {
      grid.innerHTML = '<div class="error-card">' + ((typeof t === 'function' && t('home.newsEmpty') && t('home.newsEmpty') !== 'home.newsEmpty') ? t('home.newsEmpty') : 'No news') + '</div>';
      return;
    }
    grid.innerHTML = data.news.map(function (item) {
      const url = safeNewsUrl(item.url);
      const title = escapeHtml(item.title || 'News');
      const meta = escapeHtml((item.source || '') + (item.time ? ' · ' + item.time : ''));
      if (url) {
        return (
          '<a class="news-card glass" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" data-external-news="1">' +
          '<div class="news-meta">' + meta + '</div>' +
          '<h3 class="news-title">' + title + '</h3></a>'
        );
      }
      return (
        '<div class="news-card glass news-card-dead" role="article">' +
        '<div class="news-meta">' + meta + '</div>' +
        '<h3 class="news-title">' + title + '</h3>' +
        '<p class="muted small">Link unavailable</p></div>'
      );
    }).join('');
    // Ensure clicks never fall through to SPA routing
    grid.querySelectorAll('a[data-external-news]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.stopPropagation();
        const href = a.getAttribute('href');
        if (!href || href === '#') {
          e.preventDefault();
          return;
        }
        // Force new tab; prevent same-origin SPA navigation on bad URLs
        if (href.indexOf('http') !== 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
      });
    });
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
    const _lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
    const _chainEl = document.getElementById('chain-select');
    const _chain =
      _chainEl && _chainEl.value && _chainEl.value !== 'auto' ? _chainEl.value : '';
    const res = await apiFetch(
      '/api/scan/' +
        encodeURIComponent(address) +
        '?plan=' +
        encodeURIComponent(currentPlan || 'free') +
        '&lang=' +
        encodeURIComponent(_lang) +
        (_chain ? '&chain=' + encodeURIComponent(_chain) : ''),
      {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }
    );
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
    ,
      price: Number((data.token && data.token.price) || (typeof tok !== "undefined" && tok.price) || 0)
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
        await apiFetch('/api/history', {
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
      '<button type="button" class="connect-btn" id="scan-another-btn">' + (((localStorage.getItem('lang')||'ru')==='en')?'Scan another token':'Сканировать другой') + '</button></div>');
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
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const en = lang === 'en';
  const legend = en
    ? '0–30 lower risk · 30–70 caution · 70–100 high risk (not a buy/sell signal)'
    : '0–30 ниже риска · 30–70 осторожно · 70–100 высокий риск (не сигнал купить/продать)';
  return (
    '<div class="risk-bar-wrap"><div class="risk-bar-track"><div class="risk-bar-fill" style="width:' +
    s +
    '%;background:' +
    color +
    '"></div></div>' +
    '<div class="risk-bar-labels"><span>0</span><span>50</span><span>100</span></div>' +
    '<p class="muted small risk-scale-legend">' +
    legend +
    '</p></div>'
  );
}

function buyChecklistHtml(data) {
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const en = lang === 'en';
  const title = en ? 'Before you buy' : 'Перед покупкой';
  let items =
    (data && data.checklist) ||
    (data && data.ai && data.ai.checklist) ||
    null;
  if (!items || !items.length) {
    const tok = (data && data.token) || {};
    const chain = tok.chainId || 'unknown';
    items = en
      ? [
          'Verify contract address on the official project site',
          'Check mint / ownership on the ' + chain + ' explorer',
          'Review top holders and LP lock',
          'Size your trade vs pool liquidity',
          'Watch for ticker clones on other networks'
        ]
      : [
          'Сверь адрес контракта с официальным сайтом проекта',
          'Проверь mint / ownership в эксплорере сети ' + chain,
          'Посмотри top holders и lock LP',
          'Сравни размер сделки с ликвидностью пула',
          'Не путай одноимённые токены на других сетях'
        ];
  }
  let html =
    '<div class="glass panel buy-checklist"><div class="muted small" style="margin-bottom:0.45rem">' +
    title +
    '</div><ul class="buy-checklist-list">';
  items.slice(0, 5).forEach(function (x) {
    html += '<li>' + safe(x) + '</li>';
  });
  html += '</ul></div>';
  return html;
}

function openDemoReport() {
  showPage('scanner');
  const results = document.getElementById('results');
  if (results) results.innerHTML = '<div class="loading glass">Loading Premium sample…</div>';
  apiFetch('/api/sample/premium')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (!data.success) {
        if (results)
          results.innerHTML =
            '<div class="error-card glass">Sample unavailable. Try scanning LINK.</div>';
        return;
      }
      lastScannedToken = {
        address: data.token && data.token.address,
        symbol: data.token && data.token.symbol,
        name: data.token && data.token.name
      };
      lastPairMeta = {
        pairAddress: data.token && data.token.pairAddress,
        chainId: (data.token && data.token.chainId) || 'ethereum'
      ,
      price: Number((data.token && data.token.price) || (typeof tok !== "undefined" && tok.price) || 0)
    };
      window.__lastScanData = data;
      renderTokenPage(data);
      if (results) {
        results.insertAdjacentHTML(
          'afterbegin',
          '<div class="glass panel sample-banner" style="margin-bottom:1rem;border-color:rgba(0,240,160,0.35)">' +
            '<strong>Sample Premium report</strong>' +
            '<p class="muted small" style="margin:0.35rem 0 0">Демо без paywall — так выглядит полный разбор. Это не финансовый совет.</p></div>'
        );
      }
    })
    .catch(function () {
      if (results)
        results.innerHTML = '<div class="error-card glass">Could not load sample</div>';
    });
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

async function fetchRealCandles(pairAddress, chainId, tf, priceHint) {
  const map = { '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w' };
  const pair = pairAddress || 'unknown';
  try {
    const res = await apiFetch(
      '/api/chart/' + encodeURIComponent(pair) +
      '?chain=' + encodeURIComponent(chainId || 'eth') +
      '&tf=' + (map[tf] || '1h') +
      '&price=' + encodeURIComponent(priceHint || 0)
    );
    const data = await res.json();
    if (!data.success || !data.candles || !data.candles.length) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function resizeCandleChart() {
  const container = document.getElementById('candle-chart');
  if (!candleChart || !container) return;
  const w = container.clientWidth || container.offsetWidth || 320;
  const h = container.clientHeight || 360;
  candleChart.applyOptions({ width: w, height: h });
  try {
    candleChart.timeScale().fitContent();
  } catch (e) {}
}

async function initCandleChart(currentPrice) {
  const container = document.getElementById('candle-chart');
  if (!container) return;
  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML =
      '<p class="muted small" style="padding:1rem">Chart library failed to load</p>';
    return;
  }
  container.innerHTML = '';
  const price = Number(currentPrice) > 0 ? Number(currentPrice) : 1;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg2').trim() || '#141825';
  const w = Math.max(container.clientWidth || 0, container.parentElement?.clientWidth || 0, 280);
  try {
    if (candleChart) {
      try {
        candleChart.remove();
      } catch (e) {}
      candleChart = null;
    }
  } catch (e) {}
  candleChart = LightweightCharts.createChart(container, {
    width: w,
    height: 360,
    layout: { background: { color: bg }, textColor: '#888' },
    grid: { vertLines: { color: '#1e2438' }, horzLines: { color: '#1e2438' } },
    rightPriceScale: { borderColor: '#1e2438' },
    timeScale: { borderColor: '#1e2438', timeVisible: true, secondsVisible: false }
  });
  candleSeries = candleChart.addCandlestickSeries({
    upColor: '#00ffc8',
    downColor: '#ff4d6a',
    borderUpColor: '#00ffc8',
    borderDownColor: '#ff4d6a',
    wickUpColor: '#00ffc8',
    wickDownColor: '#ff4d6a'
  });
  volumeSeries = candleChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.78, bottom: 0 }
  });
  try {
    candleChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
  } catch (e) {}

  let seriesData = null;
  if (lastPairMeta?.pairAddress) {
    seriesData = await fetchRealCandles(
      lastPairMeta.pairAddress,
      lastPairMeta.chainId,
      currentTimeframe,
      price
    );
  }
  if (!seriesData || !seriesData.candles || !seriesData.candles.length) {
    seriesData = generateCandleAndVolumeData(price, currentTimeframe);
  }
  try {
    candleSeries.setData(seriesData.candles);
    if (seriesData.volumes && seriesData.volumes.length) {
      volumeSeries.setData(seriesData.volumes);
    }
  } catch (e) {
    console.warn('[chart setData]', e);
    const fb = generateCandleAndVolumeData(price, currentTimeframe);
    candleSeries.setData(fb.candles);
    volumeSeries.setData(fb.volumes);
  }
  resizeCandleChart();
  setTimeout(resizeCandleChart, 80);
  setTimeout(resizeCandleChart, 300);
  if (!window._chartResizeBound) {
    window._chartResizeBound = true;
    window.addEventListener('resize', resizeCandleChart);
  }
}

async function updateCandleData(currentPrice) {
  if (!candleSeries) return;
  const price = Number(currentPrice) > 0 ? Number(currentPrice) : Number(lastPairMeta && lastPairMeta.price) || 1;
  let seriesData = null;
  try {
    if (lastPairMeta && lastPairMeta.pairAddress) {
      seriesData = await fetchRealCandles(
        lastPairMeta.pairAddress,
        lastPairMeta.chainId,
        currentTimeframe,
        price
      );
    }
  } catch (e) {
    seriesData = null;
  }
  if (!seriesData || !seriesData.candles || !seriesData.candles.length) {
    seriesData = generateCandleAndVolumeData(price, currentTimeframe);
  }
  try {
    candleSeries.setData(seriesData.candles);
    if (volumeSeries && seriesData.volumes && seriesData.volumes.length) {
      volumeSeries.setData(seriesData.volumes);
    }
    if (candleChart) {
      try { candleChart.timeScale().fitContent(); } catch (e2) {}
    }
  } catch (e) {
    const fb = generateCandleAndVolumeData(price, currentTimeframe);
    try {
      candleSeries.setData(fb.candles);
      if (volumeSeries) volumeSeries.setData(fb.volumes || []);
    } catch (e3) {
      console.warn('[chart]', e3);
    }
  }
  resizeCandleChart();
  resizeCandleChart();
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

function buildSecurityFlags(tok, risk, address, security) {
  tok = tok || {};
  const chain = String(tok.chainId || detectChainFromAddress(address) || '').toLowerCase();
  const sym = String(tok.symbol || '').toUpperCase();
  const name = String(tok.name || '').toLowerCase();
  const liq = Number(tok.liquidity) || 0;
  const isImposter =
    ((sym === 'BTC' || name.indexOf('bitcoin') >= 0) && chain && chain !== 'bitcoin') ||
    (sym === 'ETH' && chain && !/ethereum|eth/.test(chain));
  const knownBluechip =
    ['LINK', 'UNI', 'AAVE', 'MKR', 'CRV', 'SNX', 'COMP', 'USDC', 'USDT'].indexOf(sym) >= 0 &&
    /ethereum|eth|base|arbitrum/.test(chain);
  const meta = (security && security.meta) || {};
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  const L = function (ru, en) {
    return lang === 'en' ? en : ru;
  };

  // Prefer GoPlus flags when available
  if (security && security.available && Array.isArray(security.flags) && security.flags.length) {
    const base = [
      {
        id: 'network',
        label: L('Сеть', 'Network'),
        status: chain ? 'ok' : 'warn',
        text: chain ? chainLabel(chain) : L('Неизвестно', 'Unknown')
      },
      {
        id: 'identity',
        label: L('Идентичность', 'Identity'),
        status: isImposter ? 'bad' : knownBluechip ? 'ok' : 'warn',
        text: isImposter
          ? L('Не нативный ' + (sym || 'актив') + ' на этой сети', 'Not native ' + (sym || 'asset') + ' on this chain')
          : knownBluechip
            ? L('Известный протокол', 'Known protocol token')
            : L('Сверьте контракт в explorer', 'Verify contract in explorer')
      }
    ];
    return base.concat(security.flags);
  }

  return [
    {
      id: 'network',
      label: L('Сеть', 'Network'),
      status: chain ? 'ok' : 'warn',
      text: chain ? chainLabel(chain) : L('Неизвестно', 'Unknown')
    },
    {
      id: 'identity',
      label: L('Идентичность', 'Identity'),
      status: isImposter ? 'bad' : knownBluechip ? 'ok' : 'warn',
      text: isImposter
        ? L('Не нативный актив на этой сети', 'Not native asset on this chain')
        : knownBluechip
          ? L('Известный протокол', 'Known protocol token')
          : L('Сверьте контракт', 'Verify contract')
    },
    {
      id: 'liquidity',
      label: L('Ликвидность', 'Liquidity'),
      status: liq >= 200000 ? 'ok' : liq >= 50000 ? 'warn' : 'bad',
      text: liq
        ? liq >= 1e6
          ? '$' + (liq / 1e6).toFixed(2) + 'M'
          : '$' + (liq / 1e3).toFixed(0) + 'K'
        : L('Очень низкая', 'Very low / n/a')
    },
    {
      id: 'verified',
      label: L('Верификация', 'Verified'),
      status: meta.isOpenSource === true || knownBluechip ? 'ok' : 'warn',
      text:
        meta.isOpenSource === true
          ? L('Исходный код открыт', 'Source verified')
          : meta.isOpenSource === false
            ? L('Код не верифицирован', 'Source not verified')
            : L('Нет данных GoPlus', 'No GoPlus data yet')
    },
    {
      id: 'honeypot',
      label: 'Honeypot',
      status: meta.isHoneypot === true ? 'bad' : meta.isHoneypot === false ? 'ok' : 'warn',
      text:
        meta.isHoneypot === true
          ? L('Флаг honeypot', 'Honeypot flag')
          : meta.isHoneypot === false
            ? L('Honeypot не обнаружен', 'No honeypot flag')
            : L('Симуляция недоступна для сети', 'Simulation unavailable for chain')
    },
    {
      id: 'tax',
      label: L('Налог buy/sell', 'Buy / Sell tax'),
      status:
        (meta.sellTax != null && meta.sellTax > 10) || (meta.buyTax != null && meta.buyTax > 10)
          ? 'bad'
          : meta.buyTax != null || meta.sellTax != null
            ? 'ok'
            : 'warn',
      text:
        meta.buyTax != null || meta.sellTax != null
          ? 'Buy ' +
            (meta.buyTax != null ? meta.buyTax + '%' : '—') +
            ' / Sell ' +
            (meta.sellTax != null ? meta.sellTax + '%' : '—')
          : L('Налог неизвестен', 'Tax unknown')
    },
    {
      id: 'mint',
      label: L('Mint / Owner', 'Mint / Own'),
      status: meta.isMintable === true ? 'bad' : meta.renounced ? 'ok' : meta.isMintable === false ? 'ok' : 'warn',
      text: meta.isMintable
        ? L('Mint возможен', 'Mint present')
        : meta.renounced
          ? L('Owner renounced', 'Owner renounced')
          : L('Нужна проверка ownership', 'Review ownership')
    },
    {
      id: 'lp',
      label: L('LP lock', 'LP lock'),
      status:
        meta.lpBurned || (meta.lpLockedPct != null && meta.lpLockedPct >= 80)
          ? 'ok'
          : meta.lpLockedPct != null
            ? 'warn'
            : 'warn',
      text:
        meta.lpLockedPct != null
          ? '~' + meta.lpLockedPct + '% locked/burned'
          : L('Неизвестно — смотри explorer', 'Unknown — check explorer')
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
    const res = await apiFetch(
      '/api/security/' + encodeURIComponent(chain) + '/' + encodeURIComponent(address)
    );
    if (!res.ok) throw new Error('security ' + res.status);
    const body = await res.json();
    if (body.success && body.security) {
      data.security = body.security;
      if (currentTokenContext && currentTokenContext.token) {
        currentTokenContext.security = {
          available: !!body.security.available,
          source: body.security.source || 'goplus',
          flags: Array.isArray(body.security.flags) ? body.security.flags : [],
          meta: body.security.meta || {},
          identityWarnings: body.security.identityWarnings || []
        };
      }
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
  const tt = typeof t === 'function' ? t : function (k) { return k; };
  const title = tt('report.securitySnap');
  const source =
    security && security.available ? tt('report.sourceGoplus') : tt('report.sourceHeuristic');

  let flags = buildSecurityFlags(tok, risk, address, security);
  // Localize known flag labels by id
  const labelKey = {
    network: 'sec.network',
    identity: 'sec.identity',
    liquidity: 'sec.liquidity',
    verified: 'sec.verified',
    honeypot: 'sec.honeypot',
    tax: 'sec.tax',
    mint: 'sec.mint',
    lp: 'sec.lp',
    holders: 'sec.holders',
    blacklist: 'sec.blacklist',
    proxy: 'sec.proxy',
    trading: 'sec.trading',
    ownership: 'sec.mint'
  };
  flags = flags.map(function (f) {
    const k = labelKey[f.id];
    if (k) return Object.assign({}, f, { label: tt(k) });
    return f;
  });

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
  const sec = data.security || {};
  const addr = tok.address || '';
  const shareUrl =
    window.location.origin +
    '/?scan=' +
    encodeURIComponent(addr) +
    (tok.chainId ? '&chain=' + encodeURIComponent(tok.chainId) : '');

  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e11';
  ctx.fillRect(0, 0, 900, 520);
  ctx.fillStyle = '#12161c';
  roundRect(ctx, 40, 40, 820, 440, 20);
  ctx.fill();
  ctx.strokeStyle = '#1e2438';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#00f0a0';
  ctx.fillRect(40, 40, 8, 440);

  ctx.fillStyle = '#e4e4f0';
  ctx.font = 'bold 28px Inter, system-ui, sans-serif';
  const title = ((tok.symbol || 'TOKEN') + '  ' + (tok.name || '')).slice(0, 42);
  ctx.fillText(title, 70, 100);

  ctx.fillStyle = '#888';
  ctx.font = '16px Inter, system-ui, sans-serif';
  const chain = tok.chainId ? String(tok.chainId).toUpperCase() : '';
  ctx.fillText(chain + (addr ? '  ·  ' + String(addr).slice(0, 12) + '…' : ''), 70, 130);

  const score = Number(r.riskScore) || 0;
  const level = String(r.riskLevel || '').toUpperCase() || (score >= 61 ? 'HIGH' : score >= 31 ? 'MEDIUM' : 'LOW');
  const col = score >= 61 ? '#ff4d6a' : score >= 31 ? '#f5a623' : '#00f0a0';
  ctx.fillStyle = col;
  ctx.font = 'bold 64px Inter, system-ui, sans-serif';
  ctx.fillText(String(score), 70, 220);
  ctx.fillStyle = '#888';
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText('/ 100  ·  ' + level, 70 + ctx.measureText(String(score)).width + 12, 220);

  ctx.fillStyle = '#e4e4f0';
  ctx.font = '20px Inter, system-ui, sans-serif';
  ctx.fillText('Price  $' + (tok.price != null ? formatPrice(tok.price) : '—'), 70, 280);
  ctx.fillText('Liquidity  ' + formatNum(tok.liquidity), 70, 315);
  ctx.fillText('Volume 24h  ' + formatNum(tok.volume24h), 70, 350);

  // top flags
  const flags = (sec.flags || []).filter(function (f) {
    return f && (f.status === 'bad' || f.status === 'warn');
  }).slice(0, 3);
  ctx.fillStyle = '#aaa';
  ctx.font = '15px Inter, system-ui, sans-serif';
  if (flags.length) {
    ctx.fillText(
      flags
        .map(function (f) {
          return (f.status === 'bad' ? '● ' : '○ ') + (f.label || f.id || '');
        })
        .join('   '),
      70,
      390
    );
  } else {
    ctx.fillText('Flags: see full report on site', 70, 390);
  }

  ctx.fillStyle = '#00f0a0';
  ctx.font = 'bold 18px Inter, system-ui, sans-serif';
  ctx.fillText('Crypto AI Scanner', 70, 440);
  ctx.fillStyle = '#666';
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.fillText('Not financial advice · DYOR', 260, 440);

  function doneBlob(blob) {
    if (!blob) return;
    const file = new File([blob], (tok.symbol || 'token') + '-risk.png', {
      type: 'image/png'
    });
    const navShare =
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] });
    if (navShare) {
      navigator
        .share({
          title: (tok.symbol || 'Token') + ' risk ' + score + '/100',
          text: 'Risk report · Crypto AI Scanner',
          url: shareUrl,
          files: [file]
        })
        .catch(function () {
          downloadBlob(blob, file.name);
        });
    } else {
      downloadBlob(blob, file.name);
      try {
        if (navigator.clipboard && shareUrl) {
          navigator.clipboard.writeText(shareUrl);
        }
      } catch (e) {}
    }
    if (typeof showToast === 'function') {
      showToast('PNG + link ready');
    }
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  canvas.toBlob(doneBlob, 'image/png');
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



function localizeRiskReason(x) {
  const s = String(x || '');
  const lang = (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru';
  if (lang === 'en') {
    return s
      .replace(/Сеть:/gi, 'Network:')
      .replace(/ликвидность/gi, 'liquidity')
      .replace(/объём/gi, 'volume');
  }
  return s
    .replace(/^Network:\s*/i, 'Сеть: ')
    .replace(/FDV is much higher than liquidity[^.]*\.?/i, 'FDV сильно выше ликвидности — риск выхода при крупной сделке')
    .replace(/exit risk if you need size/gi, 'сложно выйти крупным объёмом')
    .replace(/GoPlus:\s*honeypot flag/i, 'GoPlus: флаг honeypot')
    .replace(/GoPlus:\s*mintable/i, 'GoPlus: возможен mint')
    .replace(/GoPlus:\s*source not verified/i, 'GoPlus: код не верифицирован')
    .replace(/GoPlus:\s*high sell tax/i, 'GoPlus: высокий sell tax')
    .replace(/Very low liquidity/i, 'Очень низкая ликвидность')
    .replace(/Thin liquidity/i, 'Тонкая ликвидность')
    .replace(/Low volume/i, 'Низкий объём')
    .replace(/FDV >> liquidity/i, 'FDV сильно выше ликвидности');
}

function healthEmoji(score) {
  const s = Number(score) || 0;
  if (s <= 30) return '🟢';
  if (s <= 60) return '🟡';
  return '🔴';
}

function healthLabel(score, en) {
  const s = Number(score) || 0;
  if (s <= 30) return en ? 'LOW' : 'НИЗКИЙ';
  if (s <= 60) return en ? 'MEDIUM' : 'СРЕДНИЙ';
  return en ? 'HIGH' : 'ВЫСОКИЙ';
}

/** Persist risk points per address for local "Risk history" chart */
function pushRiskHistory(address, score) {
  if (!address) return [];
  const key = 'risk_hist_' + String(address).toLowerCase();
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  const now = Date.now();
  const last = arr[arr.length - 1];
  if (!last || last.s !== Number(score) || now - last.t > 30 * 60 * 1000) {
    arr.push({ t: now, s: Number(score) || 0 });
  }
  if (arr.length > 24) arr = arr.slice(-24);
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {}
  return arr;
}

function tokenHealthHtml(tok, risk, security) {
  const en = ((typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru') === 'en';
  const parts = buildRiskBreakdown(tok, risk, tok && tok.address);
  const meta = (security && security.meta) || {};
  const trading =
    meta.isHoneypot === true || meta.cannotSellAll
      ? 85
      : meta.sellTax != null && meta.sellTax > 10
        ? 70
        : 25;
  const ownership = meta.renounced ? 15 : meta.isMintable ? 70 : 40;
  const items = [
    { key: en ? 'Contract' : 'Контракт', score: parts.contract },
    { key: en ? 'Liquidity' : 'Ликвидность', score: parts.liquidity },
    { key: en ? 'Holders' : 'Холдеры', score: parts.holders },
    { key: en ? 'Trading' : 'Торговля', score: trading },
    { key: en ? 'Whales' : 'Киты', score: parts.holders },
    { key: en ? 'Ownership' : 'Ownership', score: ownership }
  ];
  const overall = Number(risk && risk.riskScore) || 50;
  let html = '<div class="token-health glass panel">';
  html += '<div class="th-head"><span class="th-title">TOKEN HEALTH</span>';
  html +=
    '<span class="th-overall" style="color:' +
    scoreColor(overall) +
    '">' +
    healthEmoji(overall) +
    ' ' +
    overall +
    '/100 · ' +
    healthLabel(overall, en) +
    '</span></div>';
  html += '<div class="th-grid">';
  items.forEach(function (it) {
    html +=
      '<div class="th-item"><span class="th-ico">' +
      healthEmoji(it.score) +
      '</span><span class="th-key">' +
      it.key +
      '</span></div>';
  });
  html += '</div></div>';
  return html;
}

function whatWeCheckedHtml(security) {
  const en = ((typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru') === 'en';
  const flags = (security && security.flags) || [];
  const n = Math.max(flags.length, 12);
  let html = '<div class="what-checked glass panel">';
  html +=
    '<div class="muted small">' +
    (en ? 'What we checked' : 'Что проверили') +
    '</div>';
  html +=
    '<p class="wc-lead">' +
    (en
      ? n + ' risk signals → AI analysis → Risk score'
      : n + ' сигналов риска → AI-анализ → Risk score') +
    '</p>';
  html += '<div class="wc-cols">';
  html +=
    '<div><strong>Contract</strong><ul><li>Honeypot</li><li>Mint</li><li>Ownership</li><li>Proxy</li><li>Tax</li><li>Blacklist</li></ul></div>';
  html +=
    '<div><strong>Liquidity</strong><ul><li>Size</li><li>LP lock</li><li>LP burn</li><li>Depth vs FDV</li></ul></div>';
  html +=
    '<div><strong>Holders</strong><ul><li>Top-10</li><li>Concentration</li><li>Count</li></ul></div>';
  html +=
    '<div><strong>Market</strong><ul><li>Volume</li><li>Buy/Sell</li><li>Volatility</li></ul></div>';
  html += '</div>';
  html +=
    '<p class="muted small wc-src">' +
    (en
      ? 'Sources: DexScreener · GoPlus · own heuristics. Not financial advice.'
      : 'Источники: DexScreener · GoPlus · эвристики. Не финансовый совет.') +
    '</p></div>';
  return html;
}

function identityBannerHtml(tok, security) {
  const warnings =
    (security && security.identityWarnings) ||
    (security && security.flags || []).filter(function (f) {
      return f && String(f.id || '').indexOf('identity') === 0;
    });
  if (!warnings || !warnings.length) {
    // client-side fallback
    const sym = String(tok && tok.symbol || '').toUpperCase();
    const chain = String(tok && tok.chainId || '').toLowerCase();
    const name = String(tok && tok.name || '').toLowerCase();
    if ((sym === 'BTC' || name.indexOf('bitcoin') >= 0) && chain && chain !== 'bitcoin') {
      warnings = [{
        title: 'Not native Bitcoin',
        text: 'Token «' + sym + '» on ' + chain + ' is not native BTC. High confusion risk.'
      }];
    }
  }
  if (!warnings || !warnings.length) return '';
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  let html = '<div class="identity-alert glass panel">';
  html += '<div class="scam-alert-title">⚠ ' + (en ? 'Identity warning' : 'Предупреждение об идентичности') + '</div>';
  warnings.forEach(function (w) {
    html += '<p class="scam-alert-ai">' + safe(w.text || w.title || '') + '</p>';
  });
  html += '</div>';
  return html;
}

function scamAlertBannerHtml(tok, risk, security) {
  const score = Number(risk && risk.riskScore) || 0;
  if (score < 55) return '';
  const en = ((typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru') === 'en';
  const meta = (security && security.meta) || {};
  const bullets = [];
  if (meta.isHoneypot) bullets.push(en ? 'Honeypot flag from GoPlus' : 'Флаг honeypot (GoPlus)');
  if (meta.isMintable) bullets.push(en ? 'Mint authority present' : 'Возможен mint');
  if (meta.top10Pct != null && meta.top10Pct >= 50)
    bullets.push(
      en
        ? 'Top wallets concentrated ~' + meta.top10Pct + '%'
        : 'Концентрация top wallets ~' + meta.top10Pct + '%'
    );
  if (meta.sellTax != null && meta.sellTax > 10)
    bullets.push(en ? 'High sell tax ' + meta.sellTax + '%' : 'Высокий sell tax ' + meta.sellTax + '%');
  if ((Number(tok && tok.liquidity) || 0) < 50000)
    bullets.push(en ? 'Thin liquidity' : 'Тонкая ликвидность');
  if (!bullets.length) {
    bullets.push(
      en ? 'Elevated composite risk score' : 'Повышенный составной risk score'
    );
  }
  let html = '<div class="scam-alert glass panel">';
  html +=
    '<div class="scam-alert-title">🚨 ' +
    (en ? 'AI Scam Detection' : 'AI Scam Detection') +
    '</div>';
  html +=
    '<div class="scam-alert-verdict" style="color:' +
    scoreColor(score) +
    '">' +
    (en ? 'Elevated risk detected' : 'Обнаружен повышенный риск') +
    ' · ' +
    score +
    '/100</div>';
  html += '<ul class="scam-alert-list">';
  bullets.slice(0, 5).forEach(function (b) {
    html += '<li>🔴 ' + safe(b) + '</li>';
  });
  html += '</ul>';
  html +=
    '<p class="scam-alert-ai"><strong>AI:</strong> ' +
    (score >= 70
      ? en
        ? 'HIGH RISK — avoid size until further investigation.'
        : 'ВЫСОКИЙ РИСК — не входи крупно до доп. проверки.'
      : en
        ? 'CAUTION — review flags before any entry.'
        : 'ОСТОРОЖНО — проверь флаги до входа.') +
    '</p>';
  html +=
    '<button type="button" class="connect-btn" id="scam-alert-details-btn">' +
    (en ? 'See what triggered the warning' : 'Что вызвало предупреждение') +
    '</button></div>';
  return html;
}

function openSecurityFromAlert() {
  const tab = document.querySelector('.tab[data-tab="security"]');
  if (tab) {
    tab.click();
  } else {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.remove('active');
    });
    document.querySelectorAll('.tab-pane').forEach(function (p) {
      p.classList.remove('active');
    });
    const secTab = document.querySelector('[data-tab="security"]');
    const pane = document.getElementById('security');
    if (secTab) secTab.classList.add('active');
    if (pane) pane.classList.add('active');
  }
  setTimeout(function () {
    const pane = document.getElementById('security');
    if (pane) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}
window.openSecurityFromAlert = openSecurityFromAlert;

function riskHistoryHtml(address, score) {
  const en = ((typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru') === 'en';
  const hist = pushRiskHistory(address, score);
  if (!hist.length) return '';
  const scores = hist.map(function (h) {
    return h.s;
  });
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = last - first;
  const maxS = Math.max.apply(null, scores.concat([100]));
  const w = 280;
  const h = 72;
  const step = scores.length > 1 ? w / (scores.length - 1) : w;
  let d = '';
  scores.forEach(function (s, i) {
    const x = i * step;
    const y = h - (s / maxS) * (h - 8) - 4;
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  });
  let html = '<div class="risk-history glass panel">';
  html +=
    '<div class="muted small">' + (en ? 'Risk history (this device)' : 'История риска (это устройство)') + '</div>';
  html +=
    '<svg class="risk-hist-svg" viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '" width="100%" height="72" preserveAspectRatio="none"><path d="' +
    d +
    '" fill="none" stroke="#00f0a0" stroke-width="2"/></svg>';
  if (hist.length >= 2 && Math.abs(delta) >= 5) {
    html +=
      '<p class="risk-hist-delta" style="color:' +
      (delta > 0 ? '#ff4d6a' : '#00f0a0') +
      '">' +
      (delta > 0 ? '⚠️ ' : '✅ ') +
      (en ? 'Risk changed ' : 'Риск изменился ') +
      first +
      ' → ' +
      last +
      ' (' +
      (delta > 0 ? '+' : '') +
      delta +
      ')</p>';
  } else {
    html +=
      '<p class="muted small">' +
      (en
        ? 'Re-scan later to see how risk moves over time.'
        : 'Повторный скан покажет, как меняется риск.') +
      '</p>';
  }
  html += '</div>';
  // hydrate from server snapshots (async)
  setTimeout(function () {
    hydrateRiskHistoryFromServer(address, score);
  }, 300);
  return html;
}

async function hydrateRiskHistoryFromServer(address, score) {
  if (!address) return;
  try {
    const res = await apiFetch(
      '/api/risk-history/' + encodeURIComponent(address) + '?hours=48'
    );
    const data = await res.json();
    const points = (data && data.points) || [];
    if (points.length < 2) return;
    const scores = points.map(function (p) {
      return Number(p.riskScore) || 0;
    });
    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const maxS = Math.max.apply(null, scores.concat([100]));
    const w = 280;
    const h = 72;
    const step = scores.length > 1 ? w / (scores.length - 1) : w;
    let d = '';
    scores.forEach(function (s, i) {
      const x = i * step;
      const y = h - (s / maxS) * (h - 8) - 4;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    const box = document.querySelector('.risk-history');
    if (!box) return;
    const en =
      ((typeof currentLang !== 'undefined' && currentLang) ||
        localStorage.getItem('lang') ||
        'ru') === 'en';
    let html =
      '<div class="muted small">' +
      (en ? 'Risk history (server, 48h)' : 'История риска (сервер, 48ч)') +
      '</div>';
    html +=
      '<svg class="risk-hist-svg" viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" width="100%" height="72" preserveAspectRatio="none"><path d="' +
      d +
      '" fill="none" stroke="#00f0a0" stroke-width="2"/></svg>';
    if (Math.abs(delta) >= 5) {
      html +=
        '<p class="risk-hist-delta" style="color:' +
        (delta > 0 ? '#ff4d6a' : '#00f0a0') +
        '">' +
        (delta > 0 ? '⚠️ ' : '✅ ') +
        first +
        ' → ' +
        last +
        ' (' +
        (delta > 0 ? '+' : '') +
        delta +
        ')</p>';
    }
    box.innerHTML = html;
  } catch (e) {}
}

function demoTokensHtml() {
  const en = ((typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru') === 'en';
  // LINK low, a mid meme-style addr placeholder uses USDC as mid-stable, high uses known pattern via sample API + synthetic
  return (
    '<div class="demo-tokens glass panel">' +
    '<div class="muted small" style="margin-bottom:0.6rem">' +
    (en ? 'Demo reports (Low / Medium / High risk profile)' : 'Демо-отчёты (низкий / средний / высокий риск)') +
    '</div>' +
    '<div class="demo-row">' +
    '<button type="button" class="demo-card low" data-demo="low"><span>🟢</span> ' +
    (en ? 'Low risk' : 'Низкий риск') +
    '<small>LINK-style</small></button>' +
    '<button type="button" class="demo-card mid" data-demo="mid"><span>🟡</span> ' +
    (en ? 'Medium' : 'Средний') +
    '<small>Stable / mixed</small></button>' +
    '<button type="button" class="demo-card high" data-demo="high"><span>🔴</span> ' +
    (en ? 'High risk' : 'Высокий риск') +
    '<small>Flags heavy</small></button>' +
    '</div></div>'
  );
}

function renderTokenPage(data) {
  const tok = data.token || {};
  const r = data.risk || {};
  const ai = data.ai || {};
  const planLabel = String(data.plan || '').toLowerCase();
  const isPrem = planLabel === 'premium' || planLabel === 'pro';
  const isPro = planLabel === 'pro';
  const addr = lastScannedToken?.address || '';
  const adv = data.advanced || {};
  const reasons = Array.isArray(r.reasons) ? r.reasons : [];
  const tt = typeof t === 'function' ? t : function (k) { return k; };

  lastPairMeta = {
    pairAddress: tok.pairAddress || lastPairMeta?.pairAddress || null,
    chainId: tok.chainId || lastPairMeta?.chainId || 'ethereum'
  ,
      price: Number((data.token && data.token.price) || (typeof tok !== "undefined" && tok.price) || 0)
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
    '<button type="button" class="btn-sm" style="margin-top:0.5rem;" onclick="addWatch(\'' + addr + '\',\'' + (tok.symbol || '') + '\',\'' + (tok.name || '') + '\')">' + tt('btn.watchlistAdd') + '</button>' +
    '<button type="button" class="btn-sm share-btn" style="margin-top:0.35rem;" onclick="shareReport()">' + tt('btn.share') + '</button>' +
    '</div></div>' +
    identityBannerHtml(tok, data.security) +
    scamAlertBannerHtml(tok, r, data.security) +
    tokenHealthHtml(tok, r, data.security) +
    riskBreakdownHtml(tok, r, addr) +
    securityFlagsHtml(tok, r, addr, data.security) +
    whatWeCheckedHtml(data.security) +
    riskHistoryHtml(addr, r.riskScore) +
    (reasons.length
      ? '<div class="glass panel risk-factors-panel"><div class="muted small">' + tt('report.riskFactors') + '</div><ul class="risk-factors-list">' +
        reasons.filter(function (x) {
      var s = String(x || '');
      if (/residual smart-contract|always remains|остаточный риск/i.test(s)) return false;
      return s.trim().length > 0;
    }).map(function (x) {
      var w = /⚠|NOT native|не нативный|wrapper|imposter|Network:|honeypot|GoPlus/i.test(String(x));
      return '<li class="' + (w ? 'risk-reason-warn' : '') + '">' + localizeRiskReason(x) + '</li>';
    }).join('') + '</ul></div>'
      : '') +
    '<div class="metrics-grid">' +
    '<div class="metric-card glass"><div class="metric-label">' + tt('report.marketCap') + '</div><div class="metric-value">' + formatNum(tok.marketCap || tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">' + tt('report.fdv') + '</div><div class="metric-value">' + formatNum(tok.fdv) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">' + tt('report.volume') + '</div><div class="metric-value">' + formatNum(tok.volume24h) + '</div></div>' +
    '<div class="metric-card glass"><div class="metric-label">' + tt('report.liquidity') + '</div><div class="metric-value">' + formatNum(tok.liquidity) + '</div></div></div>' +
    '<div class="tabs">' +
    '<button type="button" class="tab active" data-tab="overview">' + tt('report.tabOverview') + '</button>' +
    '<button type="button" class="tab" data-tab="security">' + tt('report.tabSecurity') + '</button>' +
    '<button type="button" class="tab" data-tab="ai">' + tt('report.tabAi') + '</button>' +
    '<button type="button" class="tab" data-tab="links">' + tt('report.tabLinks') + '</button></div>' +
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
        '<div class="muted small" style="margin-bottom:0.5rem;">' + tt('report.riskScale') + '</div>' +
        riskBarHtml(r.riskScore) +
        aiOverviewHtml(ai, r) +
        '<p class="muted small" style="margin-top:0.75rem;">' + tt('report.freeCharts') + '</p>' +
        '<button type="button" class="connect-btn" style="margin-top:0.5rem;" onclick="openPricing(\'premium\')">' + tt('btn.seePremium') + '</button></div>') +
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
    securityFlagsHtml(tok, r, addr, data.security) +
    (isPrem
      ? '<div class="metrics-grid" style="margin-top:1rem">' +
        '<div class="metric-card glass"><div class="metric-label">Contract</div><div class="metric-value">' +
        (data.security?.meta?.isOpenSource === true || data.security?.contractVerified
          ? 'Verified'
          : data.security?.meta?.isOpenSource === false
            ? 'Not verified'
            : '—') +
        '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Top-10</div><div class="metric-value">' +
        (data.security?.meta?.top10Pct != null ? data.security.meta.top10Pct + '%' : safe(adv.whaleConcentration) || '—') +
        '</div></div>' +
        '<div class="metric-card glass"><div class="metric-label">Risk</div><div class="metric-value risk-' +
        (r.riskLevel || '').toLowerCase() +
        '">' +
        safe(r.riskLevel) +
        '</div></div></div>'
      : '<p class="muted small" style="margin-top:0.75rem;">Free: honeypot · tax · mint · ownership · LP (GoPlus). Premium: holders chart, deep AI, alerts.</p>' +
        '<button type="button" class="connect-btn" onclick="openPricing(\'premium\')">Premium deep report</button>') +
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
    buyChecklistHtml(data) +
    (!isPrem
      ? '<div class="glass panel" style="margin-top:1rem;padding:1rem;border-color:rgba(0,240,160,0.25);">' +
        '<p style="margin:0 0 0.5rem;font-size:0.9rem;">Free AI — первый фильтр. Premium: график, security, алерты и чат с лимитом.</p>' +
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
  const scamBtn = document.getElementById('scam-alert-details-btn');
  if (scamBtn) {
    scamBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openSecurityFromAlert();
    });
  }
  initAIChat(data);
}

function initAIChat(data) {
  const section = document.getElementById('ai-chat-section');
  if (!section) return;
  const plan = String(
    (data && data.plan) || currentPlan || (user && user.plan) || 'free'
  ).toLowerCase();
  const isPro = plan === 'pro';
  const isPrem = plan === 'premium' || isPro;
  const lang =
    (typeof currentLang !== 'undefined' && currentLang) ||
    localStorage.getItem('lang') ||
    'ru';
  const en = lang === 'en';
  const title = section.querySelector('h3');
  if (title) {
    if (typeof t === 'function') {
      title.textContent = isPro
        ? t('chat.pro')
        : isPrem
          ? t('chat.premium')
          : t('chat.freeTrial');
    } else {
      title.textContent = isPro
        ? 'AI Chat (Pro)'
        : isPrem
          ? en
            ? 'AI Chat (Premium · limited)'
            : 'AI Chat (Premium · лимит)'
          : en
            ? 'AI Chat (Free trial · 2/day)'
            : 'AI Chat (Free trial · 2/день)';
    }
  }
  section.style.display = 'block';
  currentTokenContext = {
    token: data.token || null,
    risk: data.risk || null,
    security: data.security
      ? {
          available: !!data.security.available,
          source: data.security.source || 'goplus',
          flags: Array.isArray(data.security.flags) ? data.security.flags : [],
          meta: data.security.meta || {},
          identityWarnings: data.security.identityWarnings || []
        }
      : null,
    plan: data.plan || plan,
    address: (data.token && data.token.address) || '',
    chainId: (data.token && data.token.chainId) || ''
  };
  const msgs = document.getElementById('chat-messages');
  if (msgs) {
    msgs.innerHTML = '';
    const chips = document.createElement('div');
    chips.className = 'chat-chips';
    const prompts = [
      { ru: 'Стоит ли брать?', en: 'Should I buy?' },
      { ru: 'Главные red flags', en: 'Main red flags' },
      { ru: 'Honeypot / mint?', en: 'Honeypot / mint?' },
      { ru: 'Какой размер безопасен?', en: 'Safe trade size?' },
      { ru: 'Что поднимет риск?', en: 'What raises risk?' }
    ];
    prompts.forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-chip';
      b.textContent = en ? p.en : p.ru;
      b.addEventListener('click', function () {
        const input = document.getElementById('chat-input');
        if (input) input.value = en ? p.en : p.ru;
        sendChatMessage();
      });
      chips.appendChild(b);
    });
    msgs.appendChild(chips);
    const tip = document.createElement('div');
    tip.className = 'muted small';
    tip.id = 'chat-limit-note';
    tip.style.marginBottom = '0.5rem';
    tip.textContent = isPrem
      ? en
        ? 'Answers use this scan only · Contract / Liquidity / Holders'
        : 'Ответы только по этому скану · Contract / Liquidity / Holders'
      : en
        ? 'Free trial: 2 messages/day. Structured answers from this scan.'
        : 'Free trial: 2 сообщения/день. Ответы строго по данным этого скана.';
    msgs.appendChild(tip);
  }
  chatHistory = [];
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.placeholder =
      typeof t === 'function'
        ? t('chat.placeholder')
        : en
          ? 'Ask about this token…'
          : 'Спросите про этот токен…';
  }
  const sendBtn = document.getElementById('chat-send');
  if (sendBtn && typeof t === 'function') sendBtn.textContent = t('chat.send');
  const toggleBtn = document.getElementById('toggle-chat');
  if (toggleBtn && typeof t === 'function') {
    const windowEl = document.getElementById('chat-window');
    const open =
      windowEl &&
      windowEl.style.display !== 'none' &&
      windowEl.style.display !== '';
    toggleBtn.textContent = open ? t('chat.hide') : en ? 'Open chat' : 'Открыть чат';
  }
}

function toggleChat() {
  const windowEl = document.getElementById('chat-window');
  const btn = document.getElementById('toggle-chat');
  if (!windowEl) return;
  if (windowEl.style.display === 'none' || !windowEl.style.display) {
    windowEl.style.display = 'flex';
    if (btn) btn.textContent = (localStorage.getItem('lang') || 'ru') === 'en' ? 'Hide' : 'Скрыть';
  } else {
    windowEl.style.display = 'none';
    if (btn) btn.textContent = (localStorage.getItem('lang') || 'ru') === 'en' ? 'Open chat' : 'Открыть чат';
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input && input.value.trim();
  if (!text) return;
  if (!currentTokenContext || !currentTokenContext.token) {
    addChatMessage('ai', ((localStorage.getItem('lang')||'ru')==='en') ? 'Scan a token first — chat answers only from this report.' : 'Сначала просканируйте токен — чат отвечает только по данным отчёта.');
    return;
  }
  addChatMessage('user', text);
  input.value = '';
  chatHistory.push({ role: 'user', content: text });
  const loadingId = addChatMessage('ai', '…');
  try {
    const res = await apiFetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        lang: (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru',
        context: Object.assign({}, currentTokenContext || {}, {
          lang: (typeof currentLang !== 'undefined' && currentLang) || localStorage.getItem('lang') || 'ru',
          token: (currentTokenContext && currentTokenContext.token) || null,
          risk: (currentTokenContext && currentTokenContext.risk) || null,
          security: (currentTokenContext && currentTokenContext.security) || null
        })
      })
    });
    const data = await res.json().catch(function () {
      return {};
    });
    removeChatMessage(loadingId);
    if (!data.success) {
      let err =
        data.error ||
        (res.status === 403
          ? ((localStorage.getItem('lang')||'ru')==='en'
              ? 'Chat limit reached. Open Premium — 20 messages/day.'
              : 'Лимит чата. Откройте Premium — 20 сообщений/день.')
          : ((localStorage.getItem('lang')||'ru')==='en' ? 'AI error' : 'Ошибка AI'));
      if (data.remaining === 0 || res.status === 403) {
        err +=
          '\n\n<button type="button" class="upgrade-btn" onclick="openPricing(\'premium\')">' +
          ((localStorage.getItem('lang')||'ru')==='en' ? 'Open Premium' : 'Открыть Premium') +
          '</button>';
        addChatMessage('ai', err);
        const last = document.querySelector('#chat-messages .chat-msg.ai:last-child .msg-bubble');
        if (last && err.indexOf('<button') >= 0) last.innerHTML = err.replace(/\n/g, '<br>');
      } else {
        addChatMessage('ai', err);
      }
      return;
    }
    addChatMessage('ai', data.reply);
    chatHistory.push({ role: 'assistant', content: data.reply });
    const note = document.getElementById('chat-limit-note');
    if (note && data.limit != null) {
      note.textContent =
        (data.limitNote || '') +
        (data.remaining != null ? ' · ' + ((localStorage.getItem('lang')||'ru')==='en'?'left ':'осталось ') + data.remaining : '');
    }
  } catch (err) {
    removeChatMessage(loadingId);
    addChatMessage('ai', ((localStorage.getItem('lang')||'ru')==='en') ? 'AI network error' : 'Ошибка сети AI');
  }
}

function addChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return 'msg-0';
  const id = 'msg-' + Date.now() + Math.random();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.style.whiteSpace = 'pre-wrap';
  bubble.textContent = String(text || '');
  div.appendChild(bubble);
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
    const res = await apiFetch('/api/history', {
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
    const res = await apiFetch('/api/watchlist', {
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
      '<button type="button" class="btn-sm" onclick="rescan(\'' + item.address + '\')\">Scan</button>' +
      '<button type="button" class="btn-sm danger" onclick="removeWatch(\'' + item.address + '\')">Remove</button></div></div>'
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty-state-cta"><p>Error</p></div>';
  }
}

async function addWatch(address, symbol, name) {
  if (!user) return openAuthModal(typeof t === 'function' ? t('empty.watchlist') : 'Sign in to save Watchlist');
  if (!address) return;
  try {
    const res = await apiFetch('/api/watchlist', {
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
  await apiFetch('/api/watchlist/' + address, {
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
    const res = await apiFetch('/api/alerts', {
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
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  if (!(await ensureSession())) {
    return openAuthModal(en ? 'Sign in to create alerts' : 'Войдите, чтобы создать алерт');
  }
  const address = document.getElementById('alert-address').value.trim();
  const symbol = document.getElementById('alert-symbol').value.trim();
  const type = document.getElementById('alert-type').value;
  const value = document.getElementById('alert-value').value;
  if (!address || value === '') {
    return alert(en ? 'Fill address and value' : 'Укажите адрес и значение');
  }
  const res = await apiFetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, address, symbol, value })
  });
  const data = await res.json();
  if (res.status === 401) {
    user = null;
    updateAuthUI();
    return openAuthModal(data.error || (en ? 'Sign in' : 'Войдите'));
  }
  if (res.status === 403) {
    if (confirm((data.error || 'Premium') + '\n\n' + (en ? 'Open plans?' : 'Открыть тарифы?'))) {
      openPricing(data.upsell || 'premium');
    }
    return;
  }
  if (!data.success) return alert(data.error || 'Error');
  document.getElementById('alert-address').value = '';
  document.getElementById('alert-value').value = '';
  loadAlerts();
  if (typeof showToast === 'function') {
    showToast(en ? 'Alert created' : 'Алерт создан');
  }
  // Confirm in TG if linked
  try {
    await apiFetch('/api/telegram/alert-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, address, symbol, value })
    });
  } catch (e) {}
}

async function removeAlertItem(id) {
  if (!(await ensureSession())) return;
  await apiFetch('/api/alerts/' + id, { method: 'DELETE' });
  loadAlerts();
}

let tgPollTimer = null;
let tgPollUntil = 0;

function stopTgPoll() {
  if (tgPollTimer) {
    clearInterval(tgPollTimer);
    tgPollTimer = null;
  }
  tgPollUntil = 0;
}

function startTgLinkPoll() {
  stopTgPoll();
  tgPollUntil = Date.now() + 3 * 60 * 1000;
  const wait = document.getElementById('tg-wait-msg');
  if (wait) {
    wait.style.display = 'block';
    wait.textContent = 'Waiting for /start in the bot… (auto-checks every 4s, up to 3 min)';
  }
  tgPollTimer = setInterval(async function () {
    if (Date.now() > tgPollUntil) {
      stopTgPoll();
      if (wait) {
        wait.textContent = 'Still waiting. Open the bot, press Start, then click Connect again.';
      }
      return;
    }
    try {
      const res = await apiFetch('/api/telegram/status');
      const data = await res.json();
      if (data.linked) {
        stopTgPoll();
        if (wait) {
          wait.style.display = 'none';
          wait.textContent = '';
        }
        const area = document.getElementById('tg-link-area');
        if (area) area.style.display = 'none';
        refreshTelegramStatus();
        if (typeof showToast === 'function') showToast('Telegram connected');
      }
    } catch (e) {}
  }, 4000);
}

async function refreshTelegramStatus() {
  const st = document.getElementById('tg-status');
  const btn = document.getElementById('tg-connect-btn');
  if (!st || !btn) return;

  if (!user || !user.id) {
    const ok = await ensureSession();
    if (!ok) {
      st.textContent = 'Login to connect Telegram';
      st.className = 'tg-status-badge';
      st.style.color = '';
      btn.textContent = 'Connect Telegram';
      btn.onclick = function () {
        openAuthModal('Sign in to connect Telegram');
      };
      return;
    }
  }

  try {
    const res = await apiFetch('/api/telegram/status');
    const data = await res.json();
    if (data.linked) {
      stopTgPoll();
      st.textContent = 'Connected ✓ · alerts → @aicryptoscreenerbot';
      st.className = 'tg-status-badge tg-status-on';
      st.style.color = '#00f0a0';
      btn.textContent = 'Disconnect';
      btn.onclick = disconnectTelegram;
      const area = document.getElementById('tg-link-area');
      if (area) area.style.display = 'none';
      const wait = document.getElementById('tg-wait-msg');
      if (wait) {
        wait.style.display = 'none';
        wait.textContent = '';
      }
    } else {
      st.textContent = 'Not connected · bot for personal alerts';
      st.className = 'tg-status-badge';
      st.style.color = '';
      btn.textContent = 'Connect Telegram';
      btn.onclick = connectTelegram;
    }
  } catch (e) {
    st.textContent = 'Status unavailable';
  }
}

async function connectTelegram() {
  if (!(await ensureSession())) {
    return openAuthModal('Sign in to connect Telegram');
  }
  try {
    const res = await apiFetch('/api/telegram/link', {
      method: 'POST'
    });
    const data = await res.json();
    if (!data.success) {
      if (res.status === 401) {
        user = null;
        updateAuthUI();
        return openAuthModal(data.error || 'Sign in to connect Telegram');
      }
      return alert(data.error || 'Error');
    }
    const area = document.getElementById('tg-link-area');
    if (area) area.style.display = 'block';
    const link = document.getElementById('tg-deep-link');
    if (link) {
      link.href = data.deepLink || ('https://t.me/aicryptoscreenerbot?start=' + data.code);
    }
    const code = document.getElementById('tg-code');
    if (code) code.textContent = data.code;
    startTgLinkPoll();
  } catch (e) {
    alert('Telegram link failed');
  }
}

async function disconnectTelegram() {
  try {
    stopTgPoll();
    await apiFetch('/api/telegram/link', {
      method: 'DELETE'
    });
    const area = document.getElementById('tg-link-area');
    if (area) area.style.display = 'none';
    const wait = document.getElementById('tg-wait-msg');
    if (wait) {
      wait.style.display = 'none';
      wait.textContent = '';
    }
    refreshTelegramStatus();
  } catch (e) {
    alert('Error');
  }
}

async function runCompare() {
  const a1 = (document.getElementById('cmp-1') || {}).value || '';
  const a2 = (document.getElementById('cmp-2') || {}).value || '';
  const a3 = (document.getElementById('cmp-3') || {}).value || '';
  const addresses = [a1.trim(), a2.trim(), a3.trim()].filter(Boolean);
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  if (addresses.length < 2) {
    alert(en ? 'Need at least 2 addresses' : 'Нужно минимум 2 адреса');
    return;
  }
  const box = document.getElementById('compare-content');
  if (!box) return;
  box.innerHTML = '<div class="loading">' + (en ? 'Comparing…' : 'Сравниваем…') + '</div>';
  try {
    const res = await apiFetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: addresses })
    });
    const data = await res.json();
    if (!data.success) {
      box.innerHTML = '<div class="error-card glass">' + (data.error || 'Error') + '</div>';
      return;
    }
    const tokens = data.tokens || [];
    const full = !!data.full;
    const wi = data.winnerIndex != null ? data.winnerIndex : 0;

    function esc(s) {
      return String(s || '').replace(/'/g, '');
    }
    function flagCell(v) {
      if (v === true) return '⚠';
      if (v === false) return '✓';
      return '?';
    }
    function betterLiq() {
      let best = 0;
      tokens.forEach(function (t, i) {
        if ((t.liquidity || 0) > (tokens[best].liquidity || 0)) best = i;
      });
      return tokens[best] ? tokens[best].symbol : '—';
    }

    let head = '<tr><th>' + (en ? 'Metric' : 'Метрика') + '</th>';
    tokens.forEach(function (t, i) {
      head +=
        '<th><button type="button" class="text-link" data-addr="' +
        esc(t.address) +
        '">' +
        (t.symbol || 'TOKEN') +
        (i === wi ? ' ✓' : '') +
        '</button></th>';
    });
    head += '<th>' + (en ? 'Better' : 'Лучше') + '</th></tr>';

    let body = '';
    body += '<tr><td>Chain</td>';
    tokens.forEach(function (t) {
      body += '<td class="muted small">' + (t.chainId || '—') + '</td>';
    });
    body += '<td></td></tr>';

    body += '<tr><td>Risk</td>';
    tokens.forEach(function (t) {
      body +=
        '<td><span style="color:' +
        scoreColor(t.riskScore) +
        ';font-weight:700">' +
        t.riskScore +
        '</span> <span class="muted small">' +
        (t.riskLevel || '') +
        '</span></td>';
    });
    body += '<td class="muted small">' + (tokens[wi] && tokens[wi].symbol) + '</td></tr>';

    body += '<tr><td>Honeypot</td>';
    tokens.forEach(function (t) {
      body += '<td>' + flagCell(t.honeypot) + '</td>';
    });
    body += '<td></td></tr>';

    body += '<tr><td>Mint</td>';
    tokens.forEach(function (t) {
      body += '<td>' + flagCell(t.mintable) + '</td>';
    });
    body += '<td></td></tr>';

    body += '<tr><td>Liquidity</td>';
    tokens.forEach(function (t) {
      body += '<td>$' + formatNum(t.liquidity) + '</td>';
    });
    body += '<td class="muted small">' + betterLiq() + '</td></tr>';

    body += '<tr><td>FDV / liq</td>';
    tokens.forEach(function (t) {
      if (!full) body += '<td class="cmp-blur">···</td>';
      else {
        const r = t.fdvLiqRatio;
        body +=
          '<td>' +
          (r != null ? r + '×' + (r > 20 ? ' ⚠' : '') : '—') +
          '</td>';
      }
    });
    body += '<td class="muted small">' + (full ? '' : 'Premium') + '</td></tr>';

    body += '<tr><td>Top-10</td>';
    tokens.forEach(function (t) {
      if (!full) body += '<td class="cmp-blur">···</td>';
      else body += '<td>' + (t.top10Pct != null ? t.top10Pct + '%' : '—') + '</td>';
    });
    body += '<td class="muted small">' + (full ? '' : 'Premium') + '</td></tr>';

    let html = '<div class="compare-result glass panel">';
    if (tokens[wi]) {
      html +=
        '<p class="cmp-verdict"><strong>' +
        tokens[wi].symbol +
        '</strong> ' +
        (en
          ? 'looks safer on this snapshot (lower risk / better liq context). Not financial advice.'
          : 'спокойнее на этом снимке (ниже risk / лучше контекст liq). Не финсовет.') +
        '</p>';
    }
    html +=
      '<div class="compare-table-wrap"><table class="compare-table"><thead>' +
      head +
      '</thead><tbody>' +
      body +
      '</tbody></table></div>';
    if (!full) {
      html +=
        '<div class="cmp-upsell"><p class="muted small">' +
        (en
          ? 'Free preview: risk + liquidity + basic flags. Full FDV/holders on Premium.'
          : 'Free preview: risk + liquidity + базовые flags. Полный FDV/holders на Premium.') +
        '</p><button type="button" class="upgrade-btn" id="cmp-upsell-btn">' +
        (en ? 'Open Premium' : 'Открыть Premium') +
        '</button></div>';
    }
    html += '<div class="btn-row" style="margin-top:0.75rem">';
    tokens.forEach(function (t) {
      html +=
        '<button type="button" class="connect-btn cmp-scan-btn" data-addr="' +
        esc(t.address) +
        '">' +
        (en ? 'Scan ' : 'Скан ') +
        (t.symbol || '') +
        '</button>';
    });
    html += '</div></div>';
    box.innerHTML = html;
    box.querySelectorAll('[data-addr]').forEach(function (el) {
      el.addEventListener('click', function () {
        const a = el.getAttribute('data-addr');
        if (a && typeof rescan === 'function') rescan(a);
      });
    });
    const up = document.getElementById('cmp-upsell-btn');
    if (up) up.addEventListener('click', function () {
      openPricing('premium');
    });
  } catch (e) {
    box.innerHTML =
      '<div class="error-card">' + (en ? 'Compare failed' : 'Ошибка сравнения') + '</div>';
  }
}

function fillCompareSlot(address) {
  if (!address) return;
  const slots = ['cmp-1', 'cmp-2', 'cmp-3'];
  for (let i = 0; i < slots.length; i++) {
    const el = document.getElementById(slots[i]);
    if (el && !String(el.value || '').trim()) {
      el.value = address;
      return;
    }
  }
  const last = document.getElementById('cmp-3') || document.getElementById('cmp-2');
  if (last) last.value = address;
}

async function cmpFromHistory() {
  if (!(await ensureSession())) return openAuthModal();
  try {
    const res = await apiFetch('/api/history');
    const data = await res.json();
    const list = data.history || [];
    if (!list.length) return alert('History empty');
    list.slice(0, 3).forEach(function (h) {
      fillCompareSlot(h.address);
    });
  } catch (e) {}
}

async function cmpFromWatch() {
  if (!(await ensureSession())) return openAuthModal();
  try {
    const res = await apiFetch('/api/watchlist');
    const data = await res.json();
    const list = data.watchlist || [];
    if (!list.length) return alert('Watchlist empty');
    list.slice(0, 3).forEach(function (h) {
      fillCompareSlot(h.address);
    });
  } catch (e) {}
}

function cmpSwapAB() {
  const a = document.getElementById('cmp-1');
  const b = document.getElementById('cmp-2');
  if (!a || !b) return;
  const t = a.value;
  a.value = b.value;
  b.value = t;
}

document.getElementById('footer-pricing')?.addEventListener('click', function (e) {
  e.preventDefault();
  if (typeof openPricing === 'function') openPricing();
  else if (typeof showPlans === 'function') showPlans();
  else document.querySelector('.plan-btn[data-plan="premium"]')?.click();
});

function showExampleReport() {
  openDemoReport();
}

/** Live Premium sample via API (LINK) — no paywall */
function openDemoReport() {
  showPage('scanner');
  const results = document.getElementById('results');
  if (results) results.innerHTML = '<div class="loading glass">Loading Premium sample…</div>';
  apiFetch('/api/sample/premium')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (!data.success) {
        if (results) {
          results.innerHTML =
            '<div class="error-card glass">Sample unavailable. Try scanning LINK: 0x514910771AF9Ca656af840dff83E8264EcF986CA</div>';
        }
        return;
      }
      lastScannedToken = {
        address: data.token && data.token.address,
        symbol: data.token && data.token.symbol,
        name: data.token && data.token.name
      };
      lastPairMeta = {
        pairAddress: data.token && data.token.pairAddress,
        chainId: (data.token && data.token.chainId) || 'ethereum'
      ,
      price: Number((data.token && data.token.price) || (typeof tok !== "undefined" && tok.price) || 0)
    };
      window.__lastScanData = data;
      renderTokenPage(data);
      if (results) {
        results.insertAdjacentHTML(
          'afterbegin',
          '<div class="glass panel sample-banner" style="margin-bottom:1rem;border-color:rgba(0,240,160,0.35)">' +
            '<strong>Sample Premium report</strong>' +
            '<p class="muted small" style="margin:0.35rem 0 0">Живой пример без paywall (LINK). Не финансовый совет.</p></div>'
        );
      }
    })
    .catch(function () {
      if (results) results.innerHTML = '<div class="error-card glass">Could not load sample</div>';
    });
}


/** Same idea as server pickBestDexPair — never let PulseChain USDT clones win */
function pickBestPairClient(pairs, address, preferredChain) {
  let list = Array.isArray(pairs) ? pairs.filter(Boolean) : [];
  if (!list.length) return null;
  const addr = String(address || '').toLowerCase();
  const pref = String(preferredChain || '').toLowerCase();
  const MAJOR_QUOTE = {
    WETH: 1, ETH: 1, USDC: 1, USDT: 1, DAI: 1, WBTC: 1,
    WBNB: 1, BNB: 1, SOL: 1, WSOL: 1, TRX: 1
  };
  if (pref && pref !== 'auto') {
    const f = list.filter(function (p) {
      const c = String(p.chainId || '').toLowerCase();
      if (pref === 'ethereum' || pref === 'eth') return c === 'ethereum' || c === 'eth';
      return c === pref || c.indexOf(pref) !== -1;
    });
    if (f.length) list = f;
  }
  const nonPulse = list.filter(function (p) {
    const c = String(p.chainId || '').toLowerCase();
    return c !== 'pulsechain' && c !== 'pulse';
  });
  if (nonPulse.length) list = nonPulse;
  const asBase = list.filter(function (p) {
    return String((p.baseToken && p.baseToken.address) || '').toLowerCase() === addr;
  });
  if (asBase.length) list = asBase;
  const withMajor = list.filter(function (p) {
    return MAJOR_QUOTE[String((p.quoteToken && p.quoteToken.symbol) || '').toUpperCase()];
  });
  if (withMajor.length) list = withMajor;
  const prices = list.map(function (p) { return Number(p.priceUsd) || 0; }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
  if (prices.length >= 3) {
    const mid = prices[Math.floor(prices.length / 2)];
    const f = list.filter(function (p) {
      const pr = Number(p.priceUsd) || 0;
      return pr > 0 && pr < mid * 20 && pr > mid / 20;
    });
    if (f.length) list = f;
  }
  list.sort(function (a, b) {
    return (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0);
  });
  return list[0] || null;
}

async function enrichTokenMarket(data, address) {
  if (!data || !data.token) return data;
  const tok = data.token;
  const serverChain = String(tok.chainId || '').toLowerCase();
  // CRITICAL: if server already resolved pair/chain/price — do not re-hit DexScreener
  // (previously overwrote Ethereum USDT with PulseChain by pure liquidity sort)
  if (tok.pairAddress && serverChain && serverChain !== 'unknown' && Number(tok.price) > 0) {
    data.risk = data.risk || {};
    data.risk.reasons = mergeReasons(data.risk.reasons, buildChainRiskReasons(tok, address));
    return data;
  }
  const chainSelect = document.getElementById('chain-select');
  const preferredChain =
    (chainSelect && chainSelect.value && chainSelect.value !== 'auto' && chainSelect.value) ||
    serverChain ||
    '';
  try {
    const url = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address);
    const res = await fetch(url);
    const j = await res.json();
    const pairs = Array.isArray(j.pairs) ? j.pairs.slice() : [];
    if (pairs.length) {
      const p = pickBestPairClient(pairs, address, preferredChain);
      if (p) {
        const pChain = String(p.chainId || '').toLowerCase();
        const ethP = pairs.find(function (x) {
          const c = String(x.chainId || '').toLowerCase();
          return c === 'ethereum' || c === 'eth';
        });
        if ((pChain === 'pulsechain' || pChain === 'pulse') && ethP) {
          tok.marketCap = numOr(tok.marketCap, ethP.marketCap, ethP.fdv);
          tok.fdv = numOr(tok.fdv, ethP.fdv, ethP.marketCap);
          tok.liquidity = numOr(tok.liquidity, ethP.liquidity && ethP.liquidity.usd);
          tok.volume24h = numOr(tok.volume24h, ethP.volume && ethP.volume.h24);
          tok.price = Number(ethP.priceUsd) || tok.price;
          tok.pairAddress = ethP.pairAddress || tok.pairAddress;
          tok.chainId = 'ethereum';
          tok.dexId = ethP.dexId || tok.dexId;
          tok.pairUrl = ethP.url || tok.pairUrl;
        } else if (pChain !== 'pulsechain' && pChain !== 'pulse') {
          tok.marketCap = numOr(tok.marketCap, p.marketCap, p.fdv);
          tok.fdv = numOr(tok.fdv, p.fdv, p.marketCap);
          tok.liquidity = numOr(tok.liquidity, p.liquidity && p.liquidity.usd);
          tok.volume24h = numOr(tok.volume24h, p.volume && p.volume.h24);
          if (!tok.price || Number(tok.price) === 0) tok.price = Number(p.priceUsd) || tok.price;
          if (!tok.pairAddress) tok.pairAddress = p.pairAddress || null;
          if (!serverChain || serverChain === 'unknown') {
            tok.chainId = pChain || detectChainFromAddress(address) || 'unknown';
          }
          tok.dexId = tok.dexId || p.dexId || null;
          tok.pairUrl = tok.pairUrl || p.url || null;
        }
        if (p.baseToken) {
          tok.symbol = tok.symbol || p.baseToken.symbol;
          tok.name = tok.name || p.baseToken.name;
        }
      }
    } else {
      tok.chainId = serverChain || detectChainFromAddress(address) || 'unknown';
    }
  } catch (e) {
    tok.chainId = serverChain || detectChainFromAddress(address) || 'unknown';
  }
  data.token = tok;
  data.risk = data.risk || {};
  data.risk.reasons = mergeReasons(data.risk.reasons, buildChainRiskReasons(tok, address));
  const hasImposter = (data.risk.reasons || []).some(function (x) {
    return /not native|обёртк|wrapper|imposter|не нативный|TRC20|поддел|PulseChain/i.test(String(x));
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
  const tt = typeof t === 'function' ? t : function (k) { return k; };
  results.innerHTML =
    '<div class="scanner-empty glass">' +
    '<p class="muted" style="margin-bottom:0.85rem;">' +
    tt('scanner.examplesTitle') +
    '</p>' +
    '<div class="home-chip-row">' +
    '<button type="button" class="home-chip example-token" data-addr="0x514910771AF9Ca656af840dff83E8264EcF986CA">LINK</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48">USDC</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0xdAC17F958D2ee523a2206206994597C13D831ec7">USDT</button>' +
    '<button type="button" class="home-chip example-token" data-addr="0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984">UNI</button>' +
    '</div>' +
    demoTokensHtml() +
    '<p class="muted small" style="margin-top:0.9rem;text-align:center;">' +
    tt('scanner.examplesSub') +
    '</p>' +
    '<p class="muted small" style="margin-top:0.4rem;text-align:center;"><a href="/methodology.html" style="color:var(--accent,#00f0a0)">' +
    tt('scanner.howRisk') +
    '</a> · <a href="/trust.html" style="color:var(--accent,#00f0a0)">Trust Center</a></p>' +
    '</div>';
  results.querySelectorAll('.example-token').forEach((btn) => {
    btn.addEventListener('click', function () {
      const input = document.getElementById('token-input');
      if (input) input.value = btn.getAttribute('data-addr');
      startScan();
    });
  });
  results.querySelectorAll('.demo-card').forEach((btn) => {
    btn.addEventListener('click', function () {
      openDemoByTier(btn.getAttribute('data-demo'));
    });
  });
}

async function openDemoByTier(tier) {
  const map = {
    low: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
    mid: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    high: null
  };
  if (tier === 'high') {
    // Synthetic high-risk report for demo (no need for a live scam)
    const data = {
      success: true,
      plan: 'Premium',
      sample: true,
      token: {
        symbol: 'DEMO',
        name: 'High-Risk Demo Token',
        address: '0xDEAD00000000000000000000000000000000BEEF',
        price: 0.00012,
        liquidity: 18000,
        volume24h: 4200,
        fdv: 2500000,
        marketCap: 2100000,
        chainId: 'ethereum'
      },
      risk: {
        riskScore: 87,
        riskLevel: 'HIGH',
        confidence: 78,
        reasons: [
          'GoPlus: honeypot flag',
          'Top wallets concentrated ~72%',
          'Thin liquidity',
          'GoPlus: mintable',
          'FDV >> liquidity'
        ]
      },
      ai: {
        text:
          'HIGH RISK — Avoid until further investigation. Honeypot/mint signals and thin liquidity mean exit may fail under sell pressure.',
        confidence: 78,
        verdict: 'HIGH RISK',
        risks: [
          'Honeypot / sell restriction signals',
          'Holder concentration above 70%',
          'Liquidity too thin for size'
        ],
        positives: ['Contract address visible on DEX'],
        checklist: [
          'Do not buy size',
          'Verify honeypot simulation independently',
          'Check top holders on explorer'
        ]
      },
      security: {
        available: true,
        source: 'demo',
        flags: [
          { id: 'honeypot', label: 'Honeypot', status: 'bad', text: 'Flagged as honeypot' },
          { id: 'mint', label: 'Mint', status: 'bad', text: 'Mint function present' },
          { id: 'holders', label: 'Holders', status: 'bad', text: 'Top10 ~72%' },
          { id: 'lp', label: 'LP lock', status: 'bad', text: 'LP lock unknown / low' },
          { id: 'tax', label: 'Buy / Sell tax', status: 'warn', text: 'Buy 5% / Sell 12%' }
        ],
        meta: {
          isHoneypot: true,
          isMintable: true,
          top10Pct: 72,
          sellTax: 12,
          buyTax: 5,
          renounced: false
        }
      }
    };
    window.__lastScanData = data;
    lastScannedToken = { address: data.token.address, symbol: data.token.symbol };
    showPage('scanner');
    renderTokenPage(data);
    return;
  }
  const addr = map[tier];
  if (!addr) return;
  const input = document.getElementById('token-input');
  if (input) input.value = addr;
  showPage('scanner');
  startScan();
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


/* ===== PRO Portfolio Risk Desk ===== */
async function loadPortfolioDesk() {
  const summary = document.getElementById('portfolio-desk-summary');
  const list = document.getElementById('portfolio-desk-list');
  if (!summary || !list) return;
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  if (!user) {
    summary.innerHTML = '';
    list.innerHTML =
      '<div class="empty-state-cta"><p>' +
      (en ? 'Sign in with Pro to use Portfolio Risk Desk' : 'Войдите с Pro для Portfolio Risk Desk') +
      '</p><button type="button" class="upgrade-btn" onclick="openPricing(\'pro\')">Pro</button></div>';
    return;
  }
  summary.innerHTML = '<div class="muted small">Loading…</div>';
  try {
    const res = await apiFetch('/api/portfolio/desk');
    const data = await res.json();
    if (!data.success) {
      list.innerHTML =
        '<div class="empty-state-cta"><p>' +
        (data.error || 'Pro required') +
        '</p><button type="button" class="upgrade-btn" onclick="openPricing(\'pro\')">Pro · $39</button></div>';
      summary.innerHTML = '';
      return;
    }
    const delta = data.portfolioAlertDelta || 15;
    summary.innerHTML =
      '<div class="metric-card glass"><div class="metric-label">Portfolio risk</div><div class="metric-value">' +
      (data.portfolioRisk || 0) +
      '/100</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">Positions</div><div class="metric-value">' +
      (data.tokenCount || 0) +
      '</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">High risk</div><div class="metric-value" style="color:#ff4d6a">' +
      (data.highRiskCount || 0) +
      '</div></div>' +
      '<div class="metric-card glass"><div class="metric-label">TG alert if risk +</div><div class="metric-value">' +
      delta +
      '</div></div>';
    // worst + 30d sparkline
    if (data.worst && data.worst.length) {
      let wh = '<div class="glass panel" style="margin:1rem 0;padding:1rem"><div class="muted small">Worst positions · risk history 30d</div>';
      data.worst.forEach(function (w) {
        const hist = (data.historyByAddress && data.historyByAddress[w.address]) || [];
        const scores = hist.map(function (p) { return Number(p.riskScore) || 0; });
        let spark = '';
        if (scores.length >= 2) {
          const maxS = Math.max.apply(null, scores.concat([100]));
          const step = 120 / (scores.length - 1);
          let d = '';
          scores.forEach(function (sc, i) {
            const x = i * step;
            const y = 36 - (sc / maxS) * 28;
            d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
          });
          spark =
            '<svg width="120" height="40" viewBox="0 0 120 40"><path d="' +
            d +
            '" fill="none" stroke="#00f0a0" stroke-width="2"/></svg>';
        } else {
          spark = '<span class="muted small">Need more scans for chart</span>';
        }
        wh +=
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem">' +
          '<div><strong>' +
          (w.symbol || 'TOKEN') +
          '</strong> · ' +
          (w.lastRisk || '—') +
          '/100</div>' +
          spark +
          '</div>';
      });
      wh += '</div>';
      summary.innerHTML += wh;
    }
    if (!data.tokens || !data.tokens.length) {
      list.innerHTML =
        '<p class="muted">' +
        (en
          ? 'Add contract addresses below. They become your monitored positions.'
          : 'Добавьте адреса контрактов — это ваши позиции для мониторинга.') +
        '</p>';
      return;
    }
    list.innerHTML = data.tokens
      .map(function (t) {
        const risk = t.lastRisk != null ? t.lastRisk : '—';
        const col =
          (t.lastRisk || 0) > 60 ? '#ff4d6a' : (t.lastRisk || 0) > 35 ? '#f5a623' : '#00f0a0';
        return (
          '<div class="token-row glass" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;margin-bottom:0.5rem">' +
          '<div><strong>' +
          (t.symbol || 'TOKEN') +
          '</strong> <span class="muted small">' +
          (t.name || '') +
          '</span><br><span class="muted small">' +
          (t.address || '').slice(0, 10) +
          '…</span></div>' +
          '<div style="text-align:right"><div style="color:' +
          col +
          ';font-weight:700">' +
          risk +
          '/100</div>' +
          '<button type="button" class="text-link" onclick="startScan(\'' +
          (t.address || '') +
          '\')">Scan</button> · ' +
          '<button type="button" class="text-link" onclick="removePortfolioPos(\'' +
          (t.address || '') +
          '\')">Remove</button></div></div>'
        );
      })
      .join('');
  } catch (e) {
    list.innerHTML = '<p class="muted">Error loading desk</p>';
  }
}

async function addPortfolioPos() {
  const input = document.getElementById('portfolio-add-input');
  const address = input && input.value.trim();
  if (!address) return;
  const res = await apiFetch('/api/portfolio/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: address })
  });
  const data = await res.json();
  if (!data.success) {
    if (data.upsell) openPricing('pro');
    else alert(data.error || 'Failed');
    return;
  }
  if (input) input.value = '';
  loadPortfolioDesk();
}

async function removePortfolioPos(address) {
  await apiFetch('/api/portfolio/positions/' + encodeURIComponent(address), {
    method: 'DELETE'
  });
  loadPortfolioDesk();
}

async function runBatchScan() {
  const ta = document.getElementById('batch-scan-input');
  const text = ta && ta.value;
  if (!text || !text.trim()) return;
  const res = await apiFetch('/api/batch-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: text })
  });
  const data = await res.json();
  const list = document.getElementById('portfolio-desk-list');
  if (!data.success) {
    if (data.upsell) openPricing('pro');
    else alert(data.error || 'Batch failed');
    return;
  }
  list.innerHTML =
    '<h4>Batch results</h4>' +
    (data.results || [])
      .map(function (r) {
        if (!r.ok) return '<div class="muted">' + r.address + ' — ' + (r.error || 'fail') + '</div>';
        return (
          '<div class="token-row glass" style="padding:0.6rem 1rem;margin:0.35rem 0">' +
          '<strong>' +
          (r.symbol || '') +
          '</strong> risk ' +
          r.riskScore +
          ' · liq $' +
          Math.round(r.liquidity || 0) +
          ' <button type="button" class="text-link" onclick="startScan(\'' +
          r.address +
          '\')">Open</button></div>'
        );
      })
      .join('');
}

async function loadNewPairs() {
  const grid = document.getElementById('new-pairs-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="muted small">Loading…</div>';
  try {
    const res = await apiFetch('/api/new-pairs');
    const data = await res.json();
    if (!data.success) {
      grid.innerHTML =
        '<div class="empty-state-cta"><p>' +
        (data.error || 'Pro only') +
        '</p><button type="button" class="upgrade-btn" onclick="openPricing(\'pro\')">Pro</button></div>';
      return;
    }
    if (!data.pairs || !data.pairs.length) {
      grid.innerHTML = '<p class="muted">No pairs right now</p>';
      return;
    }
    grid.innerHTML = data.pairs
      .map(function (p) {
        return (
          '<div class="glass panel" style="padding:0.75rem;cursor:pointer" onclick="startScan(\'' +
          p.address +
          '\')"><strong>' +
          (p.symbol || 'TOKEN') +
          '</strong><div class="muted small">Risk ' +
          (p.riskScore || '—') +
          ' · Liq $' +
          Math.round(p.liquidity || 0) +
          '</div></div>'
        );
      })
      .join('');
  } catch (e) {
    grid.innerHTML = '<p class="muted">Failed</p>';
  }
}

document.getElementById('portfolio-add-btn')?.addEventListener('click', addPortfolioPos);
document.getElementById('batch-scan-btn')?.addEventListener('click', runBatchScan);
document.getElementById('refresh-new-pairs')?.addEventListener('click', loadNewPairs);

// hook page switch
const _origShowPage = typeof showPage === 'function' ? showPage : null;
if (_origShowPage) {
  window.showPage = function (name) {
    _origShowPage(name);
    if (name === 'portfolio') {
      loadPortfolioDesk();
      loadNewPairs();
    }
  };
}

window.loadPortfolioDesk = loadPortfolioDesk;
window.addPortfolioPos = addPortfolioPos;
window.removePortfolioPos = removePortfolioPos;
window.runBatchScan = runBatchScan;
window.loadNewPairs = loadNewPairs;


async function cancelSubscription() {
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  if (!user) return openAuthModal();
  if (!confirm(en ? 'Cancel paid plan and switch to Free?' : 'Отменить платный план и перейти на Free?')) return;
  try {
    const res = await apiFetch('/api/billing/cancel', { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Failed');
      return;
    }
    currentPlan = 'free';
    if (user) user.plan = 'free';
    updateAuthUI();
    refreshAccountPage();
    refreshUsage();
    alert(en ? 'Plan set to Free' : 'План: Free');
  } catch (e) {
    alert(en ? 'Network error' : 'Ошибка сети');
  }
}
window.cancelSubscription = cancelSubscription;

async function refreshBillingPanel() {
  const st = document.getElementById('acc-billing-status');
  const cancelBtn = document.getElementById('acc-cancel-sub');
  const payPrem = document.getElementById('acc-pay-premium');
  const payPro = document.getElementById('acc-pay-pro');
  if (!st) return;
  const en = (localStorage.getItem('lang') || 'ru') === 'en';
  try {
    const res = await apiFetch('/api/billing/status');
    const data = await res.json();
    if (!data.success) return;
    if (data.paymentsEnabled) {
      st.textContent = en
        ? ('Payments ON · current plan: ' + (data.plan || 'free').toUpperCase())
        : ('Оплата включена · план: ' + (data.plan || 'free').toUpperCase());
      if (payPrem) payPrem.style.display = '';
      if (payPro) payPro.style.display = '';
    } else {
      st.textContent = en
        ? 'Payments coming soon — waitlist in Pricing'
        : 'Оплата скоро — waitlist в тарифах';
      if (payPrem) payPrem.style.display = 'none';
      if (payPro) payPro.style.display = 'none';
    }
    if (cancelBtn) {
      cancelBtn.style.display = data.canCancel ? '' : 'none';
      cancelBtn.onclick = cancelSubscription;
    }
  } catch (e) {
    st.textContent = '—';
  }
}
