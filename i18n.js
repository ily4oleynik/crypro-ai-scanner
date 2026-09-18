const I18N = {
  ru: {
    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',
    'btn.upgrade': 'Upgrade',
    'btn.login': 'Login',
    'btn.logout': 'Logout',
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
    'watchlist.home': 'Your Watchlist',
    'continue': 'Continue',
    'news': 'Latest News',
    'scanner.title': 'Token Scanner',
    'scanner.sub': 'Вставь адрес контракта — AI оценит риск до покупки',
    'scanner.btn': 'Проверить токен бесплатно',
    'auth.login': 'Login',
    'auth.register': 'Create account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.password2': 'Confirm password',
    'auth.terms': 'I agree to the Terms and Privacy Policy',
    'auth.hint': 'После регистрации — тариф Free. Оплата подключится позже.',
    'pricing.title': 'Выберите тариф',
    'pricing.sub': 'Free — попробовать. Premium — когда цена ошибки уже высока.'
  },
  en: {
    'nav.home': 'Home',
    'nav.scanner': 'Scanner',
    'nav.watchlist': 'Watchlist',
    'nav.history': 'History',
    'nav.alerts': 'Alerts',
    'nav.compare': 'Compare',
    'nav.account': 'Account',
    'btn.upgrade': 'Upgrade',
    'btn.login': 'Login',
    'btn.logout': 'Logout',
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
    'watchlist.home': 'Your Watchlist',
    'continue': 'Continue',
    'news': 'Latest News',
    'scanner.title': 'Token Scanner',
    'scanner.sub': 'Paste a contract address — AI estimates risk before you buy',
    'scanner.btn': 'Check token free',
    'auth.login': 'Login',
    'auth.register': 'Create account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.password2': 'Confirm password',
    'auth.terms': 'I agree to the Terms and Privacy Policy',
    'auth.hint': 'After register — Free plan. Payments coming soon.',
    'pricing.title': 'Choose a plan',
    'pricing.sub': 'Free to try. Premium when the cost of a mistake is high.'
  }
};

function t(key) {
  const lang = localStorage.getItem('lang') === 'en' ? 'en' : 'ru';
  return (I18N[lang] && I18N[lang][key]) || (I18N.ru && I18N.ru[key]) || key;
}

function setLanguage(lang) {
  lang = lang === 'en' ? 'en' : 'ru';
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;

  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  const dict = I18N[lang] || I18N.ru;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] != null) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key] != null) el.setAttribute('placeholder', dict[key]);
  });
}

window.setLanguage = setLanguage;
window.t = t;
window.I18N = I18N;
