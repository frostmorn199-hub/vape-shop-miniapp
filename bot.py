from aiogram import Bot, Dispatcher, types
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
from aiogram.utils import executor
from aiogram.dispatcher import FSMContext
from aiogram.dispatcher.filters.state import State, StatesGroup
from aiogram.contrib.fsm_storage.memory import MemoryStorage
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime
import logging
import json

logging.basicConfig(level=logging.INFO)

API_TOKEN = "8751207190:AAEm1ZeGSJQn0LCKKIq6rd_GZxAChr2IhR0"
ADMIN_ID = 525971484
SELLER_IDS = [ADMIN_ID]  # добавить ID продавцов позже
PICKUP_ADDRESS = "Кривошеина 13/2"
WEBAPP_URL = "https://vape-shop-miniapp.onrender.com"

LOYALTY_LEVELS = [
    (300_000, "Платина 💎", 15),
    (100_000, "Золото 🥇", 10),
    (50_000,  "Серебро 🥈", 7),
    (20_000,  "Бронза 🥉",  5),
]

def get_loyalty(total: int):
    for threshold, name, discount in LOYALTY_LEVELS:
        if total >= threshold:
            return name, discount
    return None, 0

def next_level_info(total: int):
    for threshold, name, _ in LOYALTY_LEVELS:
        if total < threshold:
            return threshold, name
    return None, None

def progress_bar(current: int, target: int, length: int = 10) -> str:
    filled = int((current / target) * length)
    return "▓" * filled + "░" * (length - filled)

def loyalty_full_text(uid: int) -> str:
    total = get_user_total(uid)
    level_name, discount = get_loyalty(total)
    next_t, next_name = next_level_info(total)

    # Нижняя граница текущего диапазона (0 если ещё нет уровня)
    sorted_asc = sorted(LOYALTY_LEVELS, key=lambda x: x[0])
    prev_t = 0
    for t, n, d in sorted_asc:
        if t <= total:
            prev_t = t

    text = f"💰 Потрачено: {total:,}₽\n\n"

    if level_name:
        text += f"Твой уровень: {level_name} — скидка {discount}%\n"
    else:
        text += "Уровень: нет\n"

    if next_t:
        remaining = next_t - total
        span = next_t - prev_t
        bar = progress_bar(total - prev_t, span)
        text += f"\nДо {next_name}:\n{bar} осталось {remaining:,}₽\n"
    else:
        text += "\n🏆 Максимальный уровень достигнут!\n"

    text += "\n📊 Все уровни:\n"
    for threshold, name, disc in sorted_asc:
        mark = "✅" if total >= threshold else "⬜"
        text += f"{mark} {name} — от {threshold:,}₽ ({disc}%)\n"

    return text


bot = Bot(token=API_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(bot, storage=storage)

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
gs_creds = ServiceAccountCredentials.from_json_keyfile_name("creds.json", scope)
gs_client = gspread.authorize(gs_creds)
spreadsheet = gs_client.open("VAPE SHOP")
products_ws = spreadsheet.worksheet("Товары")
sales_ws    = spreadsheet.worksheet("Продажи")
clients_ws  = spreadsheet.worksheet("Клиенты")

cart = {}
user_qty = {}


class OrderState(StatesGroup):
    waiting_contact  = State()
    waiting_address  = State()
    waiting_payment  = State()


# --- ЛОЯЛЬНОСТЬ ---

def get_user_total(uid: int) -> int:
    try:
        for r in clients_ws.get_all_records():
            if int(r.get("ID", 0)) == uid:
                return int(r.get("Итого", 0))
    except Exception as e:
        logging.error(f"get_user_total: {e}")
    return 0

def update_user_total(uid: int, contact: str, amount: int) -> int:
    try:
        records = clients_ws.get_all_records()
        now = datetime.now().strftime("%Y-%m-%d")
        for idx, r in enumerate(records):
            if int(r.get("ID", 0)) == uid:
                new_total = int(r.get("Итого", 0)) + amount
                clients_ws.update_cell(idx + 2, 3, new_total)
                clients_ws.update_cell(idx + 2, 5, now)
                return new_total
        clients_ws.append_row([uid, contact, amount, now, now])
        return amount
    except Exception as e:
        logging.error(f"update_user_total: {e}")
        return 0


# --- МЕНЮ ---

def main_menu():
    kb = InlineKeyboardMarkup()
    if WEBAPP_URL:
        kb.add(InlineKeyboardButton("🌐 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL)))
    kb.add(InlineKeyboardButton("🔥 Одноразки",  callback_data="cat_Одноразка"))
    kb.add(InlineKeyboardButton("💧 Жидкости",   callback_data="cat_Жидкость"))
    kb.add(InlineKeyboardButton("🚬 Табак",      callback_data="cat_Табак"))
    kb.add(InlineKeyboardButton("⚙️ Устройства", callback_data="cat_Устройство"))
    kb.add(InlineKeyboardButton("🛒 Корзина",    callback_data="open_cart"))
    kb.add(InlineKeyboardButton("🎁 Моя лояльность", callback_data="my_loyalty"))
    return kb

def webapp_keyboard():
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    if WEBAPP_URL:
        kb.add(KeyboardButton("🌐 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL)))
    return kb

def loyalty_text(uid: int) -> str:
    total = get_user_total(uid)
    level_name, discount = get_loyalty(total)
    next_t, next_name = next_level_info(total)
    if level_name:
        text = f"Твой уровень: {level_name} — скидка {discount}%\n"
        if next_t:
            text += f"До {next_name}: {next_t - total:,}₽\n"
        return text
    if next_t:
        return f"Накопи {next_t - total:,}₽ для уровня {next_name} 🎁\n"
    return ""


@dp.message_handler(commands=["start"], state="*")
async def start(msg: types.Message, state: FSMContext):
    await state.finish()
    text = "Добро пожаловать в VAPE SHOP VRN 💨\nПриятных покупок 🛒"
    # Постоянная кнопка Mini App под полем ввода
    await msg.answer(text, reply_markup=webapp_keyboard())
    # Инлайн-меню с категориями
    await msg.answer("Выбери раздел:", reply_markup=main_menu())

@dp.message_handler(commands=["loyalty"], state="*")
async def loyalty_cmd(msg: types.Message):
    await msg.answer(loyalty_full_text(msg.from_user.id))

@dp.message_handler(commands=["app"], state="*")
async def app_cmd(msg: types.Message):
    if WEBAPP_URL:
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🌐 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL)))
        await msg.answer("Нажми кнопку, чтобы открыть Mini App:", reply_markup=kb)
    else:
        await msg.answer("Mini App пока недоступен.")

@dp.message_handler(commands=["cart"], state="*")
async def cart_cmd(msg: types.Message):
    await show_cart(msg, msg.from_user.id)

@dp.callback_query_handler(lambda c: c.data == "my_loyalty")
async def my_loyalty_callback(call: types.CallbackQuery):
    await call.answer()
    await call.message.answer(loyalty_full_text(call.from_user.id))


# --- НАЗАД ---

@dp.callback_query_handler(lambda c: c.data == "back_main", state="*")
async def back(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.message.edit_text("Главное меню", reply_markup=main_menu())


# --- КАТЕГОРИИ ---

@dp.callback_query_handler(lambda c: c.data.startswith("cat_"))
async def brands_handler(call: types.CallbackQuery):
    category = call.data[4:]
    data = products_ws.get_all_records()
    brand_set = {i["Бренд"] for i in data if i["Категория"] == category and i["Остаток"] > 0}
    if not brand_set:
        await call.answer("Нет товаров в этой категории", show_alert=True)
        return
    kb = InlineKeyboardMarkup()
    for b in sorted(brand_set):
        kb.add(InlineKeyboardButton(b, callback_data=f"brand_{category}|{b}"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data="back_main"))
    await call.message.edit_text("Выбери бренд:", reply_markup=kb)


# --- ЗАТЯЖКИ ---

@dp.callback_query_handler(lambda c: c.data.startswith("brand_"))
async def puffs_handler(call: types.CallbackQuery):
    category, brand = call.data[6:].split("|", 1)
    data = products_ws.get_all_records()
    puffs_set = {
        str(i["Затяжки"]) for i in data
        if i["Категория"] == category and i["Бренд"] == brand
        and i["Остаток"] > 0 and i.get("Затяжки")
    }
    if not puffs_set:
        await show_products_direct(call, category, brand)
        return
    kb = InlineKeyboardMarkup()
    for p in sorted(puffs_set, key=lambda x: int(x) if x.isdigit() else 0):
        kb.add(InlineKeyboardButton(f"{p} тяг", callback_data=f"puffs_{category}|{brand}|{p}"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data=f"cat_{category}"))
    await call.message.edit_text("Выбери затяжки:", reply_markup=kb)


# --- ТОВАРЫ ---

@dp.callback_query_handler(lambda c: c.data.startswith("puffs_"))
async def show_products(call: types.CallbackQuery):
    category, brand, puffs = call.data[6:].split("|", 2)
    data = products_ws.get_all_records()
    kb = InlineKeyboardMarkup()
    for i in data:
        if i["Категория"] == category and i["Бренд"] == brand and str(i["Затяжки"]) == puffs and i["Остаток"] > 0:
            kb.add(InlineKeyboardButton(f"{i['Название']} — {i['Цена (₽)']}₽", callback_data=f"item_{i['ID']}"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data=f"brand_{category}|{brand}"))
    await call.message.edit_text("Выбери товар:", reply_markup=kb)

async def show_products_direct(call: types.CallbackQuery, category: str, brand: str):
    data = products_ws.get_all_records()
    kb = InlineKeyboardMarkup()
    for i in data:
        if i["Категория"] == category and i["Бренд"] == brand and i["Остаток"] > 0:
            kb.add(InlineKeyboardButton(f"{i['Название']} — {i['Цена (₽)']}₽", callback_data=f"item_{i['ID']}"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data=f"cat_{category}"))
    await call.message.edit_text("Выбери товар:", reply_markup=kb)


# --- КАРТОЧКА ---

def item_keyboard(pid: int, qty: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup()
    kb.add(
        InlineKeyboardButton("➖", callback_data=f"minus_{pid}"),
        InlineKeyboardButton(f"{qty} шт", callback_data="noop"),
        InlineKeyboardButton("➕", callback_data=f"plus_{pid}")
    )
    kb.add(InlineKeyboardButton("🛒 В корзину", callback_data=f"add_{pid}"))
    kb.add(InlineKeyboardButton("🛒 Корзина", callback_data="open_cart"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data="back_main"))
    return kb

@dp.callback_query_handler(lambda c: c.data.startswith("item_"))
async def item_handler(call: types.CallbackQuery):
    pid = int(call.data.split("_")[1])
    for i in products_ws.get_all_records():
        if i["ID"] == pid:
            user_qty[call.from_user.id] = 1
            await call.message.edit_text(
                f"{i['Название']}\n\n"
                f"💰 {i['Цена (₽)']}₽\n"
                f"📦 Остаток: {i['Остаток']}\n\n"
                f"📝 {i.get('Описание', 'Без описания')}",
                reply_markup=item_keyboard(pid, 1)
            )
            return

@dp.callback_query_handler(lambda c: c.data.startswith("plus_"))
async def plus(call: types.CallbackQuery):
    pid = int(call.data.split("_")[1])
    uid = call.from_user.id
    user_qty[uid] = user_qty.get(uid, 1) + 1
    await call.message.edit_reply_markup(item_keyboard(pid, user_qty[uid]))

@dp.callback_query_handler(lambda c: c.data.startswith("minus_"))
async def minus(call: types.CallbackQuery):
    pid = int(call.data.split("_")[1])
    uid = call.from_user.id
    user_qty[uid] = max(1, user_qty.get(uid, 1) - 1)
    await call.message.edit_reply_markup(item_keyboard(pid, user_qty[uid]))

@dp.callback_query_handler(lambda c: c.data == "noop")
async def noop(call: types.CallbackQuery):
    await call.answer()


# --- КОРЗИНА ---

@dp.callback_query_handler(lambda c: c.data.startswith("add_"))
async def add_to_cart(call: types.CallbackQuery):
    pid = int(call.data.split("_")[1])
    uid = call.from_user.id
    qty = user_qty.get(uid, 1)
    cart.setdefault(uid, {})
    cart[uid][pid] = cart[uid].get(pid, 0) + qty
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🛒 Перейти в корзину", callback_data="open_cart"))
    kb.add(InlineKeyboardButton("⬅️ Продолжить покупки", callback_data="back_main"))
    await call.answer(f"Добавлено: {qty} шт")
    await call.message.edit_reply_markup(kb)

@dp.callback_query_handler(lambda c: c.data == "open_cart")
async def open_cart_handler(call: types.CallbackQuery):
    await show_cart(call.message, call.from_user.id)

async def show_cart(msg: types.Message, uid: int):
    if uid not in cart or not cart[uid]:
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("⬅️ Назад", callback_data="back_main"))
        await msg.answer("🛒 Корзина пустая", reply_markup=kb)
        return

    data = products_ws.get_all_records()
    raw_total = 0
    text = "🛒 Твоя корзина:\n\n"
    kb = InlineKeyboardMarkup()

    for pid, qty in list(cart[uid].items()):
        for i in data:
            if i["ID"] == pid:
                price = i["Цена (₽)"]
                summ = price * qty
                raw_total += summ
                text += f"{i['Название']}\n{qty} × {price}₽ = {summ}₽\n\n"
                kb.add(InlineKeyboardButton(f"❌ {i['Название']}", callback_data=f"remove_{pid}"))

    level_name, discount = get_loyalty(get_user_total(uid))
    if discount > 0:
        disc_sum = int(raw_total * discount / 100)
        text += f"💰 Сумма: {raw_total:,}₽\n"
        text += f"🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽\n"
        text += f"✅ Итого: {raw_total - disc_sum:,}₽"
    else:
        text += f"💰 Итого: {raw_total:,}₽"

    kb.add(InlineKeyboardButton("🧹 Очистить корзину", callback_data="clear"))
    kb.add(InlineKeyboardButton("✅ Оформить заказ",   callback_data="checkout"))
    kb.add(InlineKeyboardButton("⬅️ Назад",            callback_data="back_main"))
    await msg.answer(text, reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data.startswith("remove_"))
async def remove_item(call: types.CallbackQuery):
    uid = call.from_user.id
    pid = int(call.data.split("_")[1])
    if uid in cart and pid in cart[uid]:
        del cart[uid][pid]
    await call.answer("Удалено")
    await show_cart(call.message, uid)

@dp.callback_query_handler(lambda c: c.data == "clear")
async def clear_cart(call: types.CallbackQuery):
    cart[call.from_user.id] = {}
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("⬅️ В меню", callback_data="back_main"))
    await call.message.edit_text("🛒 Корзина очищена", reply_markup=kb)


# --- ОФОРМЛЕНИЕ: шаг 1 — выбор доставки ---

@dp.callback_query_handler(lambda c: c.data == "checkout")
async def checkout(call: types.CallbackQuery):
    uid = call.from_user.id
    if uid not in cart or not cart[uid]:
        await call.answer("Корзина пустая", show_alert=True)
        return
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🚚 Доставка",  callback_data="delivery_courier"))
    kb.add(InlineKeyboardButton("🚶 Самовывоз", callback_data="delivery_pickup"))
    kb.add(InlineKeyboardButton("⬅️ Назад",     callback_data="open_cart"))
    await call.message.edit_text("Выбери способ получения:", reply_markup=kb)


# --- САМОВЫВОЗ: показываем пункт выдачи ---

@dp.callback_query_handler(lambda c: c.data == "delivery_pickup")
async def pickup_point(call: types.CallbackQuery, state: FSMContext):
    await state.update_data(delivery="pickup", address=PICKUP_ADDRESS)
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton(f"📍 {PICKUP_ADDRESS} — подтвердить", callback_data="confirm_pickup"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data="checkout"))
    await call.message.edit_text(
        f"📍 *Пункт самовывоза:*\n\n`{PICKUP_ADDRESS}`\n\nНажми для подтверждения:",
        parse_mode="Markdown",
        reply_markup=kb
    )

@dp.callback_query_handler(lambda c: c.data == "confirm_pickup")
async def confirm_pickup(call: types.CallbackQuery, state: FSMContext):
    await OrderState.waiting_contact.set()
    await call.message.edit_text("📱 Напиши свой @username или номер телефона:")


# --- ДОСТАВКА: запрашиваем контакт ---

@dp.callback_query_handler(lambda c: c.data == "delivery_courier")
async def delivery_courier(call: types.CallbackQuery, state: FSMContext):
    await state.update_data(delivery="courier")
    await OrderState.waiting_contact.set()
    await call.message.edit_text("📱 Напиши свой @username или номер телефона:")


# --- ШАГ 2: контакт ---

@dp.message_handler(state=OrderState.waiting_contact)
async def get_contact(msg: types.Message, state: FSMContext):
    await state.update_data(contact=msg.text)
    data = await state.get_data()
    if data.get("delivery") == "courier":
        await OrderState.waiting_address.set()
        await msg.answer("📍 Укажи адрес доставки (улица, дом, квартира):")
    else:
        await OrderState.waiting_payment.set()
        await show_payment_options(msg, state)


# --- ШАГ 3: адрес (только для доставки) ---

@dp.message_handler(state=OrderState.waiting_address)
async def get_address(msg: types.Message, state: FSMContext):
    await state.update_data(address=msg.text)
    await OrderState.waiting_payment.set()
    await show_payment_options(msg, state)


async def show_payment_options(msg: types.Message, state: FSMContext):
    uid = msg.from_user.id
    user_total = get_user_total(uid)
    level_name, discount = get_loyalty(user_total)

    data_gs = products_ws.get_all_records()
    raw_total = sum(
        item["Цена (₽)"] * qty
        for pid, qty in cart.get(uid, {}).items()
        for item in data_gs if item["ID"] == pid
    )
    disc_sum   = int(raw_total * discount / 100)
    final_total = raw_total - disc_sum

    text = f"💰 Сумма заказа: {raw_total:,}₽"
    if discount > 0:
        text += f"\n🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽\n✅ К оплате: {final_total:,}₽"

    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("💳 Перевод на карту", callback_data="pay_card"))
    kb.add(InlineKeyboardButton("💵 Наличные",         callback_data="pay_cash"))
    await msg.answer(text, reply_markup=kb)


# --- ШАГ 4: оплата и финализация ---

@dp.callback_query_handler(lambda c: c.data.startswith("pay_"), state=OrderState.waiting_payment)
async def finish(call: types.CallbackQuery, state: FSMContext):
    uid   = call.from_user.id
    pay   = call.data.split("_", 1)[1]

    order_data = await state.get_data()
    delivery   = order_data.get("delivery", "pickup")
    contact    = order_data.get("contact", "—")
    address    = order_data.get("address", PICKUP_ADDRESS)
    await state.finish()

    if uid not in cart or not cart[uid]:
        await call.answer("Корзина пустая", show_alert=True)
        return

    data_gs = products_ws.get_all_records()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    raw_total = 0
    order_lines = []

    user_total  = get_user_total(uid)
    level_name, discount = get_loyalty(user_total)

    for pid, qty in list(cart[uid].items()):
        for idx, item in enumerate(data_gs):
            if item["ID"] == pid:
                price = item["Цена (₽)"]
                summ  = price * qty
                raw_total += summ
                order_lines.append(f"{item['Название']} × {qty} = {summ:,}₽")
                products_ws.update_cell(idx + 2, 7, max(0, item["Остаток"] - qty))
                sales_ws.append_row([
                    now, uid, contact,
                    item["Название"], qty, price, summ,
                    "Доставка" if delivery == "courier" else "Самовывоз",
                    address, "Перевод" if pay == "card" else "Наличные",
                    discount, ""  # итого со скидкой заполним ниже
                ])

    disc_sum    = int(raw_total * discount / 100)
    final_total = raw_total - disc_sum
    new_total   = update_user_total(uid, contact, final_total)
    new_level, _= get_loyalty(new_total)
    cart[uid]   = {}

    pay_label      = "Перевод на карту" if pay == "card" else "Наличные"
    delivery_label = "Доставка" if delivery == "courier" else "Самовывоз"
    summary        = "\n".join(order_lines)

    user_text = f"✅ Заказ оформлен!\n\n{summary}\n\n💰 Сумма: {raw_total:,}₽"
    if discount > 0:
        user_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽\n✅ Итого: {final_total:,}₽"
    user_text += (
        f"\n\n🚚 Получение: {delivery_label}\n"
        f"📍 Адрес: {address}\n"
        f"💳 Оплата: {pay_label}\n\n"
        f"Мы свяжемся с тобой в ближайшее время 🙌"
    )
    if new_level and new_level != level_name:
        user_text += f"\n\n🎉 Новый уровень: {new_level}!"

    await call.message.edit_text(user_text)

    seller_text = (
        f"🔥 Новый заказ!\n\n"
        f"👤 {contact} (ID: {uid})\n\n"
        f"📦 Состав:\n{summary}\n\n"
        f"💰 Сумма: {raw_total:,}₽"
    )
    if discount > 0:
        seller_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽\n✅ Итого: {final_total:,}₽"
    seller_text += (
        f"\n\n🚚 Тип: {delivery_label}\n"
        f"📍 Адрес: {address}\n"
        f"💳 Оплата: {pay_label}"
    )
    for seller_id in SELLER_IDS:
        try:
            await bot.send_message(seller_id, seller_text)
        except Exception as e:
            logging.error(f"Ошибка отправки продавцу {seller_id}: {e}")


# --- MINI APP: заказ из веб-приложения ---

@dp.message_handler(content_types=types.ContentType.WEB_APP_DATA)
async def web_app_order(msg: types.Message):
    try:
        data       = json.loads(msg.web_app_data.data)
        uid        = msg.from_user.id
        contact    = data.get("contact", "—")
        address    = data.get("address", PICKUP_ADDRESS)
        delivery   = data.get("delivery", "pickup")
        pay        = data.get("pay", "card")
        items      = data.get("items", [])

        user_total  = get_user_total(uid)
        level_name, discount = get_loyalty(user_total)

        now       = datetime.now().strftime("%Y-%m-%d %H:%M")
        raw_total = sum(i["price"] * i["qty"] for i in items)
        disc_sum  = int(raw_total * discount / 100)
        final_total = raw_total - disc_sum

        data_gs     = products_ws.get_all_records()
        order_lines = []

        for it in items:
            summ = it["price"] * it["qty"]
            order_lines.append(f"{it['name']} × {it['qty']} = {summ:,}₽")
            for idx, row in enumerate(data_gs):
                if row["ID"] == it["id"]:
                    products_ws.update_cell(idx + 2, 7, max(0, row["Остаток"] - it["qty"]))
            sales_ws.append_row([
                now, uid, contact,
                it["name"], it["qty"], it["price"], summ,
                "Доставка" if delivery == "courier" else "Самовывоз",
                address, "Перевод" if pay == "card" else "Наличные",
                discount, final_total
            ])

        new_total = update_user_total(uid, contact, final_total)
        new_level, _ = get_loyalty(new_total)

        summary        = "\n".join(order_lines)
        pay_label      = "Перевод на карту" if pay == "card" else "Наличные"
        delivery_label = "Доставка" if delivery == "courier" else "Самовывоз"

        user_text = f"✅ Заказ из Mini App оформлен!\n\n{summary}\n\n💰 Сумма: {raw_total:,}₽"
        if discount > 0:
            user_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽\n✅ Итого: {final_total:,}₽"
        user_text += (
            f"\n\n🚚 Получение: {delivery_label}\n"
            f"📍 Адрес: {address}\n"
            f"💳 Оплата: {pay_label}\n\n"
            f"Мы свяжемся с тобой в ближайшее время 🙌"
        )
        if new_level and new_level != level_name:
            user_text += f"\n\n🎉 Новый уровень: {new_level}!"
        await msg.answer(user_text)

        seller_text = (
            f"🔥 Новый заказ (Mini App)!\n\n"
            f"👤 {contact} (ID: {uid})\n\n"
            f"📦 Состав:\n{summary}\n\n"
            f"💰 Сумма: {raw_total:,}₽"
        )
        if discount > 0:
            seller_text += f"\n🎁 Скидка {level_name}: -{disc_sum:,}₽\n✅ Итого: {final_total:,}₽"
        seller_text += f"\n\n🚚 Тип: {delivery_label}\n📍 Адрес: {address}\n💳 Оплата: {pay_label}"
        for seller_id in SELLER_IDS:
            try:
                await bot.send_message(seller_id, seller_text)
            except Exception as e:
                logging.error(f"Ошибка отправки продавцу {seller_id}: {e}")

    except Exception as e:
        logging.error(f"web_app_order error: {e}")
        await msg.answer("Ошибка при оформлении. Попробуй через бота.")


async def on_startup(dp):
    await bot.set_my_commands([
        types.BotCommand("start",   "Главное меню"),
        types.BotCommand("app",     "Открыть Mini App"),
        types.BotCommand("loyalty", "Моя лояльность"),
        types.BotCommand("cart",    "Корзина"),
    ])

if __name__ == "__main__":
    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)
