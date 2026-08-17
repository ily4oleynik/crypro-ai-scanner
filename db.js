// backend/db.js
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'crypto_scanner'
      }
);

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
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      address TEXT NOT NULL,
      symbol TEXT,
      value DOUBLE PRECISION NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS telegram_links (
      user_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fired_alerts (
      user_id TEXT NOT NULL,
      alert_id TEXT NOT NULL,
      PRIMARY KEY (user_id, alert_id)
    );
  `);

  await query(`
    INSERT INTO users (id, email, password, plan) VALUES
      (1, 'demo@test.com', 'demo123', 'free'),
      (2, 'premium@test.com', 'premium123', 'premium'),
      (3, 'pro@test.com', 'pro123', 'pro')
    ON CONFLICT (email) DO NOTHING;
  `);

  await query(`
    SELECT setval(
      pg_get_serial_sequence('users', 'id'),
      (SELECT COALESCE(MAX(id), 1) FROM users)
    );
  `);

  console.log('[DB] PostgreSQL ready');
}

module.exports = { pool, query, initDb };