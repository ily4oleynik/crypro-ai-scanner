const axios = require('axios');

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml, source) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 12)) {
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
      block.match(/<title>(.*?)<\/title>/i) || [])[1];
    const link = (block.match(/<link>(.*?)<\/link>/i) ||
      block.match(/<guid[^>]*>(.*?)<\/guid>/i) || [])[1];
    const pub = (block.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1];
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      url: stripHtml(link),
      source,
      time: pub
        ? new Date(pub).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '',
      platform: 'rss'
    });
  }
  return items;
}

async function fetchRss(url, source) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'CryptoAIScanner/1.0' }
    });
    return parseRss(res.data, source);
  } catch (e) {
    console.error('[News] RSS fail', source, e.message);
    return [];
  }
}

/** CryptoPanic free URL часто отдаёт 404 — пробуем с ключом, иначе тихо пропускаем */
async function fetchCryptoPanic() {
  const token = process.env.CRYPTOPANIC_TOKEN || process.env.CRYPTOPANIC_API_KEY;
  if (!token) {
    return [];
  }
  try {
    const res = await axios.get(
      `https://cryptopanic.com/api/developer/v2/posts/?auth_token=${encodeURIComponent(
        token
      )}&public=true&kind=news`,
      { timeout: 8000 }
    );
    const list = res.data?.results || res.data?.data || [];
    return list.slice(0, 15).map((item) => ({
      title: item.title,
      source: item.source?.title || item.source?.name || 'CryptoPanic',
      url: item.url || item.original_url || '#',
      time: item.published_at
        ? new Date(item.published_at).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '',
      platform: 'cryptopanic'
    }));
  } catch (e) {
    // не спамим 404 каждые N секунд
    if (e.response?.status !== 404) {
      console.error('[News] CryptoPanic', e.message);
    }
    return [];
  }
}

async function fetchXNews() {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return [];
  try {
    const query = encodeURIComponent(
      '(crypto OR bitcoin OR ethereum) lang:en -is:retweet'
    );
    const res = await axios.get(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at,author_id`,
      {
        timeout: 8000,
        headers: { Authorization: `Bearer ${bearer}` }
      }
    );
    return (res.data.data || []).map((t) => ({
      title: t.text.slice(0, 120) + (t.text.length > 120 ? '…' : ''),
      source: 'X',
      url: `https://x.com/i/web/status/${t.id}`,
      time: t.created_at
        ? new Date(t.created_at).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '',
      platform: 'x'
    }));
  } catch (e) {
    console.error('[News] X API', e.response?.data || e.message);
    return [];
  }
}

async function fetchNews(limit = 24) {
  const [panic, ct, cd, dec, bm, x] = await Promise.all([
    fetchCryptoPanic(),
    fetchRss('https://cointelegraph.com/rss', 'CoinTelegraph'),
    fetchRss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'),
    fetchRss('https://decrypt.co/feed', 'Decrypt'),
    fetchRss('https://bitcoinmagazine.com/.rss/full/', 'Bitcoin Magazine'),
    fetchXNews()
  ]);

  const merged = [...panic, ...ct, ...cd, ...dec, ...bm, ...x];
  const seen = new Set();
  const unique = [];
  for (const n of merged) {
    if (!n?.title) continue;
    const key = n.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  return unique.slice(0, limit);
}

module.exports = { fetchNews };
