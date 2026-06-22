const JSZip = require("jszip");

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
  const { generateEpubNode } = require("../lib/epub-generator-node.cjs");

  await test("generates valid EPUB blob", async () => {
    const result = await generateEpubNode({
      title: "Test Newsletter",
      author: "Test Author",
      content: "<h1>Hello</h1><p>World</p>",
      url: "https://example.com/newsletter/42"
    });
    if (!result) throw new Error("no result");
    if (!result.blob || result.blob.size < 100) throw new Error("blob too small: " + (result.blob ? result.blob.size : 0));
  });

  await test("EPUB has valid ZIP structure", async () => {
    const result = await generateEpubNode({ title: "Structure Test", content: "<p>Test content</p>" });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not a valid ZIP");
  });

  await test("EPUB contains required files", async () => {
    const result = await generateEpubNode({ title: "Files Test", content: "<p>Testing required files</p>" });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    const required = ["mimetype", "META-INF/container.xml", "OEBPS/content.opf",
      "OEBPS/toc.ncx", "OEBPS/content.xhtml"];
    for (const f of required) {
      if (!zip.files[f]) throw new Error("missing: " + f);
    }
  });

  await test("mimetype is stored uncompressed", async () => {
    const result = await generateEpubNode({ title: "Mimetype Test", content: "<p>Test</p>" });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const mt = zip.files["mimetype"];
    if (mt.options.compression !== null && mt.options.compression !== "STORE") {
      throw new Error("mimetype should be stored, not compressed");
    }
  });

  await test("content.xhtml has proper XHTML 1.1 structure", async () => {
    const result = await generateEpubNode({ title: "XHTML Test", content: "<p>XHTML output test</p>" });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const xhtml = await zip.files["OEBPS/content.xhtml"].async("string");

    if (!xhtml.includes('<?xml version="1.0"')) throw new Error("missing XML declaration");
    if (!xhtml.includes('xmlns="http://www.w3.org/1999/xhtml"')) throw new Error("missing XHTML namespace");
  });

  await test("handles empty content gracefully", async () => {
    const result = await generateEpubNode({ title: "Empty", content: "" });
    if (!result) throw new Error("no result for empty content");
    if (result.blob.size < 50) throw new Error("blob too small for empty content");
  });

  console.log("\n=== " + (failed === 0 ? "ALL TESTS PASSED" : failed + " FAILURES") + " ===");
  console.log(passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
