(() => {
  const $ = id => document.getElementById(id);
  if (!$("hero-buy")) return;

  let service = "wa";
  let offers = [];

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

  function showProvider(provider) {
    const isHero = provider === "hero";
    $("main-provider-panel").hidden = isHero;
    $("herosms-panel").hidden = !isHero;
    document.querySelectorAll("[data-provider-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.providerTab === provider);
    });
    if (isHero) loadOffers();
  }

  async function loadOffers() {
    const select = $("hero-country");
    select.innerHTML = '<option value="">جارٍ تحميل العروض...</option>';
    $("hero-price").textContent = "يتم جلب الأسعار والتوفر من HEROSMS...";
    try {
      const data = await request("/api/herosms/offers?service=" + encodeURIComponent(service));
      offers = Array.isArray(data.offers) ? data.offers : [];
      select.innerHTML = offers.length
        ? offers.map(offer => '<option value="' + escapeHtml(offer.country_code) + '">' +
            escapeHtml(offer.country_name || ("الدولة " + offer.country_code)) +
            " — $" + Number(offer.price).toFixed(4) + " — متاح " +
            Number(offer.qty || 0) + "</option>").join("")
        : '<option value="">لا توجد دول متاحة حالياً</option>';
      showOfferPrice();
    } catch (error) {
      offers = [];
      select.innerHTML = '<option value="">تعذر تحميل الدول</option>';
      $("hero-price").textContent = error.message;
    }
  }

  function selectedOffer() {
    return offers.find(offer => String(offer.country_code) === $("hero-country").value);
  }

  function showOfferPrice() {
    const offer = selectedOffer();
    $("hero-price").textContent = offer
      ? "السعر النهائي: $" + Number(offer.price).toFixed(4) +
        " · المتاح: " + Number(offer.qty || 0) + " رقم"
      : "لا توجد عروض لهذه الخدمة حالياً.";
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

  document.querySelectorAll("[data-provider-tab]").forEach(button => {
    button.addEventListener("click", () => showProvider(button.dataset.providerTab));
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

  $("hero-country").addEventListener("change", showOfferPrice);

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