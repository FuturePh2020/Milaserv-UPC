/* ==========================================================================
   Bazaar Pop — EasyOrders custom theme
   Global script (uploaded as theme_script, loaded on every page).

   Rules this file follows:
   - Storefront actions (cart, wishlist, quick view, newsletter) are ONLY
     triggered through the documented bubbling CustomEvents, dispatched from an
     element inside the section so the storefront's section listener handles
     them. Nothing here keeps its own cart or claims success on its own.
   - Every init function is idempotent (guarded by data attributes) and all
     interaction is delegated from `document` once, so SPA navigation and the
     MutationObserver never stack duplicate listeners.
   - Public catalogue reads only (products / categories / simple-pages).
     No API keys or credentials belong in this file.
   ========================================================================== */
(function () {
  "use strict";

  if (window.__bpTheme) {
    window.__bpTheme.run();
    return;
  }

  var API_FALLBACK = "https://api.easy-orders.net/api/v1";
  var docEl = document.documentElement;
  docEl.classList.add("bp-js");

  /* ---------- helpers ---------------------------------------------------- */
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function isRTL() {
    var d = (docEl.getAttribute("dir") || (document.body && document.body.getAttribute("dir")) || "").toLowerCase();
    if (d) return d === "rtl";
    return getLang() === "ar";
  }
  var nextDataCache = null;
  function nextData() {
    if (nextDataCache !== null) return nextDataCache;
    nextDataCache = {};
    try {
      var el = document.getElementById("__NEXT_DATA__");
      if (el) nextDataCache = JSON.parse(el.textContent) || {};
    } catch (e) {}
    return nextDataCache;
  }
  function appSettings() {
    var d = nextData();
    return (d && d.props && d.props.pageProps && d.props.pageProps.appSettings) || {};
  }
  function getLang() {
    var l = (docEl.getAttribute("lang") || "").toLowerCase();
    var s = appSettings();
    var pp = (nextData().props || {}).pageProps || {};
    l = String(s.lang || pp.locale || l || "ar").toLowerCase().split("-")[0];
    return l || "ar";
  }

  var I18N = {
    ar: {
      add: "أضف",
      addLong: "أضف للسلة",
      choose: "اختار",
      chooseLong: "اختار المواصفات من صفحة المنتج",
      oos: "نفدت الكمية",
      wishlist: "إضافة أو إزالة من المفضلة",
      empty: "مفيش منتجات هنا دلوقتي.",
      error: "حصلت مشكلة في تحميل المنتجات. جرّب تحدّث الصفحة.",
      retry: "حاول تاني",
      days: "يوم",
      hours: "ساعة",
      minutes: "دقيقة",
      seconds: "ثانية",
      play: "تشغيل الفيديو",
      pause: "إيقاف الفيديو",
      prev: "السابق",
      next: "التالي",
      sending: "بنضيف {n} من {t} للسلة…",
      sent: "طلبنا إضافة {t} قطعة للسلة. افتح السلة واتأكد من المنتجات والكميات قبل إتمام الطلب.",
      needMore: "ناقصك {n} قطعة عشان توصل للحد الأدنى ({min}).",
      maxReached: "وصلت للحد الأقصى للبوكس ({max} قطعة).",
      ready: "البوكس جاهز! اضغط أضف للسلة.",
      copied: "اتنسخت الرسالة. الصقها في خانة الملاحظات وقت إتمام الطلب.",
      copyFail: "مقدرناش ننسخ تلقائياً، انسخ الرسالة يدوياً.",
      noPack: "بدون تغليف",
      estimate: "إجمالي تقديري",
      items: "قطعة",
      inc: "زوّد",
      dec: "قلّل",
      remove: "شيل"
    },
    en: {
      add: "Add",
      addLong: "Add to cart",
      choose: "Choose",
      chooseLong: "Choose options on the product page",
      oos: "Out of stock",
      wishlist: "Add to or remove from wishlist",
      empty: "No products here yet.",
      error: "We couldn't load these products. Please refresh the page.",
      retry: "Try again",
      days: "Days",
      hours: "Hours",
      minutes: "Min",
      seconds: "Sec",
      play: "Play video",
      pause: "Pause video",
      prev: "Previous",
      next: "Next",
      sending: "Adding {n} of {t} to your cart…",
      sent: "We requested {t} items to be added to your cart. Open the cart and confirm items and quantities before checkout.",
      needMore: "Add {n} more to reach the minimum ({min}).",
      maxReached: "You reached the box maximum ({max} items).",
      ready: "Your box is ready! Press add to cart.",
      copied: "Message copied. Paste it into the order notes at checkout.",
      copyFail: "Couldn't copy automatically, please copy the message manually.",
      noPack: "No packaging",
      estimate: "Estimated total",
      items: "items",
      inc: "Increase",
      dec: "Decrease",
      remove: "Remove"
    }
  };
  function t(key, vars) {
    var dict = I18N[getLang()] || I18N.ar;
    var s = dict[key] != null ? dict[key] : I18N.ar[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      });
    }
    return s;
  }

  function apiBase(el) {
    var wrap = el && el.closest ? el.closest("[data-eo-api-base]") : null;
    var v = (wrap && wrap.getAttribute("data-eo-api-base")) || (typeof window.__EO_STORE_API_BASE__ === "string" && window.__EO_STORE_API_BASE__) || API_FALLBACK;
    return String(v).replace(/\/$/, "");
  }

  function fmtNumber(n) {
    var num = Number(n);
    if (!isFinite(num)) return String(n == null ? "" : n);
    return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function currencyFor(el) {
    var host = el && el.closest ? el.closest("[data-bp-currency]") : null;
    var c = host ? host.getAttribute("data-bp-currency") : "";
    if (c) return c;
    var s = appSettings();
    return s.currency_symbol || s.currency || "";
  }

  /* fetch entities by id, preserving the merchant's order; cached per run */
  var entityCache = {};
  function fetchEntities(entity, ids, el) {
    var clean = ids
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(Boolean);
    if (!clean.length) return Promise.resolve([]);
    var path = entity === "categories" ? "categories" : entity === "pages" ? "simple-pages" : "products";
    var key = path + ":" + clean.join(",");
    if (entityCache[key]) return entityCache[key];
    var url = apiBase(el) + "/" + path + "?filter=id||$in||" + clean.map(encodeURIComponent).join(",") + "&limit=" + Math.max(clean.length, 1);
    var p = fetch(url, { credentials: "omit", headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (body) {
        var rows = Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : [];
        var byId = {};
        rows.forEach(function (r) {
          if (r && r.id != null) byId[String(r.id)] = r;
        });
        return clean
          .map(function (id) {
            return byId[id];
          })
          .filter(Boolean);
      });
    p.catch(function () {
      delete entityCache[key];
    });
    entityCache[key] = p;
    return p;
  }

  function hasVariants(p) {
    return (Array.isArray(p.variations) && p.variations.length > 0) || (Array.isArray(p.variants) && p.variants.length > 0);
  }
  function truthy(v) {
    return v === true || v === 1 || v === "1" || v === "true";
  }
  function isOutOfStock(p) {
    // Mirrors the official starter theme: only treat a product as unavailable
    // when the store blocks orders for zero stock AND the data says it is out.
    if (!truthy(p.disable_orders_for_no_stock)) return false;
    if (p.in_stock === false || p.available === false) return true;
    if (!hasVariants(p) && typeof p.quantity === "number") return p.quantity <= 0;
    return false;
  }
  function priceOf(p) {
    var price = Number(p.price) || 0;
    var sale = p.sale_price != null && p.sale_price !== "" ? Number(p.sale_price) : NaN;
    var onSale = isFinite(sale) && sale > 0 && sale < price;
    return { now: onSale ? sale : price, old: onSale ? price : 0, onSale: onSale };
  }

  var ICONS = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>'
  };

  /* Card markup used by hydrated (picker-based) home sections. Mirrors the
     Liquid product card in sections/*.liquid. */
  function productCardHTML(p, opts) {
    opts = opts || {};
    var cur = esc(opts.currency || "");
    var pr = priceOf(p);
    var oos = isOutOfStock(p);
    var variants = hasVariants(p);
    var slug = encodeURIComponent(p.slug || "");
    var href = "/products/" + slug;
    var name = esc(p.name || "");
    var img = p.thumb || (Array.isArray(p.images) && p.images[0]) || "";
    var badges = "";
    if (pr.onSale && opts.showSale !== false) {
      var pct = Math.floor(((pr.old - pr.now) * 100) / pr.old);
      if (pct > 0) badges += '<span class="bp-sticker bp-sticker--red">-' + pct + "%</span>";
    }
    if (oos) badges += '<span class="bp-sticker bp-sticker--muted">' + esc(opts.oosLabel || t("oos")) + "</span>";
    var id = esc(p.id);
    var actions = "";
    if (oos) {
      actions = '<span class="bp-card__oos">' + esc(opts.oosLabel || t("oos")) + "</span>";
    } else if (opts.quickAdd !== false) {
      if (variants) {
        actions =
          '<button type="button" class="bp-btn bp-btn--white bp-card__add" aria-label="' + esc(t("chooseLong")) + " - " + name + '" onclick="event.preventDefault();event.stopPropagation();this.dispatchEvent(new CustomEvent(\'quick-view\',{bubbles:true,detail:{productId:\'' + id + "'}}));\">" + esc(t("choose")) + "</button>";
      } else {
        actions =
          '<button type="button" class="bp-btn bp-card__add" aria-label="' + esc(t("addLong")) + " - " + name + '" onclick="event.preventDefault();event.stopPropagation();this.dispatchEvent(new CustomEvent(\'quick-add\',{bubbles:true,detail:{productId:\'' + id + "'}}));\">" + ICONS.plus + "<span>" + esc(opts.addLabel || t("add")) + "</span></button>";
      }
    }
    if (opts.wishlist !== false) {
      actions +=
        '<button type="button" class="bp-icon-btn" aria-label="' + esc(t("wishlist")) + " - " + name + '" onclick="event.preventDefault();event.stopPropagation();this.dispatchEvent(new CustomEvent(\'toggle-wishlist\',{bubbles:true,detail:{productId:\'' + id + "'}}));\">" + ICONS.heart + "</button>";
    }
    return (
      '<article class="bp-card' + (opts.variant === "box" ? " bp-card--box" : "") + (oos ? " bp-card--oos" : "") + '">' +
      '<a class="bp-card__link" href="' + href + '">' +
      '<div class="bp-card__media">' +
      (badges ? '<div class="bp-card__badges">' + badges + "</div>" : "") +
      (img ? '<img class="bp-card__img-main" src="' + esc(img) + '" alt="' + name + '" loading="lazy" decoding="async" width="400" height="400">' : '<span class="bp-card__media--empty" aria-hidden="true">🛍️</span>') +
      "</div>" +
      '<div class="bp-card__body"><h3 class="bp-card__name">' + name + "</h3>" +
      '<div class="bp-price">' +
      '<span class="bp-price__now' + (pr.onSale ? " bp-price__now--sale" : "") + '"><span class="bp-money">' + esc(fmtNumber(pr.now)) + "</span> " + cur + "</span>" +
      (pr.onSale ? '<span class="bp-price__old"><span class="bp-visually-hidden">' + (getLang() === "ar" ? "بدلاً من" : "was") + ' </span><span class="bp-money">' + esc(fmtNumber(pr.old)) + "</span> " + cur + "</span>" : "") +
      "</div></div></a>" +
      (actions ? '<div class="bp-card__actions">' + actions + "</div>" : "") +
      "</article>"
    );
  }

  /* ---------- 1. product hydration for picker-based sections ------------- */
  function renderProductsInto(container, rows) {
    var mount = $("[data-bp-mount]", container) || container;
    var opts = {
      currency: currencyFor(container),
      variant: container.getAttribute("data-bp-card") || "",
      quickAdd: container.getAttribute("data-bp-quick-add") !== "false",
      wishlist: container.getAttribute("data-bp-wishlist") !== "false",
      showSale: container.getAttribute("data-bp-sale") !== "false",
      oosLabel: container.getAttribute("data-bp-oos-label") || "",
      addLabel: container.getAttribute("data-bp-add-label") || ""
    };
    var limit = parseInt(container.getAttribute("data-bp-limit"), 10) || 0;
    if (limit > 0) rows = rows.slice(0, limit);
    if (!rows.length) {
      mount.innerHTML = '<div class="bp-state" role="status"><span class="bp-state__icon" aria-hidden="true">🫙</span><p>' + esc(t("empty")) + "</p></div>";
      container.setAttribute("data-bp-state", "empty");
      return;
    }
    var wrapTag = mount.tagName === "UL" || mount.tagName === "OL" ? "li" : "div";
    mount.innerHTML = rows
      .map(function (p) {
        return "<" + wrapTag + ' class="bp-cell">' + productCardHTML(p, opts) + "</" + wrapTag + ">";
      })
      .join("");
    container.setAttribute("data-bp-state", "ready");
    var rail = container.closest(".bp-rail");
    if (rail) updateRail(rail);
  }
  function hydrateProducts(container) {
    if (container.getAttribute("data-bp-hydrated")) return;
    if (container.closest("[hidden]")) return; // lazy: inactive tab panels hydrate when shown
    var ids = (container.getAttribute("data-bp-products") || "").split(",").filter(Boolean);
    container.setAttribute("data-bp-hydrated", "1");
    if (!ids.length) return;
    container.setAttribute("aria-busy", "true");
    fetchEntities("products", ids, container)
      .then(function (rows) {
        renderProductsInto(container, rows);
      })
      .catch(function () {
        var mount = $("[data-bp-mount]", container) || container;
        mount.innerHTML =
          '<div class="bp-state" role="alert"><span class="bp-state__icon" aria-hidden="true">⚠️</span><p>' + esc(t("error")) + '</p><button type="button" class="bp-btn bp-btn--white bp-btn--sm" data-bp-retry>' + esc(t("retry")) + "</button></div>";
        container.removeAttribute("data-bp-hydrated");
        container.setAttribute("data-bp-state", "error");
      })
      .then(function () {
        container.removeAttribute("aria-busy");
      });
  }
  function initHydration() {
    $$("[data-bp-products]:not([data-bp-hydrated])").forEach(hydrateProducts);
  }

  /* ---------- 2. resolve entity links (category / product / page IDs) ---- */
  function initEntityLinks() {
    var groups = {};
    $$("a[data-bp-link-id]:not([data-bp-link-done])").forEach(function (a) {
      var id = (a.getAttribute("data-bp-link-id") || "").trim();
      var ent = a.getAttribute("data-bp-link-entity") || "categories";
      a.setAttribute("data-bp-link-done", "1");
      if (!id) return;
      (groups[ent] = groups[ent] || []).push({ a: a, id: id });
    });
    Object.keys(groups).forEach(function (ent) {
      var list = groups[ent];
      var ids = list.map(function (x) {
        return x.id;
      });
      var uniq = ids.filter(function (v, i) {
        return ids.indexOf(v) === i;
      });
      fetchEntities(ent, uniq, list[0].a)
        .then(function (rows) {
          var bySlug = {};
          rows.forEach(function (r) {
            bySlug[String(r.id)] = r;
          });
          list.forEach(function (x) {
            var r = bySlug[x.id];
            if (!r || !r.slug) return;
            var prefix = ent === "categories" ? "/collections/" : ent === "pages" ? "/pages/" : "/products/";
            x.a.setAttribute("href", prefix + encodeURIComponent(r.slug));
            x.a.removeAttribute("aria-disabled");
            x.a.removeAttribute("tabindex");
          });
        })
        .catch(function () {});
    });
  }

  /* ---------- 3. single product chips (video cards etc.) ----------------- */
  function initProductChips() {
    var chips = $$("[data-bp-product-chip]:not([data-bp-chip-done])");
    if (!chips.length) return;
    var ids = [];
    chips.forEach(function (c) {
      c.setAttribute("data-bp-chip-done", "1");
      var id = c.getAttribute("data-bp-product-chip");
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    fetchEntities("products", ids, chips[0])
      .then(function (rows) {
        var byId = {};
        rows.forEach(function (r) {
          byId[String(r.id)] = r;
        });
        chips.forEach(function (c) {
          var p = byId[c.getAttribute("data-bp-product-chip")];
          if (!p) {
            c.hidden = true;
            return;
          }
          var pr = priceOf(p);
          var cur = esc(currencyFor(c));
          var img = p.thumb || (Array.isArray(p.images) && p.images[0]) || "";
          var name = esc(p.name || "");
          var id = esc(p.id);
          var btn = "";
          if (!isOutOfStock(p)) {
            var ev = hasVariants(p) ? "quick-view" : "quick-add";
            var label = hasVariants(p) ? t("chooseLong") : t("addLong");
            btn = '<button type="button" class="bp-icon-btn" aria-label="' + esc(label) + " - " + name + '" onclick="event.preventDefault();event.stopPropagation();this.dispatchEvent(new CustomEvent(\'' + ev + "',{bubbles:true,detail:{productId:'" + id + "'}}));\">" + ICONS.plus + "</button>";
          }
          c.innerHTML =
            (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" width="52" height="52">' : "") +
            '<a href="/products/' + encodeURIComponent(p.slug || "") + '"><span class="bp-vcard__product-name">' + name + '</span><span class="bp-price__now' + (pr.onSale ? " bp-price__now--sale" : "") + '"><span class="bp-money">' + esc(fmtNumber(pr.now)) + "</span> " + cur + "</span></a>" +
            btn;
          c.hidden = false;
        });
      })
      .catch(function () {
        chips.forEach(function (c) {
          c.hidden = true;
        });
      });
  }

  /* ---------- 4. rails (horizontal scrollers) ---------------------------- */
  function updateRail(rail) {
    var track = $(".bp-rail__track", rail);
    var nav = $(".bp-rail__nav", rail.closest("[data-bp-rail-scope]") || rail);
    if (!track || !nav || rail.closest("[hidden]")) return;
    var max = track.scrollWidth - track.clientWidth;
    var pos = Math.abs(track.scrollLeft);
    nav.hidden = max <= 4;
    var prev = $("[data-bp-rail='prev']", nav);
    var next = $("[data-bp-rail='next']", nav);
    if (prev) prev.disabled = pos <= 4;
    if (next) next.disabled = pos >= max - 4;
  }
  function initRails() {
    $$(".bp-rail:not([data-bp-rail-ready])").forEach(function (rail) {
      var track = $(".bp-rail__track", rail);
      if (!track) return;
      rail.setAttribute("data-bp-rail-ready", "1");
      track.addEventListener(
        "scroll",
        function () {
          updateRail(rail);
        },
        { passive: true }
      );
      updateRail(rail);
    });
  }

  /* ---------- 5. announcement strip -------------------------------------- */
  function initAnnouncement() {
    $$(".bp-marquee:not([data-bp-ready])").forEach(function (m) {
      m.setAttribute("data-bp-ready", "1");
      if (reduceMotion.matches) return;
      var group = $(".bp-marquee__group", m);
      if (!group) return;
      var speed = parseFloat(m.getAttribute("data-speed")) || 40;
      var w = group.getBoundingClientRect().width;
      if (w < 10) return;
      m.style.setProperty("--bp-marquee-shift", "50%");
      m.style.setProperty("--bp-marquee-dur", Math.max(w / Math.max(speed, 5), 8) + "s");
      m.classList.add("is-running");
    });
    $$("[data-bp-rotator]:not([data-bp-ready])").forEach(function (root) {
      root.setAttribute("data-bp-ready", "1");
      var slides = $$(":scope > *", root);
      if (slides.length < 2 || reduceMotion.matches) {
        slides.forEach(function (s, i) {
          s.classList.toggle("is-active", i === 0);
        });
        return;
      }
      var i = 0;
      var paused = false;
      var host = root.closest(".bp-announce") || root;
      host.addEventListener("mouseenter", function () {
        paused = true;
      });
      host.addEventListener("mouseleave", function () {
        paused = false;
      });
      host.addEventListener("focusin", function () {
        paused = true;
      });
      host.addEventListener("focusout", function () {
        paused = false;
      });
      var timer = setInterval(function () {
        if (!document.body.contains(root)) {
          clearInterval(timer);
          return;
        }
        if (paused || document.hidden) return;
        slides[i].classList.remove("is-active");
        i = (i + 1) % slides.length;
        slides[i].classList.add("is-active");
      }, 4000);
    });
  }

  /* ---------- 6. header: drawer, dropdowns, sticky ----------------------- */
  var lastFocus = null;
  function drawer() {
    return document.getElementById("bp-mobile-menu");
  }
  function openDrawer(trigger) {
    var d = drawer();
    var ov = document.getElementById("bp-drawer-overlay");
    if (!d) return;
    lastFocus = trigger || document.activeElement;
    d.classList.add("is-open");
    d.removeAttribute("inert");
    d.setAttribute("aria-hidden", "false");
    if (ov) ov.classList.add("is-open");
    document.body.classList.add("bp-scroll-lock");
    $$("[data-bp-menu-open]").forEach(function (b) {
      b.setAttribute("aria-expanded", "true");
    });
    var first = $("[data-bp-menu-close]", d) || d;
    setTimeout(function () {
      first.focus();
    }, 30);
  }
  function closeDrawer() {
    var d = drawer();
    var ov = document.getElementById("bp-drawer-overlay");
    if (!d || !d.classList.contains("is-open")) return;
    d.classList.remove("is-open");
    d.setAttribute("aria-hidden", "true");
    d.setAttribute("inert", "");
    if (ov) ov.classList.remove("is-open");
    document.body.classList.remove("bp-scroll-lock");
    $$("[data-bp-menu-open]").forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  function trapFocus(e) {
    var d = drawer();
    if (!d || !d.classList.contains("is-open") || e.key !== "Tab") return;
    var f = $$('a[href], button:not([disabled]):not([hidden]), input, [tabindex]:not([tabindex="-1"])', d).filter(function (el) {
      return el.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function closeDropdowns(except) {
    $$(".bp-catnav__item.is-open").forEach(function (li) {
      if (li === except) return;
      li.classList.remove("is-open");
      var b = $(".bp-catnav__toggle", li);
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  function initHeader() {
    var d = drawer();
    if (d && !d.getAttribute("data-bp-ready")) {
      d.setAttribute("data-bp-ready", "1");
      if (!d.classList.contains("is-open")) d.setAttribute("inert", "");
    }
    // current-page highlight in category nav
    $$(".bp-catnav__link[href]:not([data-bp-cur])").forEach(function (a) {
      a.setAttribute("data-bp-cur", "1");
      try {
        var u = new URL(a.href, location.href);
        if (u.origin === location.origin && u.pathname !== "/" && u.pathname === location.pathname) a.setAttribute("aria-current", "page");
      } catch (e) {}
    });
  }

  /* ---------- 7. built-in slider ----------------------------------------- */
  function initSliders() {
    $$(".bp-slider:not([data-bp-ready])").forEach(function (s) {
      s.setAttribute("data-bp-ready", "1");
      var track = $(".bp-slider__track", s);
      var slides = $$(".bp-slider__slide", s);
      var dots = $$(".bp-slider__dot", s);
      if (!track || slides.length < 2) return;
      var current = 0;
      function setDot(i) {
        current = i;
        dots.forEach(function (d, k) {
          d.setAttribute("aria-current", k === i ? "true" : "false");
        });
      }
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting && en.intersectionRatio > 0.6) setDot(slides.indexOf(en.target));
            });
          },
          { root: track, threshold: [0.6] }
        );
        slides.forEach(function (sl) {
          io.observe(sl);
        });
      }
      var delay = parseInt(s.getAttribute("data-autoplay"), 10) || 0;
      if (delay > 0 && !reduceMotion.matches) {
        var paused = false;
        s.addEventListener("mouseenter", function () {
          paused = true;
        });
        s.addEventListener("mouseleave", function () {
          paused = false;
        });
        s.addEventListener("focusin", function () {
          paused = true;
        });
        s.addEventListener("focusout", function () {
          paused = false;
        });
        s.addEventListener(
          "touchstart",
          function () {
            paused = true;
          },
          { passive: true }
        );
        var timer = setInterval(function () {
          if (!document.body.contains(s)) {
            clearInterval(timer);
            return;
          }
          if (paused || document.hidden) return;
          goToSlide(s, (current + 1) % slides.length);
        }, Math.max(delay, 3000));
      }
    });
  }
  function goToSlide(s, i) {
    var track = $(".bp-slider__track", s);
    var slides = $$(".bp-slider__slide", s);
    if (!track || !slides[i]) return;
    track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: reduceMotion.matches ? "auto" : "smooth" });
  }

  /* ---------- 8. gallery ------------------------------------------------- */
  function setGalleryMain(gallery, btn) {
    var main = $(".bp-gallery__main", gallery);
    if (!main || !btn) return;
    var src = btn.getAttribute("data-src") || "";
    var isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src);
    var alt = gallery.getAttribute("data-alt") || "";
    $$("video", main).forEach(function (v) {
      try {
        v.pause();
      } catch (e) {}
    });
    var zoom = $(".bp-gallery__zoom", gallery);
    if (isVideo) {
      main.innerHTML = '<video src="' + esc(src) + '" controls playsinline preload="metadata"></video>';
      if (zoom) zoom.hidden = true;
    } else {
      main.innerHTML = '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="800" height="800" decoding="async">';
      if (zoom) {
        zoom.hidden = false;
        zoom.setAttribute("data-src", src);
      }
    }
    $$(".bp-gallery__thumb", gallery).forEach(function (b) {
      b.setAttribute("aria-current", b === btn ? "true" : "false");
    });
  }
  function openLightbox(gallery, src) {
    var dlg = $(".bp-lightbox", gallery);
    if (!dlg || typeof dlg.showModal !== "function") {
      window.open(src, "_blank", "noopener");
      return;
    }
    var img = $("img", dlg);
    if (img) {
      img.src = src;
      img.alt = gallery.getAttribute("data-alt") || "";
    }
    dlg.showModal();
  }

  /* ---------- 9. countdown ----------------------------------------------- */
  function tzParts(epoch, tz) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var o = {};
    f.formatToParts(new Date(epoch)).forEach(function (p) {
      o[p.type] = p.value;
    });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function zonedEpoch(str, tz) {
    var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(str || "");
    if (!m) return NaN;
    var y = +m[1],
      mo = +m[2],
      d = +m[3],
      h = +(m[4] || 0),
      mi = +(m[5] || 0);
    var wanted = Date.UTC(y, mo - 1, d, h, mi);
    var guess = wanted;
    try {
      for (var i = 0; i < 3; i++) {
        var p = tzParts(guess, tz);
        var diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - wanted;
        if (!diff) break;
        guess -= diff;
      }
    } catch (e) {
      // Unknown timezone in this browser: treat the configured time as UTC
      return wanted;
    }
    return guess;
  }
  var countdownTimer = null;
  function tickCountdowns() {
    var any = false;
    $$("[data-bp-countdown]").forEach(function (root) {
      var target = parseFloat(root.getAttribute("data-bp-epoch"));
      if (!isFinite(target)) return;
      var left = Math.max(0, target - Date.now());
      if (left <= 0) {
        if (root.getAttribute("data-bp-expired-done")) return;
        root.setAttribute("data-bp-expired-done", "1");
        var mode = root.getAttribute("data-expired") || "message";
        var section = root.closest("[data-bp-countdown-section]") || root;
        if (mode === "hide") {
          section.hidden = true;
        } else {
          var timer = $(".bp-timer", root);
          var msg = $("[data-bp-expired-msg]", root);
          if (timer) timer.hidden = true;
          if (msg) msg.hidden = false;
        }
        return;
      }
      any = true;
      var s = Math.floor(left / 1000);
      var vals = { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
      Object.keys(vals).forEach(function (k) {
        var el = $('[data-unit="' + k + '"]', root);
        if (el) el.textContent = String(vals[k]).padStart(2, "0");
      });
    });
    if (!any && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }
  function initCountdowns() {
    var fresh = $$("[data-bp-countdown]:not([data-bp-epoch])");
    fresh.forEach(function (root) {
      var tz = root.getAttribute("data-tz") || "Africa/Cairo";
      var epoch = zonedEpoch(root.getAttribute("data-target"), tz);
      if (!isFinite(epoch)) {
        root.setAttribute("data-bp-epoch", "invalid");
        var timer = $(".bp-timer", root);
        if (timer) timer.hidden = true;
        return;
      }
      root.setAttribute("data-bp-epoch", String(epoch));
    });
    if (!countdownTimer && $$("[data-bp-countdown]").length) {
      tickCountdowns();
      countdownTimer = setInterval(tickCountdowns, 1000);
    }
  }

  /* ---------- 10. video cards -------------------------------------------- */
  function pauseVideo(card) {
    var v = $("video", card);
    if (v && !v.paused) v.pause();
    card.classList.remove("is-playing");
    var btn = $(".bp-vcard__play", card);
    if (btn) btn.setAttribute("aria-pressed", "false");
  }
  function playVideo(card, muted) {
    $$(".bp-vcard.is-playing").forEach(function (c) {
      if (c !== card) pauseVideo(c);
    });
    var v = $("video", card);
    if (!v) return;
    if (!v.getAttribute("src") && v.getAttribute("data-src")) v.setAttribute("src", v.getAttribute("data-src"));
    v.muted = !!muted;
    v.controls = !muted;
    var poster = $(".bp-vcard__poster", card);
    var pr = v.play();
    card.classList.add("is-playing");
    if (poster) poster.hidden = true;
    var btn = $(".bp-vcard__play", card);
    if (btn) btn.setAttribute("aria-pressed", "true");
    if (pr && pr.catch)
      pr.catch(function () {
        card.classList.remove("is-playing");
      });
  }
  var videoIO = null;
  function initVideos() {
    var cards = $$(".bp-vcard:not([data-bp-ready])");
    if (!cards.length) return;
    if (!videoIO && "IntersectionObserver" in window) {
      videoIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            var card = en.target;
            var auto = card.getAttribute("data-autoplay-muted") === "true" && !reduceMotion.matches;
            if (!en.isIntersecting || en.intersectionRatio < 0.35) {
              pauseVideo(card);
            } else if (auto && !card.classList.contains("is-playing")) {
              playVideo(card, true);
            }
          });
        },
        { threshold: [0, 0.35, 0.7] }
      );
    }
    cards.forEach(function (c) {
      c.setAttribute("data-bp-ready", "1");
      if (videoIO) videoIO.observe(c);
    });
  }

  /* ---------- 11. gift-box builder --------------------------------------- */
  function builderState(root) {
    if (!root.__bp) root.__bp = { qty: {}, items: {}, pack: "" };
    return root.__bp;
  }
  function builderTotals(root) {
    var st = builderState(root);
    var count = 0;
    var sum = 0;
    Object.keys(st.qty).forEach(function (id) {
      var q = st.qty[id];
      if (!q) return;
      count += q;
      sum += q * priceOf(st.items[id] || {}).now;
    });
    var packPrice = 0;
    if (st.pack && st.items[st.pack]) packPrice = priceOf(st.items[st.pack]).now;
    return { count: count, sum: sum + packPrice };
  }
  function renderBuilder(root) {
    var st = builderState(root);
    var min = parseInt(root.getAttribute("data-min"), 10) || 1;
    var max = parseInt(root.getAttribute("data-max"), 10) || 99;
    var cur = esc(currencyFor(root));
    var tot = builderTotals(root);
    // steppers
    $$("[data-bp-bitem]", root).forEach(function (li) {
      var id = li.getAttribute("data-bp-bitem");
      var q = st.qty[id] || 0;
      var out = $("output", li);
      if (out) out.textContent = String(q);
      var dec = $("[data-bp-step='-1']", li);
      var inc = $("[data-bp-step='1']", li);
      if (dec) dec.disabled = q <= 0;
      if (inc) inc.disabled = tot.count >= max;
      li.classList.toggle("is-selected", q > 0);
    });
    // summary
    var list = $("[data-bp-summary-list]", root);
    if (list) {
      var rows = Object.keys(st.qty)
        .filter(function (id) {
          return st.qty[id] > 0 && st.items[id];
        })
        .map(function (id) {
          var p = st.items[id];
          return "<li><span>" + esc(p.name) + " × " + st.qty[id] + '</span><span><span class="bp-money">' + esc(fmtNumber(st.qty[id] * priceOf(p).now)) + "</span> " + cur + "</span></li>";
        });
      if (st.pack && st.items[st.pack]) {
        rows.push("<li><span>🎀 " + esc(st.items[st.pack].name) + '</span><span><span class="bp-money">' + esc(fmtNumber(priceOf(st.items[st.pack]).now)) + "</span> " + cur + "</span></li>");
      }
      list.innerHTML = rows.join("") || '<li><span>' + esc(root.getAttribute("data-empty-label") || "—") + "</span></li>";
    }
    var total = $("[data-bp-summary-total]", root);
    if (total) total.innerHTML = '<span class="bp-money">' + esc(fmtNumber(tot.sum)) + "</span> " + cur;
    var count = $("[data-bp-summary-count]", root);
    if (count) count.textContent = tot.count + " / " + max;
    var bar = $(".bp-progress", root);
    if (bar) {
      bar.style.setProperty("--bp-progress", Math.min(100, Math.round((tot.count / Math.max(min, 1)) * 100)) + "%");
      bar.setAttribute("aria-valuenow", String(tot.count));
    }
    var status = $("[data-bp-builder-status]", root);
    if (status && !root.getAttribute("data-bp-busy")) {
      status.textContent = tot.count < min ? t("needMore", { n: min - tot.count, min: min }) : tot.count >= max ? t("maxReached", { max: max }) : t("ready");
    }
    var add = $("[data-bp-builder-add]", root);
    if (add && !root.getAttribute("data-bp-busy")) add.disabled = tot.count < min || tot.count > max;
  }
  function builderItemHTML(p, cur) {
    var pr = priceOf(p);
    var oos = isOutOfStock(p);
    var variants = hasVariants(p);
    var name = esc(p.name || "");
    var img = p.thumb || (Array.isArray(p.images) && p.images[0]) || "";
    var foot;
    if (oos) foot = '<p class="bp-bitem__note">' + esc(t("oos")) + "</p>";
    else if (variants) foot = '<a class="bp-bitem__note" href="/products/' + encodeURIComponent(p.slug || "") + '">' + esc(t("chooseLong")) + "</a>";
    else
      foot =
        '<div class="bp-qty" role="group" aria-label="' + name + '">' +
        '<button type="button" data-bp-step="-1" aria-label="' + esc(t("dec")) + " - " + name + '" disabled>' + ICONS.minus + "</button>" +
        '<output aria-live="polite">0</output>' +
        '<button type="button" data-bp-step="1" aria-label="' + esc(t("inc")) + " - " + name + '">' + ICONS.plus + "</button></div>";
    return (
      '<li class="bp-bitem" data-bp-bitem="' + esc(p.id) + '"' + (oos || variants ? ' data-bp-locked="1"' : "") + ">" +
      '<div class="bp-bitem__media">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" width="300" height="300">' : "") + "</div>" +
      '<div class="bp-bitem__body"><a class="bp-bitem__name" href="/products/' + encodeURIComponent(p.slug || "") + '">' + name + "</a>" +
      '<span class="bp-price__now' + (pr.onSale ? " bp-price__now--sale" : "") + '"><span class="bp-money">' + esc(fmtNumber(pr.now)) + "</span> " + cur + "</span></div>" +
      '<div class="bp-bitem__foot">' + foot + "</div></li>"
    );
  }
  function initBuilders() {
    $$("[data-bp-builder]:not([data-bp-ready])").forEach(function (root) {
      root.setAttribute("data-bp-ready", "1");
      var st = builderState(root);
      var cur = esc(currencyFor(root));
      var itemIds = (root.getAttribute("data-items") || "").split(",").filter(Boolean);
      var packIds = (root.getAttribute("data-packs") || "").split(",").filter(Boolean);
      var itemsMount = $("[data-bp-builder-items]", root);
      var packsMount = $("[data-bp-builder-packs]", root);
      var all = itemIds.concat(packIds.filter(function (id) {
        return itemIds.indexOf(id) === -1;
      }));
      if (!all.length) return;
      fetchEntities("products", all, root)
        .then(function (rows) {
          rows.forEach(function (p) {
            st.items[String(p.id)] = p;
          });
          if (itemsMount) {
            var html = itemIds
              .map(function (id) {
                return st.items[id] ? builderItemHTML(st.items[id], cur) : "";
              })
              .join("");
            itemsMount.innerHTML = html || '<li class="bp-state" role="status"><p>' + esc(t("empty")) + "</p></li>";
          }
          if (packsMount) {
            var packs = packIds
              .map(function (id) {
                return st.items[id];
              })
              .filter(function (p) {
                return p && !isOutOfStock(p) && !hasVariants(p);
              });
            var name = "bp-pack-" + (root.id || Math.random().toString(36).slice(2));
            var required = root.getAttribute("data-pack-required") === "true";
            var out = "";
            if (!required) {
              out += '<li class="bp-pack"><input type="radio" id="' + name + '-none" name="' + name + '" value="" checked><label for="' + name + '-none"><span aria-hidden="true">📦</span><strong>' + esc(t("noPack")) + "</strong></label></li>";
            }
            packs.forEach(function (p, i) {
              var pid = name + "-" + i;
              var img = p.thumb || (Array.isArray(p.images) && p.images[0]) || "";
              out +=
                '<li class="bp-pack"><input type="radio" id="' + pid + '" name="' + name + '" value="' + esc(p.id) + '"' + (required && i === 0 ? " checked" : "") + '><label for="' + pid + '">' +
                (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" width="52" height="52">' : "") +
                "<span><strong>" + esc(p.name) + '</strong><br><span class="bp-money">' + esc(fmtNumber(priceOf(p).now)) + "</span> " + cur + "</span></label></li>";
            });
            if (required && packs[0]) st.pack = String(packs[0].id);
            packsMount.innerHTML = out;
            var packWrap = packsMount.closest("[data-bp-pack-step]");
            if (packWrap) packWrap.hidden = !packs.length;
          }
          renderBuilder(root);
        })
        .catch(function () {
          if (itemsMount) itemsMount.innerHTML = '<li class="bp-state" role="alert"><p>' + esc(t("error")) + "</p></li>";
        });
    });
  }
  function builderStep(root, li, delta) {
    if (!li || li.getAttribute("data-bp-locked")) return;
    var st = builderState(root);
    var id = li.getAttribute("data-bp-bitem");
    var max = parseInt(root.getAttribute("data-max"), 10) || 99;
    var tot = builderTotals(root);
    var q = st.qty[id] || 0;
    if (delta > 0 && tot.count >= max) return;
    q = Math.max(0, q + delta);
    st.qty[id] = q;
    renderBuilder(root);
  }
  function builderAddToCart(root, btn) {
    var st = builderState(root);
    var min = parseInt(root.getAttribute("data-min"), 10) || 1;
    var max = parseInt(root.getAttribute("data-max"), 10) || 99;
    var tot = builderTotals(root);
    if (tot.count < min || tot.count > max || root.getAttribute("data-bp-busy")) return;
    var queue = [];
    Object.keys(st.qty).forEach(function (id) {
      for (var i = 0; i < (st.qty[id] || 0); i++) queue.push(id);
    });
    if (st.pack) queue.push(st.pack);
    var total = queue.length;
    var status = $("[data-bp-builder-status]", root);
    root.setAttribute("data-bp-busy", "1");
    btn.disabled = true;
    var gap = parseInt(root.getAttribute("data-gap"), 10) || 600;
    var n = 0;
    (function next() {
      if (n >= total) {
        root.removeAttribute("data-bp-busy");
        if (status) status.textContent = t("sent", { t: total });
        st.qty = {};
        renderBuilder(root);
        if (status) status.textContent = t("sent", { t: total });
        var cartBtn = $(".bp-header .cart-btn");
        if (cartBtn && root.getAttribute("data-open-cart") !== "false") cartBtn.click();
        return;
      }
      var id = queue[n];
      n += 1;
      if (status) status.textContent = t("sending", { n: n, t: total });
      // Dispatched from the button (inside the section) so it reaches the
      // storefront's section-level listener, exactly like a product card.
      btn.dispatchEvent(new CustomEvent("quick-add", { bubbles: true, detail: { productId: id } }));
      setTimeout(next, gap);
    })();
  }
  function copyText(text, statusEl) {
    function done(ok) {
      if (statusEl) statusEl.textContent = ok ? t("copied") : t("copyFail");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(false);
        }
      );
    } else {
      done(false);
    }
  }

  /* ---------- 12. price formatting --------------------------------------- */
  function formatMoney() {
    $$(".bp-money:not([data-bp-fmt])").forEach(function (el) {
      el.setAttribute("data-bp-fmt", "1");
      var raw = (el.textContent || "").trim();
      if (/^\d+(\.\d+)?$/.test(raw)) el.textContent = fmtNumber(raw);
    });
  }

  /* ---------- 13. tabs --------------------------------------------------- */
  function selectTab(tab, focus) {
    var list = tab.closest("[role='tablist']");
    if (!list) return;
    var tabs = $$("[role='tab']", list);
    tabs.forEach(function (tb) {
      var on = tb === tab;
      tb.setAttribute("aria-selected", on ? "true" : "false");
      tb.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(tb.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    var panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) {
      $$("[data-bp-products]:not([data-bp-hydrated])", panel).forEach(hydrateProducts);
      $$(".bp-rail", panel).forEach(updateRail);
    }
  }

  /* ---------- 14. same-page hash links (/#gift-box) ---------------------- */
  function scrollToHash(hash, smooth) {
    if (!hash || hash.length < 2) return false;
    var el;
    try {
      el = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch (e) {
      return false;
    }
    if (!el) return false;
    el.scrollIntoView({ behavior: smooth && !reduceMotion.matches ? "smooth" : "auto", block: "start" });
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    return true;
  }

  /* ---------- delegated listeners (attached exactly once) --------------- */
  document.addEventListener(
    "click",
    function (e) {
      // same-page anchors — capture phase, before SPA link interception
      var a = e.target.closest && e.target.closest("a[href*='#']");
      if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && a.target !== "_blank") {
        try {
          var u = new URL(a.getAttribute("href"), location.href);
          if (u.origin === location.origin && u.pathname === location.pathname && u.hash) {
            if (scrollToHash(u.hash, true)) {
              e.preventDefault();
              e.stopPropagation();
              closeDrawer();
              history.replaceState(null, "", u.hash);
            }
          }
        } catch (err) {}
      }
    },
    true
  );

  document.addEventListener("click", function (e) {
    var tgt = e.target;
    if (!tgt || !tgt.closest) return;
    var el;

    if ((el = tgt.closest("[data-bp-menu-open]"))) {
      e.preventDefault();
      openDrawer(el);
      return;
    }
    if ((el = tgt.closest("[data-bp-menu-close]")) || tgt.id === "bp-drawer-overlay") {
      closeDrawer();
      return;
    }
    if (tgt.closest("#bp-mobile-menu a[href]")) {
      closeDrawer();
    }
    if ((el = tgt.closest("[data-bp-subtoggle]"))) {
      var sub = document.getElementById(el.getAttribute("aria-controls"));
      var open = el.getAttribute("aria-expanded") !== "true";
      el.setAttribute("aria-expanded", open ? "true" : "false");
      if (sub) sub.hidden = !open;
      return;
    }
    if ((el = tgt.closest(".bp-catnav__toggle"))) {
      var li = el.closest(".bp-catnav__item");
      var isOpen = li.classList.toggle("is-open");
      el.setAttribute("aria-expanded", isOpen ? "true" : "false");
      closeDropdowns(li);
      return;
    }
    if (!tgt.closest(".bp-catnav__item")) closeDropdowns();

    if ((el = tgt.closest("[data-bp-acc]"))) {
      var panel = document.getElementById(el.getAttribute("aria-controls"));
      var exp = el.getAttribute("aria-expanded") !== "true";
      el.setAttribute("aria-expanded", exp ? "true" : "false");
      if (panel) panel.hidden = !exp;
      return;
    }
    if ((el = tgt.closest("[data-bp-rail]"))) {
      var scope = el.closest("[data-bp-rail-scope]") || el.closest(".bp-rail");
      var rail = scope && (scope.classList.contains("bp-rail") ? scope : $(".bp-tabpanel:not([hidden]) .bp-rail", scope) || $(".bp-rail", scope));
      var track = rail && $(".bp-rail__track", rail);
      if (track) {
        var dir = el.getAttribute("data-bp-rail") === "next" ? 1 : -1;
        var sign = isRTL() ? -1 : 1;
        track.scrollBy({ left: dir * sign * track.clientWidth * 0.85, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
      return;
    }
    if ((el = tgt.closest("[role='tab']"))) {
      selectTab(el, false);
      return;
    }
    if ((el = tgt.closest(".bp-slider__dot"))) {
      var s = el.closest(".bp-slider");
      goToSlide(s, parseInt(el.getAttribute("data-index"), 10) || 0);
      return;
    }
    if ((el = tgt.closest(".bp-gallery__thumb"))) {
      setGalleryMain(el.closest(".bp-gallery"), el);
      return;
    }
    if ((el = tgt.closest(".bp-gallery__zoom"))) {
      var g = el.closest(".bp-gallery");
      openLightbox(g, el.getAttribute("data-src") || ($(".bp-gallery__main img", g) || {}).src || "");
      return;
    }
    if ((el = tgt.closest("[data-bp-lightbox-close]"))) {
      var dlg = el.closest("dialog");
      if (dlg) dlg.close();
      return;
    }
    if ((el = tgt.closest(".bp-vcard__play"))) {
      playVideo(el.closest(".bp-vcard"), false);
      return;
    }
    if ((el = tgt.closest(".bp-vcard__pause"))) {
      pauseVideo(el.closest(".bp-vcard"));
      return;
    }
    if ((el = tgt.closest("[data-bp-step]"))) {
      var root = el.closest("[data-bp-builder]");
      if (root) builderStep(root, el.closest("[data-bp-bitem]"), parseInt(el.getAttribute("data-bp-step"), 10));
      return;
    }
    if ((el = tgt.closest("[data-bp-builder-add]"))) {
      var r = el.closest("[data-bp-builder]");
      if (r) builderAddToCart(r, el);
      return;
    }
    if ((el = tgt.closest("[data-bp-copy]"))) {
      var box = el.closest("[data-bp-builder]") || document;
      var ta = $("textarea", el.closest(".bp-message-copy") || box);
      var msg = $("[data-bp-copy-status]", el.closest(".bp-message-copy") || box);
      if (ta && ta.value.trim()) copyText(ta.value.trim(), msg);
      return;
    }
    if ((el = tgt.closest("[data-bp-retry]"))) {
      var c = el.closest("[data-bp-products]");
      if (c) hydrateProducts(c);
      return;
    }
    if ((el = tgt.closest("[data-bp-marquee-toggle]"))) {
      var ann = el.closest(".bp-announce");
      var mq = ann && $(".bp-marquee", ann);
      if (mq) {
        var p = mq.classList.toggle("is-paused");
        el.setAttribute("aria-pressed", p ? "true" : "false");
      }
      return;
    }
  });

  document.addEventListener("change", function (e) {
    var input = e.target;
    if (input && input.matches && input.matches(".bp-pack input[type='radio']")) {
      var root = input.closest("[data-bp-builder]");
      if (root) {
        builderState(root).pack = input.value || "";
        renderBuilder(root);
      }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeDrawer();
      closeDropdowns();
    }
    trapFocus(e);
    var tab = e.target && e.target.closest && e.target.closest("[role='tab']");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) !== -1) {
      var tabs = $$("[role='tab']", tab.closest("[role='tablist']"));
      var i = tabs.indexOf(tab);
      var fwd = isRTL() ? "ArrowLeft" : "ArrowRight";
      var back = isRTL() ? "ArrowRight" : "ArrowLeft";
      var n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : e.key === fwd ? (i + 1) % tabs.length : e.key === back ? (i - 1 + tabs.length) % tabs.length : i;
      e.preventDefault();
      selectTab(tabs[n], true);
    }
  });

  /* ---------- run (initial + after DOM changes) -------------------------- */
  function run() {
    nextDataCache = null;
    try {
      initHeader();
      initAnnouncement();
      initSliders();
      initRails();
      initHydration();
      initEntityLinks();
      initProductChips();
      initCountdowns();
      initVideos();
      initBuilders();
      formatMoney();
    } catch (err) {
      if (window.console) console.warn("[bazaar-pop]", err);
    }
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      scheduled = false;
      run();
    });
  }
  window.__bpTheme = { run: schedule, version: "1.0.0" };

  function start() {
    run();
    if (location.hash) setTimeout(function () {
      scrollToHash(location.hash, false);
    }, 300);
    if ("MutationObserver" in window) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes && muts[i].addedNodes.length) {
            schedule();
            return;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("resize", function () {
      $$(".bp-rail").forEach(updateRail);
    }, { passive: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
