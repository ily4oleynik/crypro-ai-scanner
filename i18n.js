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
    'auth.hint': 'После регистрации — тариф Free. Оплата подключится позже.'
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
    'auth.hint': 'After register — Free plan. Payments coming soon.'
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

  // 1) data-i18n
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (d[key] != null) el.textContent = d[key];
  });

  // 2) fallback — если data-i18n нет на проде
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
  set('.sell-strip .muted', 'sell.text');
  set('.sell-strip .upgrade-btn', 'sell.cta');

  const steps = document.querySelectorAll('.step-item span:last-child');
  if (steps[0]) steps[0].textContent = d['how.1'];
  if (steps[1]) steps[1].textContent = d['how.2'];
  if (steps[2]) steps[2].textContent = d['how.3'];

  const authBtn = document.getElementById('auth-btn');
  if (authBtn && !authBtn.dataset.user) {
    // не трогаем Logout если залогинен — app.js updateAuthUI
  }

  if (typeof window.updateAuthUI === 'function') {
    window.updateAuthUI();
  } else if (authBtn && authBtn.textContent !== 'Logout' && authBtn.textContent !== 'Выйти') {
    authBtn.textContent = d['btn.login'];
  }
}

window.setLanguage = setLanguage;
window.t = t;
window.I18N = I18N;
