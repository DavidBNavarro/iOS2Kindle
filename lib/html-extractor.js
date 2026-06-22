const { JSDOM } = require("jsdom");

function extractNewsletterContent(html, opts = {}) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const body = doc.body;

  if (!body) {
    return { title: opts.subject || "", author: opts.senderName || "", content: "" };
  }

  const imgs = body.querySelectorAll("img");
  imgs.forEach(img => {
    const w = parseInt(img.getAttribute("width") || "0");
    const h = parseInt(img.getAttribute("height") || "0");
    const src = (img.getAttribute("src") || "").toLowerCase();
    if ((w === 1 && h === 1) || src.includes("track") || src.includes("pixel") || src.includes("open.gif")) {
      img.parentNode.removeChild(img);
    }
  });

  removeMatchingLinks(body, /view.*(browser|online|web)/i);
  removeMatchingLinks(body, /unsubscribe|manage.*pref/i);
  removeFooterBlocks(body);

  const allEls = body.querySelectorAll("*");
  allEls.forEach(el => el.removeAttribute("style"));
  body.querySelectorAll("style, script, noscript").forEach(el => el.parentNode.removeChild(el));

  const h1 = body.querySelector("h1");
  const title = h1 ? h1.textContent.trim() : (opts.subject || "");

  return {
    title,
    author: opts.senderName || "",
    content: body.innerHTML.trim()
  };
}

function removeMatchingLinks(root, pattern) {
  const links = root.querySelectorAll("a");
  links.forEach(a => {
    const text = (a.textContent || "").toLowerCase();
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (pattern.test(text) || pattern.test(href)) {
      a.parentNode.removeChild(a);
    }
  });
}

function removeFooterBlocks(root) {
  const footers = root.querySelectorAll("p, div, td");
  footers.forEach(el => {
    const text = el.textContent.trim().toLowerCase();
    const hasFooterKeywords = text.includes("unsubscribe") ||
      text.includes("manage") && text.includes("pref") ||
      text.includes("update your") && text.includes("pref") ||
      text.includes("privacy policy") && text.length < 200;

    if (hasFooterKeywords && text.length < 300) {
      el.parentNode.removeChild(el);
    }
  });
}

module.exports = { extractNewsletterContent };
