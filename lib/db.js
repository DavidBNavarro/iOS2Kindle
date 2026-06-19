const crypto = require("crypto");
const { createClient } = require("@libsql/client");

let _client = null;

function getDb() {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url || !token) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
    }
    _client = createClient({ url, authToken: token });
  }
  return _client;
}

async function ensureSchema(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key TEXT UNIQUE NOT NULL,
    kindle_email TEXT NOT NULL,
    forwarding_address TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    year_month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    source_type TEXT NOT NULL,
    UNIQUE(user_id, year_month, source_type)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS send_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    url TEXT,
    source_type TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  )`);
}

function generateApiKey() {
  const bytes = crypto.randomBytes(12).toString("hex");
  return "w2k_" + bytes;
}

function generateForwardingAddress() {
  const slug = crypto.randomBytes(4).toString("hex");
  const domain = process.env.INBOUND_DOMAIN || "inbound.web2kindle.com";
  return "wk-" + slug + "@" + domain;
}

function generateUserId() {
  return crypto.randomUUID();
}

async function createUser(db, kindleEmail) {
  const id = generateUserId();
  const apiKey = generateApiKey();
  const forwardingAddress = generateForwardingAddress();
  await db.execute({
    sql: "INSERT INTO users (id, api_key, kindle_email, forwarding_address) VALUES (?, ?, ?, ?)",
    args: [id, apiKey, kindleEmail, forwardingAddress]
  });
  return { id, api_key: apiKey, forwarding_address: forwardingAddress, kindle_email: kindleEmail };
}

async function getUserByApiKey(db, apiKey) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE api_key = ?",
    args: [apiKey]
  });
  return result.rows[0] || null;
}

async function getUserByForwardingAddress(db, address) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE forwarding_address = ?",
    args: [address]
  });
  return result.rows[0] || null;
}

async function getUserById(db, userId) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [userId]
  });
  return result.rows[0] || null;
}

async function incrementUsage(db, userId, sourceType) {
  const now = new Date();
  const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  await db.execute({
    sql: `INSERT INTO usage (user_id, year_month, count, source_type)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(user_id, year_month, source_type)
          DO UPDATE SET count = count + 1`,
    args: [userId, yearMonth, sourceType]
  });
}

async function getUsage(db, userId, yearMonth) {
  const result = await db.execute({
    sql: "SELECT source_type, count FROM usage WHERE user_id = ? AND year_month = ?",
    args: [userId, yearMonth]
  });
  const usage = {};
  for (const row of result.rows) {
    usage[row.source_type] = row.count;
  }
  return usage;
}

async function addHistory(db, userId, title, url, sourceType) {
  await db.execute({
    sql: "INSERT INTO send_history (user_id, title, url, source_type) VALUES (?, ?, ?, ?)",
    args: [userId, title || null, url || null, sourceType]
  });
}

async function getHistory(db, userId, limit) {
  const result = await db.execute({
    sql: "SELECT * FROM send_history WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?",
    args: [userId, limit || 50]
  });
  return result.rows;
}

async function deleteHistoryEntry(db, userId, entryId) {
  await db.execute({
    sql: "DELETE FROM send_history WHERE id = ? AND user_id = ?",
    args: [entryId, userId]
  });
}

async function updateKindleEmail(db, userId, kindleEmail) {
  await db.execute({
    sql: "UPDATE users SET kindle_email = ? WHERE id = ?",
    args: [kindleEmail, userId]
  });
}

module.exports = {
  getDb, ensureSchema,
  createUser, getUserByApiKey, getUserByForwardingAddress, getUserById,
  incrementUsage, getUsage,
  addHistory, getHistory, deleteHistoryEntry,
  updateKindleEmail
};
