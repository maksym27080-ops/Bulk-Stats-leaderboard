const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/Users/Lenovo/Desktop/bulk-leaderboard/leaderboard.db');
db.get('SELECT COUNT(*) as count FROM trades', (err, row) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('Trade count:', row.count);
  }
  db.close();
});
