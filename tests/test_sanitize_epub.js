const { sanitizeHtmlForEpub } = require("../lib/sanitize-epub");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
    passed++;
  } catch (e) {
    console.log("FAIL: " + name + " \u2014 " + e.message);
    failed++;
  }
}

test("strips HTML5 semantic tags (unwrap)", () => {
  const input = "<body><article><p>Hello</p></article></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<article")) throw new Error("article tag not stripped");
  if (!result.includes("<p>Hello</p>")) throw new Error("inner content lost");
});

test("strips forbidden elements", () => {
  const input = "<body><p>Hi</p><script>alert(1)</script><iframe src='x'></iframe></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<script")) throw new Error("script not stripped");
  if (result.includes("<iframe")) throw new Error("iframe not stripped");
});

test("strips HTML5 attributes", () => {
  const input = "<body><p aria-label='x' role='main' data-foo='bar' onclick='x'>Hi</p></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("aria-label")) throw new Error("aria not stripped");
  if (result.includes("role=")) throw new Error("role not stripped");
  if (result.includes("data-foo")) throw new Error("data-* not stripped");
  if (result.includes("onclick")) throw new Error("on* not stripped");
});

test("strips id attributes", () => {
  const input = "<body><h1 id='title'>Hi</h1></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("id=")) throw new Error("id not stripped");
});

test("preserves img tags", () => {
  const input = "<body><img src='x.jpg' alt='pic'></body>";
  const result = sanitizeHtmlForEpub(input);
  if (!result.includes("<img ")) throw new Error("img tag lost");
});

test("replaces picture with img child", () => {
  const input = "<body><picture><source srcset='x.webp'><img src='x.jpg'></picture></body>";
  const result = sanitizeHtmlForEpub(input);
  if (result.includes("<picture")) throw new Error("picture not stripped");
  if (!result.includes("<img ")) throw new Error("img lost from picture");
});

test("removes orphan li elements", () => {
  const input = "<body><li>orphan</li><ul><li>valid</li></ul></body>";
  const result = sanitizeHtmlForEpub(input);
  const orphanCount = (result.match(/<li/g) || []).length;
  if (orphanCount !== 1) throw new Error("expected 1 li, got " + orphanCount);
});

test("removes empty ul/ol", () => {
  const input = "<body><ul></ul><ol><li>one</li></ol></body>";
  const result = sanitizeHtmlForEpub(input);
  const ulEmpty = result.includes("<ul></ul>") || result.includes("<ul>\n</ul>");
  if (ulEmpty) throw new Error("empty ul not removed");
  if (!result.includes("<ol>")) throw new Error("non-empty ol removed");
});

test("preserves normal HTML elements", () => {
  const input = "<body><h1>Title</h1><p>Par <b>bold</b> <i>italic</i></p><blockquote cite='x'>Q</blockquote></body>";
  const result = sanitizeHtmlForEpub(input);
  if (!result.includes("<h1>")) throw new Error("h1 lost");
  if (!result.includes("<b>")) throw new Error("b lost");
  if (!result.includes("<i>")) throw new Error("i lost");
  if (!result.includes("<blockquote")) throw new Error("blockquote lost");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
