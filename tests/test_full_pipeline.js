// Comprehensive test that simulates exact Scriptable flow:
// - eval(bundleCode) in non-Node env (no setImmediate, no module/exports in main)
// - WebView-based content processing (DOMParser available)  
// - Custom ZIP builder in main context (DOMParser NOT available)
// - Validates EPUB output with JSZip (npm) for structural verification
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const npmJSZip = require("jszip");
const ROOT = path.join(__dirname, "..");

// === Test pages ===
const TEST_PAGES = [
  {
    name: "simple article",
    html: `<!DOCTYPE html>
<html><head><title>Simple Article</title></head>
<body><article>
  <h1>Simple Article Title</h1>
  <p>First paragraph with content to extract.</p>
  <p>Second with <a href="https://example.com">linked</a> text.</p>
  <h2>Section One</h2>
  <p>Section one content.</p>
  <h3>Subsection A</h3>
  <p>Subsection content here.</p>
</article></body></html>`
  },
  {
    name: "emoji in content",
    html: `<!DOCTYPE html>
<html><head><title>Emoji Test 😀</title></head>
<body><article>
  <h1>Emoji Test 🔥 Star ⭐ Party 🎉</h1>
  <p>Text with emoji: 😀🎉🔥⭐❤️👋</p>
  <p>More: 🚀💡📚🎯🏆</p>
</article></body></html>`
  },
  {
    name: "special chars",
    html: `<!DOCTYPE html>
<html><head><title>Special: ñ ü ö ß</title></head>
<body><article>
  <h1>Café résumé piñata München</h1>
  <p>UTF-8 chars: ñ Ñ á é í ó ú Á É Í Ó Ú ü Ü ö Ö ß</p>
  <p>Symbols: © ® ™ £ € ¥ § ¶ † ‡ • ·</p>
  <p>Math: ∑ ∫ ∂ √ ∞ ≈ ≠ ≤ ≥ ± × ÷</p>
</article></body></html>`
  },
  {
    name: "surrogate pairs",
    html: `<!DOCTYPE html>
<html><head><title>Surrogate Pairs</title></head>
<body><article>
  <h1>Music: 𝄞 𝄟 𝄠 (clefs)</h1>
  <p>Gothic: 𐌰 𐌱 𐌲 (futhark)</p>
  <p>Mesoamerican: 𒀀 𒀁 𒀂 (cuneiform)</p>
</article></body></html>`
  }
];

async function testPage(testPage) {
  const dom = new JSDOM(testPage.html);
  const doc = dom.window.document;

  // === Phase 1: eval(bundleCode) in Scriptable-like env ===
  // In Scriptable: no DOMParser/XMLSerializer/setImmediate in main context
  // We delete them after phase 1.
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  globalThis.DOMTokenList = dom.window.DOMTokenList;
  globalThis.document = doc;
  globalThis.Set = Set;

  const bundleCode = fs.readFileSync(path.join(ROOT, "ios", "bundle.js"), "utf8");
  eval(bundleCode);

  // Verify helpers loaded
  const required = ["Readability", "_restoreHeadings", "_supplementContent", "stripUiText",
    "stripTrailingRelated", "_sanitizeHtmlForEpub", "_sanitizeKindleText", "_KINDLE_CSS",
    "_containerXml", "_contentOpf", "_tocNcx", "_uuid", "_esc", "_epubXmlHeader"];
  const missing = required.filter(k => typeof eval(k) === "undefined");
  if (missing.length > 0) {
    return { pass: false, name: testPage.name, errors: [`Missing globals: ${missing.join(", ")}`] };
  }

  // === Phase 2: Content processing via DOMParser/Readability ===
  // This runs inside WebView in Scriptable (DOMParser available)
  var wvDoc = new DOMParser().parseFromString(testPage.html, "text/html");
  var wvReader = new Readability(wvDoc);
  var wvArticle = wvReader.parse();
  if (!wvArticle || !wvArticle.content) {
    wvArticle = _extractDomArticle(testPage.html);
  }
  if (!wvArticle) {
    return { pass: false, name: testPage.name, errors: ["Readability failed to extract article"] };
  }

  var c = _restoreHeadings(wvArticle.content || "");
  c = _supplementContent(c, testPage.html);
  c = stripUiText(c);
  c = stripTrailingRelated(c);
  c = _sanitizeHtmlForEpub(c);
  c = c.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");

  var cd = new DOMParser().parseFromString(c, "text/html");
  var emptyLists = cd.querySelectorAll("ul,ol");
  for (var li = emptyLists.length - 1; li >= 0; li--) {
    var lst = emptyLists[li];
    if (lst.parentNode && !lst.querySelector("li")) lst.parentNode.removeChild(lst);
  }

  var existingIds = cd.querySelectorAll("[id]");
  var ids = new Set(["title"]);
  for (var ei = 0; ei < existingIds.length; ei++) ids.add(existingIds[ei].id);

  var hs = cd.querySelectorAll("h1,h2,h3");
  var toc = [];
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i];
    var t = h.textContent.replace(/\s+/g, " ").trim();
    if (!t) continue;
    var s = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var slug = s, n = 1;
    while (ids.has(slug)) slug = s + "-" + (++n);
    ids.add(slug);
    h.id = slug;
    toc.push({ text: t, slug: slug, level: parseInt(h.tagName[1]) });
  }

  var ser = new XMLSerializer();
  var bh = ser.serializeToString(cd.body);
  bh = bh.replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "");

  // === Phase 3: EPUB assembly in main context ===
  // Simulate Scriptable main context: NO DOMParser, NO XMLSerializer
  // (setImmediate is kept for the JSZip validation library below)
  delete globalThis.DOMParser;
  delete globalThis.XMLSerializer;
  delete globalThis.document;
  delete globalThis.Node;
  delete globalThis.Element;
  delete globalThis.DOMTokenList;

  var title = _sanitizeKindleText(wvArticle.title);
  var author = _sanitizeKindleText(wvArticle.author);

  var contentHtml =
    '<body>\n  <h1 id="title">' + _esc(title) + "</h1>\n" +
    (author ? '  <p class="byline">' + _esc(author) + "</p>\n" : "") +
    "  " + bh + "\n</body>";

  var contentXhtml = _epubXmlHeader() +
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n' +
    "<head><title>" + _esc(title) + "</title></head>\n" +
    contentHtml + "\n</html>";

  var navPoints = [{ label: title, src: "content.xhtml#title" }];
  for (var i = 0; i < toc.length; i++) {
    if (toc[i].level <= 2) {
      navPoints.push({ label: _sanitizeKindleText(toc[i].text), src: "content.xhtml#" + toc[i].slug });
    }
  }

  var bookId = _uuid();
  var manifest = [
    { id: "content", href: "content.xhtml", mediaType: "application/xhtml+xml" },
    { id: "css", href: "style/default.css", mediaType: "text/css" },
    { id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
  ];

  var files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: _containerXml() },
    { name: "OEBPS/style/default.css", data: _KINDLE_CSS },
    { name: "OEBPS/content.xhtml", data: contentXhtml },
    { name: "OEBPS/content.opf", data: _contentOpf(title, author, manifest, ["content"], "", bookId) },
    { name: "OEBPS/toc.ncx", data: _tocNcx(title, navPoints, bookId) },
  ];

  function s2b(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) { bytes.push(c); }
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c < 0xd800 || c >= 0xe000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff) {
        i++; var c2 = s.charCodeAt(i);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) { var cp = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000; bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
      }
    }
    var b = new Uint8Array(bytes.length);
    for (var j = 0; j < bytes.length; j++) b[j] = bytes[j];
    return b;
  }

  function crc32(d) {
    var e = 0xffffffff;
    for (var i = 0; i < d.length; i++) { e ^= d[i]; for (var j = 0; j < 8; j++) e = (e >>> 1) ^ (e & 1 ? 0xedb88320 : 0); }
    return (e ^ 0xffffffff) >>> 0;
  }

  var ents = [];
  var loff = 0;
  for (var i = 0; i < files.length; i++) {
    var d = s2b(files[i].data);
    var nb = s2b(files[i].name);
    ents.push({ name: files[i].name, nb: nb, d: d, crc: crc32(d), hs: 30 + nb.length, lo: loff });
    loff += 30 + nb.length + d.length;
  }

  var cdSize = 0;
  for (var i = 0; i < ents.length; i++) cdSize += 46 + ents[i].nb.length;

  var total = loff + cdSize + 22;
  var zip = new Uint8Array(total);
  var o = 0;

  function w32(v) { zip[o] = v & 0xff; zip[o + 1] = (v >>> 8) & 0xff; zip[o + 2] = (v >>> 16) & 0xff; zip[o + 3] = (v >>> 24) & 0xff; o += 4; }
  function w16(v) { zip[o] = v & 0xff; zip[o + 1] = (v >>> 8) & 0xff; o += 2; }

  for (var i = 0; i < ents.length; i++) {
    var e = ents[i];
    w32(0x04034b50); w16(20); w16(0); w16(0); w16(0); w16(0);
    w32(e.crc); w32(e.d.length); w32(e.d.length);
    w16(e.nb.length); w16(0);
    for (var j = 0; j < e.nb.length; j++) { zip[o] = e.nb[j]; o++; }
    for (var j = 0; j < e.d.length; j++) { zip[o] = e.d[j]; o++; }
  }

  var cdOff = o;

  for (var i = 0; i < ents.length; i++) {
    var e = ents[i];
    w32(0x02014b50); w16(20); w16(20); w16(0); w16(0); w16(0); w16(0);
    w32(e.crc); w32(e.d.length); w32(e.d.length);
    w16(e.nb.length); w16(0); w16(0); w16(0); w16(0); w32(0); w32(e.lo);
    for (var j = 0; j < e.nb.length; j++) { zip[o] = e.nb[j]; o++; }
  }

  var cdSizeActual = o - cdOff;
  w32(0x06054b50); w16(0); w16(0);
  w16(ents.length); w16(ents.length);
  w32(cdSizeActual); w32(cdOff); w16(0);

  // === Phase 4: Validate EPUB ===
  var errors = [];

  // 4a. ZIP signature
  if (zip[0] !== 0x50 || zip[1] !== 0x4b || zip[2] !== 0x03 || zip[3] !== 0x04) {
    errors.push("Invalid ZIP signature");
  }

  // 4b. Parse with JSZip
  try {
    const loaded = await npmJSZip.loadAsync(zip);
    const expectedFiles = ["mimetype", "META-INF/container.xml", "OEBPS/content.opf",
      "OEBPS/toc.ncx", "OEBPS/style/default.css", "OEBPS/content.xhtml"];
    for (const f of expectedFiles) {
      if (!loaded.files[f]) errors.push("Missing file: " + f);
    }

    // 4c. Verify content.xhtml structure
    const cx = await loaded.files["OEBPS/content.xhtml"].async("string");
    if (!cx.includes('<?xml version="1.0"')) errors.push("content.xhtml: missing XML declaration");
    if (!cx.includes('xmlns="http://www.w3.org/1999/xhtml"')) errors.push("content.xhtml: missing xmlns");
    if (!cx.includes('xml:lang="en"')) errors.push("content.xhtml: missing xml:lang");
    if (!cx.includes('lang="en"')) errors.push("content.xhtml: missing lang");
    if (cx.includes('<a ')) errors.push("content.xhtml: contains links");

    // 4d. Verify OPF metadata
    const opf = await loaded.files["OEBPS/content.opf"].async("string");
    if (!opf.includes('<dc:language>en</dc:language>')) errors.push("OPF: missing dc:language");
    if (!opf.includes('<dc:identifier id="BookId">')) errors.push("OPF: missing BookId identifier");
    if (!opf.includes('unique-identifier="BookId"')) errors.push("OPF: missing unique-identifier");
    if (!opf.includes('<dc:title>')) errors.push("OPF: missing dc:title");

    // 4e. Verify NCX
    const ncx = await loaded.files["OEBPS/toc.ncx"].async("string");
    if (!ncx.includes('<navMap>')) errors.push("NCX: missing navMap");

    // 4f. Verify mimetype content
    const mt = await loaded.files["mimetype"].async("string");
    if (mt !== "application/epub+zip") errors.push("mimetype: wrong content");

    // 4g. Verify no binary corruption: round-trip content
    // Read content.xhtml bodies, verify raw bytes match UTF-8 decoded
    const rawContent = await loaded.files["OEBPS/content.xhtml"].async("nodebuffer");
    const decoded = rawContent.toString("utf8");
    if (decoded !== cx) {
      // Check for encoding corruption (s2b issue)
      const corrupt = [];
      for (var i = 0; i < Math.min(cx.length, 100); i++) {
        if (cx[i] !== decoded[i]) corrupt.push({ offset: i, expected: cx.charCodeAt(i), got: decoded.charCodeAt(i) });
      }
      if (corrupt.length > 0) {
        errors.push("content.xhtml: encoding round-trip mismatch (" + corrupt.length + " differences, first at offset " + corrupt[0].offset + ")");
      }
    }

  } catch (e) {
    errors.push("JSZip parse failed: " + e.message);
  }

  return { pass: errors.length === 0, name: testPage.name, errors, zip };
}

async function main() {
  console.log("=== iOS2Kindle Full Pipeline Test ===\n");

  let totalPass = 0, totalFail = 0;
  const epubs = [];

  for (const page of TEST_PAGES) {
    console.log("Testing: " + page.name);
    const result = await testPage(page);
    if (result.pass) {
      console.log("  PASS (" + result.zip.length + " bytes)");
      totalPass++;
    } else {
      console.log("  FAIL:");
      for (const e of result.errors) console.log("    - " + e);
      totalFail++;
    }
    epubs.push(result);
  }

  console.log("\n=== Results ===");
  console.log(totalPass + " passed, " + totalFail + " failed");

  // Write EPUBs for manual epubcheck
  const outDir = path.join(ROOT, "tests", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < epubs.length; i++) {
    const safe = TEST_PAGES[i].name.replace(/[^a-z0-9]+/gi, "_") + ".epub";
    fs.writeFileSync(path.join(outDir, safe), epubs[i].zip);
  }
  console.log("\nEPUBs written to: " + outDir);

  // Try epubcheck if available
  try {
    const { execSync } = require("child_process");
    for (const file of fs.readdirSync(outDir)) {
      const fpath = path.join(outDir, file);
      try {
        const out = execSync("java -jar /usr/local/bin/epubcheck.jar " + fpath, { encoding: "utf8", timeout: 10000 });
        if (out.includes("Check finished with errors") || out.includes("Check finished with warnings")) {
          console.log("\nepubcheck " + file + ": " + out.trim().split("\n").pop());
        } else {
          console.log("\nepubcheck " + file + ": PASSED");
        }
      } catch (e) {
        const stderr = e.stderr || e.message;
        if (stderr.includes("Unable to locate a Java")) {
          console.log("\nepubcheck: Java not available, skipping");
        } else {
          console.log("\nepubcheck " + file + ": " + stderr.trim().split("\n").slice(-3).join("\n"));
        }
      }
    }
  } catch (e) {
    console.log("\nepubcheck: " + e.message.substring(0, 100));
  }

  if (totalFail > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
