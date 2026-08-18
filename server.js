const express = require('express');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// 1. 確保 data 資料夾存在並初始化 SQLite 資料庫
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'omniflow.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
    }
});

// 初始化資料庫資料表
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            sender TEXT,
            subject TEXT,
            body TEXT,
            received_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// 2. 解析 IMAP 設定（自動移除密碼空格並忽略 TLS 驗證）
function getImapConfig() {
    const rawPassword = process.env.EMAIL_PASSWORD || '';
    const cleanPassword = rawPassword.replace(/\s+/g, ''); // 清除所有空格

    return {
        imap: {
            user: process.env.EMAIL_USER,
            password: cleanPassword,
            host: process.env.EMAIL_HOST || 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false // 繞過 self-signed certificate 驗證
            },
            authTimeout: 10000
        }
    };
}

// 3. 收信核心邏輯
async function checkEmails() {
    console.log(`[${new Date().toISOString()}] Checking for new unread emails...`);

    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;

    if (!user || !pass) {
        console.error('Mail Check Error: EMAIL_USER or EMAIL_PASSWORD is missing in environment variables.');
        return { success: false, message: 'Missing credentials' };
    }

    let connection;
    try {
        const config = getImapConfig(); // 呼叫 getImapConfig 取得正確設定
        connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // 僅搜尋 UNSEEN（未讀）郵件
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: true // 讀取後將 Gmail 信件標示為已讀
        };

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} unread email(s).`);

        let fetchedCount = 0;

        for (const item of messages) {
            const allParts = item.parts.find(part => part.which === '');
            const id = item.attributes.uid;
            const idHeader = "imap-" + id;

            if (allParts && allParts.body) {
                const parsed = await simpleParser(allParts.body);
                const sender = parsed.from ? parsed.from.text : 'Unknown';
                const subject = parsed.subject || '(No Subject)';
                const body = parsed.text || parsed.html || '';
                const messageId = parsed.messageId || idHeader;

                // 將郵件寫入 SQLite
                await new Promise((resolve) => {
                    const stmt = db.prepare(`
                        INSERT OR IGNORE INTO emails (message_id, sender, subject, body)
                        VALUES (?, ?, ?, ?)
                    `);
                    stmt.run(messageId, sender, subject, body, function(err) {
                        if (err) {
                            console.error('Error inserting email to DB:', err.message);
                        } else if (this.changes > 0) {
                            fetchedCount++;
                            console.log(`Saved email: "${subject}" from ${sender}`);
                        }
                        resolve();
                    });
                    stmt.finalize();
                });
            }
        }

        connection.end();
        console.log(`Email check completed. ${fetchedCount} new email(s) processed.`);
        return { success: true, count: fetchedCount };

    } catch (error) {
        console.error('Mail Check Error:', error.message || error);
        if (connection) {
            try { connection.end(); } catch (e) {}
        }
        return { success: false, error: error.message };
    }
}

// 4. API 路由定義

// 前端初始化載入點 (適應前端 /api/init-data 請求)
app.get('/api/init-data', (req, res) => {
    db.all('SELECT * FROM emails ORDER BY received_at DESC', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({
            success: true,
            emails: rows,
            bills: rows,
            transactions: [],
            targets: []
        });
    });
});

// GET /api/emails - 取得已存入資料庫的信件列表
app.get('/api/emails', (req, res) => {
    db.all('SELECT * FROM emails ORDER BY received_at DESC', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, emails: rows, data: rows });
    });
});

// POST /api/check-email - 手動觸發檢查郵件
app.post('/api/check-email', async (req, res) => {
    const result = await checkEmails();
    res.json(result);
});

// 5. 啟動伺服器與設定自動輪詢
app.listen(PORT, '0.0.0.0', () => {
    console.log(`OmniFlow server running at http://0.0.0.0:${PORT}`);

    // 啟動時立即執行一次收信
    checkEmails();

    // 設定定時器：每 60 秒自動檢查一次新郵件
    setInterval(() => {
        checkEmails();
    }, 60000);
});