const I18N = {
  ru: {
    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',
    'nav.login': 'Войти',
    'nav.logout': 'Выйти',
    'btn.upgrade': 'Upgrade',
    'hero.sub': 'Риск смарт-контракта + AI-вердикт + алерты — чтобы не потерять деньги на очередном rug.',
    'hero.proof': 'Сделано для тех, кто уже обжигался на скамах',
    'hero.cta': 'Проверить токен бесплатно',
    'hero.example': 'Пример: LINK',
    'hero.report': 'Посмотреть пример полного анализа',
    'home.how': 'Как это работает',
    'home.step1': 'Вставь адрес контракта',
    'home.step2': 'Получи риск + AI-вердикт',
    'home.step3': 'Следи через Watchlist и Telegram',
    'sell.title': 'После 1–2 сканов обычно не хватает глубины',
    'sell.text': 'Free — быстро пощупать риск. Premium — полный разбор, алерты и watchlist.',
    'sell.cta': 'Смотреть тарифы',
    'home.watchlist': 'Your Watchlist',
    'home.openAll': 'Open all',
    'home.continue': 'Continue',
    'home.history': 'History',
    'home.news': 'Latest News',
    'scanner.title': 'Token Scanner',
    'scanner.subtitle': 'Вставь адрес контракта — AI оценит риск до покупки',
    'scanner.analyze': 'Проверить токен бесплатно',
    'auth.login': 'Вход',
    'auth.register': 'Регистрация',
    'auth.submitLogin': 'Войти',
    'auth.submitRegister': 'Создать аккаунт',
    'auth.hint': 'После регистрации — тариф Free. Оплата подключится позже.'
  },
  en: {
    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',
    'nav.login': 'Login',
    'nav.logout': 'Logout',
    'btn.upgrade': 'Upgrade',
    'hero.sub': 'Smart-contract risk + AI verdict + alerts — so you do not lose money on the next rug.',
    'hero.proof': 'Built for people who already got burned by scams',
    'hero.cta': 'Check a token free',
    'hero.example': 'Example: LINK',
    'hero.report': 'See a full analysis example',
    'home.how': 'How it works',
    'home.step1': 'Paste the contract address',
    'home.step2': 'Get risk + AI verdict',
    'home.step3': 'Track via Watchlist and Telegram',
    'sell.title': 'After 1–2 scans you usually need more depth',
    'sell.text': 'Free — quick risk check. Premium — full report, alerts and watchlist.',
    'sell.cta': 'View plans',
    'home.watchlist': 'Your Watchlist',
    'home.openAll': 'Open all',
    'home.continue': 'Continue',
    'home.history': 'History',
    'home.news': 'Latest News',
    'scanner.title': 'Token Scanner',
    'scanner.subtitle': 'Paste a contract address — AI estimates risk before you buy',
    'scanner.analyze': 'Check token free',
    'auth.login': 'Login',
    'auth.register': 'Register',
    'auth.submitLogin': 'Login',
    'auth.submitRegister': 'Create Account',
    'auth.hint': 'After register — Free plan. Payments coming soon.'
  }
};

let currentLang = localStorage.getItem('lang') || 'ru';

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
}

function setText(sel, key) {
  const el = document.querySelector(sel);
  if (el) el.textContent = t(key);
}

function applyTranslations() {
  // 1) если когда-нибудь появятся data-i18n
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = val;
    else el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  // 2) fallback — твоя реальная вёрстка (data-i18n = 0)
  setText('.hero-sub', 'hero.sub');
  setText('.hero-proof', 'hero.proof');
  setText('#try-link-btn', 'hero.cta');
  setText('#go-scanner-btn', 'hero.example');
  setText('#example-report-btn', 'hero.report');
  setText('.quick-start h3', 'home.how');
  setText('.sell-strip h3', 'sell.title');
  setText('.sell-strip p.muted', 'sell.text');
  setText('.sell-strip .upgrade-btn', 'sell.cta');
  setText('#scan-button', 'scanner.analyze');
  setText('.scanner-hero h1', 'scanner.title');
  setText('.scanner-hero > p', 'scanner.subtitle');

  const steps = document.querySelectorAll('.step-item span:last-child');
  if (steps[0]) steps[0].textContent = t('home.step1');
  if (steps[1]) steps[1].textContent = t('home.step2');
  if (steps[2]) steps[2].textContent = t('home.step3');

  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    const loggedIn =
      typeof user !== 'undefined' && user;
    authBtn.textContent = loggedIn ? t('nav.logout') : t('nav.login');
  }

  const mode = document.querySelector('.auth-tab.active')?.dataset?.mode || 'login';
  const authTitle = document.getElementById('auth-title');
  const authSubmit = document.getElementById('auth-submit');
  if (authTitle) {
    authTitle.textContent = mode === 'login' ? t('auth.login') : t('auth.register');
  }
  if (authSubmit) {
    authSubmit.textContent =
      mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister');
  }

  const hint = document.querySelector('#auth-modal .muted.small');
  if (hint && !hint.id) hint.textContent = t('auth.hint');
}

function setLanguage(lang) {
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  applyTranslations();
  if (typeof loadHomeWidgets === 'function') loadHomeWidgets();
}

window.t = t;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.I18N = I18N;
