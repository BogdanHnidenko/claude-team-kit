// Згенеровано з templates/layout-checks.ts (типи прибрано): перевірка верстки, що виконується всередині браузера.
// Використовує `pl eyes` (eyes-web.mjs): page.evaluate(auditInPage, ignore). Повертає масив { kind, severity, selector, detail }.
// Види знахідок: page-horizontal-scroll, outside-viewport, overflows-parent, text-clipped, content-clipped, broken-image, overlap, covered; попередження: text-truncated, small-target, small-text.
const auditInPage = (ignore) => {
  const issues = [];
  const vw = document.documentElement.clientWidth;
  const skip = (el) => ignore.some((s) => el.matches(s) || el.closest(s));
  const sel = (el) => {
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
    if (el.id) return `#${el.id}`;
    const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  const add = (kind, severity, el, detail) => {
    if (issues.some((i) => i.kind === kind && i.selector === sel(el))) return;
    issues.push({ kind, severity, selector: sel(el), detail });
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const insideScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
  const interactive = (el) => el.matches('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[tabindex]:not([tabindex="-1"])');
  if (document.documentElement.scrollWidth > vw + 1) {
    add("page-horizontal-scroll", "error", document.documentElement, `scrollWidth ${document.documentElement.scrollWidth} > \u0448\u0438\u0440\u0438\u043D\u0430 \u0435\u043A\u0440\u0430\u043D\u0430 ${vw}`);
  }
  const all = [...document.body.querySelectorAll("*")].filter((e) => !skip(e) && visible(e)).slice(0, 1500);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = hasOwnText(el);
    if ((r.right > vw + 1 || r.left < -1) && !insideScroller(el) && cs.position !== "fixed") {
      add("outside-viewport", "error", el, `x: ${Math.round(r.left)}\u2026${Math.round(r.right)}, \u0435\u043A\u0440\u0430\u043D ${vw}px`);
    }
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement && (own || interactive(el) || el.tagName === "IMG")) {
      const pcs = getComputedStyle(parent);
      const pr = parent.getBoundingClientRect();
      const clipsParent = pcs.overflowX !== "visible" || pcs.overflowY !== "visible";
      if (!clipsParent && pcs.display !== "contents" && cs.position !== "absolute" && cs.position !== "fixed" && pr.width > 0) {
        if (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) add("overflows-parent", "error", el, `\u0432\u0438\u0445\u043E\u0434\u0438\u0442\u044C \u0437\u0430 \u043C\u0435\u0436\u0456 ${sel(parent)} \u043F\u043E \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0430\u043B\u0456 (${Math.round(r.right - pr.right)}px)`);
      }
    }
    if (own || interactive(el)) {
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
        add(cs.textOverflow === "ellipsis" ? "text-truncated" : "text-clipped", cs.textOverflow === "ellipsis" ? "warn" : "error", el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
      if (el.scrollHeight > el.clientHeight + 2 && (cs.overflowY === "hidden" || cs.overflowY === "clip") && !/\d/.test(cs.getPropertyValue("-webkit-line-clamp"))) {
        add("content-clipped", "error", el, `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);
      }
    }
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth === 0 && el.currentSrc) add("broken-image", "error", el, el.currentSrc.slice(0, 80));
    if (interactive(el) && vw <= 480 && (r.width < 24 || r.height < 24)) add("small-target", "warn", el, `${Math.round(r.width)}\xD7${Math.round(r.height)}px`);
    if (own && parseFloat(cs.fontSize) < 11) add("small-text", "warn", el, `${cs.fontSize}`);
  }
  const leaves = all.filter((e) => (hasOwnText(e) || interactive(e) || e.tagName === "IMG") && getComputedStyle(e).position !== "absolute").slice(0, 400);
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 2 || h <= 2) continue;
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (w * h > smaller * 0.15) add("overlap", "error", a, `\u043D\u0430\u043A\u043B\u0430\u0434\u0430\u0454\u0442\u044C\u0441\u044F \u043D\u0430 ${sel(b)} (${Math.round(w)}\xD7${Math.round(h)}px)`);
    }
  }
  for (const el of all.filter(interactive).slice(0, 150)) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
    if (top && top !== el && !el.contains(top) && !top.contains(el)) add("covered", "error", el, `\u0443 \u0446\u0435\u043D\u0442\u0440\u0456 \u043B\u0435\u0436\u0438\u0442\u044C ${sel(top)}`);
  }
  window.scrollTo(0, 0);
  return issues;
};
export {
  auditInPage
};
