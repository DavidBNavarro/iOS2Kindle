let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " — " + e.message);
    failed++;
  }
}

const { parseSendGridWebhook } = require("../lib/email-parser");

test("extracts from, to, subject from SendGrid payload", () => {
  const payload = {
    from: "sender@newsletter.com",
    to: "wk-abc123@inbound.web2kindle.com",
    subject: "Weekly Digest #42",
    html: "<html><body><p>Hello world</p></body></html>"
  };
  const result = parseSendGridWebhook(payload);
  if (result.from !== "sender@newsletter.com") throw new Error("from mismatch");
  if (result.to !== "wk-abc123@inbound.web2kindle.com") throw new Error("to mismatch");
  if (result.subject !== "Weekly Digest #42") throw new Error("subject mismatch");
  if (result.html !== "<html><body><p>Hello world</p></body></html>") throw new Error("html mismatch");
});

test("extracts forwarding address from 'to' field", () => {
  const payload = { from: "x@x.com", to: "wk-xyz789@inbound.web2kindle.com", subject: "Test", html: "<p>Hi</p>" };
  const result = parseSendGridWebhook(payload);
  if (result.forwardingAddress !== "wk-xyz789@inbound.web2kindle.com") {
    throw new Error("forwardingAddress mismatch: " + result.forwardingAddress);
  }
});

test("prefers HTML body over text", () => {
  const payload = { from: "x@x.com", to: "wk-test@inbound.test", subject: "Test", html: "<p>HTML version</p>", text: "Plain text version" };
  const result = parseSendGridWebhook(payload);
  if (result.body !== "<p>HTML version</p>") throw new Error("should prefer HTML");
  if (result.bodyType !== "html") throw new Error("bodyType should be html");
});

test("falls back to text when no HTML", () => {
  const payload = { from: "x@x.com", to: "wk-test@inbound.test", subject: "Plain", text: "Just plain text" };
  const result = parseSendGridWebhook(payload);
  if (result.body !== "Just plain text") throw new Error("should use text fallback");
  if (result.bodyType !== "text") throw new Error("bodyType should be text");
});

test("extracts sender name and email from from field", () => {
  const payload = { from: "Jane's Newsletter <jane@news.com>", to: "wk-test@inbound.test", subject: "Hi", html: "<p>Content</p>" };
  const result = parseSendGridWebhook(payload);
  if (result.senderName !== "Jane's Newsletter") throw new Error("senderName mismatch: " + result.senderName);
  if (result.senderEmail !== "jane@news.com") throw new Error("senderEmail mismatch: " + result.senderEmail);
});

test("handles bare email (no name)", () => {
  const payload = { from: "jane@news.com", to: "wk-test@inbound.test", subject: "Hi", html: "<p>Content</p>" };
  const result = parseSendGridWebhook(payload);
  if (result.senderEmail !== "jane@news.com") throw new Error("bare email mismatch");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
