const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');
const { initDatabase } = require('./init-db');

// ─── Config ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const BULK_API = 'https://exchange-api.bulk.trade/api/v1';
const BULK_WS = 'wss://exchange-ws1.bulk.trade';

let db;

// ─── Express App ───────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Time helpers
const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// API: Global stats
app.get('/api/stats', async (req, res) => {
  try {
    const dayAgo = now() - DAY_MS;
    const weekAgo = now() - WEEK_MS;

    const usersToday = (await db.get('SELECT COUNT(DISTINCT user_address) as count FROM trades WHERE timestamp >= ?', [dayAgo])).count;
    const usersWeek = (await db.get('SELECT COUNT(DISTINCT user_address) as count FROM trades WHERE timestamp >= ?', [weekAgo])).count;
    const usersTotal = (await db.get('SELECT COUNT(*) as count FROM users')).count;
    const volumeToday = (await db.get('SELECT SUM(volume) as total FROM trades WHERE timestamp >= ?', [dayAgo])).total || 0;
    const volumeWeek = (await db.get('SELECT SUM(volume) as total FROM trades WHERE timestamp >= ?', [weekAgo])).total || 0;

    res.json({
      users: { today: usersToday, week: usersWeek, total: usersTotal },
      volume: { today: volumeToday, week: volumeWeek },
      lastUpdate: now()
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const period = req.query.period || 'day';
    let data;

    if (period === 'all') {
      data = await db.all('SELECT address as user_address, total_trades as trade_count, total_volume, last_seen as last_trade FROM users ORDER BY total_volume DESC LIMIT 50');
    } else {
      const since = period === 'week' ? now() - WEEK_MS : now() - DAY_MS;
      data = await db.all(`
        SELECT user_address, COUNT(*) as trade_count, SUM(volume) as total_volume, MAX(timestamp) as last_trade
        FROM trades 
        WHERE timestamp >= ?
        GROUP BY user_address
        ORDER BY total_volume DESC
        LIMIT 50
      `, [since]);
    }

    res.json({
      period,
      traders: data.map((t, i) => ({
        rank: i + 1,
        address: t.user_address,
        tradeCount: t.trade_count,
        totalVolume: t.total_volume,
        lastTrade: t.last_trade
      }))
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/overview', async (req, res) => {
  try {
    const response = await fetch(`${BULK_API}/stats`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.json({ error: 'Could not fetch stats' });
  }
});

// ─── WebSocket Collector ──────────────────────────────────────
function connectWebSocket() {
  console.log('🔌 Connecting to Bulk WS...');
  const ws = new WebSocket(BULK_WS);

  ws.on('open', () => {
    console.log('✅ WS Connected');
    // Subscribe to major pairs
    const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ARB-USD', 'OP-USD', 'TIA-USD'];
    const sub = {
      method: "subscribe",
      subscription: symbols.map(s => ({ type: "trades", symbol: s }))
    };
    ws.send(JSON.stringify(sub));

    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: "ping" }));
    }, 20000);

    ws.on('close', () => clearInterval(pingInterval));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.channel === 'trades' && msg.data) {
        for (const trade of msg.data) {
          const user = trade.u;
          const vol = parseFloat(trade.px || 0) * parseFloat(trade.sz || 0);
          const time = trade.t || now();
          const tid = trade.i || `tid_${now()}_${Math.random()}`;

          // Save to DB
          await db.run('INSERT OR IGNORE INTO trades (user_address, coin, side, price, size, volume, timestamp, trade_id) VALUES (?,?,?,?,?,?,?,?)',
            [user, trade.s || '', trade.side ? 'long' : 'short', trade.px || 0, trade.sz || 0, vol, time, tid]);
          
          await db.run(`INSERT INTO users (address, first_seen, last_seen, total_trades, total_volume) VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(address) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen), total_trades = total_trades + 1, total_volume = total_volume + excluded.total_volume`,
            [user, time, time, vol]);
        }
      }
    } catch (e) {}
  });

  ws.on('error', (err) => console.error('WS Error:', err.message));
  ws.on('close', () => {
    console.log('⚠️ WS Closed. Reconnecting in 10s...');
    setTimeout(connectWebSocket, 10000);
  });
}

// ─── Backfill worker ──────────────────────────────────────────
async function backfillWorker() {
  try {
    const user = await db.get('SELECT address FROM users WHERE backfilled = 0 LIMIT 1');
    if (user) {
      console.log(`🔄 Backfilling ${user.address.slice(0,8)}...`);
      const res = await fetch(`${BULK_API}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fills', user: user.address })
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const f of data) {
          const vol = parseFloat(f.px || 0) * parseFloat(f.sz || 0);
          await db.run('INSERT OR IGNORE INTO trades (user_address, coin, side, price, size, volume, timestamp, trade_id) VALUES (?,?,?,?,?,?,?,?)',
            [user.address, f.coin||'', f.side||'', f.px||0, f.sz||0, vol, f.time||0, f.id||Math.random()]);
        }
      }
      await db.run('UPDATE users SET backfilled = 1 WHERE address = ?', [user.address]);
    }
  } catch (e) {}
  setTimeout(backfillWorker, 15000);
}

// ─── Start ─────────────────────────────────────────────────────
(async () => {
  try {
    db = await initDatabase();
    console.log('✅ Database Ready');
    app.listen(PORT, () => {
      console.log(`🚀 Server on http://localhost:${PORT}`);
      connectWebSocket();
      backfillWorker();
    });
  } catch (err) {
    console.error('Failed to start:', err);
  }
})();
