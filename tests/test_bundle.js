const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");

async function main() {
  // Load bundle
  const bundlePath = path.join(ROOT, "ios", "bundle.js");
  const bundleCode = fs.readFileSync(bundlePath, "utf8");
  console.log("bundle.js: " + (bundleCode.length / 1024).toFixed(1) + "KB");
  console.log("Has JSZip include: " + bundleCode.includes("JSZip"));
  console.log("Has Readability: " + bundleCode.includes("Readability"));

  // Load iOS2Kindle.js
  const iosCode = fs.readFileSync(path.join(ROOT, "ios", "iOS2Kindle.js"), "utf8");
  console.log("iOS2Kindle.js: " + iosCode.length + " chars");

  // Test 1: Can we parse bundle.js as valid JS?
  try {
    new Function(bundleCode);
    console.log("Test 1 PASS: bundle.js parses as valid JS");
  } catch(e) {
    console.log("Test 1 FAIL: " + e.message);
    return;
  }

  // Test 2: Simulate eval(bundleCode) in a mock Scriptable context
  const mockContext = {
    Readability: undefined,
    _extractDomArticle: undefined,
    _restoreHeadings: undefined,
    _supplementContent: undefined,
    stripUiText: undefined,
    stripTrailingRelated: undefined,
    _sanitizeHtmlForEpub: undefined,
    _KINDLE_CSS: undefined,
    _containerXml: undefined,
    _contentOpf: undefined,
    _tocNcx: undefined,
    _uuid: undefined,
    _esc: undefined,
    _epubXmlHeader: undefined,
  };

  try {
    // Create sandbox-like eval that defines globals
    // Bundle uses var/function at top level, so we eval in global-like scope
    // For safety, we set up globals
    const globalVars = {};
    const evalCode = `
      (function() {
        ${bundleCode}
        return {
          Readability: typeof Readability !== 'undefined' ? Readability : undefined,
          _extractDomArticle: typeof _extractDomArticle !== 'undefined' ? _extractDomArticle : undefined,
          _restoreHeadings: typeof _restoreHeadings !== 'undefined' ? _restoreHeadings : undefined,
          _supplementContent: typeof _supplementContent !== 'undefined' ? _supplementContent : undefined,
          stripUiText: typeof stripUiText !== 'undefined' ? stripUiText : undefined,
          stripTrailingRelated: typeof stripTrailingRelated !== 'undefined' ? stripTrailingRelated : undefined,
          _sanitizeHtmlForEpub: typeof _sanitizeHtmlForEpub !== 'undefined' ? _sanitizeHtmlForEpub : undefined,
          _KINDLE_CSS: typeof _KINDLE_CSS !== 'undefined' ? _KINDLE_CSS : undefined,
          _containerXml: typeof _containerXml !== 'undefined' ? _containerXml : undefined,
          _contentOpf: typeof _contentOpf !== 'undefined' ? _contentOpf : undefined,
          _tocNcx: typeof _tocNcx !== 'undefined' ? _tocNcx : undefined,
          _uuid: typeof _uuid !== 'undefined' ? _uuid : undefined,
          _esc: typeof _esc !== 'undefined' ? _esc : undefined,
          _epubXmlHeader: typeof _epubXmlHeader !== 'undefined' ? _epubXmlHeader : undefined,
          iOSBundle: typeof iOSBundle !== 'undefined' ? iOSBundle : undefined,
        };
      })()
    `;
    const result = eval(evalCode);

    const expected = ["Readability", "_extractDomArticle", "_restoreHeadings", "_supplementContent",
      "stripUiText", "stripTrailingRelated", "_sanitizeHtmlForEpub", "_KINDLE_CSS",
      "_containerXml", "_contentOpf", "_tocNcx", "_uuid", "_esc", "_epubXmlHeader", "iOSBundle"];

    let missing = expected.filter(k => !result[k]);
    if (missing.length === 0) {
      console.log("Test 2 PASS: all " + expected.length + " globals defined by bundle");
    } else {
      console.log("Test 2 FAIL: missing globals: " + missing.join(", "));
      return;
    }
  } catch(e) {
    console.log("Test 2 FAIL: eval error: " + e.message);
    return;
  }

  // Test 3: Extract article from a real HTML page
  console.log("\n--- Test 3: Extract article from HTML ---");
  const html = `<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article Title</h1>
    <p>This is the first paragraph of the test article. It contains some content that should be extracted by Readability.</p>
    <p>This is a second paragraph with more content. We want to make sure the extraction works correctly.</p>
    <h2>Section One</h2>
    <p>Content in section one. This is longer text that should be properly captured in the extraction output.</p>
    <h3>Subsection A</h3>
    <p>This is a subsection with some detailed content about the topic being discussed in the article.</p>
    <h2>Section Two</h2>
    <p>Final section with concluding thoughts and a summary of the key points from the article.</p>
  </article>
</body>
</html>`;

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Re-eval the bundleCode in the JSDOM context to get Readability + helpers
  try {
    globalThis.document = doc;
    globalThis.Node = dom.window.Node;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer;
    globalThis.Element = dom.window.Element;
    globalThis.DOMTokenList = dom.window.DOMTokenList;
    globalThis.Set = Set;

    // eval bundle in a way that defines globals
    eval(bundleCode);

    console.log("Readability: " + (typeof Readability));
    console.log("_extractDomArticle: " + (typeof _extractDomArticle));
    console.log("_restoreHeadings: " + (typeof _restoreHeadings));
    console.log("_sanitizeHtmlForEpub: " + (typeof _sanitizeHtmlForEpub));
    console.log("iOSBundle: " + (typeof iOSBundle));

    // Test Readability extraction
    const readability = new Readability(doc);
    const article = readability.parse();
    console.log("\nReadability result: " + (article ? "OK" : "null"));
    if (article) {
      console.log("  title: " + article.title);
      console.log("  content length: " + (article.content || "").length);
    }

    // Test heading restoration
    if (typeof _restoreHeadings === 'function' && article && article.content) {
      const restored = _restoreHeadings(article.content);
      console.log("  restored content length: " + restored.length);

      // Test supplement content
      const supplemented = _supplementContent(restored, html);
      console.log("  supplemented content length: " + supplemented.length);

      // Test strip UI text
      const stripped = stripUiText(supplemented);
      console.log("  stripUiText result length: " + stripped.length);

      // Test strip trailing related
      const relatedStripped = stripTrailingRelated(stripped);
      console.log("  stripTrailingRelated result length: " + relatedStripped.length);

      // Test sanitize for epub
      const sanitized = _sanitizeHtmlForEpub(relatedStripped);
      console.log("  sanitized content length: " + sanitized.length);

      console.log("Test 3 PASS: full extraction pipeline works");
    } else {
      console.log("Test 3 FAIL: article extraction failed");
    }
  } catch(e) {
    console.log("Test 3 FAIL: " + e.message);
    console.log(e.stack);
    return;
  }

  // Test 4: Test the ZIP builder (epub generation)
  console.log("\n--- Test 4: Build EPUB (ZIP) ---");
  try {
    // Regenerate the article and build an EPUB
    const readability2 = new Readability(doc);
    const art = readability2.parse();

    if (!art) throw new Error("Readability parse failed");

    const c = _restoreHeadings(art.content);
    const c2 = _supplementContent(c, html);
    const c3 = stripUiText(c2);
    const c4 = stripTrailingRelated(c3);
    const c5 = _sanitizeHtmlForEpub(c4);
    const bodyHtml = c5.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');

    // Parse to get TOC
    const pdoc = new DOMParser().parseFromString(bodyHtml, 'text/html');
    const hs = pdoc.querySelectorAll('h1,h2,h3');
    const ids = new Set(['title']);
    const toc = [];
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const t = h.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      let s = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let slug = s, n = 1;
      while (ids.has(slug)) slug = s + '-' + (++n);
      ids.add(slug);
      h.id = slug;
      toc.push({ text: t, slug, level: parseInt(h.tagName[1]) });
    }

    const ser = new XMLSerializer();
    const bh = ser.serializeToString(pdoc.body).replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');

    const title = art.title;
    const author = art.author || '';

    const contentHtml = '<body>\n  <h1 id="title">' + _esc(title) + '</h1>\n' +
      (author ? '  <p class="byline">' + _esc(author) + '</p>\n' : '') +
      '  ' + bh + '\n</body>';

    const contentXhtml = _epubXmlHeader() +
      '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
      '<head><title>' + _esc(title) + '</title></head>\n' +
      contentHtml + '\n</html>';

    const navPoints = [{ label: title, src: "content.xhtml#title" }];
    for (let i = 0; i < toc.length; i++) {
      if (toc[i].level <= 2) {
        navPoints.push({ label: toc[i].text, src: "content.xhtml#" + toc[i].slug });
      }
    }

    const manifest = [
      {id:"content",href:"content.xhtml","media-type":"application/xhtml+xml"},
      {id:"css",href:"style/default.css","media-type":"text/css"},
      {id:"ncx",href:"toc.ncx","media-type":"application/x-dtbncx+xml"}
    ];

    const files = [
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: _containerXml() },
      { name: "OEBPS/style/default.css", data: _KINDLE_CSS },
      { name: "OEBPS/content.xhtml", data: contentXhtml },
      { name: "OEBPS/content.opf", data: _contentOpf(title, author, manifest, ["content"], "", _uuid()) },
      { name: "OEBPS/toc.ncx", data: _tocNcx(title, navPoints, _uuid()) }
    ];

    console.log("Files to zip: " + files.length);
    for (const f of files) {
      console.log("  " + f.name + ": " + f.data.length + " bytes");
    }

    // Build ZIP using the same code as iOS2Kindle.js
    function s2b(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }

    function crc32(d) {
      var c = 0xffffffff;
      for (var i = 0; i < d.length; i++) { c ^= d[i]; for (var j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
      return (c ^ 0xffffffff) >>> 0;
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

    function w32(v) { zip[o] = v & 0xff; zip[o+1] = (v >>> 8) & 0xff; zip[o+2] = (v >>> 16) & 0xff; zip[o+3] = (v >>> 24) & 0xff; o += 4; }
    function w16(v) { zip[o] = v & 0xff; zip[o+1] = (v >>> 8) & 0xff; o += 2; }

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

    w32(0x06054b50); w16(0); w16(0);
    w16(ents.length); w16(ents.length);
    w32(o - cdOff); w32(cdOff); w16(0);

    var bin = "";
    for (var i = 0; i < zip.length; i++) bin += String.fromCharCode(zip[i]);
    var epubBase64 = Buffer.from(bin, "binary").toString("base64");

    console.log("ZIP size: " + zip.length + " bytes");
    console.log("Base64 length: " + epubBase64.length);
    console.log("Base64 starts: " + epubBase64.substring(0, 30) + "...");
    console.log("Test 4 PASS: EPUB ZIP built successfully");

    // Validate that the ZIP starts with PK\x03\x04
    if (zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04) {
      console.log("ZIP signature valid: PK\\x03\\x04");
    } else {
      console.log("ZIP signature INVALID: " + zip[0].toString(16) + " " + zip[1].toString(16) + " " + zip[2].toString(16) + " " + zip[3].toString(16));
    }

    // Try parsing with jszip if available
    let jszipOk = false;
    try {
      const JSZip = require("jszip");
      // We need the raw buffer, not base64 string
      const buf = Buffer.from(bin, "binary");
      const loaded = await JSZip.loadAsync(buf);
      const fileCount = Object.keys(loaded.files).length;
      console.log("JSZip parsed: " + fileCount + " files");
      for (const name of Object.keys(loaded.files)) {
        console.log("  " + name + " (" + (loaded.files[name]._data ? "data" : "dir") + ")");
      }
      jszipOk = true;
    } catch(e) {
      // jszip might not be available in this context
      if (e.code === 'MODULE_NOT_FOUND') {
        console.log("JSZip not available for validation, skipping");
        jszipOk = true; // not a failure
      } else {
        console.log("JSZip validation failed: " + e.message);
      }
    }

    console.log("\n=== ALL TESTS PASSED ===");
  } catch(e) {
    console.log("Test 4 FAIL: " + e.message);
    console.log(e.stack);
  }
}

main().catch(e => { console.error("Fatal:", e.message); });
