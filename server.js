const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './omniflow.db';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 初始化 SQLite 資料庫
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log(`Connected to SQLite database at ${DB_PATH}`);
});

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
  const sql = `INSERT INTO transactions (type, amount, note, targetName, date) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [type, amount, note, targetName, date], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, type, amount, note, targetName, date });
  });
});

app.post('/api/targets', (req, res) => {
  const { title, current, target, isDone } = req.body;
  const sql = `INSERT INTO targets (title, current, target, isDone) VALUES (?, ?, ?, ?)`;
  db.run(sql, [title, current || 0, target, isDone ? 1 : 0], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, title, current: current || 0, target, isDone: Boolean(isDone) });
  });
});

app.put('/api/targets/:id', (req, res) => {
  const { current, isDone } = req.body;
  const sql = `UPDATE targets SET current = ?, isDone = ? WHERE id = ?`;
  db.run(sql, [current, isDone ? 1 : 0, req.params.id], function (err) {
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
  const sql = `INSERT INTO calendar_events (day, month, year, title, time, cost, tag) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [day, month, year, title, time, cost, tag], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, day, month, year, title, time, cost, tag });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OmniFlow server running at http://0.0.0.0:${PORT}`);
});