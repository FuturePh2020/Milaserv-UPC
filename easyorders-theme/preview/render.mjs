// PREVIEW-ONLY: renders the theme with LiquidJS + fixtures into preview/out/*.html
// so layouts can be checked in a browser without an EasyOrders store.
// The real storefront (Next.js) supplies the variables, layout wrappers, native
// product form, cart drawer and checkout; this harness only approximates them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Liquid } from "liquidjs";
import * as fx from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const theme = path.resolve(here, "../theme");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const engine = new Liquid({ strictFilters: true });
engine.registerFilter("raw", (v) => v);

const lang = process.env.PREVIEW_LANG || "ar";
const themeData = { ...JSON.parse(fs.readFileSync(path.join(theme, "theme-data.json"), "utf8")), ...fx.themeDataOverrides };
const base = { theme_data: themeData, lang };

function tpl(rel) {
  return fs.readFileSync(path.join(theme, rel), "utf8");
}
async function section(name, vars) {
  const html = await engine.parseAndRender(tpl(`sections/${name}.liquid`), { ...base, ...vars });
  return `<div data-eo-section="${name}">${html}</div>`;
}
async function home(key, data) {
  const html = await engine.parseAndRender(tpl(`home-sections/${key}/template.liquid`), { ...base, section_data: data, section_id: key.replace(/-/g, "_"), currency: fx.store.currency });
  return `<div data-eo-section="home:${key}">${html}</div>`;
}

const header = () => section("header", { ...fx.store, categories: fx.headerCategories });
const footer = () => section("footer", { ...fx.store, categories: fx.catThumbs });

function page(title, body) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Bazaar Pop preview</title>
<link rel="stylesheet" href="../../../theme/style.css">
<style>
  /* preview-only stand-ins for storefront layout wrappers */
  .pv-product { display:grid; gap:28px; padding-block:12px 40px; }
  @media (min-width: 960px) { .pv-product { grid-template-columns: minmax(0,1.05fr) minmax(0,1fr); align-items:start; } }
  .pv-native { border:3px dashed #8a8f9c; border-radius:18px; padding:16px; color:#4b5468; font-size:.9rem; background:#fff; }
  .pv-toast { position:fixed; bottom:110px; left:50%; transform:translateX(-50%); background:#0C1423; color:#fff; padding:10px 16px; border-radius:12px; z-index:999; font:600 14px system-ui; }
</style>
</head>
<body>
${body}
<script>window.__FIXTURE_PRODUCTS = ${JSON.stringify(fx.products)};</script>
<script src="../../mock-storefront.js"></script>
<script src="../../../theme/script.js"></script>
</body>
</html>`;
}

const pages = {};
// Home
{
  const parts = [await header(), await section("slider", { slides: fx.sliderSlides })];
  for (const [key, data] of fx.home) {
    if (key === "@categories") parts.push(await section("categories", { categories: fx.catThumbs, section_title: "" }));
    else if (key === "@list-products") parts.push(await section("list-products", { ...fx.store, products: fx.products.slice(0, 10), category: fx.catThumbs[0], section_title: "الأكثر مبيعاً (تجريبي)", currency: fx.store.currency, hide_view_all: false }));
    else parts.push(await home(key, data));
  }
  parts.push(await section("featured-products", { ...fx.store, products: fx.products.slice(2, 10), category: fx.catThumbs[1], section_title: "مشروبات (تجريبي)", currency: fx.store.currency }));
  parts.push(await section("home-products-grid", { ...fx.store, products: fx.products.slice(0, 10), category: fx.catThumbs[2], section_title: "وصل حديثاً (تجريبي)", currency: fx.store.currency }));
  parts.push(await footer());
  pages.home = page("Home", parts.join("\n"));
}
// Collection
pages.collection = page("Collection", [await header(), await section("products-grid", { ...fx.store, products: fx.products.slice(0, 12), category: fx.catThumbs[0], section_title: "سناكس", currency: fx.store.currency, hide_view_all: true }), await footer()].join("\n"));
pages["collection-empty"] = page("Empty collection", [await header(), await section("products-grid", { ...fx.store, products: [], category: fx.catThumbs[5], section_title: "بقالة", currency: fx.store.currency, hide_view_all: true }), await footer()].join("\n"));
pages["search-empty"] = page("Search empty", [await header(), await section("products-grid", { ...fx.store, products: [], category: null, section_title: "كلمة مش موجودة", currency: fx.store.currency, hide_view_all: true }), await footer()].join("\n"));
pages.search = page("Search", [await header(), await section("products-grid", { ...fx.store, products: fx.products.slice(3, 8), category: null, section_title: "قهوة", currency: fx.store.currency, hide_view_all: true }), await footer()].join("\n"));
// Product
{
  const p = fx.productPage;
  const left = await section("gallery", { images: p.images, mainImage: p.mainImage, product_name: p.product_name });
  const right = [
    await section("product-details", { ...p, description: "" }),
    `<div class="pv-native" data-preview-only>منطقة المنصة: اختيار المواصفات + الكمية + زرار أضف للسلة/اشتري الآن + فورم الطلب (بترسمها EasyOrders، مش جزء من الثيم)</div>`,
    await section("fake-stock", { text: "نص مخزون (لن يظهر إلا لو فعّلته)" }),
    await section("fake-visitor", { min: 10, max: 30, watching_text: "x" }),
    await section("product-description", { description: p.descriptionHtml, description_label: "الوصف", policies: p.policies, product_theme_data: p.product_theme_data }),
  ].join("\n");
  const body = [
    await header(),
    await section("breadcrumbs", { categories: p.breadcrumbs, product_name: p.product_name, home_text: "الرئيسية" }),
    `<main class="bp-container pv-product"><div>${left}</div><div style="display:grid;gap:18px">${right}</div></main>`,
    `<div class="bp-container">${await section("reviews", { reviews: p.reviews, reviews_count: 2, average_rating: 4.5, average_rating_display: "4.5", t_users_reviews: "آراء العملاء", t_reviews: "تقييم", t_share_your_review: "اكتب تقييمك", t_no_reviews: "لسه مفيش تقييمات" })}</div>`,
    await section("related-products", { ...fx.store, products: fx.products.slice(0, 8), category: fx.catThumbs[0], section_title: "منتجات مشابهة", currency: fx.store.currency }),
    await section("fixed-buy-button", { ...p, buy_now_text: "اشتري دلوقتي", quantity: 1, disabled: false, hide_quantity: false, increase_disabled: false }),
    await footer(),
  ].join("\n");
  pages.product = page("Product", body);
}
pages.thanks = page("Thanks", [await header(), await section("thanks", { content: "", show_home_button: true, thanks_title: "شكراً لطلبك!", thanks_message: "رسالة المنصة تظهر هنا.", phone_message: "", go_home_text: "الرئيسية", offers_text: "" }), await footer()].join("\n"));

for (const [name, html] of Object.entries(pages)) {
  fs.mkdirSync(path.join(out, lang), { recursive: true });
  fs.writeFileSync(path.join(out, lang, `${name}.html`), html);
  console.log("rendered", `preview/out/${lang}/${name}.html`);
}
