// PREVIEW-ONLY stand-in for the EasyOrders storefront runtime.
// It records the CustomEvents the theme dispatches (as the real section
// containers would receive them) and serves fixture products for the public
// catalogue API. It is NOT part of the theme and is never uploaded.
(function () {
  window.__eoEvents = [];
  var EVENTS = ["cart-click", "lang-click", "register-click", "footer-subscribe", "review-open", "buy-now", "increment-quantity", "decrement-quantity", "quick-add", "quick-view", "toggle-wishlist", "toggle-compare", "compare-click", "go-home", "copy-tracking-link"];
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "pv-toast";
    t.textContent = "[mock storefront] " + msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 1200);
  }
  document.querySelectorAll("[data-eo-section]").forEach(function (sec) {
    EVENTS.forEach(function (name) {
      sec.addEventListener(name, function (e) {
        var rec = { event: name, section: sec.getAttribute("data-eo-section"), detail: e.detail || null };
        window.__eoEvents.push(rec);
        if (name === "quick-add") {
          var c = document.getElementById("header-cart-count");
          if (c) {
            c.textContent = String((parseInt(c.textContent, 10) || 0) + 1);
            c.hidden = false;
          }
        }
        toast(name + (e.detail && e.detail.productId ? " " + e.detail.productId : ""));
      });
    });
  });
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf("api.easy-orders.net") !== -1) {
      var m = /filter=id\|\|\$in\|\|([^&]+)/.exec(u);
      var ids = m ? decodeURIComponent(m[1]).split(",") : [];
      var rows = (window.__FIXTURE_PRODUCTS || []).filter(function (p) {
        return ids.indexOf(p.id) !== -1;
      });
      if (u.indexOf("/categories") !== -1 || u.indexOf("/simple-pages") !== -1) rows = ids.map(function (id) { return { id: id, slug: "slug-" + id }; });
      return new Promise(function (r) {
        setTimeout(function () {
          r(new Response(JSON.stringify({ data: rows }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }, 120);
      });
    }
    return realFetch.apply(this, arguments);
  };
})();
