const { createClient } = require("@libsql/client");

// Use in-memory SQLite for tests (no Turso connection needed)
const db = createClient({ url: ":memory:" });

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " \u2014 " + e.message);
    failed++;
  }
}

async function main() {
  // Set up schema
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

  const { createUser, getUserByApiKey, getUserByForwardingAddress,
          incrementUsage, getUsage, addHistory, getHistory } = require("../lib/db.cjs");

  await test("createUser returns user with id, api_key, forwarding_address", async () => {
    const user = await createUser(db, "kindle@example.com");
    if (!user.id) throw new Error("no id");
    if (!user.api_key.startsWith("w2k_")) throw new Error("bad api_key format: " + user.api_key);
    if (!user.forwarding_address.includes("@")) throw new Error("bad forwarding address: " + user.forwarding_address);
    if (user.kindle_email !== "kindle@example.com") throw new Error("kindle_email mismatch");
  });

  await test("getUserByApiKey finds user", async () => {
    const u = await createUser(db, "test2@example.com");
    const found = await getUserByApiKey(db, u.api_key);
    if (!found) throw new Error("user not found by api_key");
    if (found.kindle_email !== "test2@example.com") throw new Error("wrong user");
  });

  await test("getUserByApiKey returns null for bad key", async () => {
    const found = await getUserByApiKey(db, "w2k_nonexistent");
    if (found) throw new Error("should return null");
  });

  await test("getUserByForwardingAddress finds user", async () => {
    const u = await createUser(db, "test3@example.com");
    const found = await getUserByForwardingAddress(db, u.forwarding_address);
    if (!found) throw new Error("user not found");
  });

  await test("incrementUsage creates and increments", async () => {
    const u = await createUser(db, "test4@example.com");
    await incrementUsage(db, u.id, "newsletter");
    await incrementUsage(db, u.id, "newsletter");
    const usage = await getUsage(db, u.id, "2026-06");
    if (usage.newsletter !== 2) throw new Error("expected 2, got " + usage.newsletter);
  });

  await test("addHistory and getHistory work", async () => {
    const u = await createUser(db, "test5@example.com");
    await addHistory(db, u.id, "Test Article", "https://example.com", "newsletter");
    const entries = await getHistory(db, u.id, 10);
    if (entries.length !== 1) throw new Error("expected 1 entry, got " + entries.length);
    if (entries[0].title !== "Test Article") throw new Error("title mismatch");
    if (entries[0].source_type !== "newsletter") throw new Error("source_type mismatch");
  });

  await test("getHistory respects limit", async () => {
    const u = await createUser(db, "test6@example.com");
    for (let i = 0; i < 5; i++) {
      await addHistory(db, u.id, "Article " + i, "https://example.com/" + i, "newsletter");
    }
    const entries = await getHistory(db, u.id, 3);
    if (entries.length !== 3) throw new Error("expected 3, got " + entries.length);
    if (entries[0].title !== "Article 4") throw new Error("wrong order, got " + entries[0].title);
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
