let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

async function main() {
  await test("builds MIME message with EPUB attachment", async () => {
    const { buildKindleMessage } = require("../lib/smtp-sender");

    const epubBuffer = Buffer.from("EPUB_CONTENT_PLACEHOLDER");
    const message = buildKindleMessage({
      from: "noreply@web2kindle.com",
      to: "user123@kindle.com",
      epubBuffer,
      filename: "article.epub"
    });

    if (!message.includes("From: noreply@web2kindle.com")) throw new Error("missing From");
    if (!message.includes("To: user123@kindle.com")) throw new Error("missing To");
    if (!message.includes('Subject: =?UTF-8?B?Y29udmVydA==')) throw new Error("missing Subject: convert");
    if (!message.includes("MIME-Version: 1.0")) throw new Error("missing MIME-Version");
    if (!message.includes('Content-Type: multipart/mixed')) throw new Error("missing multipart/mixed");
    if (!message.includes('name="article.epub"')) throw new Error("missing attachment name");
    if (!message.includes("Content-Transfer-Encoding: base64")) throw new Error("missing base64 encoding");
    if (!message.includes("application/epub+zip")) throw new Error("missing epub mime type");
  });

  await test("message is valid RFC 2822 format", async () => {
    const { buildKindleMessage } = require("../lib/smtp-sender");

    const message = buildKindleMessage({
      from: "noreply@web2kindle.com",
      to: "user@kindle.com",
      epubBuffer: Buffer.from("test"),
      filename: "test.epub"
    });

    if (!message.includes("\r\n\r\n")) throw new Error("missing header/body separator");
    const bareLF = message.replace(/\r\n/g, "").includes("\n");
    if (bareLF) throw new Error("contains bare LF without CR");
  });

  await test("epub buffer is base64 encoded in message", async () => {
    const { buildKindleMessage } = require("../lib/smtp-sender");

    const epubContent = "Hello, Kindle!";
    const epubBuffer = Buffer.from(epubContent);
    const message = buildKindleMessage({
      from: "noreply@test.com",
      to: "test@kindle.com",
      epubBuffer,
      filename: "hello.epub"
    });

    const expectedB64 = epubBuffer.toString("base64");
    if (!message.includes(expectedB64)) throw new Error("base64 content not found in message");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
