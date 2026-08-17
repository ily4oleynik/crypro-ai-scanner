// backend/store.js
const { query } = require('./db');

const LIMITS = {
  free: 5,
  premium: 50,
  pro: 999999
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getUserId(user) {
  return user?.id != null ? String(user.id) : 'anonymous';
}

async function findUserByEmail(email) {
  const r = await query('SELECT * FROM users WHERE email = $1', [email]);
  return r.rows[0] || null;
}

async function findUserById(id) {
  const r = await query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function createUser(email, password, plan = 'free') {
  const r = await query(
    `INSERT INTO users (email, password, plan)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email, password, plan]
  );
  return r.rows[0];
}

async function canScan(user) {
  const plan = (user?.plan || 'free').toLowerCase();
  const uid = getUserId(user);
  const day = today();

  let r = await query(
    'SELECT count FROM scan_usage WHERE user_id = $1 AND day = $2',
    [uid, day]
  );

  if (!r.rows[0]) {
    await query(
      `INSERT INTO scan_usage (user_id, day, count)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, day) DO NOTHING`,
      [uid, day]
    );
    r = { rows: [{ count: 0 }] };
  }

  const used = Number(r.rows[0].count);
  const limit = LIMITS[plan] ?? LIMITS.free;

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used)
  };
}

async function incrementScan(user) {
  const uid = getUserId(user);
  const day = today();
  const r = await query(
    `INSERT INTO scan_usage (user_id, day, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, day)
     DO UPDATE SET count = scan_usage.count + 1
     RETURNING count`,
    [uid, day]
  );
  return Number(r.rows[0].count);
}

async function addHistory(user, item) {
  const uid = getUserId(user);
  await query(
    `INSERT INTO scan_history (user_id, address, symbol, name, price, risk_score, plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uid,
      item.address,
      item.symbol || null,
      item.name || null,
      item.price != null ? Number(item.price) : null,
      item.riskScore != null ? Number(item.riskScore) : null,
      item.plan || null
    ]
  );

  await query(
    `DELETE FROM scan_history
     WHERE user_id = $1
       AND id NOT IN (
         SELECT id FROM scan_history
         WHERE user_id = $1
         ORDER BY scanned_at DESC, id DESC
         LIMIT 50
       )`,
    [uid]
  );
}

async function getHistory(user) {
  const uid = getUserId(user);
  const r = await query(
    `SELECT address, symbol, name, price,
            risk_score AS "riskScore", plan,
            scanned_at AS "scannedAt"
     FROM scan_history
     WHERE user_id = $1
     ORDER BY scanned_at DESC, id DESC
     LIMIT 50`,
    [uid]
  );
  return r.rows;
}

async function getWatchlist(user) {
  const uid = getUserId(user);
  const r = await query(
    `SELECT address, symbol, name, added_at AS "addedAt"
     FROM watchlist
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [uid]
  );
  return r.rows;
}

async function addToWatchlist(user, token) {
  const uid = getUserId(user);
  try {
    await query(
      `INSERT INTO watchlist (user_id, address, symbol, name)
       VALUES ($1, $2, $3, $4)`,
      [uid, token.address, token.symbol || 'TOKEN', token.name || '']
    );
    return { success: true, watchlist: await getWatchlist(user) };
  } catch (e) {
    if (e.code === '23505') {
      return { success: false, error: 'Уже в watchlist' };
    }
    throw e;
  }
}

async function removeFromWatchlist(user, address) {
  const uid = getUserId(user);
  await query(
    `DELETE FROM watchlist
     WHERE user_id = $1 AND lower(address) = lower($2)`,
    [uid, address]
  );
  return { success: true, watchlist: await getWatchlist(user) };
}

async function getAlerts(user) {
  const uid = getUserId(user);
  const r = await query(
    `SELECT id, type, address, symbol, value, active,
            created_at AS "createdAt"
     FROM alerts
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [uid]
  );
  return r.rows;
}

async function addAlert(user, alert) {
  const uid = getUserId(user);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await query(
    `INSERT INTO alerts (id, user_id, type, address, symbol, value, active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [id, uid, alert.type, alert.address, alert.symbol || 'TOKEN', Number(alert.value)]
  );
  return { success: true, alerts: await getAlerts(user) };
}

async function removeAlert(user, alertId) {
  const uid = getUserId(user);
  await query('DELETE FROM alerts WHERE user_id = $1 AND id = $2', [uid, alertId]);
  await query('DELETE FROM fired_alerts WHERE user_id = $1 AND alert_id = $2', [uid, alertId]);
  return { success: true, alerts: await getAlerts(user) };
}

async function linkTelegram(user, chatId) {
  const uid = getUserId(user);
  await query(
    `INSERT INTO telegram_links (user_id, chat_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id`,
    [uid, String(chatId)]
  );
  return { success: true, chatId: String(chatId) };
}

async function getTelegramChatId(user) {
  const uid = getUserId(user);
  const r = await query(
    'SELECT chat_id FROM telegram_links WHERE user_id = $1',
    [uid]
  );
  return r.rows[0]?.chat_id || null;
}

async function unlinkTelegram(user) {
  const uid = getUserId(user);
  await query('DELETE FROM telegram_links WHERE user_id = $1', [uid]);
  return { success: true };
}

async function markAlertFired(userId, alertId) {
  await query(
    `INSERT INTO fired_alerts (user_id, alert_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [String(userId), String(alertId)]
  );
}

async function wasAlertFired(userId, alertId) {
  const r = await query(
    'SELECT 1 FROM fired_alerts WHERE user_id = $1 AND alert_id = $2',
    [String(userId), String(alertId)]
  );
  return r.rows.length > 0;
}

async function getAllAlertUsers() {
  const links = await query('SELECT user_id, chat_id FROM telegram_links');
  const result = [];
  for (const link of links.rows) {
    const alerts = await query(
      `SELECT id, type, address, symbol, value, active,
              created_at AS "createdAt"
       FROM alerts
       WHERE user_id = $1 AND active = TRUE`,
      [link.user_id]
    );
    if (alerts.rows.length) {
      result.push({
        userId: link.user_id,
        chatId: link.chat_id,
        alerts: alerts.rows
      });
    }
  }
  return result;
}

async function getDigestUsers() {
  const links = await query('SELECT user_id, chat_id FROM telegram_links');
  const result = [];
  for (const link of links.rows) {
    const wl = await query(
      `SELECT address, symbol, name, added_at AS "addedAt"
       FROM watchlist WHERE user_id = $1
       ORDER BY added_at DESC`,
      [link.user_id]
    );
    result.push({
      userId: link.user_id,
      chatId: link.chat_id,
      watchlist: wl.rows
    });
  }
  return result;
}

module.exports = {
  LIMITS,
  findUserByEmail,
  findUserById,
  createUser,
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
  linkTelegram,
  getTelegramChatId,
  unlinkTelegram,
  markAlertFired,
  wasAlertFired,
  getAllAlertUsers,
  getDigestUsers
};