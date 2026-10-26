// PREVIEW-ONLY FIXTURES — fake catalogue used to render the theme locally.
// Nothing here is uploaded to EasyOrders and none of it is real store data.

const COLORS = ["#FFDE00", "#FF9EC4", "#7FE3C4", "#A9D6FF", "#FFB86B", "#F2452E", "#214BD9", "#C9B6FF"];
const SHAPES = ["can", "bag", "bottle", "box", "jar", "tube"];

function shapeSVG(kind, color, label) {
  const ink = "#0C1423";
  const body = {
    can: `<rect x="70" y="40" width="160" height="230" rx="26" fill="${color}" stroke="${ink}" stroke-width="8"/><rect x="70" y="40" width="160" height="34" rx="14" fill="#fff" stroke="${ink}" stroke-width="8"/><rect x="70" y="236" width="160" height="34" rx="14" fill="#fff" stroke="${ink}" stroke-width="8"/>`,
    bag: `<path d="M60 70 Q150 40 240 70 L230 260 Q150 285 70 260 Z" fill="${color}" stroke="${ink}" stroke-width="8" stroke-linejoin="round"/><path d="M60 70 L80 50 M240 70 L220 50" stroke="${ink}" stroke-width="8"/>`,
    bottle: `<rect x="125" y="20" width="50" height="40" rx="8" fill="#fff" stroke="${ink}" stroke-width="8"/><path d="M110 60 h80 l20 50 v150 a20 20 0 0 1 -20 20 h-80 a20 20 0 0 1 -20 -20 v-150z" fill="${color}" stroke="${ink}" stroke-width="8" stroke-linejoin="round"/>`,
    box: `<rect x="50" y="80" width="200" height="180" rx="18" fill="${color}" stroke="${ink}" stroke-width="8"/><path d="M50 130 h200" stroke="${ink}" stroke-width="8"/><rect x="135" y="80" width="30" height="180" fill="#fff" stroke="${ink}" stroke-width="6"/>`,
    jar: `<rect x="85" y="50" width="130" height="36" rx="10" fill="#fff" stroke="${ink}" stroke-width="8"/><rect x="70" y="84" width="160" height="186" rx="30" fill="${color}" stroke="${ink}" stroke-width="8"/>`,
    tube: `<path d="M100 40 h100 l-14 210 a10 10 0 0 1 -10 10 h-52 a10 10 0 0 1 -10 -10z" fill="${color}" stroke="${ink}" stroke-width="8" stroke-linejoin="round"/><rect x="120" y="258" width="60" height="26" rx="6" fill="#fff" stroke="${ink}" stroke-width="8"/>`,
  }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${body}<text x="150" y="${kind === "box" ? 115 : 180}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="30" fill="${ink}">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function flagSVG(a, b, c) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><rect width="60" height="40" fill="${a}"/><rect y="13" width="60" height="14" fill="${b}"/><circle cx="30" cy="20" r="6" fill="${c}"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function bannerSVG(text, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 600"><rect width="1600" height="600" fill="${bg}"/><circle cx="1300" cy="300" r="220" fill="#FFDE00" stroke="#0C1423" stroke-width="12"/><text x="800" y="330" text-anchor="middle" font-family="Arial" font-weight="700" font-size="90" fill="#fff">${text}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const names = [
  ["شيبسي بالجبنة الحارة", "CHIPS"], ["مشروب طاقة توت أزرق", "ENERGY"], ["بسكويت شوكولاتة مزدوج", "COOKIE"],
  ["قهوة مختصة محمصة", "COFFEE"], ["شاي ماتشا ياباني", "MATCHA"], ["كريم مرطب للوجه", "CREAM"],
  ["سيروم فيتامين سي", "SERUM"], ["جيلي فواكه كوري", "JELLY"], ["نودلز حارة", "NOODLE"],
  ["أكل قطط بالسلمون", "CAT"], ["لعبة كلاب مطاطية", "DOG"], ["عصير مانجو", "MANGO"],
  ["بوكس الهدايا الوردي", "GIFT"], ["بوكس السهرة", "PARTY"], ["تغليف هدايا فاخر", "WRAP"], ["كيس هدايا ورقي", "BAG"],
];

export const products = names.map(([name, label], i) => {
  const price = [45, 60, 85, 320, 210, 450, 690, 55, 70, 380, 150, 35, 950, 1250, 40, 15][i];
  const onSale = [0, 2, 5, 7, 12].includes(i);
  return {
    id: `p${i + 1}`,
    name,
    slug: `product-${i + 1}`,
    price,
    sale_price: onSale ? Math.round(price * 0.8) : null,
    thumb: shapeSVG(SHAPES[i % SHAPES.length], COLORS[i % COLORS.length], label),
    images: [shapeSVG(SHAPES[(i + 2) % SHAPES.length], COLORS[(i + 3) % COLORS.length], label)],
    variations: i === 5 ? [{ type: "color", props: [{ name: "50 مل", value: "#fff" }, { name: "100 مل", value: "#eee" }] }] : [],
    disable_orders_for_no_stock: i === 8,
    quantity: i === 8 ? 0 : 20,
    product_theme_data: i === 1 ? { custom_badge_title: "جديد", custom_badge_color: "mint", brand: "Blue Bolt" } : i === 3 ? { brand: "Roastery" } : {},
  };
});

export const headerCategories = [
  { name: "سناكس", url: "/collections/snacks", children: [{ name: "شيبسي", url: "/collections/chips" }, { name: "شوكولاتة", url: "/collections/chocolate" }] },
  { name: "مشروبات", url: "/collections/drinks" },
  { name: "قهوة وشاي", url: "/collections/coffee-tea" },
  { name: "عناية وتجميل", url: "/collections/beauty" },
  { name: "حيوانات أليفة", url: "/collections/pets" },
  { name: "بقالة", url: "/collections/grocery" },
  { name: "البراندات", url: "/pages/brands" },
];

export const catThumbs = headerCategories.map((c, i) => ({ name: c.name, slug: c.url.split("/").pop(), thumb: shapeSVG(SHAPES[i % 6], COLORS[(i + 1) % 8], "") }));

export const store = {
  store_name: "بازار بوب",
  logo: "",
  lang: "ar",
  currency: "ج.م",
  cart_count: 0,
  wishlist_count: 2,
  compare_count: 0,
  is_register_active: true,
  announcement_config: { type: "marquee", text: ["إعلان تجريبي رقم 1 — اكتب هنا عرضك الحقيقي", "إعلان تجريبي رقم 2", "إعلان تجريبي رقم 3"] },
  // footer
  pages: [{ title: "سياسة الاستبدال", slug: "returns" }, { title: "الشحن والتوصيل", slug: "shipping" }, { title: "تواصل معنا", slug: "contact" }],
  social: [{ type: "facebook", url: "#", label: "Facebook", icon: "" }, { type: "instagram", url: "#", label: "Instagram", icon: "" }, { type: "tiktok", url: "#", label: "TikTok", icon: "" }],
  year: 2026,
  payment_img: "",
  phone: "01000000000",
  email: "hello@example.com",
  address: "عنوان تجريبي — القاهرة",
  has_contact: true,
  shop_label: "تسوّق",
  help_label: "مساعدة",
  subscribe_label: "اشترك في النشرة",
  email_placeholder: "name@example.com",
  follow_label: "تابعنا",
  rights_label: "جميع الحقوق محفوظة",
  show_powered: true,
  add: "أضف",
  shop_now: "تسوّق دلوقتي",
  sale: "خصم",
};

export const themeDataOverrides = {
  whatsapp_number: "201000000000",
  currency_display: "ج.م",
  footer_about: "نص تجريبي عن المتجر — غيّره من إعدادات الثيم.",
  product_info_rows: [
    { icon: "🚚", title: "الشحن", text: "نص تجريبي: اكتب سياسة الشحن الحقيقية لمتجرك." },
    { icon: "💳", title: "الدفع", text: "نص تجريبي: اكتب طرق الدفع المتاحة فعلاً." },
  ],
};

const ids = (...n) => n.map((x) => `p${x}`);
export const home = [
  ["bp-country-strip", { title: "طعم من كل حتة في العالم", surface: "yellow", countries: [
    { label: "كوريا", flag: flagSVG("#fff", "#C60C30", "#003478"), link_url: "/collections/korea" },
    { label: "اليابان", flag: flagSVG("#fff", "#fff", "#BC002D"), link_url: "/collections/japan" },
    { label: "أمريكا", flag: flagSVG("#3C3B6E", "#B22234", "#fff"), link_url: "" },
    { label: "تركيا", flag: flagSVG("#E30A17", "#E30A17", "#fff"), link_url: "/collections/turkey" },
    { label: "إيطاليا", flag: flagSVG("#009246", "#fff", "#CE2B37"), link_url: "/collections/italy" },
    { label: "تايلاند", emoji: "🇹🇭", link_url: "/collections/thailand" },
  ] }],
  ["bp-hero", { kicker: "جديد كل أسبوع", title: "كل السناكس اللي بتحبها في مكان واحد", title_highlight: "السناكس", subtitle: "نص تجريبي: مستورد ومحلي، مشروبات وحلويات وعناية — اكتب وصف متجرك هنا.", primary_label: "تسوّق دلوقتي", primary_link_type: "url", primary_url: "/collections/snacks", secondary_label: "اعمل بوكسك", secondary_link_type: "url", secondary_url: "#gift-box", image_1: products[0].thumb, image_2: products[1].thumb, image_3: products[4].thumb, image_4: products[7].thumb, image_fit: "contain", collage_bg: "#A9D6FF", sticker_1: "ستيكر تجريبي", sticker_2: "نص حقيقي فقط", show_doodles: true, trust_items: [{ icon: "🚚", text: "نقطة ثقة تجريبية" }, { icon: "💵", text: "اكتب سياستك الحقيقية" }], surface: "cream" }],
  ["@categories", {}],
  ["bp-mood-cards", { title: "مزاجك النهارده إيه؟", title_highlight: "مزاجك", subtitle: "اختار المود واحنا نختارلك.", columns: "6", cards: [
    { label: "حاجة حلوة", sub: "شوكولاتة وبسكويت", color: "yellow", image: products[2].thumb, link_url: "/collections/sweet" },
    { label: "حاجة حراقة", sub: "سناكس سبايسي", color: "pink", image: products[8].thumb, link_url: "/collections/spicy" },
    { label: "فوقني", sub: "قهوة وطاقة", color: "mint", image: products[3].thumb, link_url: "/collections/coffee" },
    { label: "منعش", sub: "عصاير", color: "sky", image: products[11].thumb, link_url: "/collections/drinks" },
    { label: "سهرة", sub: "للتجمعات", color: "orange", emoji: "🎉", link_url: "/collections/party" },
    { label: "صحي", sub: "اختيارات أخف", color: "white", emoji: "🥗", link_url: "" },
  ] }],
  ["bp-category-feature", { kicker: "💄 ركن العناية", title: "عناية وجمال", title_highlight: "جمال", subtitle: "منتجات عناية مختارة.", surface: "pink", wave_top: true, chips: [{ label: "سكين كير", link_url: "/collections/skincare" }, { label: "شعر", link_url: "/collections/hair" }, { label: "عطور", link_url: "/collections/perfume" }], product_ids: ids(6, 7, 1, 3, 5, 12), cta_label: "شوف الكل", cta_link_type: "url", cta_url: "/collections/beauty" }],
  ["@list-products", {}],
  ["bp-promo-banner", { title: "املأ الدولاب بالحاجات الحلوة", title_highlight: "الحلوة", subtitle: "نص تجريبي للبانر.", image: products[12].thumb, burst_text: "نص تجريبي", box_color: "blue", cta_label: "يلا نتسوق", cta_link_type: "url", cta_url: "/collections/snacks" }],
  ["bp-wholesale", { kicker: "📦 الجملة", title: "اشتري بالجملة ووفّر", title_highlight: "بالجملة", subtitle: "للمحلات والكافيهات والمكاتب.", surface: "blue", wave_top: true, anchor_id: "wholesale", tiers: [
    { name: "شريحة تجريبية 1", quantity: "من 3 كراتين", unit_note: "الكرتونة = 24 علبة (مثال)", price_note: "السعر بيتأكد مع خدمة العملاء" },
    { name: "شريحة تجريبية 2", quantity: "من 10 كراتين", unit_note: "مثال", price_note: "مثال", badge: "الأكثر طلباً (مثال)", highlight: true },
    { name: "شريحة تجريبية 3", quantity: "من 25 كرتونة", unit_note: "مثال", price_note: "مثال" },
  ], disclaimer: "أسعار الجملة لا تُطبق تلقائياً في السلة؛ بيتم تأكيد السعر النهائي مع فريقنا قبل الشحن.", show_whatsapp: true, whatsapp_message: "أهلاً، عايز أسأل عن أسعار الجملة", cta_label: "تصفّح منتجات الجملة", cta_link_type: "url", cta_url: "/collections/wholesale" }],
  ["bp-gift-box-promo", { kicker: "🎁 بوكس الهدايا", title: "اعمل بوكس الهدايا بنفسك", title_highlight: "بنفسك", subtitle: "اختار الحاجات اللي بتحبها.", surface: "mint", wave_top: true, image_1: products[2].thumb, image_2: products[7].thumb, image_3: products[11].thumb, cta_label: "ابدأ البوكس", cta_link_type: "url", cta_url: "#gift-box" }],
  ["bp-gift-box-builder", { title: "ابني البوكس بتاعك", title_highlight: "البوكس", subtitle: "اختار من {min} لـ {max} قطعة.", anchor_id: "gift-box", item_ids: ids(1, 2, 3, 6, 8, 9, 12, 5), pack_ids: ids(15, 16), pack_required: false, min_items: 3, max_items: 10, show_message: true, message_hint: "اكتب رسالتك، وانسخها في ملاحظات الطلب.", open_cart: true, add_gap_ms: 150, add_label: "ضيف البوكس للسلة" }],
  ["bp-countdown", { kicker: "⏳ قريباً", title: "شحنة جديدة في الطريق", title_highlight: "جديدة", subtitle: "نص تجريبي.", surface: "ink", wave_top: true, target_datetime: "2026-12-01 20:00", timezone: "Africa/Cairo", date_label: "الثلاثاء 1 ديسمبر 2026 — 8 مساءً (مثال)", expired_behavior: "message", expired_message: "وصلت!", product_ids: ids(9, 10, 11, 4) }],
  ["bp-product-rail", { title: "بوكسات جاهزة", title_highlight: "جاهزة", product_ids: ids(13, 14, 13, 14), layout: "rail", card_style: "box", box_color: "pink", limit: 8, cta_label: "شوف الكل", cta_link_type: "url", cta_url: "/collections/boxes" }],
  ["bp-tabbed-products", { kicker: "🐾 الحيوانات الأليفة", title: "لأصحابنا الصغيرين", title_highlight: "الصغيرين", subtitle: "أكل وألعاب ومستلزمات.", surface: "sky", wave_top: true, tabs: [
    { label: "قطط", product_ids: ids(10, 11, 1, 2, 3), link_url: "/collections/cats" },
    { label: "كلاب", product_ids: ids(11, 10, 4), link_url: "/collections/dogs" },
    { label: "فارغ (لن يظهر)", product_ids: [] },
  ] }],
  ["bp-video-shop", { kicker: "🎬", title: "اتفرج واشتري", title_highlight: "اتفرج", subtitle: "فيديوهات قصيرة.", videos: [
    { video: "sample-1.mp4", poster: products[0].thumb, caption: "تعليق تجريبي", product_id: "p1" },
    { video: "sample-2.mp4", poster: products[3].thumb, caption: "تعليق تجريبي 2", product_id: "p6" },
    { video: "sample-3.mp4", poster: products[7].thumb, caption: "", product_id: "p8" },
    { video: "sample-4.mp4", poster: products[11].thumb, caption: "", product_id: "" },
  ] }],
  ["bp-newsletter", { title: "خليك أول واحد يعرف", title_highlight: "أول واحد", subtitle: "عروض ووصول جديد على إيميلك.", surface: "yellow", wave_top: true, placeholder: "name@example.com", button_label: "اشترك", footnote: "تقدر تلغي الاشتراك في أي وقت." }],
];

export const sliderSlides = [
  { image: bannerSVG("بانر تجريبي 1", "#214BD9"), mobile_image: "", url: "/collections/snacks", alt: "بانر تجريبي" },
  { image: bannerSVG("بانر تجريبي 2", "#F2452E"), mobile_image: "", url: "", alt: "" },
];

export const productPage = {
  product_id: "p3",
  product_name: products[2].name,
  price: 85,
  sale_price: 68,
  currency: "ج.م",
  rating: 4.5,
  reviews_count: 2,
  description: "",
  images: [products[2].thumb, products[2].images[0], products[0].thumb],
  mainImage: products[2].thumb,
  thumb: products[2].thumb,
  product_theme_data: { brand: "براند تجريبي", origin_country: "كوريا", origin_flag: flagSVG("#fff", "#C60C30", "#003478"), weight: "250 جم", sku: "SKU-0003", expiry_note: "مثال: مكتوبة على العبوة", custom_badge_title: "جديد", custom_badge_color: "mint", desc: [{ title_headline: "المكونات", title_desc: "نص تجريبي للمكونات." }] },
  descriptionHtml: "<p>وصف تجريبي للمنتج بصيغة HTML. اكتب الوصف الحقيقي من لوحة التحكم.</p><ul><li>نقطة 1</li><li>نقطة 2</li></ul>",
  policies: [{ icon: "", title: "سياسة الاستبدال", content: "<p>نص سياسة تجريبي.</p>" }],
  reviews: [
    { rating: 5, user_name: "عميل تجريبي", comment: "تقييم تجريبي للعرض فقط.", image: "" },
    { rating: 4, user_name: "عميل تجريبي 2", comment: "تقييم تجريبي آخر.", image: "" },
  ],
  breadcrumbs: [{ name: "سناكس", slug: "snacks" }, { name: "شوكولاتة", slug: "chocolate" }],
};
