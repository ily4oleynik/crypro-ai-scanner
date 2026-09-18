const I18N = {
  ru: {
    'btn.login': 'Войти',
    'btn.logout': 'Выйти',
    'btn.upgrade': 'Upgrade',
    'hero.sub': 'Риск смарт-контракта + AI-вердикт + алерты — чтобы не потерять деньги на очередном rug.',
    'hero.proof': 'Сделано для тех, кто уже обжигался на скамах',
    'hero.cta': 'Проверить токен бесплатно',
    'hero.example': 'Пример: LINK',
    'hero.report': 'Посмотреть пример полного анализа',
    'how.title': 'Как это работает',
    'how.1': 'Вставь адрес контракта',
    'how.2': 'Получи риск + AI-вердикт',
    'how.3': 'Следи через Watchlist и Telegram',
    'sell.title': 'После 1–2 сканов обычно не хватает глубины',
    'sell.text': 'Free — быстро пощупать риск. Premium — полный разбор, алерты и watchlist.',
    'sell.cta': 'Смотреть тарифы',
    'trending': 'Trending',
    'auth.login': 'Войти',
    'auth.register': 'Регистрация',
    'auth.hint': 'После регистрации — тариф Free. Оплата подключится позже.',
    'scanner.title': 'Token Scanner',
    'scanner.sub': 'Вставь адрес контракта — AI оценит риск до покупки',
    'scanner.btn': 'Проверить токен бесплатно'
  },
  en: {
    'btn.login': 'Login',
    'btn.logout': 'Logout',
    'btn.upgrade': 'Upgrade',
    'hero.sub': 'Smart-contract risk + AI verdict + alerts — so you do not lose money on the next rug.',
    'hero.proof': 'Built for people who already got burned by scams',
    'hero.cta': 'Check a token free',
    'hero.example': 'Example: LINK',
    'hero.report': 'See a full analysis example',
    'how.title': 'How it works',
    'how.1': 'Paste the contract address',
    'how.2': 'Get risk + AI verdict',
    'how.3': 'Track via Watchlist and Telegram',
    'sell.title': 'After 1–2 scans you usually need more depth',
    'sell.text': 'Free — quick risk check. Premium — full report, alerts and watchlist.',
    'sell.cta': 'View plans',
    'trending': 'Trending',
    'auth.login': 'Login',
    'auth.register': 'Create account',
    'auth.hint': 'After register — Free plan. Payments coming soon.',
    'scanner.title': 'Token Scanner',
    'scanner.sub': 'Paste a contract address — AI estimates risk before you buy',
    'scanner.btn': 'Check token free'
  }
};

function t(key) {
  const lang = localStorage.getItem('lang') === 'en' ? 'en' : 'ru';
  return (I18N[lang] && I18N[lang][key]) || I18N.ru[key] || key;
}

function setLanguage(lang) {
  lang = lang === 'en' ? 'en' : 'ru';
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;

  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  const d = I18N[lang];

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (d[key] != null) el.textContent = d[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (d[key] != null) el.setAttribute('placeholder', d[key]);
  });

  const set = (sel, key) => {
    const el = document.querySelector(sel);
    if (el && d[key] != null) el.textContent = d[key];
  };

  set('.hero-sub', 'hero.sub');
  set('.hero-proof', 'hero.proof');
  set('#try-link-btn', 'hero.cta');
  set('#go-scanner-btn', 'hero.example');
  set('#example-report-btn', 'hero.report');
  set('.quick-start h3', 'how.title');
  set('.sell-strip h3', 'sell.title');
  set('.sell-strip p.muted', 'sell.text');
  set('.sell-strip .upgrade-btn', 'sell.cta');
  set('#scan-button', 'scanner.btn');
  set('.scanner-hero h1', 'scanner.title');
  set('.scanner-hero p', 'scanner.sub');

  const steps = document.querySelectorAll('.step-item span:last-child');
  if (steps[0] && d['how.1']) steps[0].textContent = d['how.1'];
  if (steps[1] && d['how.2']) steps[1].textContent = d['how.2'];
  if (steps[2] && d['how.3']) steps[2].textContent = d['how.3'];

  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    const loggedOut =
      !authBtn.textContent ||
      /login|войти/i.test(authBtn.textContent);
    if (loggedOut) authBtn.textContent = d['btn.login'];
  }

  const authTitle = document.getElementById('auth-title');
  const authSubmit = document.getElementById('auth-submit');
  const mode = document.querySelector('.auth-tab.active')?.dataset?.mode;
  if (mode === 'register') {
    if (authTitle) authTitle.textContent = d['auth.register'];
    if (authSubmit) authSubmit.textContent = d['auth.register'];
  } else {
    if (authTitle) authTitle.textContent = d['auth.login'];
    if (authSubmit) authSubmit.textContent = d['auth.login'];
  }
}

window.setLanguage = setLanguage;
window.t = t;
window.I18N = I18N;
