const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './omniflow.db';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL,
    note TEXT,
    targetName TEXT,
    date TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    current REAL DEFAULT 0,
    target REAL NOT NULL,
    isDone INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    title TEXT NOT NULL,
    time TEXT,
    cost REAL,
    tag TEXT
  )`);
});

// IMAP 電子郵件檢查設定 (使用應用程式專用密碼)
const imapConfig = {
  imap: {
    user: process.env.EMAIL_USER || 'YOUR_APP_EMAIL@gmail.com',
    password: process.env.EMAIL_PASSWORD || 'YOUR_APP_PASSWORD',
    host: process.env.EMAIL_HOST || 'imap.gmail.com',
    port: 993,
    tls: true,
    authTimeout: 3000
  }
};

// 解析郵件內文並抓取 HKD 金額
async function checkEmails() {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER.includes('YOUR_APP')) return;
  
  try {
    const connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN']; // 只讀取未讀郵件
    const fetchOptions = { bodies: [''], markSeen: true };
    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const item of messages) {
      const all = item.parts.find(part => part.which === '');
      const parsed = await simpleParser(all.body);
      
      const subject = parsed.subject || 'Receipt Email';
      const text = parsed.text || '';

      // 正則表達式匹配 HKD 格式，例如: HKD $500 或 HKD 500
      const match = text.match(/HKD\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) || subject.match(/HKD\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);

      if (match) {
        const amount = parseFloat(match[1]);
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

        // 自動加入交易記錄
        db.run(
          `INSERT INTO transactions (type, amount, note, targetName, date) VALUES (?, ?, ?, ?, ?)`,
          ['expense', amount, subject, 'Auto Mail Sync', dateStr]
        );
      }
    }
    connection.end();
  } catch (err) {
    console.error("Mail Check Error:", err.message);
  }
}

// 每 10 分鐘自動檢查一次收件匣
setInterval(checkEmails, 10 * 60 * 1000);

// API 路由
app.get('/api/init-data', (req, res) => {
  const data = {};
  db.all('SELECT * FROM transactions ORDER BY id DESC', [], (err, bills) => {
    if (err) return res.status(500).json({ error: err.message });
    data.billsHistory = bills;

    db.all('SELECT * FROM targets', [], (err, targets) => {
      if (err) return res.status(500).json({ error: err.message });
      data.targets = targets.map(t => ({ ...t, isDone: Boolean(t.isDone) }));

      db.all('SELECT * FROM calendar_events', [], (err, events) => {
        if (err) return res.status(500).json({ error: err.message });
        data.events = events;
        res.json(data);
      });
    });
  });
});

app.post('/api/transactions', (req, res) => {
  const { type, amount, note, targetName, date } = req.body;
  db.run(`INSERT INTO transactions (type, amount, note, targetName, date) VALUES (?, ?, ?, ?, ?)`,
    [type, amount, note, targetName, date], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, type, amount, note, targetName, date });
  });
});

app.post('/api/targets', (req, res) => {
  const { title, current, target, isDone } = req.body;
  db.run(`INSERT INTO targets (title, current, target, isDone) VALUES (?, ?, ?, ?)`,
    [title, current || 0, target, isDone ? 1 : 0], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, title, current: current || 0, target, isDone: Boolean(isDone) });
  });
});

app.put('/api/targets/:id', (req, res) => {
  const { current, isDone } = req.body;
  db.run(`UPDATE targets SET current = ?, isDone = ? WHERE id = ?`,
    [current, isDone ? 1 : 0, req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
  });
});

app.delete('/api/targets/:id', (req, res) => {
  db.run(`DELETE FROM targets WHERE id = ?`, req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

app.post('/api/events', (req, res) => {
  const { day, month, year, title, time, cost, tag } = req.body;
  db.run(`INSERT INTO calendar_events (day, month, year, title, time, cost, tag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [day, month, year, title, time, cost, tag], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, day, month, year, title, time, cost, tag });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OmniFlow server running at http://0.0.0.0:${PORT}`);
});