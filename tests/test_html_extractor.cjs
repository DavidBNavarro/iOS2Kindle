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

const { extractNewsletterContent } = require("../lib/html-extractor.cjs");

test("extracts basic HTML content", () => {
  const html = "<html><body><h1>Newsletter Title</h1><p>Hello world</p><p>More text</p></body></html>";
  const result = extractNewsletterContent(html);
  if (!result.content.includes("<h1>Newsletter Title</h1>")) throw new Error("h1 lost");
  if (!result.content.includes("<p>Hello world</p>")) throw new Error("paragraph lost");
});

test("strips style tags", () => {
  const html = "<html><head><style>body{color:red}</style></head><body><p>Hi</p></body></html>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("<style")) throw new Error("style not stripped");
});

test("strips inline styles", () => {
  const html = "<p style='color:red;font-size:20px'>Styled text</p>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("style=")) throw new Error("inline style not stripped");
});

test("strips tracking pixels (1x1 images)", () => {
  const html = "<body><p>Content</p><img src='https://track.newsletter.com/open.gif' width='1' height='1'></body>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("track.newsletter.com")) throw new Error("tracking pixel not removed");
});

test("strips unsubscribe links", () => {
  const html = "<body><p>Content</p><a href='https://news.com/unsub'>Unsubscribe</a></body>";
  const result = extractNewsletterContent(html);
  if (result.content.includes("unsub")) throw new Error("unsubscribe link not stripped");
});

test("strips 'view in browser' links", () => {
  const html = "<body><p><a href='https://news.com/view'>View this email in your browser</a></p><p>Real content</p></body>";
  const result = extractNewsletterContent(html);
  if (result.content.toLowerCase().includes("view")) throw new Error("view-in-browser link not stripped");
  if (!result.content.includes("Real content")) throw new Error("real content lost");
});

test("preserves article content after stripping", () => {
  const html = `
    <html><body>
      <p style="color:#333">View this email in your browser</p>
      <hr>
      <h1>Issue #42: Important News</h1>
      <p>First paragraph of real content.</p>
      <p>Second paragraph with a <a href="https://example.com/article">link</a>.</p>
      <blockquote>A relevant quote</blockquote>
      <hr>
      <p style="font-size:10px">Unsubscribe | Manage preferences</p>
      <img src="https://track.news.com/pixel.gif" width="1" height="1">
    </body></html>`;

  const result = extractNewsletterContent(html);
  if (!result.content.includes("Important News")) throw new Error("title lost");
  if (!result.content.includes("First paragraph")) throw new Error("content lost");
  if (!result.content.includes("<a href=")) throw new Error("links lost");
  if (!result.content.includes("<blockquote>")) throw new Error("blockquote lost");
});

test("returns title extracted from h1", () => {
  const html = "<body><h1>My Newsletter</h1><p>Content</p></body>";
  const result = extractNewsletterContent(html);
  if (!result.title) throw new Error("no title");
  if (result.title !== "My Newsletter") throw new Error("title mismatch: " + result.title);
});

test("returns author from sender info", () => {
  const html = "<body><p>Content</p></body>";
  const senderName = "Tech Weekly Digest";
  const result = extractNewsletterContent(html, { senderName });
  if (result.author !== "Tech Weekly Digest") throw new Error("author mismatch");
});

console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
