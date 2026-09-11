const axios = require('axios');

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml, source) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
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
      time: pub ? new Date(pub).toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }) : '',
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

async function fetchCryptoPanic() {
  try {
    const res = await axios.get(
      'https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&kind=news&limit=15',
      { timeout: 8000 }
    );
    return (res.data.results || []).map(item => ({
      title: item.title,
      source: item.source?.title || 'CryptoPanic',
      url: item.url,
      time: new Date(item.published_at).toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }),
      platform: 'cryptopanic'
    }));
  } catch (e) {
    console.error('[News] CryptoPanic', e.message);
    return [];
  }
}

// Опционально: X (Twitter) API v2 — если есть Bearer
async function fetchXNews() {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return [];
  try {
    const query = encodeURIComponent('(crypto OR bitcoin OR ethereum) lang:en -is:retweet');
    const res = await axios.get(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at,author_id`,
      {
        timeout: 8000,
        headers: { Authorization: `Bearer ${bearer}` }
      }
    );
    return (res.data.data || []).map(t => ({
      title: t.text.slice(0, 120) + (t.text.length > 120 ? '…' : ''),
      source: 'X',
      url: `https://x.com/i/web/status/${t.id}`,
      time: t.created_at
        ? new Date(t.created_at).toLocaleString('ru-RU', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
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
  // дедуп по title
  const seen = new Set();
  const unique = [];
  for (const n of merged) {
    const key = n.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  return unique.slice(0, limit);
}

module.exports = { fetchNews };
