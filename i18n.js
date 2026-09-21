const I18N = {
  ru: {
    'btn.login': 'Войти',
    'btn.logout': 'Выйти',
    'btn.upgrade': 'Upgrade',
    'btn.checkToken': 'Check token',
    'btn.scanFree': 'Сканировать бесплатно',

    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',

    'hero.badge': 'Institutional AI · On-chain risk',
    'hero.title': 'Institutional-grade Crypto Intelligence',
    'hero.sub': 'Риск смарт-контракта + AI-вердикт + алерты — чтобы не потерять деньги на очередном rug.',
    'hero.proof': 'Сделано для тех, кто уже обжигался на скамах',
    'hero.cta': 'Сканировать бесплатно',
    'hero.example': 'Пример: LINK',
    'hero.report': 'Посмотреть пример полного анализа',
    'hero.openScanner': 'Открыть сканер',
    'hero.placeholder': '0x… адрес контракта',

    'how.1.title': 'Вставь адрес',
    'how.1.text': 'Контракт токена — за секунды, без регистрации для базового риска.',
    'how.2.title': 'Риск + AI',
    'how.2.text': 'Скор, liquidity, pressure и вердикт модели — до покупки.',
    'how.3.title': 'Watchlist + TG',
    'how.3.text': 'Избранное и алерты в Telegram, когда цена или риск меняются.',

    'sell.title': 'После 1–2 сканов обычно не хватает глубины',
    'sell.text': 'Free — быстро пощупать риск. Premium — полный разбор, алерты и watchlist.',
    'sell.cta': 'Смотреть тарифы',

    'section.trending': 'Trending markets',
    'section.watchlist': 'Watchlist',
    'section.history': 'History',
    'section.news': 'News',
    'section.refresh': 'Refresh',
    'section.all': 'All',

    'scanner.title': 'Сканер токенов',
    'scanner.subtitle': 'Вставь адрес контракта — AI оценит риск до покупки',
    'scanner.analyze': 'Проверить токен бесплатно',
    'scanner.placeholder': '0x… адрес контракта',

    'auth.login': 'Вход',
    'auth.register': 'Регистрация',
    'auth.email': 'Email',
    'auth.password': 'Пароль',
    'auth.password2': 'Повторите пароль',
    'auth.terms': 'Согласен с условиями и политикой конфиденциальности',
    'auth.submitLogin': 'Войти',
    'auth.submitRegister': 'Создать аккаунт',
    'auth.hint': 'После регистрации — тариф Free. Оплата подключится позже.',

    'tg.strip': 'Channels',
    'tg.hint': 'Alerts · digests · signal ideas'
  },
  en: {
    'btn.login': 'Login',
    'btn.logout': 'Logout',
    'btn.upgrade': 'Upgrade',
    'btn.checkToken': 'Check token',
    'btn.scanFree': 'Scan free',

    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',

    'hero.badge': 'Institutional AI · On-chain risk',
    'hero.title': 'Institutional-grade Crypto Intelligence',
    'hero.sub': 'Smart-contract risk + AI verdict + alerts — so you do not lose money on the next rug.',
    'hero.proof': 'Built for people who already got burned by scams',
    'hero.cta': 'Scan free',
    'hero.example': 'Example: LINK',
    'hero.report': 'See a full analysis example',
    'hero.openScanner': 'Open scanner',
    'hero.placeholder': '0x… contract address',

    'how.1.title': 'Paste address',
    'how.1.text': 'Token contract — in seconds, no signup for basic risk.',
    'how.2.title': 'Risk + AI',
    'how.2.text': 'Score, liquidity, pressure and model verdict — before you buy.',
    'how.3.title': 'Watchlist + TG',
    'how.3.text': 'Favorites and Telegram alerts when price or risk moves.',

    'sell.title': 'After 1–2 scans you usually need more depth',
    'sell.text': 'Free — quick risk check. Premium — full report, alerts and watchlist.',
    'sell.cta': 'View plans',

    'section.trending': 'Trending markets',
    'section.watchlist': 'Watchlist',
    'section.history': 'History',
    'section.news': 'News',
    'section.refresh': 'Refresh',
    'section.all': 'All',

    'scanner.title': 'Token Scanner',
    'scanner.subtitle': 'Paste a contract address — AI estimates risk before you buy',
    'scanner.analyze': 'Check token free',
    'scanner.placeholder': '0x… contract address',

    'auth.login': 'Login',
    'auth.register': 'Register',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.password2': 'Confirm password',
    'auth.terms': 'I agree to the Terms and Privacy Policy',
    'auth.submitLogin': 'Login',
    'auth.submitRegister': 'Create account',
    'auth.hint': 'After register — Free plan. Payments coming soon.',

    'tg.strip': 'Channels',
    'tg.hint': 'Alerts · digests · signal ideas'
  }
};

let currentLang = localStorage.getItem('lang') || 'ru';
if (currentLang !== 'ru' && currentLang !== 'en') currentLang = 'ru';

function t(key) {
  if (!key) return '';
  const lang = currentLang === 'en' ? 'en' : 'ru';
  const dict = I18N[lang] || I18N.ru;
  if (dict && dict[key] != null) return dict[key];
  if (I18N.en && I18N.en[key] != null) return I18N.en[key];
  if (I18N.ru && I18N.ru[key] != null) return I18N.ru[key];
  return key;
}

function setText(sel, key) {
  const el = document.querySelector(sel);
  if (el) el.textContent = t(key);
}

function setPlaceholder(id, key) {
  const el = document.getElementById(id);
  if (el) el.placeholder = t(key);
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = val;
    else el.textContent = val;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  // Nav
  setText('#nav-home', 'nav.home');
  setText('#nav-scanner', 'nav.scanner');
  setText('#nav-watchlist', 'nav.watchlist');
  setText('#nav-history', 'nav.history');
  setText('#nav-alerts', 'nav.alerts');
  setText('#nav-compare', 'nav.compare');
  setText('#nav-account', 'nav.account');

  // Hero
  setText('.hero-badge', 'hero.badge');
  setText('.hero h1', 'hero.title');
  setText('.hero-sub', 'hero.sub');
  setText('.hero-proof', 'hero.proof');
  setText('#home-scan-btn', 'hero.cta');
  setText('#go-scanner-btn', 'hero.example');
  setText('#example-report-btn', 'hero.report');
  setText('#try-link-btn', 'hero.openScanner');
  setText('#nav-scan-cta', 'btn.checkToken');
  setPlaceholder('home-token-input', 'hero.placeholder');
  setPlaceholder('token-input', 'scanner.placeholder');

  // How cards
  const howTitles = document.querySelectorAll('.how-card h3');
  const howTexts = document.querySelectorAll('.how-card p');
  if (howTitles[0]) howTitles[0].textContent = t('how.1.title');
  if (howTitles[1]) howTitles[1].textContent = t('how.2.title');
  if (howTitles[2]) howTitles[2].textContent = t('how.3.title');
  if (howTexts[0]) howTexts[0].textContent = t('how.1.text');
  if (howTexts[1]) howTexts[1].textContent = t('how.2.text');
  if (howTexts[2]) howTexts[2].textContent = t('how.3.text');

  // Sell
  setText('.sell-copy h3', 'sell.title');
  setText('.sell-copy p.muted', 'sell.text');
  const sellBtn = document.querySelector('.sell-strip .upgrade-btn, .sell-strip .plan-btn');
  if (sellBtn) sellBtn.textContent = t('sell.cta');

  // Sections
  const trendingH = document.querySelector('#page-home .section-head h2');
  if (trendingH && trendingH.textContent.toLowerCase().includes('trend')) {
    trendingH.textContent = t('section.trending');
  }
  setText('#refresh-trending', 'section.refresh');
  setText('#scan-button', 'scanner.analyze');
  setText('.scanner-hero h1', 'scanner.title');
  setText('.scanner-hero > p', 'scanner.subtitle');

  // Auth
  setPlaceholder('auth-email', 'auth.email');
  setPlaceholder('auth-password', 'auth.password');
  setPlaceholder('auth-password2', 'auth.password2');
  const termsLabel = document.querySelector('#auth-terms-wrap span, .auth-terms span');
  if (termsLabel) {
    // keep links if any
    const hasLinks = termsLabel.querySelector('a');
    if (!hasLinks) termsLabel.textContent = t('auth.terms');
    else {
      // rebuild with links
      termsLabel.innerHTML = currentLang === 'ru'
        ? 'Согласен с <a href="/terms.html" target="_blank">условиями</a> и <a href="/privacy.html" target="_blank">политикой</a>'
        : 'I agree to the <a href="/terms.html" target="_blank">Terms</a> and <a href="/privacy.html" target="_blank">Privacy Policy</a>';
    }
  }

  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    const loggedIn = typeof user !== 'undefined' && user;
    authBtn.textContent = loggedIn ? t('btn.logout') : t('btn.login');
  }

  document.querySelectorAll('.plan-btn').forEach((btn) => {
    if (btn.dataset.plan === 'premium' && btn.id !== 'footer-pricing') {
      if (!btn.classList.contains('pricing-pick') && btn.closest('.sell-strip')) {
        btn.textContent = t('sell.cta');
      } else if (btn.closest('.nav-actions') || (btn.textContent && /upgrade|тариф/i.test(btn.textContent))) {
        if (!btn.closest('.price-card') && !btn.closest('.plans-list')) {
          btn.textContent = t('btn.upgrade');
        }
      }
    }
  });

  const mode = document.querySelector('.auth-tab.active')?.dataset?.mode || 'login';
  const authTitle = document.getElementById('auth-title');
  const authSubmit = document.getElementById('auth-submit');
  if (authTitle) authTitle.textContent = mode === 'login' ? t('auth.login') : t('auth.register');
  if (authSubmit) {
    authSubmit.textContent = mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister');
  }
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    const m = tab.dataset.mode;
    if (m === 'login') tab.textContent = t('auth.login');
    if (m === 'register') tab.textContent = t('auth.register');
  });

  setText('.tg-strip-label', 'tg.strip');
  setText('.tg-strip-hint', 'tg.hint');
}

function setLanguage(lang) {
  if (lang !== 'ru' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  applyTranslations();
  if (typeof loadHomeWidgets === 'function') loadHomeWidgets();
  if (typeof updateAuthUI === 'function') updateAuthUI();
}

window.t = t;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.I18N = I18N;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyTranslations);
} else {
  applyTranslations();
}
