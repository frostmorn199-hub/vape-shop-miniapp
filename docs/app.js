const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const BASE = "https://vape-shop-miniapp.onrender.com";

const LOYALTY_LEVELS = [
  { threshold: 300_000, name: "Платина 💎", discount: 15 },
  { threshold: 100_000, name: "Золото 🥇",  discount: 10 },
  { threshold:  50_000, name: "Серебро 🥈", discount:  7 },
  { threshold:  20_000, name: "Бронза 🥉",  discount:  5 },
];

const REFERRAL_LEVELS = [
  { threshold: 100, name: "Платина 🔥", pct: 10 },
  { threshold:  40, name: "Золото 🥇",  pct:  7 },
  { threshold:  15, name: "Серебро 🥈", pct:  5 },
  { threshold:   1, name: "Бронза 🥉",  pct:  3 },
];

const CATEGORIES = [
  { key: "all",        label: "Все" },
  { key: "Одноразка", label: "🔥 Одноразки" },
  { key: "Жидкость",  label: "💧 Жидкости" },
  { key: "Табак",     label: "🚬 Табак" },
  { key: "Устройство",label: "⚙️ Устройства" },
  { key: "Товары VC", label: "🪙 Товары VC" },
];

const DELIVERY_FEE = 250;
const FREE_DELIVERY_THRESHOLD = 2000;

let products   = [];
let cart       = JSON.parse(localStorage.getItem("vape_cart") || "{}");
let favorites  = JSON.parse(localStorage.getItem("vape_fav")  || "[]");
let cardQty    = {};
let currentCat   = "all";
let currentBrand = null;
let currentSearch = "";
let currentSort   = null;  // null | "asc" | "desc"
let showFavOnly  = false;
let loyalty    = {
  total: 0, level: null, discount: 0, next_threshold: 20_000,
  vaypecoins: 0, ref_code: "", ref_count: 0,
  ref_level: null, ref_pct: 0, next_ref_threshold: 1,
};


// ── INIT ──────────────────────────────────────────────────────

function fetchJSON(url, timeoutMs = 12000) {
  return Promise.race([
    fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
  ]);
}

async function init() {
  buildTabs();

  // Пинг для пробуждения Render.com сервера (cold start)
  fetch(`${BASE}/api/ping`).catch(() => {});

  const uid = tg.initDataUnsafe?.user?.id;

  // Загружаем loyalty, products и корзину с сервера параллельно
  const [loyaltyResult, productsResult, cartResult] = await Promise.allSettled([
    uid ? fetchJSON(`${BASE}/api/loyalty/${uid}`) : Promise.resolve(null),
    fetchJSON(`${BASE}/api/products`),
    uid ? fetchJSON(`${BASE}/api/cart/${uid}`) : Promise.resolve(null),
  ]);

  if (loyaltyResult.status === "fulfilled" && loyaltyResult.value) {
    loyalty = loyaltyResult.value;
  } else if (loyaltyResult.status === "rejected") {
    console.warn("loyalty fetch failed", loyaltyResult.reason);
  }

  if (productsResult.status === "fulfilled" && Array.isArray(productsResult.value)) {
    products = productsResult.value;
  } else {
    console.warn("products fetch failed", productsResult.reason);
  }

  // Мержим серверную корзину с локальной (серверная приоритетнее если не пуста)
  if (cartResult.status === "fulfilled" && cartResult.value &&
      Object.keys(cartResult.value).length > 0) {
    const serverCart = {};
    for (const [k, v] of Object.entries(cartResult.value)) serverCart[+k] = +v;
    cart = serverCart;
    saveCart();
  }

  updateLoyaltyBar();
  updateCheckoutVC();
  renderProducts();
  updateFab();
  buildLoyaltyScreen();
  updateLoyaltyBadge();
}

async function retryLoadProducts() {
  const grid = document.getElementById("products-grid");
  grid.innerHTML = '<div class="placeholder">Загружаем товары…</div>';
  try {
    products = await fetchJSON(`${BASE}/api/products`);
    renderProducts();
    updateFab();
  } catch (e) {
    grid.innerHTML = '<div class="placeholder">Ошибка загрузки 😔<br><button class="retry-btn" onclick="retryLoadProducts()">🔄 Повторить</button></div>';
  }
}


// ── TABS ──────────────────────────────────────────────────────

function buildTabs() {
  const wrap = document.getElementById("tabs");
  wrap.innerHTML = "";

  CATEGORIES.forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (key === "all" ? " active" : "");
    btn.textContent = label;
    btn.dataset.cat = key;
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tabs .tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      currentCat   = key;
      currentBrand = null;
      showFavOnly  = false;
      renderProducts();
    });
    wrap.appendChild(btn);
  });

  // Кнопка «Избранное»
  const favBtn = document.createElement("button");
  favBtn.className = "tab fav-tab" + (showFavOnly ? " active" : "");
  favBtn.id = "fav-tab-btn";
  favBtn.textContent = "♥ Избранное";
  favBtn.addEventListener("click", () => {
    showFavOnly = !showFavOnly;
    document.querySelectorAll("#tabs .tab").forEach(t => t.classList.remove("active"));
    favBtn.classList.toggle("active", showFavOnly);
    if (!showFavOnly) {
      document.querySelector(`#tabs .tab[data-cat="${currentCat}"]`)?.classList.add("active");
    }
    currentBrand = null;
    renderProducts();
  });
  wrap.appendChild(favBtn);
}


// ── BRAND BAR ─────────────────────────────────────────────

function buildBrandBar(cat) {
  const bar  = document.getElementById("brands-bar");
  const wrap = document.getElementById("brands");
  if (!bar || !wrap) return;

  if (cat === "all") { bar.classList.add("hidden"); return; }

  const brands = [...new Set(
    products.filter(p => p["Категория"] === cat).map(p => p["Бренд"]).filter(Boolean)
  )].sort();

  if (brands.length < 2) { bar.classList.add("hidden"); currentBrand = null; return; }

  bar.classList.remove("hidden");
  wrap.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "tab" + (!currentBrand ? " active" : "");
  allBtn.textContent = "Все";
  allBtn.onclick = () => {
    wrap.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    allBtn.classList.add("active");
    currentBrand = null;
    renderProducts();
  };
  wrap.appendChild(allBtn);

  brands.forEach(brand => {
    const btn = document.createElement("button");
    btn.className = "tab" + (currentBrand === brand ? " active" : "");
    btn.textContent = brand;
    btn.onclick = () => {
      wrap.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      currentBrand = brand;
      renderProducts();
    };
    wrap.appendChild(btn);
  });
}


// ── LOYALTY BAR (header) ──────────────────────────────────────

function updateLoyaltyBar() {
  const label   = document.getElementById("loyalty-label");
  const totalEl = document.getElementById("loyalty-total");
  const fill    = document.getElementById("progress-fill");

  const total = loyalty.total || 0;
  totalEl.textContent = `${total.toLocaleString("ru")}₽`;

  const next = loyalty.next_threshold;

  if (next) {
    // LOYALTY_LEVELS уже отсортирован по убыванию (300k→20k),
    // find находит наибольший порог ниже next — это ближайший предыдущий уровень
    const prevLevel = LOYALTY_LEVELS.find(l => l.threshold < next);
    const prevThreshold = prevLevel ? prevLevel.threshold : 0;
    const pct = Math.min(((total - prevThreshold) / (next - prevThreshold)) * 100, 100);
    fill.style.width = pct + "%";
    const nextName = LOYALTY_LEVELS.find(l => l.threshold === next)?.name || "";
    label.textContent = `До ${nextName}: ${(next - total).toLocaleString("ru")}₽`;
  } else {
    fill.style.width = "100%";
    label.textContent = loyalty.level
      ? `${loyalty.level} — скидка ${loyalty.discount}% 🏆`
      : "Максимальный уровень 🏆";
  }
}


// ── LOYALTY SCREEN ────────────────────────────────────────────

function buildLoyaltyScreen() {
  const total     = loyalty.total || 0;
  const coins     = loyalty.vaypecoins || 0;
  const refCode   = loyalty.ref_code || "—";
  const refCount  = loyalty.ref_count || 0;
  const refPct    = loyalty.ref_pct || 0;
  const nextRefT  = loyalty.next_ref_threshold;
  const discount  = loyalty.discount || 0;
  const nextT     = loyalty.next_threshold;

  // Вейпкоины
  document.getElementById("loy-coins").textContent = `${coins.toLocaleString("ru")} VC`;

  // Реферальный уровень
  const refLevelEl = document.getElementById("ref-level-name");
  if (loyalty.ref_level) {
    refLevelEl.textContent = loyalty.ref_level;
    refLevelEl.classList.remove("no-level");
  } else {
    refLevelEl.textContent = "Нет уровня";
    refLevelEl.classList.add("no-level");
  }
  document.getElementById("ref-count-text").textContent = `${refCount} рефералов`;
  document.getElementById("ref-pct-text").textContent = refPct > 0 ? `${refPct}% кэшбек` : "";

  // Находим следующий уровень по threshold из сервера (он всегда корректный)
  const nextRefLevel = nextRefT ? REFERRAL_LEVELS.find(l => l.threshold === nextRefT) : null;
  if (nextRefT && nextRefLevel) {
    // REFERRAL_LEVELS по убыванию (100→1) — find вернёт текущий (ближайший достигнутый) уровень
    const prevRefLevel = REFERRAL_LEVELS.find(l => l.threshold <= refCount);
    const prevRefT = prevRefLevel ? prevRefLevel.threshold : 0;
    const refPct2  = Math.min(((refCount - prevRefT) / (nextRefT - prevRefT)) * 100, 100);
    document.getElementById("ref-progress-fill").style.width = refPct2 + "%";
    document.getElementById("ref-progress-label").textContent =
      `До ${nextRefLevel.name}: ${refCount}/${nextRefT} рефералов`;
  } else {
    document.getElementById("ref-progress-fill").style.width = "100%";
    document.getElementById("ref-progress-label").textContent = "🏆 Максимальный реферальный уровень!";
  }

  // Реферальный код
  document.getElementById("ref-code-display").textContent = refCode;

  // Реферальные уровни
  const sortedRef = [...REFERRAL_LEVELS].reverse();
  const refGrid = document.getElementById("ref-levels-grid");
  refGrid.innerHTML = sortedRef.map(l => {
    const done = refCount >= l.threshold;
    return `<div class="loy-level-item ${done ? "done" : ""}">
      <span class="li-mark">${done ? "✅" : "⬜"}</span>
      <span class="li-name">${l.name}</span>
      <span class="li-val">${l.threshold}+ реф. · ${l.pct}%</span>
    </div>`;
  }).join("");

  // Уровень скидок
  const spendLevelEl = document.getElementById("spend-level-name");
  if (loyalty.level) {
    spendLevelEl.textContent = loyalty.level;
    spendLevelEl.classList.remove("no-level");
  } else {
    spendLevelEl.textContent = "Нет уровня";
    spendLevelEl.classList.add("no-level");
  }
  document.getElementById("spend-total-text").textContent = `${total.toLocaleString("ru")}₽ потрачено`;
  document.getElementById("spend-disc-text").textContent = discount > 0 ? `${discount}% скидка` : "";

  if (nextT) {
    // LOYALTY_LEVELS по убыванию — find вернёт ближайший предыдущий уровень
    const prevSpend = LOYALTY_LEVELS.find(l => l.threshold < nextT);
    const prevT     = prevSpend ? prevSpend.threshold : 0;
    const spPct      = Math.min(((total - prevT) / (nextT - prevT)) * 100, 100);
    document.getElementById("spend-progress-fill").style.width = spPct + "%";
    const nextSpendName = LOYALTY_LEVELS.find(l => l.threshold === nextT)?.name || "";
    document.getElementById("spend-progress-label").textContent =
      `До ${nextSpendName}: ${(nextT - total).toLocaleString("ru")}₽`;
  } else {
    document.getElementById("spend-progress-fill").style.width = "100%";
    document.getElementById("spend-progress-label").textContent = "🏆 Максимальный уровень скидок!";
  }

  // Уровни скидок
  const spendGrid = document.getElementById("spend-levels-grid");
  const sortedSpend = [...LOYALTY_LEVELS].reverse();
  spendGrid.innerHTML = sortedSpend.map(l => {
    const done = total >= l.threshold;
    return `<div class="loy-level-item ${done ? "done" : ""}">
      <span class="li-mark">${done ? "✅" : "⬜"}</span>
      <span class="li-name">${l.name}</span>
      <span class="li-val">${l.threshold.toLocaleString("ru")}₽ · ${l.discount}% скидка</span>
    </div>`;
  }).join("");
}

function updateCheckoutVC() {
  const coins = loyalty.vaypecoins || 0;
  const el = document.getElementById("checkout-vc");
  if (el) el.textContent = `${coins.toLocaleString("ru")} VC`;

  // Show VCoin payment option only if cart has VCoin items
  const vcBlock  = document.getElementById("vcoin-pay-option");
  const vcInfo   = document.getElementById("vc-balance-block");
  const hasVC    = hasVCoinItems();
  const vct      = hasVC ? vcoinItemsTotal() : 0;

  if (vcBlock) vcBlock.classList.toggle("hidden", !hasVC);
  if (vcInfo)  vcInfo.classList.toggle("hidden",  !hasVC);

  // If no VCoin items, force card selection
  if (!hasVC) {
    const cardRadio = document.querySelector('input[name="pay"][value="card"]');
    if (cardRadio) cardRadio.checked = true;
  }
}

function copyRefCode() {
  const code = loyalty.ref_code;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => {
    tg.showAlert(`Код ${code} скопирован!`);
  }).catch(() => {
    tg.showAlert(`Твой код: ${code}`);
  });
}

function shareRefCode() {
  const code = loyalty.ref_code;
  if (!code) return;
  const text = `Я пользуюсь VAPE SHOP VRN 💨\nВведи мой код ${code} при регистрации и получи 100 вейпкоинов на баланс! 🎁`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    tg.showAlert(text);
  }
}


// ── PHOTO URL ─────────────────────────────────────────────────

function normalizePhotoUrl(url) {
  if (!url) return "";
  // Извлекаем file_id из Google Drive ссылки и используем серверный прокси
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `${BASE}/api/photo/${m[1]}`;
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && url.includes("drive.google.com")) return `${BASE}/api/photo/${m2[1]}`;
  return url;
}


// ── PRODUCTS ──────────────────────────────────────────────────

function onSearchInput(val) {
  currentSearch = val.trim().toLowerCase();
  renderProducts();
}

function toggleSort() {
  if (!currentSort || currentSort === "desc") currentSort = "asc";
  else currentSort = "desc";
  const btn = document.getElementById("sort-btn");
  if (btn) {
    btn.textContent = currentSort === "asc" ? "↑₽" : "↓₽";
    btn.classList.toggle("sort-active", true);
  }
  renderProducts();
}

function renderProducts() {
  buildBrandBar(currentCat);
  const grid = document.getElementById("products-grid");

  let list = showFavOnly
    ? products.filter(p => favorites.includes(p["ID"]))
    : (currentCat === "all" ? products : products.filter(p => p["Категория"] === currentCat));

  if (!showFavOnly && currentBrand) list = list.filter(p => p["Бренд"] === currentBrand);

  // Поиск
  if (currentSearch) {
    list = list.filter(p =>
      (p["Название"] || "").toLowerCase().includes(currentSearch) ||
      (p["Бренд"] || "").toLowerCase().includes(currentSearch)
    );
  }

  // Сортировка по цене
  if (currentSort === "asc")  list = [...list].sort((a, b) => a["Цена (₽)"] - b["Цена (₽)"]);
  if (currentSort === "desc") list = [...list].sort((a, b) => b["Цена (₽)"] - a["Цена (₽)"]);

  if (!list.length) {
    if (showFavOnly) {
      grid.innerHTML = '<div class="placeholder">Нет избранных товаров 💔<br><small style="color:var(--hint)">Нажми ♥ на карточке товара</small></div>';
    } else {
      grid.innerHTML = products.length === 0
        ? '<div class="placeholder">Не удалось загрузить товары 😔<br><button class="retry-btn" onclick="retryLoadProducts()">🔄 Повторить</button></div>'
        : '<div class="placeholder">Товаров нет 🤷</div>';
    }
    return;
  }

  grid.innerHTML = list.map(p => {
    const id    = p["ID"];
    const stock = p["Остаток"] || 0;
    const qty   = Math.min(cardQty[id] || 1, stock);
    const photo = normalizePhotoUrl(p["Фото"] || "");
    const isFav = favorites.includes(id);
    const imgHtml = photo
      ? `<div class="p-img-wrap">
           <img class="p-img" src="${photo}" alt="${p["Название"]}" loading="lazy"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23333%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23888%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22>нет фото</text></svg>'">
           <button class="fav-btn ${isFav ? "faved" : ""}" onclick="toggleFav(${id})" id="favbtn-${id}">♥</button>
         </div>`
      : `<div class="p-img-wrap no-img">
           <button class="fav-btn ${isFav ? "faved" : ""}" onclick="toggleFav(${id})" id="favbtn-${id}">♥</button>
         </div>`;
    const isVC = p["Категория"] === "Товары VC";
    return `
      <div class="product-card">
        ${imgHtml}
        <div class="p-name">${p["Название"]}</div>
        <div class="p-brand">${p["Бренд"]}${p["Затяжки"] ? " · " + p["Затяжки"] + " тяг" : ""}</div>
        <div class="p-price">${isVC ? `<span class="vc-price">🪙 ${p["Цена (₽)"].toLocaleString("ru")} VC</span>` : `${p["Цена (₽)"].toLocaleString("ru")}₽`}</div>
        <div class="p-stock" style="color:${stock <= 3 ? "#e74c3c" : "var(--hint)"}">Остаток: ${stock} шт</div>
        <div class="p-actions">
          <button class="qty-btn" onclick="changeCardQty(${id},-1)">−</button>
          <span class="qty-val" id="cqty-${id}">${qty}</span>
          <button class="qty-btn" onclick="changeCardQty(${id},1)">+</button>
          <button class="add-btn" id="addbtn-${id}" onclick="addToCart(${id})">В корзину</button>
        </div>
      </div>`;
  }).join("");
}

function toggleFav(id) {
  const idx = favorites.indexOf(id);
  if (idx === -1) favorites.push(id);
  else favorites.splice(idx, 1);
  localStorage.setItem("vape_fav", JSON.stringify(favorites));
  // Обновляем только кнопку без перерисовки всего списка
  const btn = document.getElementById(`favbtn-${id}`);
  if (btn) btn.classList.toggle("faved", favorites.includes(id));
  // Обновляем счётчик на вкладке «Избранное»
  const favTab = document.getElementById("fav-tab-btn");
  if (favTab && showFavOnly && idx !== -1) renderProducts(); // удалили из избранного — обновляем список
}

function changeCardQty(id, delta) {
  const product = products.find(p => p["ID"] === id);
  const max = product ? (product["Остаток"] || 1) : 999;
  cardQty[id] = Math.min(max, Math.max(1, (cardQty[id] || 1) + delta));
  const el = document.getElementById(`cqty-${id}`);
  if (el) el.textContent = cardQty[id];
}

function addToCart(id) {
  const product = products.find(p => p["ID"] === id);
  const stock   = product ? (product["Остаток"] || 0) : 0;
  const qty     = cardQty[id] || 1;
  const already = cart[id] || 0;

  if (already >= stock) {
    tg.showAlert("Больше нет в наличии!");
    return;
  }

  cart[id] = Math.min(already + qty, stock);
  saveCart();
  updateFab();
  tg.HapticFeedback?.impactOccurred("light");

  // Анимация иконки корзины в навигации
  const cartNavBtn = document.querySelector('.nav-btn[data-screen="cart"]');
  if (cartNavBtn) {
    cartNavBtn.classList.remove("cart-bounce");
    void cartNavBtn.offsetWidth; // reflow для перезапуска анимации
    cartNavBtn.classList.add("cart-bounce");
    setTimeout(() => cartNavBtn.classList.remove("cart-bounce"), 400);
  }

  const btn = document.getElementById(`addbtn-${id}`);
  if (btn) {
    btn.textContent = "✓ Добавлено";
    btn.classList.add("added");
    setTimeout(() => { btn.textContent = "В корзину"; btn.classList.remove("added"); }, 1200);
  }
}

function saveCart() {
  localStorage.setItem("vape_cart", JSON.stringify(cart));
  const uid = tg.initDataUnsafe?.user?.id;
  if (uid) {
    fetch(`${BASE}/api/cart/${uid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cart),
    }).catch(() => {});
  }
}

function updateFab() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const price = products
    .filter(p => cart[p["ID"]] > 0)
    .reduce((s, p) => s + p["Цена (₽)"] * (cart[p["ID"]] || 0), 0);

  const badge = document.getElementById("nav-cart-count");
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle("hidden", count === 0);
  }
  const priceEl = document.getElementById("nav-cart-price");
  if (priceEl) {
    priceEl.textContent = count > 0 ? `${price.toLocaleString("ru")}₽` : "";
    priceEl.classList.toggle("hidden", count === 0);
  }
}

function updateLoyaltyBadge() {
  const btn = document.querySelector('.nav-btn[data-screen="loyalty"]');
  if (!btn) return;
  // Показываем точку если есть VCoin или реферальный код
  const hasCoins = (loyalty.vaypecoins || 0) > 0;
  const hasCode  = !!(loyalty.ref_code);
  let dot = btn.querySelector(".nav-loyalty-dot");
  if (hasCoins || hasCode) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "nav-loyalty-dot";
      btn.appendChild(dot);
    }
  } else if (dot) {
    dot.remove();
  }
}


// ── CART SCREEN ───────────────────────────────────────────────

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total-block");

  const inCart = products.filter(p => cart[p["ID"]] > 0);
  if (!inCart.length) {
    itemsEl.innerHTML = '<div class="cart-empty">🛒 Корзина пустая</div>';
    totalEl.innerHTML = "";
    return;
  }

  let raw = 0;
  itemsEl.innerHTML = inCart.map(p => {
    const id  = p["ID"];
    const qty = cart[id];
    const sum = p["Цена (₽)"] * qty;
    raw += sum;
    return `
      <div class="cart-item">
        <div class="ci-info">
          <div class="ci-name">${p["Название"]}</div>
          <div class="ci-price">${qty} × ${p["Цена (₽)"].toLocaleString("ru")}₽ = ${sum.toLocaleString("ru")}₽</div>
        </div>
        <div class="ci-ctrl">
          <button class="qty-btn" onclick="changeCartQty(${id},-1)">−</button>
          <span class="qty-val">${qty}</span>
          <button class="qty-btn" onclick="changeCartQty(${id},1)">+</button>
          <button class="remove-btn" onclick="removeFromCart(${id})">✕</button>
        </div>
      </div>`;
  }).join("");

  const disc       = loyalty.discount || 0;
  const wheelDisc  = loyalty.wheel_discount || 0;
  const totalDisc  = disc + wheelDisc;
  const discSum    = Math.round(raw * totalDisc / 100);
  const itemsTotal = raw - discSum;

  let html = `<div class="total-row"><span>Сумма</span><span>${raw.toLocaleString("ru")}₽</span></div>`;
  if (disc > 0) {
    html += `<div class="total-row discount"><span>Скидка ${loyalty.level} (${disc}%)</span><span>−${Math.round(raw * disc / 100).toLocaleString("ru")}₽</span></div>`;
  }
  if (wheelDisc > 0) {
    html += `<div class="total-row discount"><span>🎰 Промокод колеса (${wheelDisc}%)</span><span>−${Math.round(raw * wheelDisc / 100).toLocaleString("ru")}₽</span></div>`;
  }
  html += `<div class="total-row delivery-info-row"><span>🚚 Доставка</span><span>${itemsTotal >= FREE_DELIVERY_THRESHOLD ? "бесплатно 🎉" : `+${DELIVERY_FEE.toLocaleString("ru")}₽ (от ${FREE_DELIVERY_THRESHOLD.toLocaleString("ru")}₽)`}</span></div>`;
  if (hasVCoinItems()) {
    const vct = vcoinItemsTotal();
    const coins = loyalty.vaypecoins || 0;
    const canPay = coins >= vct;
    html += `<div class="total-row" style="color:${canPay ? '#f0c040' : '#e74c3c'}">🪙 VCoin-товары: ${vct.toLocaleString("ru")} VC ${canPay ? `(баланс: ${coins} VC ✓)` : `(не хватает: нужно ${vct}, есть ${coins})`}</div>`;
  }
  html += `<div class="total-row final"><span>Итого</span><span>${itemsTotal.toLocaleString("ru")}₽</span></div>`;
  totalEl.innerHTML = html;
}

function changeCartQty(id, delta) {
  const nq = (cart[id] || 1) + delta;
  if (nq <= 0) { removeFromCart(id); return; }
  const product = products.find(p => p["ID"] === id);
  const max = product ? (product["Остаток"] || 999) : 999;
  cart[id] = Math.min(nq, max);
  saveCart(); updateFab(); renderCart();
}

function removeFromCart(id) {
  delete cart[id];
  saveCart(); updateFab(); renderCart();
}


function hasVCoinItems() {
  return products.some(p => cart[p["ID"]] > 0 && p["Категория"] === "Товары VC");
}

function vcoinItemsTotal() {
  return products
    .filter(p => cart[p["ID"]] > 0 && p["Категория"] === "Товары VC")
    .reduce((s, p) => s + p["Цена (₽)"] * cart[p["ID"]], 0);
}


// ── CHECKOUT ──────────────────────────────────────────────────

function toggleAddress() {
  const delivery = document.querySelector('input[name="delivery"]:checked')?.value;
  const isCourier = delivery === "courier";
  document.getElementById("address-block").classList.toggle("hidden", !isCourier);
  document.getElementById("comment-block").classList.toggle("hidden", !isCourier);
  // Скрываем наличные для курьера
  const cashOption = document.getElementById("cash-option");
  if (cashOption) {
    cashOption.classList.toggle("hidden", isCourier);
    // Если курьер — переключаем на карту
    if (isCourier) {
      document.querySelector('input[name="pay"][value="card"]').checked = true;
    }
  }
  renderOrderSummary();
}

function renderOrderSummary() {
  const delivery = document.querySelector('input[name="delivery"]:checked')?.value;
  const inCart = products.filter(p => cart[p["ID"]] > 0);
  let raw = 0;
  const lines = inCart.map(p => {
    const qty = cart[p["ID"]];
    const sum = p["Цена (₽)"] * qty;
    raw += sum;
    return `${p["Название"]} × ${qty} = ${sum.toLocaleString("ru")}₽`;
  }).join("<br>");

  const disc      = loyalty.discount || 0;
  const wheelDisc = loyalty.wheel_discount || 0;
  const totalDisc = disc + wheelDisc;
  const discSum   = Math.round(raw * totalDisc / 100);
  let itemsTotal  = raw - discSum;

  let html = `<strong>Состав:</strong><br>${lines}<br><br>`;
  html += `💰 Сумма: ${raw.toLocaleString("ru")}₽`;
  if (disc > 0) {
    html += `<br>🎁 Скидка ${loyalty.level} (${disc}%): −${Math.round(raw * disc / 100).toLocaleString("ru")}₽`;
  }
  if (wheelDisc > 0) {
    html += `<br>🎰 Промокод колеса (${wheelDisc}%): −${Math.round(raw * wheelDisc / 100).toLocaleString("ru")}₽`;
  }

  let deliveryFee = 0;
  if (delivery === "courier") {
    if (itemsTotal < FREE_DELIVERY_THRESHOLD) {
      deliveryFee = DELIVERY_FEE;
      html += `<br>🚚 Доставка: +${DELIVERY_FEE.toLocaleString("ru")}₽ <span style="color:var(--hint);font-size:12px">(бесплатно от ${FREE_DELIVERY_THRESHOLD.toLocaleString("ru")}₽)</span>`;
    } else {
      html += `<br>🚚 Доставка: <span style="color:#27ae60">бесплатно 🎉</span>`;
    }
  }

  const final = itemsTotal + deliveryFee;
  html += `<br><strong>✅ Итого: ${final.toLocaleString("ru")}₽</strong>`;

  const pay = document.querySelector('input[name="pay"]:checked')?.value;
  if (pay === "vcoin" || hasVCoinItems()) {
    const vct   = vcoinItemsTotal();
    const coins = loyalty.vaypecoins || 0;
    html += `<br>🪙 VCoin-оплата: ${vct.toLocaleString("ru")} VC из ${coins.toLocaleString("ru")} VC`;
  }

  document.getElementById("order-summary").innerHTML = html;
}

function submitOrder() {
  const contact  = document.getElementById("inp-contact").value.trim();
  const delivery = document.querySelector('input[name="delivery"]:checked')?.value;
  const pay      = document.querySelector('input[name="pay"]:checked')?.value;
  const address  = delivery === "courier"
    ? document.getElementById("inp-address").value.trim()
    : "Кривошеина 13/2";
  const comment  = delivery === "courier"
    ? (document.getElementById("inp-comment")?.value.trim() || "")
    : "";

  if (!contact) { tg.showAlert("Укажи контакт для связи"); return; }
  if (delivery === "courier" && !address) { tg.showAlert("Укажи адрес доставки"); return; }

  const inCart = products.filter(p => cart[p["ID"]] > 0);
  if (!inCart.length) { tg.showAlert("Корзина пустая"); return; }

  // VCoin validation
  const vct = vcoinItemsTotal();
  if (vct > 0) {
    const coins = loyalty.vaypecoins || 0;
    if (coins < vct) {
      tg.showAlert(`Недостаточно VCoin! Нужно ${vct} VC, у тебя ${coins} VC`);
      return;
    }
  }

  const items = inCart.map(p => ({
    id:       p["ID"],
    name:     p["Название"],
    qty:      cart[p["ID"]],
    price:    p["Цена (₽)"],
    category: p["Категория"],
  }));

  // Сохраняем в историю заказов
  const disc      = loyalty.discount || 0;
  const wheelDisc = loyalty.wheel_discount || 0;
  const totalDisc = disc + wheelDisc;
  let rawTotal  = 0;
  inCart.forEach(p => { rawTotal += p["Цена (₽)"] * (cart[p["ID"]] || 0); });
  const discSum    = Math.round(rawTotal * totalDisc / 100);
  const itemsTotal = rawTotal - discSum;
  const delivFee  = delivery === "courier" && itemsTotal < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE : 0;
  const finalTotal = itemsTotal + delivFee;
  const histEntry = {
    date: new Date().toLocaleString("ru"),
    contact, delivery, address, pay: pay === "card" ? "Карта" : pay === "cash" ? "Наличные" : "VCoin",
    items: items.map(i => `${i.name} × ${i.qty}`).join(", "),
    total: finalTotal,
    discountPct: disc,
  };
  const hist = JSON.parse(localStorage.getItem("vape_orders") || "[]");
  hist.unshift(histEntry);
  if (hist.length > 50) hist.length = 50;
  localStorage.setItem("vape_orders", JSON.stringify(hist));

  // Обновляем достижения
  updateAchievements(finalTotal);

  // Показываем экран успеха
  const successLines = inCart.map(p =>
    `${p["Название"]} × ${cart[p["ID"]]} = ${(p["Цена (₽)"] * cart[p["ID"]]).toLocaleString("ru")}₽`
  ).join("<br>");
  let successHtml = `<div class="success-lines">${successLines}</div>`;
  if (totalDisc > 0) successHtml += `<div class="success-disc">🎁 Скидка ${totalDisc}%: −${(rawTotal - itemsTotal).toLocaleString("ru")}₽</div>`;
  if (delivFee > 0)  successHtml += `<div class="success-disc">🚚 Доставка: +${delivFee.toLocaleString("ru")}₽</div>`;
  successHtml += `<div class="success-total">✅ Итого: ${finalTotal.toLocaleString("ru")}₽</div>`;
  const successSummaryEl = document.getElementById("success-order-summary");
  if (successSummaryEl) successSummaryEl.innerHTML = successHtml;

  cart = {};
  saveCart();

  showScreen("success", null);
  tg.MainButton.hide();

  tg.sendData(JSON.stringify({ contact, delivery, address, pay, items, comment, vcoin_total: vct }));
}


// ── ИСТОРИЯ ЗАКАЗОВ ──────────────────────────────────────────

async function renderHistory() {
  const el = document.getElementById("history-list");
  if (!el) return;

  el.innerHTML = '<div class="placeholder">Загружаем историю…</div>';

  const uid = tg.initDataUnsafe?.user?.id;
  let orders = [];

  if (uid) {
    try {
      orders = await fetchJSON(`${BASE}/api/orders/${uid}`, 10000);
    } catch (e) {
      console.warn("orders fetch failed, using localStorage", e);
    }
  }

  // Fallback: localStorage
  if (!orders.length) {
    const hist = JSON.parse(localStorage.getItem("vape_orders") || "[]");
    orders = hist.map((h, i) => ({
      id:     `#${hist.length - i}`,
      date:   h.date,
      total:  h.total || 0,
      status: "✅ Выдан",
      items:  h.items,
      type:   h.delivery === "courier" ? "Доставка" : "Самовывоз",
      pay:    h.pay,
    }));
  }

  if (!orders.length) {
    el.innerHTML = '<div class="placeholder">История пуста 📭<br><small style="color:var(--hint)">Оформи первый заказ!</small></div>';
    return;
  }

  el.innerHTML = orders.map((h, i) => `
    <div class="history-card">
      <div class="hc-header">
        <span class="hc-num">#${orders.length - i}</span>
        <span class="hc-date">${h.date}</span>
      </div>
      <div class="hc-items">${(h.items || "").replace(/\n/g, "<br>")}</div>
      <div class="hc-footer">
        <span class="hc-type">${h.type === "Доставка" ? "🚚 Доставка" : "🚶 Самовывоз"}</span>
        <span class="hc-pay">${h.pay || ""}</span>
        <span class="hc-total">${(h.total || 0).toLocaleString("ru")}₽</span>
      </div>
      <div class="hc-status">${h.status || ""}</div>
    </div>`).join("");
}


// ── ДОСТИЖЕНИЯ ────────────────────────────────────────────────

const ACHIEVEMENTS = [
  { id: "first_order",  label: "Первый заказ",  emoji: "🛒", desc: "Оформи первый заказ",           check: s => s.orders >= 1 },
  { id: "five_orders",  label: "Постоянный",     emoji: "🏆", desc: "5 заказов оформлено",           check: s => s.orders >= 5 },
  { id: "big_spender",  label: "Щедрый",         emoji: "💰", desc: "Потрачено 5 000₽ всего",        check: s => s.spent >= 5000 },
  { id: "whale",        label: "Кит",            emoji: "🐋", desc: "Потрачено 20 000₽ всего",       check: s => s.spent >= 20000 },
  { id: "gamer",        label: "Геймер",         emoji: "🎮", desc: "Сыграл в VapeRun",              check: s => s.gamesPlayed >= 1 },
  { id: "highscore",    label: "Рекордсмен",     emoji: "🥇", desc: "Рекорд 500+ в VapeRun",        check: s => s.bestScore >= 500 },
  { id: "coin_hunter",  label: "Коллекционер",   emoji: "🌀", desc: "Собрал 100 монет в игре",       check: s => s.totalCoins >= 100 },
  { id: "referral",     label: "Друг",           emoji: "🤝", desc: "Привёл друга по реф. коду",     check: s => s.refCount >= 1 },
];

function getAchievementStats() {
  const hist  = JSON.parse(localStorage.getItem("vape_orders") || "[]");
  const spent = hist.reduce((a, h) => a + (h.total || 0), 0);
  const bestScore   = parseInt(localStorage.getItem("vr_best") || "0");
  const totalCoins  = parseInt(localStorage.getItem("vr_coins") || "0");
  const gamesPlayed = totalCoins > 0 || bestScore > 0 ? 1 : 0;
  const refCount    = loyalty.ref_count || 0;
  return { orders: hist.length, spent, bestScore, totalCoins, gamesPlayed, refCount };
}

function updateAchievements(newOrderTotal) {
  // Called after order submit — trigger re-check
  renderAchievements();
}

function renderAchievements() {
  const el = document.getElementById("achievements-grid");
  if (!el) return;
  const stats   = getAchievementStats();
  const unlocked = JSON.parse(localStorage.getItem("vape_ach") || "[]");
  const newUnlocked = [...unlocked];

  ACHIEVEMENTS.forEach(a => {
    if (!unlocked.includes(a.id) && a.check(stats)) {
      newUnlocked.push(a.id);
    }
  });
  if (newUnlocked.length > unlocked.length) {
    localStorage.setItem("vape_ach", JSON.stringify(newUnlocked));
  }

  el.innerHTML = ACHIEVEMENTS.map(a => {
    const done = newUnlocked.includes(a.id);
    return `<div class="ach-item ${done ? "ach-done" : "ach-locked"}">
      <span class="ach-emoji">${a.emoji}</span>
      <div class="ach-info">
        <span class="ach-label">${a.label}</span>
        <span class="ach-desc">${a.desc}</span>
      </div>
      <span class="ach-check">${done ? "✅" : "🔒"}</span>
    </div>`;
  }).join("");
}


// ── NAVIGATION ────────────────────────────────────────────────

function showScreen(name, navBtn) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add("active");
  window.scrollTo(0, 0);

  // Показываем табы только в каталоге
  const tabsBar = document.getElementById("tabs-bar");
  if (tabsBar) tabsBar.classList.toggle("hidden", name !== "catalog");

  // Строка поиска только в каталоге
  const searchWrap = document.getElementById("search-bar-wrap");
  if (searchWrap) searchWrap.classList.toggle("hidden", name !== "catalog");

  // Обновляем nav кнопки
  if (navBtn) {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    navBtn.classList.add("active");
  }

  if (name === "cart")     renderCart();
  if (name === "checkout") { renderOrderSummary(); updateCheckoutVC(); }
  if (name === "loyalty")  { buildLoyaltyScreen(); renderAchievements(); }
  if (name === "history")  renderHistory();

  // Управление главной кнопкой TG
  if (name === "catalog" || name === "loyalty" || name === "history" || name === "success") {
    tg.MainButton.hide();
  } else if (name === "cart") {
    tg.MainButton.setText("Оформить заказ");
    tg.MainButton.show();
    tg.MainButton.onClick(() => showScreen("checkout", null));
  }
}

init();
