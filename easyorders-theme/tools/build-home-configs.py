#!/usr/bin/env python3
"""Generates theme/home-sections/<key>/config.json for every Bazaar Pop home block.
Run after editing this file:  python3 tools/build-home-configs.py
Field types follow the EasyOrders dynamic-theme-data reference (no `default`
on entity pickers, `group` only on root fields)."""
import json, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "theme" / "home-sections"
ICON = "https://api.iconify.design/lucide:{}.svg"


def f(name, type_, desc, default=None, **extra):
    d = {"name": name, "type": type_, "description": desc}
    if default is not None:
        d["default"] = default
    d.update(extra)
    return d


def opts(*pairs):
    return [{"label": l, "value": v} for v, l in pairs]


SURFACES = opts(("cream", "كريمي"), ("blue", "أزرق"), ("yellow", "أصفر"), ("pink", "وردي"), ("mint", "نعناعي"), ("sky", "سماوي"), ("ink", "كحلي غامق"), ("white", "أبيض"), ("custom", "لون مخصص ↓"))


def look(default_surface="cream", wave=False, anchor=""):
    g = "الشكل (Look)"
    return [
        f("surface", "select", "خلفية السكشن", default_surface, options=SURFACES, group=g),
        f("bg_custom", "color", "اللون المخصص (لو اخترت لون مخصص)", "#FFFFFF", group=g),
        f("text_light", "boolean", "نص فاتح (للخلفيات الغامقة المخصصة)", False, group=g),
        f("wave_top", "boolean", "حافة متموجة أعلى السكشن", wave, group=g),
        f("anchor_id", "string", "معرّف للرابط المباشر بدون # (مثال: gift-box ← الرابط /#gift-box)", anchor, group=g),
        f("hide_on_mobile", "boolean", "إخفاء السكشن على الموبايل", False, group=g),
    ]


def heading(title="", highlight="", sub="", kicker=""):
    g = "العنوان (Heading)"
    return [
        f("kicker", "string", "سطر صغير فوق العنوان (اختياري)", kicker, group=g),
        f("title", "string", "العنوان", title, group=g),
        f("title_highlight", "string", "جزء من العنوان يتلوّن بالماركر (لازم يكون موجود في العنوان بالظبط)", highlight, group=g),
        f("subtitle", "string", "وصف قصير", sub, group=g),
        f("title_en", "string", "Title (English, optional)", "", group=g),
        f("subtitle_en", "string", "Subtitle (English, optional)", "", group=g),
    ]


def link(prefix, label_default, desc, type_default="category", group=None):
    g = group or ("الزرار " + desc)
    return [
        f(prefix + "_label", "string", "نص الزرار (فاضي = بدون زرار)", label_default, group=g),
        f(prefix + "_label_en", "string", "Button label (English)", "", group=g),
        f(prefix + "_link_type", "select", "الزرار يودّي على", type_default, options=opts(("category", "قسم"), ("product", "منتج"), ("page", "صفحة"), ("url", "رابط مكتوب")), group=g),
        f(prefix + "_category_id", "category_single_select", "القسم", group=g),
        f(prefix + "_product_id", "product_single_select", "المنتج", group=g),
        f(prefix + "_page_id", "page_single_select", "الصفحة", group=g),
        f(prefix + "_url", "string", "الرابط المكتوب (مثال: /collections/snacks أو /#gift-box)", "", group=g),
    ]


def tile_link():
    return [
        f("link_url", "string", "رابط مكتوب (اختياري، له الأولوية)", ""),
        f("category_id", "category_single_select", "أو اختار قسم"),
    ]


SECTIONS = {
    "bp-country-strip": {
        "icon": ICON.format("flag"),
        "label": "Bazaar Pop: شريط الدول",
        "section_schema": [
            f("title", "string", "العنوان", "طعم من كل حتة في العالم"),
            f("title_en", "string", "Title (English)", ""),
            f("countries", "object_array", "الدول (البلاط يبقى قابل للضغط فقط لو حطيت رابط أو قسم)", fields=[
                f("label", "string", "اسم الدولة", "كوريا"),
                f("label_en", "string", "Name (English)", ""),
                f("flag", "image", "صورة العلم (اختياري)", ""),
                f("emoji", "string", "إيموجي العلم لو مفيش صورة", "🇰🇷"),
            ] + tile_link()),
        ] + look("yellow"),
    },
    "bp-hero": {
        "icon": ICON.format("sparkles"),
        "label": "Bazaar Pop: الهيرو الرئيسي",
        "section_schema": heading("كل السناكس اللي بتحبها في مكان واحد", "السناكس", "مستورد ومحلي، مشروبات وحلويات وعناية — كله بيوصلك لحد البيت.", "") + link("primary", "تسوّق دلوقتي", "الأساسي") + link("secondary", "", "الثانوي", "url") + [
            f("image_1", "image", "صورة الكولاج 1 (الكبيرة)", "", group="الكولاج (Collage)"),
            f("image_2", "image", "صورة الكولاج 2", "", group="الكولاج (Collage)"),
            f("image_3", "image", "صورة الكولاج 3", "", group="الكولاج (Collage)"),
            f("image_4", "image", "صورة الكولاج 4", "", group="الكولاج (Collage)"),
            f("image_fit", "select", "طريقة عرض الصور", "contain", options=opts(("contain", "منتج مقصوص (contain)"), ("cover", "صورة كاملة (cover)")), group="الكولاج (Collage)"),
            f("collage_bg", "color", "خلفية الكولاج", "#A9D6FF", group="الكولاج (Collage)"),
            f("sticker_1", "string", "ستيكر 1 (اكتب معلومة حقيقية فقط، مثال: أسعار تبدأ من 25 ج)", "", group="الستيكرز (Stickers)"),
            f("sticker_2", "string", "ستيكر 2", "", group="الستيكرز (Stickers)"),
            f("sticker_3", "string", "ستيكر 3", "", group="الستيكرز (Stickers)"),
            f("show_doodles", "boolean", "رسومات وأسهم ديكور", True, group="الستيكرز (Stickers)"),
            f("trust_items", "object_array", "نقاط ثقة تحت الأزرار (اكتب سياسات متجرك الحقيقية فقط)", fields=[
                f("icon", "string", "إيموجي", "🚚"),
                f("text", "string", "النص", ""),
            ]),
        ] + look("cream"),
    },
    "bp-mood-cards": {
        "icon": ICON.format("smile"),
        "label": "Bazaar Pop: تسوّق حسب المزاج",
        "section_schema": heading("مزاجك النهارده إيه؟", "مزاجك", "اختار المود واحنا نختارلك.") + [
            f("columns", "select", "عدد الأعمدة على الكمبيوتر", "6", options=opts(("3", "3"), ("4", "4"), ("6", "6"))),
            f("cards", "object_array", "الكروت", fields=[
                f("label", "string", "العنوان", "حاجة حلوة"),
                f("label_en", "string", "Label (English)", ""),
                f("sub", "string", "سطر صغير", ""),
                f("color", "select", "اللون", "yellow", options=opts(("yellow", "أصفر"), ("pink", "وردي"), ("mint", "نعناعي"), ("sky", "سماوي"), ("orange", "برتقالي"), ("white", "أبيض"))),
                f("image", "image", "صورة منتج مقصوصة (PNG شفاف)", ""),
                f("emoji", "string", "إيموجي لو مفيش صورة", "🍫"),
            ] + tile_link()),
        ] + look("cream"),
    },
    "bp-category-feature": {
        "icon": ICON.format("heart-handshake"),
        "label": "Bazaar Pop: قسم مميز (العناية مثلاً)",
        "section_schema": heading("عناية وجمال", "جمال", "منتجات عناية مختارة بعناية.", "💄 ركن العناية") + [
            f("image", "image", "صورة جانبية (اختياري)", "", group="المحتوى (Content)"),
            f("chips", "object_array", "روابط الأقسام الفرعية", group="المحتوى (Content)", fields=[
                f("label", "string", "النص", "سكين كير"),
            ] + tile_link()),
            f("product_ids", "product_multi_select", "المنتجات المعروضة", group="المحتوى (Content)"),
        ] + link("cta", "شوف الكل", "شوف الكل") + look("pink", True),
    },
    "bp-promo-banner": {
        "icon": ICON.format("megaphone"),
        "label": "Bazaar Pop: بانر دعائي",
        "section_schema": heading("املأ الدولاب بالحاجات الحلوة", "الحلوة", "تشكيلة كبيرة من السناكس والمشروبات.") + [
            f("image", "image", "صورة (PNG شفاف مفضّل)", "", group="المحتوى (Content)"),
            f("burst_text", "string", "نص النجمة (اختياري — معلومة حقيقية فقط)", "", group="المحتوى (Content)"),
            f("box_color", "select", "لون البانر", "blue", options=opts(("blue", "أزرق"), ("yellow", "أصفر"), ("ink", "كحلي"), ("pink", "وردي")), group="المحتوى (Content)"),
        ] + link("cta", "يلا نتسوق", "الأساسي") + look("cream"),
    },
    "bp-wholesale": {
        "icon": ICON.format("package"),
        "label": "Bazaar Pop: الجملة / الكراتين",
        "section_schema": heading("اشتري بالجملة ووفّر", "بالجملة", "للمحلات والكافيهات والمكاتب: اطلب بالكرتونة.", "📦 الجملة") + [
            f("tiers", "object_array", "الشرائح (اكتب أرقامك الحقيقية)", group="الشرائح (Tiers)", fields=[
                f("name", "string", "اسم الشريحة", "شريحة 1"),
                f("quantity", "string", "الكمية/الحد الأدنى، مثال: من 3 كراتين", "من 3 كراتين"),
                f("unit_note", "string", "توضيح الوحدة، مثال: الكرتونة = 24 علبة", ""),
                f("price_note", "string", "ملاحظة السعر، مثال: سعر خاص بيتأكد مع خدمة العملاء", ""),
                f("badge", "string", "ستيكر (اختياري)", ""),
                f("highlight", "boolean", "تمييز الشريحة", False),
            ]),
            f("carton_info", "string", "معلومة عامة عن الكراتين (اختياري)", "", group="الشرائح (Tiers)"),
            f("disclaimer", "string", "تنبيه السعر النهائي", "أسعار الجملة لا تُطبق تلقائياً في السلة؛ بيتم تأكيد السعر النهائي مع فريقنا قبل الشحن.", group="الشرائح (Tiers)"),
            f("show_whatsapp", "boolean", "زرار واتساب للجملة (يستخدم رقم واتساب من إعدادات الثيم)", True, group="الشرائح (Tiers)"),
            f("whatsapp_message", "string", "رسالة واتساب الجاهزة", "أهلاً، عايز أسأل عن أسعار الجملة", group="الشرائح (Tiers)"),
        ] + link("cta", "تصفّح منتجات الجملة", "الأساسي") + look("blue", True, "wholesale"),
    },
    "bp-gift-box-promo": {
        "icon": ICON.format("gift"),
        "label": "Bazaar Pop: اعمل بوكسك (دعاية)",
        "section_schema": heading("اعمل بوكس الهدايا بنفسك", "بنفسك", "اختار الحاجات اللي بتحبها ونجهزهالك.", "🎁 بوكس الهدايا") + [
            f("steps", "object_array", "الخطوات (فاضي = خطوات افتراضية)", group="المحتوى (Content)", fields=[f("text", "string", "الخطوة", "")]),
            f("image_1", "image", "منتج 1 (PNG)", "", group="المحتوى (Content)"),
            f("image_2", "image", "منتج 2 (PNG)", "", group="المحتوى (Content)"),
            f("image_3", "image", "منتج 3 (PNG)", "", group="المحتوى (Content)"),
            f("box_image", "image", "صورة البوكس (اختياري بدل الرسمة)", "", group="المحتوى (Content)"),
        ] + link("cta", "ابدأ البوكس", "الأساسي", "url") + look("mint", True),
    },
    "bp-gift-box-builder": {
        "icon": ICON.format("boxes"),
        "label": "Bazaar Pop: بنّاء بوكس الهدايا",
        "section_schema": heading("ابني البوكس بتاعك", "البوكس", "اختار من {min} لـ {max} قطعة، واختار التغليف، وبعدين ضيفهم للسلة مرة واحدة.") + [
            f("item_ids", "product_multi_select", "المنتجات المتاحة للبوكس (المنتجات اللي ليها اختيارات/مقاسات هتظهر برابط لصفحتها بدل الإضافة المباشرة)", group="المنتجات (Products)"),
            f("pack_ids", "product_multi_select", "منتجات التغليف (اعمل كل نوع تغليف كمنتج بسعره الحقيقي)", group="المنتجات (Products)"),
            f("pack_required", "boolean", "التغليف إجباري", False, group="المنتجات (Products)"),
            f("min_items", "number", "أقل عدد قطع", 3, group="القواعد (Rules)"),
            f("max_items", "number", "أقصى عدد قطع", 12, group="القواعد (Rules)"),
            f("show_message", "boolean", "خانة رسالة الهدية (العميل بينسخها ويلصقها في ملاحظات الطلب)", True, group="القواعد (Rules)"),
            f("message_hint", "string", "توضيح رسالة الهدية", "اكتب رسالتك هنا، وبعد ما تضيف البوكس انسخها والصقها في خانة الملاحظات عند إتمام الطلب.", group="القواعد (Rules)"),
            f("open_cart", "boolean", "افتح السلة بعد الإضافة", True, group="القواعد (Rules)"),
            f("add_gap_ms", "number", "فاصل زمني بين إضافة كل قطعة بالمللي ثانية (زوّده لو لاحظت قطع ناقصة)", 600, group="القواعد (Rules)"),
            f("add_label", "string", "نص زرار الإضافة", "ضيف البوكس للسلة", group="القواعد (Rules)"),
        ] + look("cream", False, "gift-box"),
    },
    "bp-countdown": {
        "icon": ICON.format("timer"),
        "label": "Bazaar Pop: عدّ تنازلي (وصول جديد)",
        "section_schema": heading("وصل قريب!", "قريب", "شحنة جديدة في الطريق.", "⏳ قريباً") + [
            f("target_datetime", "string", "ميعاد الوصول الحقيقي بالصيغة YYYY-MM-DD HH:mm (مثال: 2026-12-01 20:00)", "", group="الميعاد (Date)"),
            f("timezone", "select", "المنطقة الزمنية", "Africa/Cairo", options=opts(("Africa/Cairo", "القاهرة"), ("Asia/Riyadh", "الرياض"), ("Asia/Dubai", "دبي"), ("UTC", "UTC")), group="الميعاد (Date)"),
            f("date_label", "string", "الميعاد بالكلام (يظهر حتى بدون جافاسكربت)، مثال: الإثنين 1 ديسمبر الساعة 8 مساءً", "", group="الميعاد (Date)"),
            f("expired_behavior", "select", "بعد انتهاء العد", "message", options=opts(("message", "اعرض رسالة"), ("hide", "اخفي السكشن")), group="الميعاد (Date)"),
            f("expired_message", "string", "رسالة بعد الانتهاء", "وصلت! اتفرج على الجديد 👇", group="الميعاد (Date)"),
            f("product_ids", "product_multi_select", "منتجات قادمة (اختياري)", group="الميعاد (Date)"),
            f("image", "image", "صورة (اختياري)", "", group="الميعاد (Date)"),
        ] + link("cta", "", "الأساسي") + look("ink", True),
    },
    "bp-product-rail": {
        "icon": ICON.format("gallery-horizontal"),
        "label": "Bazaar Pop: شريط منتجات / بوكسات جاهزة",
        "section_schema": heading("بوكسات جاهزة", "جاهزة", "") + [
            f("product_ids", "product_multi_select", "المنتجات", group="المنتجات (Products)"),
            f("layout", "select", "الشكل", "rail", options=opts(("rail", "شريط أفقي"), ("grid", "شبكة")), group="المنتجات (Products)"),
            f("card_style", "select", "شكل الكارت", "product", options=opts(("product", "منتج عادي"), ("box", "بوكس ملوّن")), group="المنتجات (Products)"),
            f("box_color", "select", "لون خلفية البوكس", "pink", options=opts(("pink", "وردي"), ("mint", "نعناعي"), ("yellow", "أصفر"), ("sky", "سماوي")), group="المنتجات (Products)"),
            f("limit", "number", "أقصى عدد", 12, group="المنتجات (Products)"),
        ] + link("cta", "شوف الكل", "شوف الكل") + look("cream"),
    },
    "bp-tabbed-products": {
        "icon": ICON.format("paw-print"),
        "label": "Bazaar Pop: منتجات بتبويبات (الحيوانات الأليفة)",
        "section_schema": heading("لأصحابنا الصغيرين", "الصغيرين", "أكل وألعاب ومستلزمات للقطط والكلاب.", "🐾 الحيوانات الأليفة") + [
            f("mascot", "image", "رسمة/ماسكوت (اختياري)", "", group="المحتوى (Content)"),
            f("tabs", "object_array", "التبويبات", group="المحتوى (Content)", fields=[
                f("label", "string", "اسم التبويب", "قطط"),
                f("label_en", "string", "Tab (English)", ""),
                f("product_ids", "product_multi_select", "منتجات التبويب"),
                f("link_url", "string", "رابط شوف الكل (اختياري)", ""),
                f("category_id", "category_single_select", "أو قسم شوف الكل"),
            ]),
        ] + look("sky", True),
    },
    "bp-video-shop": {
        "icon": ICON.format("clapperboard"),
        "label": "Bazaar Pop: اتفرج واشتري",
        "section_schema": heading("اتفرج واشتري", "اتفرج", "فيديوهات قصيرة لمنتجاتنا.", "🎬") + [
            f("videos", "object_array", "الفيديوهات (رأسي 9:16 مفضّل، ارفع فيديوهاتك أنت)", group="الفيديوهات (Videos)", fields=[
                f("video", "video", "الفيديو", ""),
                f("poster", "image", "صورة الغلاف", ""),
                f("caption", "string", "تعليق", ""),
                f("product_id", "product_single_select", "المنتج المرتبط"),
            ]),
            f("autoplay_muted", "boolean", "تشغيل تلقائي صامت عند الظهور (بدون صوت أبداً)", False, group="الفيديوهات (Videos)"),
        ] + look("cream"),
    },
    "bp-newsletter": {
        "icon": ICON.format("mail"),
        "label": "Bazaar Pop: الاشتراك في النشرة",
        "section_schema": heading("خليك أول واحد يعرف", "أول واحد", "عروض ووصول جديد على إيميلك، من غير إزعاج.") + [
            f("placeholder", "string", "نص خانة الإيميل", "name@example.com", group="النموذج (Form)"),
            f("button_label", "string", "نص الزرار", "اشترك", group="النموذج (Form)"),
            f("button_label_en", "string", "Button (English)", "Subscribe", group="النموذج (Form)"),
            f("footnote", "string", "سطر صغير تحت النموذج", "تقدر تلغي الاشتراك في أي وقت.", group="النموذج (Form)"),
            f("image", "image", "رسمة (اختياري)", "", group="النموذج (Form)"),
        ] + look("yellow", True),
    },
}


def main():
    for key, cfg in SECTIONS.items():
        names = [x["name"] for x in cfg["section_schema"]]
        assert len(names) == len(set(names)), f"duplicate field in {key}"
        d = OUT / key
        d.mkdir(parents=True, exist_ok=True)
        (d / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("wrote", key)


if __name__ == "__main__":
    main()
