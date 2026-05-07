const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const BASE = window.location.origin;

const LOYALTY_LEVELS = [
  { threshold: 300_000, name: "Платина 💎", discount: 15 },
  { threshold: 100_000, name: "Золото 🥇",  discount: 10 },
  { threshold:  50_000, name: "Серебро 🥈", discount:  7 },
  { threshold:  20_000, name: "Бронза 🥉",  discount:  5 },
];

const CATEGORIES = [
  { key: "all",        label: "Все" },
  { key: "Одноразка", label: "🔥 Одноразки" },
  { key: "Жидкость",  label: "💧 Жидкости" },
  { key: "Табак",     label: "🚬 Табак" },
  { key: "Устройство",label: "⚙️ Устройства" },
];

let products = [];
let cart     = JSON.parse(localStorage.getItem("vape_cart") || "{}");  // {id: qty}
let cardQty  = {};   // qty selector on product cards
let currentCat = "all";
let loyalty  = { total: 0, level: null, discount: 0, next_threshold: 20_000 };

// ── INIT ──────────────────────────────────────────────

async function init() {
  buildTabs();

  const uid = tg.initDataUnsafe?.user?.id;
  if (uid) {
    try {
      const r = await fetch(`${BASE}/api/loyalty/${uid}`);
      loyalty = await r.json();
    } catch (e) { console.warn("loyalty fetch failed", e); }
  }
  updateLoyaltyUI();

  try {
    const r = await fetch(`${BASE}/api/products`);
    products = await r.json();
    renderProducts();
  } catch (e) {
    document.getElementById("products-grid").innerHTML =
      '<div class="placeholder">Не удалось загрузить товары 😔</div>';
  }

  updateFab();
}

// ── TABS ──────────────────────────────────────────────

function buildTabs() {
  const wrap = document.getElementById("tabs");
  CATEGORIES.forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (key === "all" ? " active" : "");
    btn.textContent = label;
    btn.dataset.cat = key;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      currentCat = key;
      renderProducts();
    });
    wrap.appendChild(btn);
  });
}

// ── LOYALTY UI ────────────────────────────────────────

function updateLoyaltyUI() {
  const badge   = document.getElementById("loyalty-badge");
  const label   = document.getElementById("loyalty-label");
  const totalEl = document.getElementById("loyalty-total");
  const fill    = document.getElementById("progress-fill");

  const total = loyalty.total || 0;
  totalEl.textContent = `${total.toLocaleString("ru")}₽`;

  if (loyalty.level) {
    badge.textContent = loyalty.level;
    badge.classList.remove("hidden");
  }

  const next = loyalty.next_threshold;
  if (next) {
    const prevLevel = LOYALTY_LEVELS.find(l => l.threshold === next);
    const prevIdx   = LOYALTY_LEVELS.indexOf(prevLevel);
    const prevThreshold = prevIdx < LOYALTY_LEVELS.length - 1
      ? LOYALTY_LEVELS[prevIdx + 1].threshold
      : 0;
    const pct = Math.min(((total - prevThreshold) / (next - prevThreshold)) * 100, 100);
    fill.style.width = pct + "%";
    const nextName = LOYALTY_LEVELS.find(l => l.threshold === next)?.name || "";
    label.textContent = `До ${nextName}: ${(next - total).toLocaleString("ru")}₽`;
  } else {
    fill.style.width = "100%";
    label.textContent = "Максимальный уровень 🏆";
  }
}

// ── PRODUCTS ──────────────────────────────────────────

function renderProducts() {
  const grid = document.getElementById("products-grid");
  const list = currentCat === "all"
    ? products
    : products.filter(p => p["Категория"] === currentCat);

  if (!list.length) {
    grid.innerHTML = '<div class="placeholder">Товаров нет 🤷</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const id  = p["ID"];
    const qty = cardQty[id] || 1;
    return `
      <div class="product-card">
        <div class="p-name">${p["Название"]}</div>
        <div class="p-brand">${p["Бренд"]}${p["Затяжки"] ? " · " + p["Затяжки"] + " тяг" : ""}</div>
        <div class="p-price">${p["Цена (₽)"].toLocaleString("ru")}₽</div>
        <div class="p-stock">Остаток: ${p["Остаток"]} шт</div>
        <div class="p-actions">
          <button class="qty-btn" onclick="changeCardQty(${id},-1)">−</button>
          <span class="qty-val" id="cqty-${id}">${qty}</span>
          <button class="qty-btn" onclick="changeCardQty(${id},1)">+</button>
          <button class="add-btn" id="addbtn-${id}" onclick="addToCart(${id})">В корзину</button>
        </div>
      </div>`;
  }).join("");
}

function changeCardQty(id, delta) {
  cardQty[id] = Math.max(1, (cardQty[id] || 1) + delta);
  const el = document.getElementById(`cqty-${id}`);
  if (el) el.textContent = cardQty[id];
}

function addToCart(id) {
  const qty = cardQty[id] || 1;
  cart[id]  = (cart[id] || 0) + qty;
  saveCart();
  updateFab();
  tg.HapticFeedback?.impactOccurred("light");

  const btn = document.getElementById(`addbtn-${id}`);
  if (btn) {
    btn.textContent = "✓ Добавлено";
    btn.classList.add("added");
    setTimeout(() => { btn.textContent = "В корзину"; btn.classList.remove("added"); }, 1200);
  }
}

function saveCart() { localStorage.setItem("vape_cart", JSON.stringify(cart)); }

function updateFab() {
  const total = Object.values(cart).reduce((a, b) => a + b, 0);
  const fab   = document.getElementById("cart-fab");
  document.getElementById("fab-count").textContent = total;
  fab.classList.toggle("hidden", total === 0);
}

// ── CART SCREEN ───────────────────────────────────────

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

  const disc    = loyalty.discount || 0;
  const discSum = Math.round(raw * disc / 100);
  const final   = raw - discSum;

  let html = `<div class="total-row"><span>Сумма</span><span>${raw.toLocaleString("ru")}₽</span></div>`;
  if (disc > 0) {
    html += `<div class="total-row discount"><span>Скидка ${loyalty.level} (${disc}%)</span><span>−${discSum.toLocaleString("ru")}₽</span></div>`;
    html += `<div class="total-row final"><span>Итого</span><span>${final.toLocaleString("ru")}₽</span></div>`;
  } else {
    html += `<div class="total-row final"><span>Итого</span><span>${raw.toLocaleString("ru")}₽</span></div>`;
  }
  totalEl.innerHTML = html;
}

function changeCartQty(id, delta) {
  const nq = (cart[id] || 1) + delta;
  if (nq <= 0) { removeFromCart(id); return; }
  cart[id] = nq;
  saveCart(); updateFab(); renderCart();
}

function removeFromCart(id) {
  delete cart[id];
  saveCart(); updateFab(); renderCart();
}

// ── CHECKOUT ──────────────────────────────────────────

function toggleAddress() {
  const delivery = document.querySelector('input[name="delivery"]:checked')?.value;
  document.getElementById("address-block").classList.toggle("hidden", delivery !== "courier");
  renderOrderSummary();
}

function renderOrderSummary() {
  const inCart = products.filter(p => cart[p["ID"]] > 0);
  let raw = 0;
  const lines = inCart.map(p => {
    const qty = cart[p["ID"]];
    const sum = p["Цена (₽)"] * qty;
    raw += sum;
    return `${p["Название"]} × ${qty} = ${sum.toLocaleString("ru")}₽`;
  }).join("<br>");

  const disc    = loyalty.discount || 0;
  const discSum = Math.round(raw * disc / 100);
  const final   = raw - discSum;

  let html = `<strong>Состав:</strong><br>${lines}<br><br>`;
  html += `💰 Сумма: ${raw.toLocaleString("ru")}₽`;
  if (disc > 0) {
    html += `<br>🎁 Скидка ${loyalty.level} (${disc}%): −${discSum.toLocaleString("ru")}₽`;
    html += `<br><strong>✅ Итого: ${final.toLocaleString("ru")}₽</strong>`;
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

  if (!contact) { tg.showAlert("Укажи контакт для связи"); return; }
  if (delivery === "courier" && !address) { tg.showAlert("Укажи адрес доставки"); return; }

  const inCart = products.filter(p => cart[p["ID"]] > 0);
  if (!inCart.length) { tg.showAlert("Корзина пустая"); return; }

  const items = inCart.map(p => ({
    id:    p["ID"],
    name:  p["Название"],
    qty:   cart[p["ID"]],
    price: p["Цена (₽)"],
  }));

  // очищаем корзину и отправляем в бот
  cart = {};
  saveCart();

  tg.sendData(JSON.stringify({ contact, delivery, address, pay, items }));
}

// ── NAVIGATION ────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");
  window.scrollTo(0, 0);
  if (name === "cart")     renderCart();
  if (name === "checkout") { renderOrderSummary(); }
}

// ── MAIN BUTTON ───────────────────────────────────────

tg.MainButton.setText("🛒 Корзина");
tg.MainButton.show();
tg.MainButton.onClick(() => showScreen("cart"));

init();
