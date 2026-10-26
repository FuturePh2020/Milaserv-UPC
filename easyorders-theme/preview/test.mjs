// PREVIEW-ONLY browser tests (Playwright + local static server).
// Usage: node preview/render.mjs && node preview/test.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "preview", "out", "screenshots");
fs.mkdirSync(shots, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/preview/out`;

const results = [];
function record(name, ok, info = "") {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`);
}

const browser = await chromium.launch();
const WIDTHS = [360, 390, 768, 1024, 1440];
const PAGES = ["home", "collection", "collection-empty", "search", "search-empty", "product", "thanks"];

async function open(pageName, width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: opts.reducedMotion || "no-preference", locale: "ar-EG" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_|fonts\.g/.test(m.text())) errors.push(m.text());
  });
  // fonts/videos are not reachable offline: abort quickly instead of hanging
  await page.route(/fonts\.(googleapis|gstatic)\.com|sample-\d\.mp4/, (r) => r.abort());
  await page.goto(`${BASE}/${opts.lang || "ar"}/${pageName}.html`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

// ---------- 1. layout matrix ---------------------------------------------
for (const lang of ["ar", "en"]) {
  for (const p of PAGES) {
    for (const w of WIDTHS) {
      const { ctx, page, errors } = await open(p, w, { lang });
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const offenders = [];
        if (sw > vw + 1) {
          document.querySelectorAll("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width && (r.right > vw + 1 || r.left < -1)) {
              let s = el, clipped = false;
              while (s && s !== document.body) {
                const cs = getComputedStyle(s);
                if (cs.position === "fixed") { clipped = true; break; }
                if (s === el) { s = s.parentElement; continue; }
                if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clipped = true; break; }
                s = s.parentElement;
              }
              if (!clipped) offenders.push(el.tagName.toLowerCase() + "." + [...el.classList].join("."));
            }
          });
        }
        return { vw, sw, offenders: [...new Set(offenders)].slice(0, 6) };
      });
      // headings must not be clipped vertically
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll(".bp-h1,.bp-h2,.bp-pd__name,.bp-mood__label")]
          .filter((h) => h.scrollHeight > h.clientHeight + 2 && getComputedStyle(h).overflow !== "visible")
          .map((h) => h.textContent.trim().slice(0, 30))
      );
      const ok = overflow.sw <= overflow.vw + 1 && errors.length === 0 && clipped.length === 0;
      record(`layout ${lang}/${p} @${w}px`, ok, ok ? "" : JSON.stringify({ ...overflow, errors, clipped }));
      if ((p === "home" || p === "product" || p === "collection") && [390, 1440].includes(w) && lang === "ar") {
        // scroll through the page so lazy images load before the full-page shot
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(shots, `${p}-${w}.png`), fullPage: true });
      }
      if (p === "search-empty" && w === 390 && lang === "ar") await page.screenshot({ path: path.join(shots, `search-empty-390.png`), fullPage: false });
      await ctx.close();
    }
  }
}

// ---------- 2. interactions ------------------------------------------------
{
  const { ctx, page } = await open("home", 1440);
  // hydration
  const hydrated = await page.$$eval("[data-bp-products]", (els) => els.filter((e) => !e.closest("[hidden]")).map((e) => e.getAttribute("data-bp-state")));
  record("hydration: picker-based sections render cards", hydrated.length > 0 && hydrated.every((s) => s === "ready"), JSON.stringify(hydrated));
  // quick-add from built-in listing
  await page.click(".bp-list .bp-card__add >> nth=0");
  let ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  record("quick-add dispatched from list-products with productId", ev && ev.event === "quick-add" && ev.section === "list-products" && !!ev.detail.productId, JSON.stringify(ev));
  // quick-add from hydrated home section reaches its section container
  await page.click(".bp-feature .bp-card__add >> nth=1");
  ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  record("quick-add/quick-view from hydrated home section reaches section container", ev && /quick-(add|view)/.test(ev.event) && ev.section === "home:bp-category-feature", JSON.stringify(ev));
  // variant product uses quick-view not quick-add
  const variantBtn = await page.$eval(".bp-feature .bp-card__add >> nth=0", (b) => b.getAttribute("onclick"));
  record("product with variations uses quick-view (no silent wrong variant)", /quick-view/.test(variantBtn), variantBtn.slice(70, 130));
  // out of stock card has no add button
  const oos = await page.$$eval(".bp-card--oos", (els) => els.map((e) => !!e.querySelector(".bp-card__add")));
  record("out-of-stock cards show no add button", oos.length > 0 && oos.every((x) => x === false), JSON.stringify(oos));
  // wishlist
  await page.click(".bp-list .bp-card .bp-icon-btn >> nth=0");
  ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  record("toggle-wishlist dispatched", ev && ev.event === "toggle-wishlist", JSON.stringify(ev));
  // cart
  await page.click(".bp-header .cart-btn");
  ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  record("cart-click from header", ev && ev.event === "cart-click" && ev.section === "header");
  // tabs
  await page.click(".bp-pets .bp-tab >> nth=1");
  await page.waitForTimeout(400);
  const tabState = await page.evaluate(() => {
    const panels = [...document.querySelectorAll(".bp-pets .bp-tabpanel")];
    return { visible: panels.map((p) => !p.hidden), hydrated: panels[1].querySelector("[data-bp-products]").getAttribute("data-bp-state") };
  });
  record("tabs: second tab shows and hydrates its panel", tabState.visible[0] === false && tabState.visible[1] === true && tabState.hydrated === "ready", JSON.stringify(tabState));
  record("tabs: empty tab is not rendered", (await page.$$(".bp-pets .bp-tab")).length === 2);
  // countdown
  const digits = await page.$eval("[data-bp-countdown] [data-unit='days']", (e) => e.textContent);
  record("countdown shows real numbers", /^\d{2,}$/.test(digits), digits);
  // gift builder
  const before = await page.evaluate(() => window.__eoEvents.length);
  const steppers = await page.$$("[data-bp-builder] [data-bp-step='1']");
  record("builder: steppers rendered for simple products only", steppers.length >= 3, `steppers=${steppers.length}`);
  await steppers[0].click();
  await steppers[0].click();
  const disabledAt2 = await page.$eval("[data-bp-builder-add]", (b) => b.disabled);
  await steppers[1].click();
  const enabledAt3 = await page.$eval("[data-bp-builder-add]", (b) => !b.disabled);
  record("builder: add button respects minimum", disabledAt2 && enabledAt3);
  await page.check(".bp-pack input >> nth=1");
  const total = await page.$eval("[data-bp-summary-total]", (e) => e.textContent.trim());
  record("builder: running total includes packaging", /\d/.test(total), total);
  await page.click("[data-bp-builder-add]");
  await page.waitForTimeout(1200);
  const sent = await page.evaluate((b) => window.__eoEvents.slice(b).filter((e) => e.event === "quick-add").map((e) => e.detail.productId), before);
  record("builder: transfers exact units + packaging via quick-add", sent.length === 4 && sent.filter((x) => x === sent[0]).length === 2, JSON.stringify(sent));
  const status = await page.$eval("[data-bp-builder-status]", (e) => e.textContent);
  record("builder: status does not claim checkout success", /راجع|اتأكد/.test(status), status);
  // newsletter
  const nBefore = await page.evaluate(() => window.__eoEvents.filter((e) => e.event === "footer-subscribe").length);
  await page.fill(".bp-news input[type=email]", "not-an-email");
  await page.click(".bp-news button[type=submit]");
  const errMsg = await page.$eval(".bp-news .bp-form-msg", (e) => e.textContent);
  const nMid = await page.evaluate(() => window.__eoEvents.filter((e) => e.event === "footer-subscribe").length);
  record("newsletter: invalid email shows error, no event", nMid === nBefore && errMsg.length > 0, errMsg);
  await page.fill(".bp-news input[type=email]", "test@example.com");
  await page.click(".bp-news button[type=submit]");
  ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  const after = await page.$eval(".bp-news .bp-form-msg", (e) => e.textContent);
  record("newsletter: valid email dispatches footer-subscribe and shows no fake success", ev.event === "footer-subscribe" && ev.detail.email === "test@example.com" && after === "", JSON.stringify(ev));
  // entity CTA resolution leaves real hrefs
  const unresolved = await page.$$eval("a[data-bp-link-id]:not([href])", (els) => els.length);
  record("entity links resolved to hrefs", unresolved === 0, `unresolved=${unresolved}`);
  // repeated init does not duplicate listeners
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__bpTheme.run(); document.body.appendChild(document.createElement("div")); });
  await page.waitForTimeout(200);
  const accBefore = await page.evaluate(() => window.__eoEvents.length);
  await page.click(".bp-list .bp-card__add >> nth=1");
  const accAfter = await page.evaluate(() => window.__eoEvents.length);
  record("re-running init does not duplicate event dispatch", accAfter - accBefore === 1, `delta=${accAfter - accBefore}`);
  await ctx.close();
}
{
  // mobile drawer + keyboard
  const { ctx, page } = await open("home", 390);
  await page.click("[data-bp-menu-open]");
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({ open: document.getElementById("bp-mobile-menu").classList.contains("is-open"), focusInside: document.getElementById("bp-mobile-menu").contains(document.activeElement), lock: document.body.classList.contains("bp-scroll-lock") }));
  record("drawer opens, moves focus inside, locks scroll", st.open && st.focusInside && st.lock, JSON.stringify(st));
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => document.getElementById("bp-mobile-menu").contains(document.activeElement));
  record("drawer traps Tab focus", trapped);
  await page.click("[data-bp-subtoggle]");
  const subOpen = await page.$eval("#bp-msub-1", (e) => !e.hidden);
  record("drawer submenu toggles", subOpen);
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({ open: document.getElementById("bp-mobile-menu").classList.contains("is-open"), focusBack: document.activeElement && document.activeElement.hasAttribute("data-bp-menu-open") }));
  record("Escape closes drawer and returns focus", !closed.open && closed.focusBack, JSON.stringify(closed));
  // touch targets in header/cards
  const small = await page.$$eval(".bp-header button, .bp-header a, .bp-card__actions button", (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 40 || e.getBoundingClientRect().width < 40)).map((e) => e.className));
  record("touch targets ≥ 40px in header and cards", small.length === 0, JSON.stringify(small.slice(0, 5)));
  await ctx.close();
}
{
  const { ctx, page } = await open("home", 1440, { reducedMotion: "reduce" });
  const running = await page.$$eval(".bp-marquee", (els) => els.map((e) => getComputedStyle(e).animationName));
  record("reduced motion: marquee animation disabled", running.every((n) => n === "none"), JSON.stringify(running));
  await ctx.close();
}
{
  const { ctx, page } = await open("product", 1440);
  await page.click(".bp-acc__btn >> nth=1");
  const accOpen = await page.$eval(".bp-acc__btn >> nth=1", (b) => b.getAttribute("aria-expanded"));
  record("accordion toggles aria-expanded", accOpen === "true");
  await page.click(".bp-gallery__thumb >> nth=1");
  const cur = await page.$$eval(".bp-gallery__thumb", (b) => b.map((x) => x.getAttribute("aria-current")));
  record("gallery thumb switches main image", cur[1] === "true" && cur[0] === "false", JSON.stringify(cur));
  await page.click(".bp-gallery__zoom");
  const dlg = await page.$eval(".bp-lightbox", (d) => d.open);
  await page.keyboard.press("Escape");
  const dlgClosed = await page.$eval(".bp-lightbox", (d) => !d.open);
  record("lightbox opens and closes with Escape", dlg && dlgClosed);
  await page.click(".bp-pd__actions .bp-btn >> nth=0");
  const ev = await page.evaluate(() => window.__eoEvents.slice(-1)[0]);
  record("product page wishlist uses product_id", ev.event === "toggle-wishlist" && ev.detail.productId === "p3", JSON.stringify(ev));
  const wa = await page.$eval(".bp-pd .bp-btn--whatsapp", (a) => a.href);
  record("WhatsApp enquiry link contains product name", /wa\.me\/201000000000\?text=/.test(wa) && decodeURIComponent(wa).includes("بسكويت"), wa.slice(0, 60));
  const fake = await page.$$eval("[data-eo-section='fake-visitor'] *, [data-eo-section='fake-stock'] *", (e) => e.length);
  record("fake urgency widgets render nothing by default", fake === 0, `nodes=${fake}`);
  await ctx.close();
}
{
  // JS disabled: critical content still visible
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ar/home.html`);
  const vis = await page.evaluate(() => ({
    hero: !!document.querySelector(".bp-hero h1") && document.querySelector(".bp-hero h1").getBoundingClientRect().height > 0,
    cats: document.querySelectorAll(".bp-catnav__link").length,
    cards: [...document.querySelectorAll(".bp-list .bp-card")].filter((c) => c.getBoundingClientRect().height > 0).length,
    countdownDate: !!document.querySelector(".bp-countdown__date"),
  }));
  record("no-JS: hero, category nav, server-rendered products and countdown date visible", vis.hero && vis.cats > 3 && vis.cards > 0 && vis.countdownDate, JSON.stringify(vis));
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(root, "preview", "out", "test-results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
