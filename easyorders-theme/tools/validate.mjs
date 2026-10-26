// Static validation for the Bazaar Pop theme.
// - Parses every Liquid template with LiquidJS (the engine EasyOrders documents)
// - Checks schema.json / product-data-schema.json / home-sections config.json
//   against the field rules in the EasyOrders "Dynamic theme data" reference
// - Checks the header/footer keep the documented storefront hooks
// Usage: node tools/validate.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Liquid } from "liquidjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const theme = path.join(root, "theme");
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const REQUIRED_SECTIONS = [
  "header", "footer", "gallery", "product-details", "product-description", "featured-products",
  "list-products", "home-products-grid", "products-grid", "related-products", "slider", "categories",
  "reviews", "fake-visitor", "fake-stock", "fake-counter", "breadcrumbs", "fixed-buy-button", "thanks", "order-invoice",
];
const TYPES = new Set(["string", "number", "color", "boolean", "checkbox", "image", "video", "select", "multi_select",
  "product_multi_select", "category_multi_select", "page_multi_select", "product_single_select",
  "category_single_select", "page_single_select", "object_array"]);
const ENTITY = new Set(["product_multi_select", "category_multi_select", "page_multi_select", "product_single_select", "category_single_select", "page_single_select"]);

const engine = new Liquid({ strictFilters: true });
engine.registerFilter("raw", (v) => v);

function checkLiquid(file) {
  const src = fs.readFileSync(file, "utf8");
  try {
    engine.parse(src);
  } catch (e) {
    err(`${path.relative(root, file)}: Liquid parse error: ${e.message}`);
  }
  if (/@include\s/.test(src) && !/GENERATED/.test(src)) err(`${path.relative(root, file)}: unexpanded @include marker`);
  if (/\{%\s*(render|include|section|schema)\b/.test(src)) err(`${path.relative(root, file)}: uses a tag EasyOrders does not document (render/include/section/schema)`);
  // Shopify-only filters/objects that must not appear
  for (const bad of [/\|\s*money\b/, /\|\s*asset_url\b/, /\|\s*img_url\b/, /\|\s*t\s*\}\}/, /\{\{-?\s*shop\./, /\{\{-?\s*settings\./, /\bcollection\.products\b/]) {
    if (bad.test(src)) err(`${path.relative(root, file)}: Shopify-only construct ${bad}`);
  }
  return src;
}

function checkFields(fields, where, isRoot) {
  const names = new Set();
  for (const f of fields) {
    const id = `${where} → ${f.name || "(no name)"}`;
    if (!f.name || !f.type || !f.description) err(`${id}: name/type/description are required`);
    if (names.has(f.name)) err(`${id}: duplicate name`);
    names.add(f.name);
    if (!TYPES.has(f.type)) err(`${id}: unknown type ${f.type}`);
    if (ENTITY.has(f.type) && "default" in f) err(`${id}: entity pickers must not have default`);
    if ((f.type === "select" || f.type === "multi_select") && !(Array.isArray(f.options) && f.options.length)) err(`${id}: select needs options`);
    if (f.type === "select" && "default" in f && !f.options.some((o) => o.value === f.default)) err(`${id}: default not in options`);
    if (!isRoot && "group" in f) err(`${id}: group is only allowed on root fields`);
    if (f.type === "object_array") {
      if (!isRoot) err(`${id}: nested object_array is not supported`);
      if (!Array.isArray(f.fields) || !f.fields.length) err(`${id}: object_array needs fields`);
      else checkFields(f.fields, id, false);
    }
    if (f.type === "number" && "default" in f && typeof f.default !== "number") err(`${id}: number default must be a number`);
    if ((f.type === "boolean" || f.type === "checkbox") && "default" in f && typeof f.default !== "boolean") err(`${id}: boolean default must be boolean`);
  }
  return names;
}

// 1. built-in sections
const secDir = path.join(theme, "sections");
const present = fs.readdirSync(secDir).filter((f) => f.endsWith(".liquid")).map((f) => f.replace(/\.liquid$/, ""));
for (const s of REQUIRED_SECTIONS) if (!present.includes(s)) err(`missing sections/${s}.liquid`);
for (const s of present) if (!REQUIRED_SECTIONS.includes(s)) warn(`sections/${s}.liquid is not in the documented file map (will be ignored or rejected)`);
const sources = {};
for (const s of present) sources[s] = checkLiquid(path.join(secDir, `${s}.liquid`));

// 2. schemas
const schema = JSON.parse(fs.readFileSync(path.join(theme, "schema.json"), "utf8"));
const schemaNames = checkFields(schema, "schema.json", true);
checkFields(JSON.parse(fs.readFileSync(path.join(theme, "product-data-schema.json"), "utf8")), "product-data-schema.json", true);
const td = JSON.parse(fs.readFileSync(path.join(theme, "theme-data.json"), "utf8"));
for (const k of Object.keys(td)) if (!schemaNames.has(k)) err(`theme-data.json key "${k}" is not defined in schema.json`);

// theme_data keys used in templates must exist in schema.json
const used = new Set();
const allSrc = [...Object.values(sources)];

// 3. home sections
const homeDir = path.join(theme, "home-sections");
const keys = new Set();
for (const dir of fs.readdirSync(homeDir)) {
  const p = path.join(homeDir, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dir)) err(`home-sections/${dir}: folder must be lowercase kebab-case`);
  const key = dir.replace(/-/g, "_");
  if (keys.has(key)) err(`home-sections/${dir}: duplicate key ${key}`);
  keys.add(key);
  const cfgPath = path.join(p, "config.json");
  const tplPath = path.join(p, "template.liquid");
  if (!fs.existsSync(cfgPath) || !fs.existsSync(tplPath)) {
    err(`home-sections/${dir}: needs config.json and template.liquid`);
    continue;
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (!cfg.label || !cfg.icon || !Array.isArray(cfg.section_schema)) err(`home-sections/${dir}: config needs icon, label, section_schema`);
  const names = checkFields(cfg.section_schema || [], `home-sections/${dir}`, true);
  const tpl = checkLiquid(tplPath);
  allSrc.push(tpl);
  for (const m of tpl.matchAll(/section_data\.([a-z0-9_]+)/g)) if (!names.has(m[1])) err(`home-sections/${dir}: section_data.${m[1]} not in section_schema`);
  const PARTIAL_OPTIONAL = new Set(["kicker", "title", "title_highlight", "subtitle", "title_en", "subtitle_en"]);
  for (const m of tpl.matchAll(/\bsd\.([a-z0-9_]+)/g)) if (!names.has(m[1]) && !PARTIAL_OPTIONAL.has(m[1])) err(`home-sections/${dir}: sd.${m[1]} not in section_schema`);
}
for (const src of allSrc) for (const m of src.matchAll(/(?<![a-z_.])theme_data\.([a-z0-9_]+)/g)) used.add(m[1]);
for (const k of used) if (!schemaNames.has(k)) err(`theme_data.${k} is used in a template but not defined in schema.json`);
for (const s of Object.values(sources)) if (/section_data/.test(s)) err("section_data must not be used in built-in sections");

// 4. documented storefront hooks
const h = sources.header || "";
for (const hook of ['id="header-cart-count"', "cart-click", "cart-btn", 'id="header-lang-btn"', 'id="header-lang-mobile"', "lang-btn", "lang-click", "register-click", "register-btn", "is_register_active", 'href="/wishlist"', 'id="header-wishlist-count"']) {
  if (!h.includes(hook)) err(`header.liquid is missing storefront hook ${hook}`);
}
const idCounts = {};
for (const m of h.matchAll(/\sid="([^"{]+)"/g)) idCounts[m[1]] = (idCounts[m[1]] || 0) + 1;
for (const [id, n] of Object.entries(idCounts)) if (n > 1) err(`header.liquid: duplicate id ${id}`);
if (!(sources.footer || "").includes("footer-subscribe")) err("footer.liquid must dispatch footer-subscribe");
for (const s of ["featured-products", "list-products", "home-products-grid", "products-grid", "related-products"]) {
  if (!sources[s].includes("'quick-add'")) err(`${s}: quick-add event missing`);
}
if (!(sources["fixed-buy-button"] || "").includes("'buy-now'")) err("fixed-buy-button: buy-now missing");
// every CustomEvent dispatched must bubble
for (const src of allSrc) for (const m of src.matchAll(/new CustomEvent\('([a-z-]+)',\{([^}]*)/g)) if (!/bubbles:\s*true/.test(m[2])) err(`CustomEvent ${m[1]} dispatched without bubbles:true`);

// 5. script / style sanity
const js = fs.readFileSync(path.join(theme, "script.js"), "utf8");
try {
  new Function(js);
} catch (e) {
  err(`script.js syntax error: ${e.message}`);
}
if (/localStorage\.setItem\(['"][^'"]*cart/i.test(js)) err("script.js must not keep its own cart in localStorage");
if (/(api[_-]?key|secret|bearer\s)/i.test(js)) err("script.js appears to contain a credential");
const css = fs.readFileSync(path.join(theme, "style.css"), "utf8");
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
if (open !== close) err(`style.css has unbalanced braces (${open} vs ${close})`);
if (!/prefers-reduced-motion/.test(css)) err("style.css must respect prefers-reduced-motion");

console.log(`Checked ${present.length} sections, ${keys.size} home sections, ${schema.length} theme settings.`);
for (const w of warnings) console.log("WARN ", w);
for (const e of errors) console.log("ERROR", e);
console.log(errors.length ? `\n✖ ${errors.length} error(s)` : "\n✔ validation passed");
process.exit(errors.length ? 1 : 0);
