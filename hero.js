(() => {
  const $ = id => document.getElementById(id);
  if (!$("hero-buy")) return;

  let service = "wa";
  let offers = [];
  let heroSort = "asc";

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.message || data.error || "تعذر تنفيذ الطلب");
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function flagFor(offer) {
    const iso = String(offer.iso || offer.iso2 || offer.country_iso || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(iso)) {
      return String.fromCodePoint(...[...iso].map(char => 127397 + char.charCodeAt(0)));
    }
    return "🌍";
  }

  function selectedOffer() {
    return offers.find(offer => String(offer.country_code) === $("hero-country").value);
  }

  function renderOffers(filter = "") {
    const query = filter.trim().toLocaleLowerCase();
    const entries = offers.filter(offer => {
      const name = offer.country_name || offer.name_ar || offer.name || "";
      return (String(name) + " " + String(offer.country_code)).toLocaleLowerCase().includes(query);
    }).sort((a, b) => heroSort === "asc"
      ? Number(a.price || 0) - Number(b.price || 0)
      : Number(b.price || 0) - Number(a.price || 0));

    $("hero-country-options").innerHTML = entries.length ? entries.map(offer => {
      const code = String(offer.country_code);
      const name = offer.country_name || offer.name_ar || offer.name || ("الدولة " + code);
      const active = code === $("hero-country").value ? " active" : "";
      return '<button type="button" class="country-option' + active + '" data-hero-country="' + escapeHtml(code) + '">' +
        '<span class="country-option-flag">' + flagFor(offer) + '</span>' +
        '<span class="country-option-info"><b>' + escapeHtml(name) + '</b><small>متاح: ' +
        Number(offer.qty || 0) + ' رقم</small></span>' +
        '<span class="country-option-price">$' + Number(offer.price || 0).toFixed(4) + '</span></button>';
    }).join("") : '<div class="country-empty">لا توجد دولة مطابقة لبحثك.</div>';
  }

  function selectOffer(code) {
    $("hero-country").value = String(code);
    const offer = selectedOffer();
    if (!offer) return;
    $("hero-country-flag").textContent = flagFor(offer);
    $("hero-country-name").textContent = offer.country_name || offer.name_ar || offer.name || ("الدولة " + code);
    $("hero-country-meta").textContent = "$" + Number(offer.price).toFixed(4) +
      " · متاح " + Number(offer.qty || 0) + " رقم";
    $("hero-country-dropdown").hidden = true;
    $("hero-country-trigger").setAttribute("aria-expanded", "false");
    renderOffers($("hero-country-search").value);
    showOfferPrice();
  }

  function showOfferPrice() {
    const offer = selectedOffer();
    $("hero-price").textContent = offer
      ? "السعر النهائي: $" + Number(offer.price).toFixed(4) +
        " · المتاح: " + Number(offer.qty || 0) + " رقم"
      : "لا توجد عروض لهذه الخدمة حالياً.";
  }

  async function loadOffers() {
    $("hero-country-name").textContent = "جارٍ تحميل الدول...";
    $("hero-country-meta").textContent = "لحظات من فضلك";
    $("hero-country-count").textContent = "جارٍ التحميل";
    $("hero-country-options").innerHTML = '<div class="country-empty">جارٍ جلب الدول والأسعار...</div>';
    $("hero-price").textContent = "يتم جلب الأسعار والتوفر من HEROSMS...";
    try {
      const data = await request("/api/herosms/offers?service=" + encodeURIComponent(service));
      offers = Array.isArray(data.offers) ? data.offers : [];
      $("hero-country").innerHTML = '<option value="">اختر الدولة</option>' +
        offers.map(offer => '<option value="' + escapeHtml(offer.country_code) + '">' +
          escapeHtml(offer.country_name || offer.name_ar || offer.name || offer.country_code) +
          ' — $' + Number(offer.price).toFixed(4) + '</option>').join("");
      $("hero-country-count").textContent = offers.length + " دولة متاحة";
      if (offers.length) {
        const cheapest = [...offers].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
        selectOffer(cheapest.country_code);
      } else {
        $("hero-country-name").textContent = "لا توجد دول متاحة";
        $("hero-country-meta").textContent = "جرّب خدمة أخرى لاحقاً";
        $("hero-price").textContent = "لا توجد دول متاحة لهذه الخدمة حالياً.";
        renderOffers();
      }
    } catch (error) {
      offers = [];
      $("hero-country").innerHTML = '<option value="">تعذر تحميل الدول</option>';
      $("hero-country-name").textContent = "تعذر تحميل الدول";
      $("hero-country-meta").textContent = error.message;
      $("hero-country-count").textContent = "خطأ";
      $("hero-price").textContent = error.message;
      $("hero-country-options").innerHTML = '<div class="country-empty">تعذر تحميل الدول. حاول مرة أخرى.</div>';
    }
  }

  async function loadOrders() {
    try {
      const data = await request("/api/herosms/orders");
      const orders = Array.isArray(data.orders) ? data.orders : [];
      $("hero-orders").innerHTML = orders.length ? orders.map(order => {
        const status = ({
          waiting: "بانتظار الكود", done: "تم استلام الكود",
          refunded: "ملغي / مسترد", uncertain: "قيد المراجعة",
          finished: "مكتمل", processing: "قيد التنفيذ"
        })[order.status] || order.status;
        return '<div class="order"><b>' +
          escapeHtml(order.phone_number || "الرقم قيد التجهيز") +
          "</b> · " + escapeHtml(order.service) + " · " + escapeHtml(status) +
          " · $" + Number(order.sale_price || 0).toFixed(4) +
          (order.code ? '<p>الكود: <b>' + escapeHtml(order.code) + "</b></p>" : "") +
          (order.status === "waiting"
            ? ' <button type="button" class="action" data-hero-code="' + Number(order.id) + '">فحص الكود</button>' +
              ' <button type="button" class="action cancel-order" data-hero-cancel="' + Number(order.id) + '">إلغاء واسترداد</button>'
            : "") +
          "</div>";
      }).join("") : "لا توجد طلبات من السيرفر الثاني بعد.";
    } catch (error) {
      $("hero-orders").textContent = error.message;
      if (error.message === "UNAUTHORIZED") location.href = "/login.html";
    }
  }

  $("hero-country-trigger").addEventListener("click", () => {
    const open = $("hero-country-dropdown").hidden;
    $("hero-country-dropdown").hidden = !open;
    $("hero-country-trigger").setAttribute("aria-expanded", String(open));
    if (open) {
      $("hero-country-search").value = "";
      renderOffers();
      $("hero-country-search").focus();
    }
  });
  $("hero-country-search").addEventListener("input", event => renderOffers(event.target.value));
  document.querySelectorAll("[data-hero-sort]").forEach(button => button.addEventListener("click", () => {
    heroSort = button.dataset.heroSort;
    document.querySelectorAll("[data-hero-sort]").forEach(item => item.classList.toggle("active", item === button));
    renderOffers($("hero-country-search").value);
  }));
  $("hero-country-options").addEventListener("click", event => {
    const button = event.target.closest("[data-hero-country]");
    if (button) selectOffer(button.dataset.heroCountry);
  });
  document.addEventListener("click", event => {
    const wrap = $("hero-country-picker-wrap");
    if (wrap && !wrap.contains(event.target)) {
      $("hero-country-dropdown").hidden = true;
      $("hero-country-trigger").setAttribute("aria-expanded", "false");
    }
  });

  document.querySelectorAll("[data-provider-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const isHero = button.dataset.providerTab === "hero";
      $("main-provider-panel").hidden = isHero;
      $("herosms-panel").hidden = !isHero;
      document.querySelectorAll("[data-provider-tab]").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      if (isHero) loadOffers();
    });
  });

  document.querySelectorAll("[data-hero-service]").forEach(button => {
    button.addEventListener("click", () => {
      service = button.dataset.heroService;
      document.querySelectorAll("[data-hero-service]").forEach(item => {
        item.classList.toggle("selected", item === button);
      });
      loadOffers();
    });
  });

  $("hero-buy").addEventListener("click", async () => {
    const offer = selectedOffer();
    if (!offer) return;
    const button = $("hero-buy");
    button.disabled = true;
    button.textContent = "جارٍ حجز الرقم من HEROSMS...";
    $("hero-message").textContent = "";
    try {
      const data = await request("/api/herosms/orders", {
        method: "POST",
        body: JSON.stringify({ service, country_code: offer.country_code })
      });
      $("hero-message").textContent = data.status === "ok"
        ? "تم حجز الرقم: " + data.number + " — تابع طلبك أدناه لاستلام الرمز."
        : (data.message || "الطلب قيد المراجعة. لا تكرر الشراء.");
      await loadOrders();
      if (typeof window.load === "function") await window.load();
    } catch (error) {
      $("hero-message").textContent = error.message;
    } finally {
      button.disabled = false;
      button.innerHTML = 'شراء من سيرفر رقم اثنين <span>←</span>';
    }
  });

  $("hero-orders").addEventListener("click", async event => {
    const codeId = event.target.dataset.heroCode;
    const cancelId = event.target.dataset.heroCancel;
    const id = codeId || cancelId;
    if (!id) return;
    try {
      if (codeId) {
        const data = await request("/api/herosms/orders/" + encodeURIComponent(id) + "/code");
        $("hero-message").textContent = data.code
          ? "رمز التفعيل: " + data.code
          : (data.message || "لم يصل الرمز بعد.");
      } else {
        if (!confirm("هل تريد إلغاء الرقم؟ سيُعاد الرصيد فقط بعد تأكيد HEROSMS الإلغاء.")) return;
        const data = await request("/api/herosms/orders/" + encodeURIComponent(id) + "/cancel", {
          method: "POST", body: "{}"
        });
        $("hero-message").textContent = data.message || "تم إلغاء الطلب.";
      }
      await loadOrders();
      if (typeof window.load === "function") await window.load();
    } catch (error) {
      $("hero-message").textContent = error.message;
    }
  });

  loadOrders();
})();