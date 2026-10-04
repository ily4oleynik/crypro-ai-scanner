const axios = require('axios');

function unwrapCdata(s) {
  const str = String(s || '').trim();
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  return m ? m[1].trim() : str;
}

function stripHtml(html) {
  return unwrapCdata(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(raw) {
  let u = unwrapCdata(raw);
  u = stripHtml(u);
  u = String(u || '').trim();
  if (!u || u === '#' || u === 'null') return null;
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) {
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

function parseRss(xml, source) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 15)) {
    const titleRaw =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
        block.match(/<title>([\s\S]*?)<\/title>/i) ||
        [])[1];
    const linkRaw =
      (block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/i) ||
        block.match(/<link>([\s\S]*?)<\/link>/i) ||
        block.match(/<guid[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/guid>/i) ||
        block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) ||
        [])[1];
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
    const title = stripHtml(titleRaw);
    const url = normalizeUrl(linkRaw);
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source,
      time: pub
        ? new Date(stripHtml(pub)).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '',
      platform: 'crypto'
    });
  }
  return items;
}

async function fetchRss(url, source) {
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CryptoAIScanner/1.0; +https://railway.app)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    return parseRss(res.data, source);
  } catch (e) {
    console.error('[News] RSS fail', source, e.message);
    return [];
  }
}

/** CryptoPanic — only if token present */
async function fetchCryptoPanic() {
  const token = process.env.CRYPTOPANIC_TOKEN || process.env.CRYPTOPANIC_API_KEY;
  if (!token) return [];
  try {
    const res = await axios.get(
      'https://cryptopanic.com/api/developer/v2/posts/?auth_token=' +
        encodeURIComponent(token) +
        '&public=true&kind=news',
      { timeout: 8000 }
    );
    const list = res.data?.results || res.data?.data || [];
    return list.slice(0, 15).map((item) => ({
      title: item.title,
      source: item.source?.title || item.source?.name || 'CryptoPanic',
      url: normalizeUrl(item.url || item.original_url) || 'https://cryptopanic.com/',
      time: item.published_at
        ? new Date(item.published_at).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '',
      platform: 'crypto'
    }));
  } catch (e) {
    if (e.response?.status !== 404) {
      console.error('[News] CryptoPanic', e.message);
    }
    return [];
  }
}

async function fetchXNews() {
  // Optional: leave empty without X API keys
  return [];
}

async function fetchNews(limit = 24) {
  const [panic, ct, cd, dec, bm] = await Promise.all([
    fetchCryptoPanic(),
    fetchRss('https://cointelegraph.com/rss', 'CoinTelegraph'),
    fetchRss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'),
    fetchRss('https://decrypt.co/feed', 'Decrypt'),
    fetchRss('https://bitcoinmagazine.com/.rss/full/', 'Bitcoin Magazine')
  ]);

  const merged = [...panic, ...ct, ...cd, ...dec, ...bm];
  const seen = new Set();
  const unique = [];
  for (const n of merged) {
    if (!n?.title || !n?.url) continue;
    const key = n.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  return unique.slice(0, limit);
}

module.exports = { fetchNews, normalizeUrl };
