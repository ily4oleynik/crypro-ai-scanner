const bcrypt = require('bcryptjs');

let pool = null;

try {
  const db = require('./db');
  pool = db.pool || db.getPool?.() || db;
} catch (e) {
  console.warn('[store] db module:', e.message);
}

function uid(user) {
  return user?.id || user?.userId || null;
}

async function query(text, params) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool not initialized');
  }
  return pool.query(text, params);
}

async function findUserByEmail(email) {
  const r = await query(
    `SELECT id, email, password, plan FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

async function createUser(email, password, plan = 'free') {
  const hash = await bcrypt.hash(password, 10);
  const r = await query(
    `INSERT INTO users (email, password, plan)
     VALUES ($1, $2, $3)
     RETURNING id, email, plan`,
    [email, hash, plan || 'free']
  );
  return r.rows[0];
}

async function verifyPassword(user, password) {
  if (!user?.password) return false;
  if (String(user.password).startsWith('$2')) {
    return bcrypt.compare(password, user.password);
  }
  // legacy plain-text → migrate
  if (user.password === password) {
    const hash = await bcrypt.hash(password, 10);
    await query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, user.id]);
    return true;
  }
  return false;
}

async function updateUserPlan(user, plan) {
  const id = uid(user);
  if (!id) return null;
  const r = await query(
    `UPDATE users SET plan = $1 WHERE id = $2
     RETURNING id, email, plan`,
    [plan, id]
  );
  return r.rows[0] || null;
}

function planLimits(plan) {
  const p = String(plan || 'free').toLowerCase();
  if (p === 'pro') return { limit: 999999 };
  if (p === 'premium') return { limit: 50 };
  return { limit: 5 };
}

async function canScan(user) {
  const id = uid(user);
  const plan = String(user?.plan || 'free').toLowerCase();
  const { limit } = planLimits(plan);

  if (!id) {
    return { allowed: true, used: 0, limit, plan: 'guest' };
  }

  const day = new Date().toISOString().slice(0, 10);
  const r = await query(
    `SELECT count FROM scan_usage WHERE user_id = $1 AND day = $2`,
    [id, day]
  );
  const used = r.rows[0] ? Number(r.rows[0].count) : 0;
  return {
    allowed: used < limit,
    used,
    limit,
    plan
  };
}

async function incrementScan(user) {
  const id = uid(user);
  if (!id) return;
  const day = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO scan_usage (user_id, day, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, day)
     DO UPDATE SET count = scan_usage.count + 1`,
    [id, day]
  );
}

async function addHistory(user, item) {
  const id = uid(user);
  if (!id) return;
  await query(
    `INSERT INTO scan_history (user_id, address, symbol, name, price, risk_score, plan, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      id,
      item.address || '',
      item.symbol || '',
      item.name || '',
      item.price || 0,
      item.riskScore || 0,
      item.plan || 'free'
    ]
  );
}

async function getHistory(user) {
  const id = uid(user);
  if (!id) return [];
  const r = await query(
    `SELECT address, symbol, name, price, risk_score AS "riskScore", plan, scanned_at AS "scannedAt"
     FROM scan_history
     WHERE user_id = $1
     ORDER BY scanned_at DESC
     LIMIT 100`,
    [id]
  );
  return r.rows;
}

async function getWatchlist(user) {
  const id = uid(user);
  if (!id) return [];
  const r = await query(
    `SELECT address, symbol, name, created_at AS "createdAt"
     FROM watchlist WHERE user_id = $1
     ORDER BY created_at DESC`,
    [id]
  );
  return r.rows;
}

async function addToWatchlist(user, item) {
  const id = uid(user);
  if (!id) return { success: false, error: 'Auth required' };
  try {
    await query(
      `INSERT INTO watchlist (user_id, address, symbol, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, address) DO UPDATE
       SET symbol = EXCLUDED.symbol, name = EXCLUDED.name`,
      [id, item.address, item.symbol || '', item.name || '']
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function removeFromWatchlist(user, address) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(`DELETE FROM watchlist WHERE user_id = $1 AND address = $2`, [id, address]);
  return { success: true };
}

async function getAlerts(user) {
  const id = uid(user);
  if (!id) return [];
  const r = await query(
    `SELECT id, type, address, symbol, value, created_at AS "createdAt"
     FROM alerts WHERE user_id = $1
     ORDER BY created_at DESC`,
    [id]
  );
  return r.rows;
}

async function addAlert(user, item) {
  const id = uid(user);
  if (!id) return { success: false, error: 'Auth required' };
  const r = await query(
    `INSERT INTO alerts (user_id, type, address, symbol, value)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, type, address, symbol, value`,
    [id, item.type, item.address, item.symbol || '', item.value]
  );
  return { success: true, alert: r.rows[0] };
}

async function removeAlert(user, alertId) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(`DELETE FROM alerts WHERE user_id = $1 AND id = $2`, [id, alertId]);
  return { success: true };
}

async function getTelegramChatId(user) {
  const id = uid(user);
  if (!id) return null;
  const r = await query(`SELECT telegram_chat_id FROM users WHERE id = $1`, [id]);
  return r.rows[0]?.telegram_chat_id || null;
}

async function linkTelegram(user, chatId) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(`UPDATE users SET telegram_chat_id = $1 WHERE id = $2`, [String(chatId), id]);
  return { success: true };
}

async function unlinkTelegram(user) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(`UPDATE users SET telegram_chat_id = NULL WHERE id = $1`, [id]);
  return { success: true };
}

async function getUsersWithTelegram() {
  const r = await query(
    `SELECT id, email, plan, telegram_chat_id AS "telegramChatId"
     FROM users
     WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''`
  );
  return r.rows;
}

module.exports = {
  findUserByEmail,
  createUser,
  verifyPassword,
  updateUserPlan,
  canScan,
  incrementScan,
  addHistory,
  getHistory,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getAlerts,
  addAlert,
  removeAlert,
  getTelegramChatId,
  linkTelegram,
  unlinkTelegram,
  getUsersWithTelegram
};
