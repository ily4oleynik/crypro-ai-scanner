const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
    })
  : new Pool({
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'crypto_scanner'
    });

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      telegram_chat_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS scan_usage (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS scan_history (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      price DOUBLE PRECISION,
      risk_score INTEGER,
      plan TEXT,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, address)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT,
      value DOUBLE PRECISION NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fired_alerts (
      user_id TEXT NOT NULL,
      alert_id TEXT NOT NULL,
      PRIMARY KEY (user_id, alert_id)
    );
  `);

  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT;
  `);

  // unique telegram_id (ignore if already exists)
  try {
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_uidx
       ON users (telegram_id)
       WHERE telegram_id IS NOT NULL AND telegram_id <> ''`
    );
  } catch (e) {
    console.warn('[DB] telegram_id index:', e.message);
  }

  // TG-only users may have placeholder password
  try {
    await query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
  } catch (e) {
    /* older PG or already nullable */
  }

  console.log('[DB] PostgreSQL ready');
}

module.exports = { pool, query, initDb };
