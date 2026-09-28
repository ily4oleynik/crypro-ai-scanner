const crypto = require('crypto');

let pool = null;

try {
  const db = require('./db');
  pool = db.pool || (typeof db.getPool === 'function' ? db.getPool() : db);
} catch (e) {
  console.warn('[store] db module:', e.message);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}

function verifyPasswordHash(stored, password) {
  if (!stored) return false;

  if (String(stored).startsWith('scrypt:')) {
    const parts = String(stored).split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const hash = parts[2];
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(test, 'hex')
      );
    } catch (e) {
      return false;
    }
  }

  if (String(stored).startsWith('$2')) {
    return false;
  }

  return stored === password;
}

/** user_id в alerts/scan_* — TEXT; users.id — integer */
function uid(user) {
  const id = user?.id ?? user?.userId ?? null;
  if (id == null || id === '') return null;
  return String(id);
}

async function query(text, params) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool not initialized');
  }
  return pool.query(text, params);
}

async function findUserByEmail(email) {
  const r = await query(
    `SELECT id, email, password, plan, telegram_id, telegram_chat_id
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

async function findUserByTelegramId(telegramId) {
  const tid = String(telegramId || '').trim();
  if (!tid) return null;
  try {
    const r = await query(
      `SELECT id, email, password, plan, telegram_id, telegram_chat_id
       FROM users WHERE telegram_id = $1 LIMIT 1`,
      [tid]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.error('[store] findUserByTelegramId:', e.message);
    return null;
  }
}

async function createUser(email, password, plan = 'free') {
  const hash = hashPassword(password);
  const r = await query(
    `INSERT INTO users (email, password, plan)
     VALUES ($1, $2, $3)
     RETURNING id, email, plan`,
    [email, hash, plan || 'free']
  );
  return r.rows[0];
}

/** Login via Telegram Widget — no real password */
async function createUserFromTelegram({ telegramId, username, firstName, lastName }) {
  const tid = String(telegramId || '').trim();
  if (!tid) throw new Error('telegramId required');

  const existing = await findUserByTelegramId(tid);
  if (existing) {
    // refresh chat id for alerts (private chats: chat_id === user id)
    try {
      await query(
        `UPDATE users
         SET telegram_chat_id = COALESCE(telegram_chat_id, $1)
         WHERE id = $2::integer`,
        [tid, existing.id]
      );
    } catch (e) {}
    return existing;
  }

  const uname = (username || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  const email = uname
    ? `tg_${tid}_${uname}@telegram.local`
    : `tg_${tid}@telegram.local`;
  // unusable password marker (cannot login with password)
  const hash = hashPassword(crypto.randomBytes(24).toString('hex'));

  try {
    const r = await query(
      `INSERT INTO users (email, password, plan, telegram_id, telegram_chat_id)
       VALUES ($1, $2, 'free', $3, $4)
       RETURNING id, email, plan, telegram_id, telegram_chat_id`,
      [email, hash, tid, tid]
    );
    return r.rows[0];
  } catch (e) {
    // race: already created
    if (String(e.message || '').includes('unique') || e.code === '23505') {
      return findUserByTelegramId(tid);
    }
    throw e;
  }
}

async function verifyPassword(user, password) {
  if (!user?.password) return false;
  const ok = verifyPasswordHash(user.password, password);
  if (ok && user.password === password) {
    const hash = hashPassword(password);
    await query(`UPDATE users SET password = $1 WHERE id = $2::integer`, [
      hash,
      uid(user)
    ]);
  }
  return ok;
}

async function updateUserPlan(user, plan) {
  const id = uid(user);
  if (!id) return null;
  const r = await query(
    `UPDATE users SET plan = $1 WHERE id = $2::integer
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

async function addRiskSnapshot(item) {
  const address = String(item.address || '').trim();
  if (!address) return;
  try {
    // throttle: one snapshot per address per ~30 min
    const recent = await query(
      `SELECT id FROM risk_snapshots
       WHERE lower(address) = lower($1)
         AND recorded_at > NOW() - INTERVAL '30 minutes'
       LIMIT 1`,
      [address]
    );
    if (recent.rows.length) return;
    await query(
      `INSERT INTO risk_snapshots
        (address, chain_id, symbol, risk_score, risk_level, liquidity, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        address,
        item.chainId || null,
        item.symbol || null,
        item.riskScore != null ? Number(item.riskScore) : 0,
        item.riskLevel || null,
        item.liquidity != null ? Number(item.liquidity) : null,
        item.price != null ? Number(item.price) : null
      ]
    );
  } catch (e) {
    console.error('[store] addRiskSnapshot:', e.message);
  }
}

async function getRiskHistory(address, hours) {
  const addr = String(address || '').trim();
  if (!addr) return [];
  const h = Math.min(720, Math.max(6, Number(hours) || 48));
  try {
    const r = await query(
      `SELECT risk_score AS "riskScore", risk_level AS "riskLevel",
              liquidity, price, recorded_at AS "at"
       FROM risk_snapshots
       WHERE lower(address) = lower($1)
         AND recorded_at > NOW() - ($2 * INTERVAL '1 hour')
       ORDER BY recorded_at ASC
       LIMIT 200`,
      [addr, h]
    );
    return r.rows;
  } catch (e) {
    console.error('[store] getRiskHistory:', e.message);
    return [];
  }
}



async function getProPortfolioWatch() {
  try {
    const r = await query(
      `SELECT u.id, u.email, u.plan, u.telegram_chat_id AS "telegramChatId"
       FROM users u
       WHERE lower(COALESCE(u.plan, 'free')) IN ('pro', 'owner', 'admin')
         AND u.telegram_chat_id IS NOT NULL
         AND u.telegram_chat_id <> ''`
    );
    const out = [];
    for (const row of r.rows) {
      const positions = await query(
        `SELECT address, symbol, name, chain_id AS "chainId",
                last_risk AS "lastRisk", last_liq AS "lastLiq", last_price AS "lastPrice"
         FROM portfolio_positions
         WHERE user_id::text = $1
         LIMIT 50`,
        [String(row.id)]
      );
      if (!positions.rows.length) continue;
      out.push({
        id: row.id,
        email: row.email,
        plan: row.plan,
        telegramChatId: row.telegramChatId,
        positions: positions.rows
      });
    }
    return out;
  } catch (e) {
    console.error('[store] getProPortfolioWatch:', e.message);
    return [];
  }
}

async function getPortfolio(user) {
  const id = uid(user);
  if (!id) return [];
  try {
    const r = await query(
      `SELECT id, address, chain_id AS "chainId", symbol, name, note,
              last_risk AS "lastRisk", last_liq AS "lastLiq", last_price AS "lastPrice",
              added_at AS "addedAt", updated_at AS "updatedAt"
       FROM portfolio_positions WHERE user_id = $1
       ORDER BY last_risk DESC NULLS LAST, id DESC
       LIMIT 100`,
      [id]
    );
    return r.rows;
  } catch (e) {
    console.error('[store] getPortfolio:', e.message);
    return [];
  }
}

async function addPortfolioPosition(user, item) {
  const id = uid(user);
  if (!id || !item || !item.address) return null;
  const address = String(item.address).trim();
  await query(
    `INSERT INTO portfolio_positions
      (user_id, address, chain_id, symbol, name, note, last_risk, last_liq, last_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, address) DO UPDATE SET
       symbol = COALESCE(EXCLUDED.symbol, portfolio_positions.symbol),
       name = COALESCE(EXCLUDED.name, portfolio_positions.name),
       chain_id = COALESCE(EXCLUDED.chain_id, portfolio_positions.chain_id),
       note = COALESCE(EXCLUDED.note, portfolio_positions.note),
       last_risk = COALESCE(EXCLUDED.last_risk, portfolio_positions.last_risk),
       last_liq = COALESCE(EXCLUDED.last_liq, portfolio_positions.last_liq),
       last_price = COALESCE(EXCLUDED.last_price, portfolio_positions.last_price),
       updated_at = NOW()
     RETURNING id`,
    [
      id,
      address,
      item.chainId || null,
      item.symbol || null,
      item.name || null,
      item.note || null,
      item.lastRisk != null ? Number(item.lastRisk) : null,
      item.lastLiq != null ? Number(item.lastLiq) : null,
      item.lastPrice != null ? Number(item.lastPrice) : null
    ]
  );
  return true;
}

async function removePortfolioPosition(user, address) {
  const id = uid(user);
  if (!id || !address) return;
  await query(
    `DELETE FROM portfolio_positions WHERE user_id = $1 AND lower(address) = lower($2)`,
    [id, String(address)]
  );
}

async function updatePortfolioSnapshot(user, address, snap) {
  const id = uid(user);
  if (!id || !address) return;
  await query(
    `UPDATE portfolio_positions SET
       last_risk = COALESCE($3, last_risk),
       last_liq = COALESCE($4, last_liq),
       last_price = COALESCE($5, last_price),
       symbol = COALESCE($6, symbol),
       name = COALESCE($7, name),
       chain_id = COALESCE($8, chain_id),
       updated_at = NOW()
     WHERE user_id = $1 AND lower(address) = lower($2)`,
    [
      id,
      String(address),
      snap.riskScore != null ? Number(snap.riskScore) : null,
      snap.liquidity != null ? Number(snap.liquidity) : null,
      snap.price != null ? Number(snap.price) : null,
      snap.symbol || null,
      snap.name || null,
      snap.chainId || null
    ]
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
  try {
    const r = await query(
      `SELECT address, symbol, name,
              COALESCE(added_at, NOW()) AS "createdAt"
       FROM watchlist WHERE user_id = $1
       ORDER BY id DESC`,
      [id]
    );
    return r.rows;
  } catch (e) {
    try {
      const r = await query(
        `SELECT address, symbol, name FROM watchlist WHERE user_id = $1 ORDER BY id DESC`,
        [id]
      );
      return r.rows;
    } catch (e2) {
      console.error('[store] getWatchlist:', e2.message);
      return [];
    }
  }
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
  await query(`DELETE FROM watchlist WHERE user_id = $1 AND address = $2`, [
    id,
    address
  ]);
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
  await query(
    `DELETE FROM alerts WHERE user_id = $1 AND id::text = $2::text`,
    [id, String(alertId)]
  );
  return { success: true };
}

async function getTelegramChatId(user) {
  const id = uid(user);
  if (!id) return null;
  const r = await query(
    `SELECT telegram_chat_id FROM users WHERE id = $1::integer`,
    [id]
  );
  return r.rows[0]?.telegram_chat_id || null;
}

async function linkTelegram(user, chatId) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(
    `UPDATE users SET telegram_chat_id = $1 WHERE id = $2::integer`,
    [String(chatId), id]
  );
  return { success: true };
}

async function unlinkTelegram(user) {
  const id = uid(user);
  if (!id) return { success: false };
  await query(`UPDATE users SET telegram_chat_id = NULL WHERE id = $1::integer`, [
    id
  ]);
  return { success: true };
}

async function getDigestUsers() {
  return getUsersWithTelegram();
}

async function getUsersWithTelegram() {
  try {
    const r = await query(
      `SELECT id, email, plan, telegram_chat_id AS "telegramChatId"
       FROM users
       WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''`
    );
    return r.rows;
  } catch (e) {
    console.error('[store] getUsersWithTelegram:', e.message);
    return [];
  }
}

async function getAllAlertUsers() {
  try {
    const r = await query(
      `SELECT DISTINCT u.id, u.email, u.plan, u.telegram_chat_id AS "telegramChatId"
       FROM users u
       INNER JOIN alerts a ON a.user_id::text = u.id::text
       WHERE u.telegram_chat_id IS NOT NULL
         AND u.telegram_chat_id <> ''`
    );
    const users = [];
    for (const row of r.rows) {
      const alertsRes = await query(
        `SELECT id, type, address, symbol, value, active
         FROM alerts WHERE user_id::text = $1 AND (active IS NULL OR active = TRUE)`,
        [String(row.id)]
      );
      users.push({
        id: row.id,
        email: row.email,
        plan: row.plan || 'free',
        telegramChatId: row.telegramChatId,
        alerts: alertsRes.rows || []
      });
    }
    return users;
  } catch (e) {
    console.error('[store] getAllAlertUsers:', e.message);
    return [];
  }
}

async function wasAlertFired(user, alertId) {
  const id = uid(user);
  if (!id || !alertId) return false;
  try {
    const r = await query(
      `SELECT 1 FROM fired_alerts WHERE user_id = $1 AND alert_id = $2 LIMIT 1`,
      [String(id), String(alertId)]
    );
    return r.rows.length > 0;
  } catch (e) {
    return false;
  }
}

async function markAlertFired(user, alertId) {
  const id = uid(user);
  if (!id || !alertId) return;
  try {
    await query(
      `INSERT INTO fired_alerts (user_id, alert_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [String(id), String(alertId)]
    );
  } catch (e) {
    console.warn('[store] markAlertFired', e.message);
  }
}

async function addWaitlist(email, plan) {
  await query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      plan TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `INSERT INTO waitlist (email, plan) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan`,
    [email, plan || 'premium']
  );
  return true;
}

module.exports = {
  findUserByEmail,
  findUserByTelegramId,
  createUser,
  createUserFromTelegram,
  verifyPassword,
  updateUserPlan,
  canScan,
  incrementScan,
  addHistory,
  getHistory,
  addRiskSnapshot,
  getRiskHistory,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getAlerts,
  addAlert,
  removeAlert,
  getTelegramChatId,
  linkTelegram,
  unlinkTelegram,
  getUsersWithTelegram,
  getAllAlertUsers,
  getDigestUsers,
  wasAlertFired,
  markAlertFired,
  addWaitlist,
  getPortfolio,
  addPortfolioPosition,
  removePortfolioPosition,
  updatePortfolioSnapshot,
  getProPortfolioWatch
};
