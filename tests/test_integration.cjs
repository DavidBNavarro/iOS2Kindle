const path = require("path");
const ROOT = __dirname;
const db = require(path.join(ROOT, "..", "lib", "db.cjs"));
const { createClient } = require("@libsql/client");

async function main() {
  console.log("=== Integration Test: Newsletter-to-Kindle API flow ===\n");

  // 1. Create an in-memory SQLite db via libsql
  const client = createClient({ url: ":memory:" });
  await db.ensureSchema(client);

  // 2. Register a user
  const user = await db.createUser(client, "test@kindle.com");
  if (!user || !user.api_key || !user.forwarding_address) {
    console.error("FAIL: createUser did not return expected fields");
    process.exit(1);
  }
  console.log(`  ✓ Registered user: ${user.forwarding_address}`);

  // 3. Look up by API key
  const lookup = await db.getUserByApiKey(client, user.api_key);
  if (!lookup || lookup.kindle_email !== "test@kindle.com") {
    console.error("FAIL: getUserByApiKey failed");
    process.exit(1);
  }
  console.log("  ✓ API key lookup works");

  // 4. Record usage
  await db.incrementUsage(client, user.id, "newsletter");
  const now = new Date();
  const yearMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const usage = await db.getUsage(client, user.id, yearMonth);
  if (usage.newsletter !== 1) {
    console.error(`FAIL: expected 1 usage, got ${usage.newsletter}`);
    process.exit(1);
  }
  console.log("  ✓ Usage increment works");

  // 5. Record history
  await db.addHistory(client, user.id, "Test Newsletter", "test-article", "newsletter");
  await db.addHistory(client, user.id, "Second Newsletter", "test-article-2", "newsletter");
  const history = await db.getHistory(client, user.id, 10);
  if (history.length !== 2 || history[0].title !== "Second Newsletter") {
    console.error(`FAIL: expected 2 history entries (newest first), got ${history.length}`);
    process.exit(1);
  }
  console.log("  ✓ History recording works");
  console.log("  ✓ History order (newest first)");

  // 6. Delete history
  await db.deleteHistoryEntry(client, user.id, history[1].id);
  const remaining = await db.getHistory(client, user.id, 10);
  if (remaining.length !== 1) {
    console.error(`FAIL: expected 1 history entry after delete, got ${remaining.length}`);
    process.exit(1);
  }
  console.log("  ✓ History deletion works");

  console.log(`\n  All 6 integration checks passed.`);
}

main().catch(err => { console.error("Test failed:", err); process.exit(1); });
