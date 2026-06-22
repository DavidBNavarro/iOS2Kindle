const { JSDOM } = require("jsdom");

const UNWRAP_TAGS = new Set([
  "article", "section", "header", "main", "footer", "aside", "nav",
  "figure", "figcaption", "details", "summary", "bdi", "font", "center"
]);

const REMOVE_TAGS = new Set([
  "input", "button", "label", "select", "textarea", "form",
  "fieldset", "legend", "meta", "link", "style", "script", "noscript",
  "iframe", "canvas", "audio", "video", "source", "track", "svg", "math"
]);

const STRIP_ATTR_PREFIXES = ["aria-", "on", "data-"];
const STRIP_ATTR_EXACT = new Set([
  "role", "tabindex", "playsinline", "typeof", "property", "resource",
  "prefix", "vocab", "about", "datatype", "inlist", "contenteditable",
  "spellcheck", "hidden", "draggable", "translate", "loading", "sizes",
  "srcset", "frameborder", "scrolling", "autocomplete", "autofocus",
  "autoplay", "controls", "loop", "muted", "preload", "poster", "width",
  "height", "align", "valign", "bgcolor", "border", "cellpadding",
  "cellspacing", "colspan", "rowspan", "nowrap", "start", "type", "value",
  "checked", "selected", "disabled", "readonly", "placeholder", "required",
  "pattern", "min", "max", "step", "action", "method", "enctype", "target",
  "rel", "integrity", "crossorigin", "referrerpolicy", "fetchpriority", "decoding"
]);

function sanitizeHtmlForEpub(html) {
  if (!html) return html;
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  const doc = dom.window.document;
  const body = doc.body;

  unwrapElements(body, UNWRAP_TAGS);
  removeElements(body, REMOVE_TAGS);
  stripAttributes(body);
  stripAllIds(body);
  replacePictureWithImg(body);
  removeOrphanLi(body);
  removeEmptyLists(body);

  return body.innerHTML;
}

function unwrapElements(root, tagSet) {
  for (const tag of tagSet) {
    const els = root.querySelectorAll(tag);
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      while (el.firstChild) {
        el.parentNode.insertBefore(el.firstChild, el);
      }
      el.parentNode.removeChild(el);
    }
  }
}

function removeElements(root, tagSet) {
  for (const tag of tagSet) {
    const els = root.querySelectorAll(tag);
    els.forEach(el => el.parentNode.removeChild(el));
  }
}

function stripAttributes(root) {
  const all = root.querySelectorAll("*");
  all.forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      const name = attr.name;
      if (STRIP_ATTR_EXACT.has(name)) {
        el.removeAttribute(name);
      } else {
        for (const prefix of STRIP_ATTR_PREFIXES) {
          if (name.startsWith(prefix)) {
            el.removeAttribute(name);
            break;
          }
        }
      }
    });
  });
}

function stripAllIds(root) {
  const all = root.querySelectorAll("[id]");
  all.forEach(el => el.removeAttribute("id"));
}

function replacePictureWithImg(root) {
  const pictures = root.querySelectorAll("picture");
  pictures.forEach(pic => {
    const img = pic.querySelector("img");
    if (img) {
      pic.parentNode.insertBefore(img, pic);
    }
    pic.parentNode.removeChild(pic);
  });
}

function removeOrphanLi(root) {
  const lis = root.querySelectorAll("li");
  lis.forEach(li => {
    const parent = li.parentNode;
    if (!parent || (parent.nodeName !== "UL" && parent.nodeName !== "OL")) {
      li.parentNode.removeChild(li);
    }
  });
}

function removeEmptyLists(root) {
  const lists = root.querySelectorAll("ul, ol");
  lists.forEach(list => {
    if (!list.querySelector("li")) {
      list.parentNode.removeChild(list);
    }
  });
}

module.exports = { sanitizeHtmlForEpub };
