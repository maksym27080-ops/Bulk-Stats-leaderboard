const path = require('path');

/**
 * Initialize the database. Supports local sqlite3 and remote LibSQL (Turso).
 */
async function initDatabase() {
  const isTurso = process.env.TURSO_URL;
  
  if (isTurso) {
    const { createClient } = require('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    
    // Create tables on Turso if they don't exist
    await client.execute(`CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_address TEXT,
      coin TEXT,
      side TEXT,
      price REAL,
      size REAL,
      volume REAL,
      timestamp INTEGER,
      trade_id TEXT UNIQUE
    )`);

    await client.execute(`CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY,
      first_seen INTEGER,
      last_seen INTEGER,
      total_trades INTEGER,
      total_volume REAL,
      backfilled INTEGER DEFAULT 0
    )`);
    
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_address)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(timestamp)`);

    // Wrapper to match a unified Promise API
    return {
      all: async (sql, params) => (await client.execute({ sql, args: params || [] })).rows,
      get: async (sql, params) => (await client.execute({ sql, args: params || [] })).rows[0],
      run: async (sql, params) => await client.execute({ sql, args: params || [] }),
      isLibsql: true
    };
  } else {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'leaderboard.db');
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_address TEXT,
          coin TEXT,
          side TEXT,
          price REAL,
          size REAL,
          volume REAL,
          timestamp INTEGER,
          trade_id TEXT UNIQUE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
          address TEXT PRIMARY KEY,
          first_seen INTEGER,
          last_seen INTEGER,
          total_trades INTEGER,
          total_volume REAL,
          backfilled INTEGER DEFAULT 0
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_address)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(timestamp)`);
        
        resolve({
          all: (sql, params) => new Promise((res, rej) => db.all(sql, params || [], (err, rows) => err ? rej(err) : res(rows))),
          get: (sql, params) => new Promise((res, rej) => db.get(sql, params || [], (err, row) => err ? rej(err) : res(row))),
          run: (sql, params) => new Promise((res, rej) => db.run(sql, params || [], (err) => err ? rej(err) : res())),
          isLibsql: false
        });
      });
    });
  }
}

module.exports = { initDatabase };
