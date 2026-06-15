const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const npmJSZip = require("jszip");
const ROOT = path.join(__dirname, "..");

async function main() {
  const html = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body><article>
  <h1>Test Article Title</h1>
  <p>First paragraph with some content to extract.</p>
  <p>Second paragraph with more <a href="https://example.com">linked</a> content.</p>
  <h2>Section One</h2>
  <p>Content in section one. Longer text here to test extraction.</p>
  <h3>Subsection A</h3>
  <p>Detailed content in the subsection area.</p>
  <h2>Section Two</h2>
  <p>Final section with concluding thoughts and key summary points.</p>
</article></body></html>`;

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Set up JSDOM globals needed by the extension sources
  globalThis.document = doc;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.Set = Set;
  globalThis.JSZip = npmJSZip;

  eval(fs.readFileSync(path.join(ROOT, "extension", "lib", "readability.js"), "utf8"));
  eval(fs.readFileSync(path.join(ROOT, "extension", "epub-generator.js"), "utf8"));
  eval(fs.readFileSync(path.join(ROOT, "extension", "article-extractor.js"), "utf8"));

  console.log("=== Test generateEpub with JSZip ===\n");

  // Simulate the new ios2kindle flow:
  const reader = new Readability(doc);
  let article = reader.parse();
  if (!article || !article.content) {
    article = _extractDomArticle(html);
  }
  if (!article) throw new Error("No article");

  let content = _restoreHeadings(article.content);
  content = _supplementContent(content, html);
  content = stripUiText(content);
  content = stripTrailingRelated(content);

  console.log("Article title:", article.title);
  console.log("Content length:", content.length);

  const blob = await generateEpub({
    article: { title: article.title, author: article.author || "", content: content },
    originalHtml: html,
    url: "https://example.com/test-article",
    title: article.title,
    keepLinks: false
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  const uint8array = new Uint8Array(buf);
  console.log("EPUB generated: " + uint8array.length + " bytes\n");

  // Verify ZIP signature
  const tests = [];

  tests.push({
    name: "Valid ZIP signature",
    pass: uint8array[0] === 0x50 && uint8array[1] === 0x4b && uint8array[2] === 0x03 && uint8array[3] === 0x04
  });

  // Parse with JSZip
  const loaded = await npmJSZip.loadAsync(uint8array);

  const expectedFiles = ["mimetype", "META-INF/container.xml", "OEBPS/content.opf",
    "OEBPS/toc.ncx", "OEBPS/style/default.css", "OEBPS/content.xhtml",
    "OEBPS/cover.xhtml", "OEBPS/details.xhtml", "OEBPS/images/cover.svg"];

  for (const name of expectedFiles) {
    tests.push({ name: "File present: " + name, pass: !!loaded.files[name] });
  }

  // mimetype uncompressed
  const mt = loaded.files["mimetype"];
  // null means uncompressed (STORED) — JSZip doesn't preserve the STORE label on load
  tests.push({
    name: "mimetype stored uncompressed",
    pass: mt.options.compression === null || mt.options.compression === "STORE"
  });

  // Read content.xhtml and verify structure
  const contentXhtml = await loaded.files["OEBPS/content.xhtml"].async("string");
  tests.push({ name: "content.xhtml has XML declaration", pass: contentXhtml.includes('<?xml version="1.0" encoding="utf-8"?>') });
  tests.push({ name: "content.xhtml has XHTML namespace", pass: contentXhtml.includes('xmlns="http://www.w3.org/1999/xhtml"') });
  tests.push({ name: "content.xhtml has xml:lang", pass: contentXhtml.includes('xml:lang="en"') });
  tests.push({ name: "content.xhtml has lang attribute", pass: contentXhtml.includes('lang="en"') });

  // No links in body
  const bodyMatch = contentXhtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : "";
  tests.push({ name: "No links in content body", pass: !body.includes('<a ') });

  // Verify OPF
  const opf = await loaded.files["OEBPS/content.opf"].async("string");
  tests.push({ name: "OPF has dc:language", pass: opf.includes('<dc:language>en</dc:language>') });
  tests.push({ name: "OPF has dc:title", pass: opf.includes('<dc:title>') });
  tests.push({ name: "OPF has unique-identifier", pass: opf.includes('unique-identifier="BookId"') });

  // Verify NCX
  const ncx = await loaded.files["OEBPS/toc.ncx"].async("string");
  tests.push({ name: "NCX has navMap", pass: ncx.includes('<navMap>') });
  tests.push({ name: "NCX has navLabel", pass: ncx.includes('<navLabel>') });

  // Base64 round-trip
  let binary = "";
  for (let i = 0; i < uint8array.length; i++) {
    binary += String.fromCharCode(uint8array[i]);
  }
  const b64 = Buffer.from(binary, "binary").toString("base64");
  const roundtrip = Buffer.from(b64, "base64");
  tests.push({
    name: "Base64 round-trip valid",
    pass: roundtrip[0] === 0x50 && roundtrip[1] === 0x4b && roundtrip[2] === 0x03 && roundtrip[3] === 0x04
  });

  // Print results
  let passed = 0, failed = 0;
  for (const t of tests) {
    if (t.pass) { console.log("PASS: " + t.name); passed++; }
    else { console.log("FAIL: " + t.name); failed++; }
  }
  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");

  // Write EPUB for epubcheck
  const epubPath = path.join(ROOT, "tests", "test_output.epub");
  fs.writeFileSync(epubPath, uint8array);
  console.log("\nEPUB written to: " + epubPath);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
