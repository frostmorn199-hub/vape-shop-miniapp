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
import random
import string
import time
import asyncio

logging.basicConfig(level=logging.INFO)

API_TOKEN = "8751207190:AAEm1ZeGSJQn0LCKKIq6rd_GZxAChr2IhR0"
ADMIN_ID = 525971484
SELLER_IDS = [8784410820, 525971484, 5710542507]
PICKUP_ADDRESS = "Кривошеина 13/2"
WEBAPP_URL = "https://frostmorn199-hub.github.io/vape-shop-miniapp"
MIN_REFERRAL_PURCHASE = 950
REFERRAL_BONUS_COINS = 100
DELIVERY_FEE = 250
FREE_DELIVERY_THRESHOLD = 2000

# Скидочная программа (по сумме покупок)
LOYALTY_LEVELS = [
    (300_000, "Платина 💎", 15),
    (100_000, "Золото 🥇",  10),
    (50_000,  "Серебро 🥈",  7),
    (20_000,  "Бронза 🥉",   5),
]

# Реферальная программа (по числу активных рефералов)
REFERRAL_LEVELS = [
    (100, "Платина 🔥", 10),
    (40,  "Золото 🥇",   7),
    (15,  "Серебро 🥈",  5),
    (1,   "Бронза 🥉",   3),
]


# ── Скидочная система ───────────────────────────────────────

def get_loyalty(total: int):
    for threshold, name, discount in LOYALTY_LEVELS:
        if total >= threshold:
            return name, discount
    return None, 0

def next_level_info(total: int):
    for threshold, name, _ in sorted(LOYALTY_LEVELS, key=lambda x: x[0]):
        if total < threshold:
            return threshold, name
    return None, None

def progress_bar(current: int, target: int, length: int = 10) -> str:
    if target <= 0:
        return "▓" * length
    filled = min(int((current / target) * length), length)
    return "▓" * filled + "░" * (length - filled)


# ── Реферальная система ─────────────────────────────────────

def get_referral_level(count: int):
    for threshold, name, pct in REFERRAL_LEVELS:
        if count >= threshold:
            return name, pct
    return None, 0

def next_referral_level_info(count: int):
    for threshold, name, _ in sorted(REFERRAL_LEVELS, key=lambda x: x[0]):
        if count < threshold:
            return threshold, name
    return None, None


# ── Инициализация бота и таблиц ─────────────────────────────

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
referrals_ws = None
orders_ws    = None
partners_ws  = None
promos_ws    = None

cart     = {}
user_qty = {}


class OrderState(StatesGroup):
    waiting_contact = State()
    waiting_address = State()
    waiting_comment = State()
    waiting_payment = State()

class PromoState(StatesGroup):
    waiting_promo = State()

class AdjustStockState(StatesGroup):
    waiting_product_name = State()
    waiting_quantity = State()

class BroadcastState(StatesGroup):
    waiting_message = State()

class NotifyState(StatesGroup):
    waiting_product = State()


# ── Инициализация листов ────────────────────────────────────

def init_sheets():
    global referrals_ws, orders_ws
    try:
        referrals_ws = spreadsheet.worksheet("Рефералы")
    except gspread.exceptions.WorksheetNotFound:
        referrals_ws = spreadsheet.add_worksheet("Рефералы", rows=1000, cols=4)
        referrals_ws.append_row(["Пригласивший_ID", "Приглашенный_ID", "Дата", "Активирован"])

    try:
        orders_ws = spreadsheet.worksheet("Заказы")
        # Добавляем колонку Товары_JSON если её нет
        orders_headers = orders_ws.row_values(1)
        if "Товары_JSON" not in orders_headers:
            orders_ws.update_cell(1, len(orders_headers) + 1, "Товары_JSON")
    except gspread.exceptions.WorksheetNotFound:
        orders_ws = spreadsheet.add_worksheet("Заказы", rows=1000, cols=12)
        orders_ws.append_row([
            "Заказ_ID", "Покупатель_ID", "Контакт", "Дата",
            "Сумма", "Финальная_сумма", "Тип", "Адрес", "Оплата", "Статус", "Состав", "Товары_JSON"
        ])

    global partners_ws
    try:
        partners_ws = spreadsheet.worksheet("Партнёры")
    except gspread.exceptions.WorksheetNotFound:
        partners_ws = spreadsheet.add_worksheet("Партнёры", rows=1000, cols=6)
        partners_ws.append_row(["ID", "Контакт", "Промокод", "Приглашено_всего", "Активных_рефералов", "Дата_регистрации"])

    global promos_ws
    try:
        promos_ws = spreadsheet.worksheet("Промокоды_колесо")
    except gspread.exceptions.WorksheetNotFound:
        promos_ws = spreadsheet.add_worksheet("Промокоды_колесо", rows=1000, cols=6)
        promos_ws.append_row(["Код", "Тип", "Скидка", "UID", "Использован", "Дата"])

    # Добавляем колонку Промо_скидка в Клиенты если нет
    try:
        headers = clients_ws.row_values(1)
        if "Промо_скидка" not in headers:
            clients_ws.update_cell(1, len(headers) + 1, "Промо_скидка")
    except Exception as e:
        logging.error(f"init Промо_скидка: {e}")

    # Добавляем новые заголовки в Клиенты если их нет
    try:
        headers = clients_ws.row_values(1)
        new_cols = {5: "Промокод", 6: "Реферер_ID", 7: "Вейпкоины", 8: "Промо_активирован"}
        for col_0, name in new_cols.items():
            if len(headers) <= col_0 or not headers[col_0]:
                clients_ws.update_cell(1, col_0 + 1, name)
    except Exception as e:
        logging.error(f"init_sheets headers: {e}")


# ── Клиенты: вспомогательные функции ───────────────────────

def _generate_unique_code() -> str:
    try:
        existing = {r.get("Промокод", "") for r in clients_ws.get_all_records()}
        while True:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in existing:
                return code
    except Exception:
        return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def _find_client_row(uid: int):
    try:
        records = clients_ws.get_all_records()
        for idx, r in enumerate(records):
            try:
                if int(r.get("ID", 0) or 0) == uid:
                    return idx + 2, r
            except (ValueError, TypeError):
                continue
    except Exception as e:
        logging.error(f"_find_client_row: {e}")
    return None, None

def ensure_client(uid: int, contact: str = "—") -> str:
    """Убедиться что юзер есть в Клиентах. Вернуть его реферальный код."""
    row_idx, rec = _find_client_row(uid)
    if row_idx:
        code = rec.get("Промокод", "")
        if not code:
            code = _generate_unique_code()
            clients_ws.update_cell(row_idx, 6, code)
        return code
    code = _generate_unique_code()
    now = datetime.now().strftime("%Y-%m-%d")
    clients_ws.append_row([uid, contact, 0, now, now, code, "", 0, 0])
    update_partners_row(uid)
    return code

def get_user_total(uid: int) -> int:
    _, rec = _find_client_row(uid)
    return int(rec.get("Итого", 0) or 0) if rec else 0

def update_user_total(uid: int, contact: str, amount: int) -> int:
    row_idx, rec = _find_client_row(uid)
    now = datetime.now().strftime("%Y-%m-%d")
    if row_idx:
        new_total = int(rec.get("Итого", 0) or 0) + amount
        clients_ws.update_cell(row_idx, 3, new_total)
        clients_ws.update_cell(row_idx, 5, now)
        return new_total
    code = _generate_unique_code()
    clients_ws.append_row([uid, contact, amount, now, now, code, "", 0, 0])
    return amount

def get_vaypecoins(uid: int) -> int:
    _, rec = _find_client_row(uid)
    return int(rec.get("Вейпкоины", 0) or 0) if rec else 0

def add_vaypecoins(uid: int, amount: int) -> int:
    row_idx, rec = _find_client_row(uid)
    if row_idx:
        current = int(rec.get("Вейпкоины", 0) or 0)
        clients_ws.update_cell(row_idx, 8, current + amount)
        return current + amount
    return 0

def get_referral_code(uid: int) -> str:
    _, rec = _find_client_row(uid)
    return rec.get("Промокод", "") if rec else ""

def get_referrer_id(uid: int):
    _, rec = _find_client_row(uid)
    if rec:
        ref = rec.get("Реферер_ID", "")
        try:
            return int(ref) if ref else None
        except (ValueError, TypeError):
            return None
    return None

def is_promo_activated(uid: int) -> bool:
    _, rec = _find_client_row(uid)
    return int(rec.get("Промо_активирован", 0) or 0) == 1 if rec else False

def set_promo_activated(uid: int):
    row_idx, _ = _find_client_row(uid)
    if row_idx:
        clients_ws.update_cell(row_idx, 9, 1)

def set_referrer(uid: int, referrer_id: int):
    row_idx, _ = _find_client_row(uid)
    if row_idx:
        clients_ws.update_cell(row_idx, 7, referrer_id)


# ── Партнёры (отдельный лист) ───────────────────────────────

def update_partners_row(uid: int):
    if not partners_ws or not referrals_ws:
        return
    try:
        _, rec = _find_client_row(uid)
        if not rec:
            return
        contact  = rec.get("Контакт", "—")
        promo    = rec.get("Промокод", "")
        reg_date = rec.get("Дата_регистрации", "")

        all_refs     = referrals_ws.get_all_records()
        total_inv    = sum(1 for r in all_refs if int(r.get("Пригласивший_ID", 0)) == uid)
        active_inv   = sum(1 for r in all_refs
                          if int(r.get("Пригласивший_ID", 0)) == uid
                          and int(r.get("Активирован", 0)) == 1)

        all_partners = partners_ws.get_all_records()
        for idx, p in enumerate(all_partners):
            if int(p.get("ID", 0)) == uid:
                partners_ws.update(f"A{idx+2}:F{idx+2}",
                                   [[uid, contact, promo, total_inv, active_inv, reg_date]])
                return
        partners_ws.append_row([uid, contact, promo, total_inv, active_inv, reg_date])
    except Exception as e:
        logging.error(f"update_partners_row: {e}")


# ── Рефералы ────────────────────────────────────────────────

def get_active_referral_count(uid: int) -> int:
    try:
        records = referrals_ws.get_all_records()
        return sum(
            1 for r in records
            if int(r.get("Пригласивший_ID", 0)) == uid
            and int(r.get("Активирован", 0)) == 1
        )
    except Exception as e:
        logging.error(f"get_active_referral_count: {e}")
    return 0

def activate_referral_record(referred_uid: int):
    try:
        records = referrals_ws.get_all_records()
        for idx, r in enumerate(records):
            if (int(r.get("Приглашенный_ID", 0)) == referred_uid
                    and int(r.get("Активирован", 0)) == 0):
                referrals_ws.update_cell(idx + 2, 4, 1)
                inviter_id = int(r.get("Пригласивший_ID", 0))
                if inviter_id:
                    update_partners_row(inviter_id)
                return
    except Exception as e:
        logging.error(f"activate_referral_record: {e}")

def find_code_owner(code: str):
    try:
        for r in clients_ws.get_all_records():
            if r.get("Промокод", "").upper() == code.upper():
                return int(r.get("ID", 0))
    except Exception as e:
        logging.error(f"find_code_owner: {e}")
    return None

def apply_promo_code(uid: int, code: str) -> tuple:
    # Сначала проверяем промокоды колеса фортуны
    wheel_promo = find_wheel_promo(code)
    if wheel_promo:
        if int(wheel_promo.get("Использован", 0)) == 1:
            return False, "❌ Этот промокод уже был использован."
        discount = int(wheel_promo.get("Скидка", 0))
        mark_wheel_promo_used(code, uid)
        set_user_wheel_discount(uid, discount)
        return True, (
            f"🎰 Промокод с колеса фортуны активирован!\n\n"
            f"🏷️ Скидка {discount}% будет применена к твоему следующему заказу автоматически."
        )

    # Реферальный промокод
    owner_id = find_code_owner(code)
    if not owner_id:
        return False, "❌ Промокод не найден."
    if owner_id == uid:
        return False, "❌ Нельзя использовать собственный промокод."
    existing = get_referrer_id(uid)
    if existing:
        return False, "❌ Ты уже использовал реферальный промокод."
    set_referrer(uid, owner_id)
    now = datetime.now().strftime("%Y-%m-%d")
    referrals_ws.append_row([owner_id, uid, now, 0])
    update_partners_row(owner_id)
    return True, (
        f"✅ Реферальный промокод принят!\n\n"
        f"Сделай первую покупку на {MIN_REFERRAL_PURCHASE}₽+ и получи "
        f"{REFERRAL_BONUS_COINS} вейпкоинов на баланс 🎁"
    )


# ── Промокоды колеса фортуны ────────────────────────────────

def find_wheel_promo(code: str):
    """Ищет промокод из колеса. Возвращает запись или None."""
    if not promos_ws:
        return None
    try:
        for r in promos_ws.get_all_records():
            if r.get("Код", "").upper() == code.upper():
                return r
    except Exception as e:
        logging.error(f"find_wheel_promo: {e}")
    return None

def mark_wheel_promo_used(code: str, uid: int):
    """Помечает промокод как использованный."""
    if not promos_ws:
        return
    try:
        records = promos_ws.get_all_records()
        for idx, r in enumerate(records):
            if r.get("Код", "").upper() == code.upper():
                promos_ws.update_cell(idx + 2, 4, uid)   # UID
                promos_ws.update_cell(idx + 2, 5, 1)     # Использован
                return
    except Exception as e:
        logging.error(f"mark_wheel_promo_used: {e}")

def get_user_wheel_discount(uid: int) -> int:
    """Возвращает скидку из промокода колеса (0 если нет активной)."""
    try:
        _, rec = _find_client_row(uid)
        if rec:
            return int(rec.get("Промо_скидка", 0) or 0)
    except Exception as e:
        logging.error(f"get_user_wheel_discount: {e}")
    return 0

def set_user_wheel_discount(uid: int, discount: int):
    """Сохраняет скидку из колеса в запись клиента."""
    try:
        row_idx, rec = _find_client_row(uid)
        if row_idx:
            headers = clients_ws.row_values(1)
            col = headers.index("Промо_скидка") + 1 if "Промо_скидка" in headers else len(headers)
            clients_ws.update_cell(row_idx, col, discount)
    except Exception as e:
        logging.error(f"set_user_wheel_discount: {e}")

def clear_user_wheel_discount(uid: int):
    set_user_wheel_discount(uid, 0)


# ── Заказы ──────────────────────────────────────────────────

def save_order(order_id: str, uid: int, contact: str, raw_total: int, final_total: int,
               delivery: str, address: str, pay: str, summary: str, items_json: str = ""):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    orders_ws.append_row([
        order_id, uid, contact, now, raw_total, final_total,
        "Доставка" if delivery == "courier" else "Самовывоз",
        address, "Перевод" if pay == "card" else "Наличные",
        "pending", summary, items_json
    ])

def get_order(order_id: str):
    try:
        for r in orders_ws.get_all_records():
            if str(r.get("Заказ_ID", "")) == order_id:
                return r
    except Exception as e:
        logging.error(f"get_order: {e}")
    return None

def set_order_status(order_id: str, status: str):
    try:
        records = orders_ws.get_all_records()
        for idx, r in enumerate(records):
            if str(r.get("Заказ_ID", "")) == order_id:
                orders_ws.update_cell(idx + 2, 10, status)
                return True
    except Exception as e:
        logging.error(f"set_order_status: {e}")
    return False

PICKUP_STATUSES = [
    ("Заказ принят",    "📦 Твой заказ принят! Начинаем обработку."),
    ("Готовим",         "🔧 Готовим твой заказ, ожидай!"),
    ("Готово к выдаче", "✅ Твой заказ готов к выдаче! Ждём тебя 🏪"),
]
DELIVERY_STATUSES = [
    ("Собираем заказ",          "📦 Собираем твой заказ!"),
    ("Отправлен в доставку",    "🚚 Заказ отправлен в доставку! Ожидай курьера."),
    ("Заказ успешно доставлен", "✅ Заказ успешно доставлен! Спасибо за покупку 🙌"),
]

def seller_kb(order_id: str, delivery: str = "pickup", step: int = 0) -> InlineKeyboardMarkup:
    """step = index of the next status to set (0-based)."""
    kb = InlineKeyboardMarkup()
    statuses = DELIVERY_STATUSES if delivery == "courier" else PICKUP_STATUSES
    if step < len(statuses):
        label, _ = statuses[step]
        kb.add(InlineKeyboardButton(f"✅ {label}", callback_data=f"sts_{order_id}_{step}"))
    kb.add(InlineKeyboardButton("❌ Отменить", callback_data=f"order_cancel_{order_id}"))
    return kb


# ── Восстановление остатка при отмене ───────────────────────

def restore_order_stock(order_id: str):
    """Возвращает товары на остаток при отмене заказа."""
    order = get_order(order_id)
    if not order:
        return
    try:
        items_json_str = str(order.get("Товары_JSON", "") or "")
        if not items_json_str:
            return
        items_list = json.loads(items_json_str)
    except Exception as e:
        logging.error(f"restore_order_stock parse: {e}")
        return
    data_gs = products_ws.get_all_records()
    for item_data in items_list:
        pid = item_data["id"]
        qty = item_data["qty"]
        for idx, item in enumerate(data_gs):
            if item["ID"] == pid:
                products_ws.update_cell(idx + 2, 7, item["Остаток"] + qty)
                break


# ── Запись продажи при подтверждении ────────────────────────

def write_order_to_sales(order_id: str):
    """Записывает строки продаж и обновляет сумму у клиента только после подтверждения."""
    order = get_order(order_id)
    if not order:
        return
    try:
        items_json_str = str(order.get("Товары_JSON", "") or "")
        if not items_json_str:
            return
        items_list = json.loads(items_json_str)
    except Exception as e:
        logging.error(f"write_order_to_sales parse: {e}")
        return

    uid        = int(order.get("Покупатель_ID", 0))
    contact    = order.get("Контакт", "—")
    delivery   = order.get("Тип", "Самовывоз")
    address    = order.get("Адрес", "")
    pay_label  = order.get("Оплата", "")
    raw_total  = int(order.get("Сумма", 0) or 0)
    final_total = int(order.get("Финальная_сумма", 0) or 0)
    discount_pct = round((raw_total - final_total) / raw_total * 100) if raw_total > 0 else 0

    now     = datetime.now().strftime("%Y-%m-%d %H:%M")
    data_gs = products_ws.get_all_records()

    for item_data in items_list:
        pid = item_data["id"]
        qty = item_data["qty"]
        for item in data_gs:
            if item["ID"] == pid:
                price = item["Цена (₽)"]
                summ  = price * qty
                sales_ws.append_row([
                    now, uid, contact,
                    item["Название"], qty, price, summ,
                    delivery, address, pay_label, discount_pct, final_total
                ])
                break

    # Обновляем суммарные траты клиента для системы лояльности
    update_user_total(uid, contact, final_total)


# ── Начисление вейпкоинов после подтверждения ───────────────

async def process_order_confirmed(order_id: str):
    order = get_order(order_id)
    if not order:
        return

    uid         = int(order.get("Покупатель_ID", 0))
    final_total = int(order.get("Финальная_сумма", 0))
    contact     = order.get("Контакт", "—")
    referrer_id = get_referrer_id(uid)

    if not referrer_id:
        return

    if not is_promo_activated(uid):
        if final_total >= MIN_REFERRAL_PURCHASE:
            # Активируем промокод
            set_promo_activated(uid)
            activate_referral_record(uid)
            add_vaypecoins(uid, REFERRAL_BONUS_COINS)

            # Начисляем кэшбек пригласившему
            ref_count = get_active_referral_count(referrer_id)
            _, pct = get_referral_level(ref_count)
            cashback = int(final_total * pct / 100)
            new_coins = add_vaypecoins(referrer_id, cashback) if cashback > 0 else get_vaypecoins(referrer_id)

            ref_level_name, _ = get_referral_level(ref_count)
            level_text = f" (уровень: {ref_level_name})" if ref_level_name else ""

            try:
                await bot.send_message(
                    uid,
                    f"🎉 Промокод активирован!\n"
                    f"+{REFERRAL_BONUS_COINS} вейпкоинов на баланс!\n"
                    f"💎 Баланс: {get_vaypecoins(uid)} VC"
                )
            except Exception as e:
                logging.error(f"notify referred: {e}")

            if cashback > 0:
                try:
                    await bot.send_message(
                        referrer_id,
                        f"🎉 Твой реферал {contact} сделал первую покупку!\n"
                        f"💰 +{cashback} VC ({pct}% от {final_total:,}₽)\n"
                        f"💎 Баланс: {new_coins} VC{level_text}"
                    )
                except Exception as e:
                    logging.error(f"notify referrer: {e}")
        else:
            try:
                await bot.send_message(
                    uid,
                    f"ℹ️ Для активации промокода нужна покупка на {MIN_REFERRAL_PURCHASE}₽+.\n"
                    f"Твоя покупка: {final_total}₽"
                )
            except Exception as e:
                logging.error(f"notify promo not activated: {e}")
    else:
        # Промокод уже активен — начисляем кэшбек
        ref_count = get_active_referral_count(referrer_id)
        _, pct = get_referral_level(ref_count)
        cashback = int(final_total * pct / 100)
        if cashback > 0:
            new_coins = add_vaypecoins(referrer_id, cashback)
            ref_level_name, _ = get_referral_level(ref_count)
            level_text = f" (уровень: {ref_level_name})" if ref_level_name else ""
            try:
                await bot.send_message(
                    referrer_id,
                    f"💰 Твой реферал {contact} оплатил заказ!\n"
                    f"+{cashback} VC ({pct}% от {final_total:,}₽)\n"
                    f"💎 Баланс: {new_coins} VC{level_text}"
                )
            except Exception as e:
                logging.error(f"notify referrer ongoing: {e}")


# ── Текст лояльности ────────────────────────────────────────

def loyalty_full_text(uid: int) -> str:
    # Скидочная программа
    total = get_user_total(uid)
    level_name, discount = get_loyalty(total)
    next_t, next_name = next_level_info(total)

    sorted_asc = sorted(LOYALTY_LEVELS, key=lambda x: x[0])
    prev_t = 0
    for t, n, d in sorted_asc:
        if t <= total:
            prev_t = t

    text = "💎 СИСТЕМА ЛОЯЛЬНОСТИ\n\n"
    text += f"💰 Потрачено: {total:,}₽\n"
    text += f"Уровень: {level_name} — скидка {discount}%\n" if level_name else "Уровень: нет\n"
    if next_t:
        bar = progress_bar(total - prev_t, next_t - prev_t)
        text += f"До {next_name}: {bar} осталось {next_t - total:,}₽\n"
    else:
        text += "🏆 Максимальный уровень!\n"

    text += "\n📊 Уровни скидок:\n"
    for threshold, name, disc in sorted_asc:
        mark = "✅" if total >= threshold else "⬜"
        text += f"{mark} {name} — от {threshold:,}₽ ({disc}% скидки)\n"

    # Вейпкоины
    coins = get_vaypecoins(uid)
    text += f"\n🪙 ВЕЙПКОИНЫ: {coins} VC\n"
    text += "1 VC = 1₽ (оплата специальных товаров)\n"

    # Реферальная программа
    ref_code = get_referral_code(uid) or ensure_client(uid)
    ref_count = get_active_referral_count(uid)
    ref_level_name, ref_pct = get_referral_level(ref_count)
    next_ref_t, next_ref_name = next_referral_level_info(ref_count)

    text += "\n🤝 РЕФЕРАЛЬНАЯ ПРОГРАММА\n"
    text += f"Твой код: `{ref_code}`\n"
    text += f"Активных рефералов: {ref_count}\n"
    text += f"Уровень: {ref_level_name} — {ref_pct}% кэшбек\n" if ref_level_name else "Уровень: нет (пригласи друга!)\n"
    if next_ref_t:
        sorted_ref_asc = sorted(REFERRAL_LEVELS, key=lambda x: x[0])
        prev_ref_t = 0
        for t, _, __ in sorted_ref_asc:
            if t <= ref_count:
                prev_ref_t = t
        bar = progress_bar(ref_count - prev_ref_t, next_ref_t - prev_ref_t)
        text += f"До {next_ref_name}: {bar} {ref_count}/{next_ref_t}\n"
    else:
        text += "🏆 Максимальный реферальный уровень!\n"

    sorted_ref = sorted(REFERRAL_LEVELS, key=lambda x: x[0])
    text += "\n📊 Реферальные уровни:\n"
    for threshold, name, pct in sorted_ref:
        mark = "✅" if ref_count >= threshold else "⬜"
        text += f"{mark} {name} — от {threshold} рефералов ({pct}%)\n"

    return text


# ── Меню ────────────────────────────────────────────────────

def main_menu():
    kb = InlineKeyboardMarkup()
    if WEBAPP_URL:
        kb.add(InlineKeyboardButton("🌐 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL)))
    kb.add(InlineKeyboardButton("🔥 Одноразки",  callback_data="cat_Одноразка"))
    kb.add(InlineKeyboardButton("💧 Жидкости",   callback_data="cat_Жидкость"))
    kb.add(InlineKeyboardButton("🚬 Табак",      callback_data="cat_Табак"))
    kb.add(InlineKeyboardButton("⚙️ Устройства", callback_data="cat_Устройство"))
    kb.add(InlineKeyboardButton("🛒 Корзина",    callback_data="open_cart"))
    kb.add(
        InlineKeyboardButton("🎁 Моя лояльность",    callback_data="my_loyalty"),
        InlineKeyboardButton("🎟️ Промокод",          callback_data="enter_promo")
    )
    return kb

def webapp_keyboard():
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    if WEBAPP_URL:
        kb.add(KeyboardButton("🌐 Открыть магазин", web_app=WebAppInfo(url=WEBAPP_URL)))
    return kb


# ── Хэндлеры: старт ─────────────────────────────────────────

@dp.message_handler(commands=["start"], state="*")
async def start(msg: types.Message, state: FSMContext):
    await state.finish()
    contact = f"@{msg.from_user.username}" if msg.from_user.username else str(msg.from_user.id)
    ensure_client(msg.from_user.id, contact)
    await msg.answer("Добро пожаловать в VAPE SHOP VRN 💨\nПриятных покупок 🛒", reply_markup=webapp_keyboard())
    await msg.answer("Выбери раздел:", reply_markup=main_menu())

@dp.message_handler(commands=["loyalty"], state="*")
async def loyalty_cmd(msg: types.Message):
    await msg.answer(loyalty_full_text(msg.from_user.id), parse_mode="Markdown")

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

@dp.message_handler(commands=["stock"], state="*")
async def stock_adjust_cmd(msg: types.Message, state: FSMContext):
    if msg.from_user.id not in SELLER_IDS:
        await msg.answer("❌ Команда доступна только продавцам.")
        return
    await state.finish()
    await AdjustStockState.waiting_product_name.set()
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_stock"))
    await msg.answer("🔍 Введи название товара (или его часть) для поиска:", reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data == "cancel_stock", state="*")
async def cancel_stock_adj(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.answer("Отменено")
    await call.message.edit_reply_markup(None)

@dp.message_handler(state=AdjustStockState.waiting_product_name)
async def stock_search_product(msg: types.Message, state: FSMContext):
    query = msg.text.strip().lower()
    data = products_ws.get_all_records()
    matches = [
        i for i in data
        if query in i.get("Название", "").lower() or query in i.get("Бренд", "").lower()
    ]
    if not matches:
        await msg.answer("❌ Товар не найден. Попробуй другое название или /stock для нового поиска.")
        await state.finish()
        return
    kb = InlineKeyboardMarkup()
    for item in matches[:10]:
        puffs = f" {item['Затяжки']}" if item.get("Затяжки") else ""
        label = f"{item['Бренд']}{puffs} {item['Название']} (ост: {item['Остаток']})"
        kb.add(InlineKeyboardButton(label, callback_data=f"stockitem_{item['ID']}"))
    kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_stock"))
    await msg.answer(f"Найдено {len(matches)} товар(ов). Выбери:", reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data.startswith("stockitem_"), state=AdjustStockState.waiting_product_name)
async def stock_select_item(call: types.CallbackQuery, state: FSMContext):
    pid = int(call.data.split("_")[1])
    data = products_ws.get_all_records()
    for item in data:
        if item["ID"] == pid:
            await state.update_data(product_id=pid, product_name=item["Название"],
                                    product_brand=item.get("Бренд", ""), current_stock=item["Остаток"])
            await AdjustStockState.waiting_quantity.set()
            kb = InlineKeyboardMarkup()
            kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_stock"))
            puffs = f" {item['Затяжки']}" if item.get("Затяжки") else ""
            await call.message.edit_text(
                f"📦 Товар: {item['Бренд']}{puffs} {item['Название']}\n"
                f"📊 Текущий остаток: {item['Остаток']} шт.\n\n"
                f"На сколько уменьшить остаток?",
                reply_markup=kb
            )
            return
    await call.answer("Товар не найден", show_alert=True)
    await state.finish()

@dp.message_handler(state=AdjustStockState.waiting_quantity)
async def stock_set_quantity(msg: types.Message, state: FSMContext):
    try:
        qty = int(msg.text.strip())
        if qty <= 0:
            raise ValueError
    except ValueError:
        await msg.answer("❌ Введи целое положительное число.")
        return

    data_state = await state.get_data()
    pid = data_state["product_id"]
    current_stock = data_state["current_stock"]
    product_name = data_state["product_name"]
    product_brand = data_state.get("product_brand", "")

    new_stock = max(0, current_stock - qty)
    data = products_ws.get_all_records()
    for idx, item in enumerate(data):
        if item["ID"] == pid:
            products_ws.update_cell(idx + 2, 7, new_stock)
            await state.finish()
            status = "📭 Товар закончился" if new_stock == 0 else f"📊 Стало: {new_stock} шт."
            await msg.answer(
                f"✅ Остаток обновлён!\n\n"
                f"📦 {product_brand} {product_name}\n"
                f"Было: {current_stock} шт. → {status}"
            )
            return
    await state.finish()
    await msg.answer("❌ Ошибка обновления. Товар не найден.")


@dp.callback_query_handler(lambda c: c.data == "my_loyalty")
async def my_loyalty_callback(call: types.CallbackQuery):
    await call.answer()
    await call.message.answer(loyalty_full_text(call.from_user.id), parse_mode="Markdown")

@dp.callback_query_handler(lambda c: c.data == "back_main", state="*")
async def back(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.message.edit_text("Главное меню", reply_markup=main_menu())


# ── Промокод ────────────────────────────────────────────────

@dp.callback_query_handler(lambda c: c.data == "enter_promo", state="*")
async def enter_promo(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.answer()
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_promo"))
    await PromoState.waiting_promo.set()
    await call.message.answer("Введи реферальный промокод друга:", reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data == "cancel_promo", state=PromoState.waiting_promo)
async def cancel_promo(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.answer("Отменено")
    await call.message.edit_reply_markup(None)

@dp.message_handler(state=PromoState.waiting_promo)
async def process_promo(msg: types.Message, state: FSMContext):
    await state.finish()
    code = msg.text.strip().upper()
    contact = f"@{msg.from_user.username}" if msg.from_user.username else str(msg.from_user.id)
    ensure_client(msg.from_user.id, contact)
    success, text = apply_promo_code(msg.from_user.id, code)
    await msg.answer(text)


# ── Подтверждение заказа продавцом ──────────────────────────

@dp.callback_query_handler(lambda c: c.data.startswith("order_confirm_"))
async def confirm_order(call: types.CallbackQuery):
    if call.from_user.id not in SELLER_IDS:
        await call.answer("Нет доступа", show_alert=True)
        return
    order_id = call.data[len("order_confirm_"):]
    order = get_order(order_id)
    if not order:
        await call.answer("Заказ не найден", show_alert=True)
        return
    if order.get("Статус") == "confirmed":
        await call.answer("Заказ уже подтверждён", show_alert=True)
        return

    set_order_status(order_id, "confirmed")
    await call.message.edit_reply_markup(None)
    await call.message.reply("✅ Заказ подтверждён!")
    await call.answer("Выдача подтверждена")

    # Записываем продажу и обновляем лояльность только сейчас
    write_order_to_sales(order_id)

    uid = int(order.get("Покупатель_ID", 0))
    contact = order.get("Контакт", "—")
    final_total = int(order.get("Финальная_сумма", 0) or 0)
    new_total = get_user_total(uid)
    new_level, _ = get_loyalty(new_total)

    confirm_text = "✅ Твой заказ подтверждён продавцом! Спасибо за покупку 🙌"
    if new_level:
        confirm_text += f"\n💎 Твой уровень лояльности: {new_level}"
    try:
        await bot.send_message(uid, confirm_text)
    except Exception as e:
        logging.error(f"notify buyer confirm: {e}")

    await process_order_confirmed(order_id)

@dp.callback_query_handler(lambda c: c.data.startswith("sts_"))
async def status_step(call: types.CallbackQuery):
    if call.from_user.id not in SELLER_IDS:
        await call.answer("Нет доступа", show_alert=True)
        return
    # callback format: sts_{uid}_{timestamp}_{step}
    parts = call.data.split("_")
    step = int(parts[-1])
    order_id = "_".join(parts[1:-1])  # reconstruct "uid_timestamp"

    order = get_order(order_id)
    if not order:
        await call.answer("Заказ не найден", show_alert=True)
        return

    delivery_type = order.get("Тип", "Самовывоз")
    is_courier = delivery_type == "Доставка"
    statuses = DELIVERY_STATUSES if is_courier else PICKUP_STATUSES

    if step >= len(statuses):
        await call.answer("Все статусы уже выставлены", show_alert=True)
        return

    label, buyer_msg = statuses[step]
    uid = int(order.get("Покупатель_ID", 0))

    set_order_status(order_id, label)
    try:
        await bot.send_message(uid, buyer_msg)
    except Exception as e:
        logging.error(f"notify buyer status step {step}: {e}")

    next_step = step + 1
    is_final = next_step >= len(statuses)

    if is_final:
        await call.message.edit_reply_markup(None)
        await call.message.reply(f"✅ Статус «{label}» — заказ завершён!")
        await call.answer(label)
        write_order_to_sales(order_id)
        await process_order_confirmed(order_id)
    else:
        delivery_key = "courier" if is_courier else "pickup"
        next_kb = seller_kb(order_id, delivery_key, next_step)
        await call.message.edit_reply_markup(next_kb)
        await call.answer(f"✅ {label}")


@dp.callback_query_handler(lambda c: c.data.startswith("order_cancel_"))
async def cancel_order(call: types.CallbackQuery):
    if call.from_user.id not in SELLER_IDS:
        await call.answer("Нет доступа", show_alert=True)
        return
    order_id = call.data[len("order_cancel_"):]
    order = get_order(order_id)
    if not order:
        await call.answer("Заказ не найден", show_alert=True)
        return
    final_statuses = [s[0] for s in PICKUP_STATUSES[-1:]] + [s[0] for s in DELIVERY_STATUSES[-1:]]
    if order.get("Статус") in (["confirmed", "Отменен"] + final_statuses):
        await call.answer("Заказ уже обработан", show_alert=True)
        return

    # Возвращаем товары на остаток
    restore_order_stock(order_id)
    set_order_status(order_id, "Отменен")
    await call.message.edit_reply_markup(None)
    await call.message.reply("❌ Заказ отменён. Товары возвращены на остаток.")
    await call.answer("Заказ отменён")

    uid = int(order.get("Покупатель_ID", 0))
    try:
        await bot.send_message(uid, "❌ Твой заказ был отменён. Свяжись с нами для уточнения.")
    except Exception as e:
        logging.error(f"notify buyer cancel: {e}")


# ── Каталог ─────────────────────────────────────────────────

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


# ── Карточка товара ─────────────────────────────────────────

def item_keyboard(pid: int, qty: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup()
    kb.add(
        InlineKeyboardButton("➖", callback_data=f"minus_{pid}"),
        InlineKeyboardButton(f"{qty} шт", callback_data="noop"),
        InlineKeyboardButton("➕", callback_data=f"plus_{pid}")
    )
    kb.add(InlineKeyboardButton("🛒 В корзину", callback_data=f"add_{pid}"))
    kb.add(InlineKeyboardButton("🛒 Корзина",   callback_data="open_cart"))
    kb.add(InlineKeyboardButton("⬅️ Назад",     callback_data="back_main"))
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


# ── Корзина ─────────────────────────────────────────────────

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
                summ  = price * qty
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

    coins = get_vaypecoins(uid)
    if coins > 0:
        text += f"\n🪙 Вейпкоины: {coins} VC"

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


# ── Оформление заказа ────────────────────────────────────────

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

@dp.callback_query_handler(lambda c: c.data == "delivery_pickup")
async def pickup_point(call: types.CallbackQuery, state: FSMContext):
    await state.update_data(delivery="pickup", address=PICKUP_ADDRESS)
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton(f"📍 {PICKUP_ADDRESS} — подтвердить", callback_data="confirm_pickup"))
    kb.add(InlineKeyboardButton("⬅️ Назад", callback_data="checkout"))
    await call.message.edit_text(
        f"📍 *Пункт самовывоза:*\n\n`{PICKUP_ADDRESS}`\n\nНажми для подтверждения:",
        parse_mode="Markdown", reply_markup=kb
    )

@dp.callback_query_handler(lambda c: c.data == "confirm_pickup")
async def confirm_pickup(call: types.CallbackQuery, state: FSMContext):
    await OrderState.waiting_contact.set()
    await call.message.edit_text("📱 Напиши свой @username или номер телефона:")

@dp.callback_query_handler(lambda c: c.data == "delivery_courier")
async def delivery_courier(call: types.CallbackQuery, state: FSMContext):
    await state.update_data(delivery="courier")
    await OrderState.waiting_contact.set()
    await call.message.edit_text("📱 Напиши свой @username или номер телефона:")

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

@dp.message_handler(state=OrderState.waiting_address)
async def get_address(msg: types.Message, state: FSMContext):
    await state.update_data(address=msg.text)
    await OrderState.waiting_comment.set()
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("⏭ Пропустить", callback_data="skip_comment"))
    await msg.answer("💬 Добавь комментарий к доставке (необязательно):", reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data == "skip_comment", state=OrderState.waiting_comment)
async def skip_comment(call: types.CallbackQuery, state: FSMContext):
    await state.update_data(comment="")
    await call.message.edit_reply_markup(None)
    await OrderState.waiting_payment.set()
    await show_payment_options(call.message, state, uid=call.from_user.id)

@dp.message_handler(state=OrderState.waiting_comment)
async def get_comment(msg: types.Message, state: FSMContext):
    await state.update_data(comment=msg.text.strip())
    await OrderState.waiting_payment.set()
    await show_payment_options(msg, state)

async def show_payment_options(msg: types.Message, state: FSMContext, uid: int = None):
    if uid is None:
        uid = msg.from_user.id
    user_total = get_user_total(uid)
    level_name, discount = get_loyalty(user_total)

    data_gs = products_ws.get_all_records()
    raw_total = sum(
        item["Цена (₽)"] * qty
        for pid, qty in cart.get(uid, {}).items()
        for item in data_gs if item["ID"] == pid
    )
    wheel_discount = get_user_wheel_discount(uid)
    total_discount = discount + wheel_discount
    disc_sum    = int(raw_total * total_discount / 100)
    items_total = raw_total - disc_sum

    order_data = await state.get_data()
    delivery   = order_data.get("delivery", "pickup")
    comment    = order_data.get("comment", "")

    delivery_fee = DELIVERY_FEE if delivery == "courier" and items_total < FREE_DELIVERY_THRESHOLD else 0
    final_total  = items_total + delivery_fee

    text = f"💰 Сумма заказа: {raw_total:,}₽"
    if discount > 0:
        text += f"\n🎁 Скидка {level_name} (-{discount}%): -{int(raw_total * discount / 100):,}₽"
    if wheel_discount > 0:
        text += f"\n🎰 Промокод колеса (-{wheel_discount}%): -{int(raw_total * wheel_discount / 100):,}₽"
    if delivery == "courier":
        if delivery_fee > 0:
            text += f"\n🚚 Доставка: +{delivery_fee:,}₽ (бесплатно от {FREE_DELIVERY_THRESHOLD:,}₽)"
        else:
            text += f"\n🚚 Доставка: бесплатно 🎉"
    text += f"\n✅ К оплате: {final_total:,}₽"
    if comment:
        text += f"\n💬 Комментарий: {comment}"

    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("💳 Перевод на карту", callback_data="pay_card"))
    if delivery != "courier":
        kb.add(InlineKeyboardButton("💵 Наличные", callback_data="pay_cash"))
    await msg.answer(text, reply_markup=kb)

@dp.callback_query_handler(lambda c: c.data.startswith("pay_"), state=OrderState.waiting_payment)
async def finish(call: types.CallbackQuery, state: FSMContext):
    uid = call.from_user.id
    pay = call.data.split("_", 1)[1]

    order_data = await state.get_data()
    delivery   = order_data.get("delivery", "pickup")
    contact    = order_data.get("contact", "—")
    address    = order_data.get("address", PICKUP_ADDRESS)
    comment    = order_data.get("comment", "")
    await state.finish()

    if uid not in cart or not cart[uid]:
        await call.answer("Корзина пустая", show_alert=True)
        return

    data_gs     = products_ws.get_all_records()
    raw_total   = 0
    order_lines = []
    items_for_json = []
    user_total  = get_user_total(uid)
    level_name, discount = get_loyalty(user_total)

    for pid, qty in list(cart[uid].items()):
        for idx, item in enumerate(data_gs):
            if item["ID"] == pid:
                price     = item["Цена (₽)"]
                summ      = price * qty
                raw_total += summ
                puffs_str = f" {item['Затяжки']}" if item.get("Затяжки") else ""
                order_lines.append(
                    f"{item['Бренд']}{puffs_str} {item['Название']} х{qty} = {summ:,}₽"
                )
                # Резервируем товар (уменьшаем остаток)
                products_ws.update_cell(idx + 2, 7, max(0, item["Остаток"] - qty))
                items_for_json.append({"id": pid, "qty": qty})

    wheel_discount = get_user_wheel_discount(uid)
    total_discount = discount + wheel_discount
    disc_sum    = int(raw_total * total_discount / 100)
    items_total = raw_total - disc_sum
    delivery_fee = DELIVERY_FEE if delivery == "courier" and items_total < FREE_DELIVERY_THRESHOLD else 0
    final_total = items_total + delivery_fee
    cart[uid]   = {}
    if wheel_discount > 0:
        clear_user_wheel_discount(uid)

    pay_label      = "Перевод на карту" if pay == "card" else "Наличные"
    delivery_label = "Доставка" if delivery == "courier" else "Самовывоз"
    summary        = "\n".join(order_lines)
    order_id       = f"{uid}_{int(time.time())}"

    # Сохраняем заказ (продажа запишется только после подтверждения продавцом)
    save_order(order_id, uid, contact, raw_total, final_total, delivery, address, pay,
               summary, json.dumps(items_for_json))

    user_text = f"✅ Заказ оформлен!\n\n{summary}\n\n💰 Сумма: {raw_total:,}₽"
    if discount > 0:
        user_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{int(raw_total * discount / 100):,}₽"
    if wheel_discount > 0:
        user_text += f"\n🎰 Промокод колеса (-{wheel_discount}%): -{int(raw_total * wheel_discount / 100):,}₽"
    if delivery == "courier":
        if delivery_fee > 0:
            user_text += f"\n🚚 Доставка: +{delivery_fee:,}₽"
        else:
            user_text += f"\n🚚 Доставка: бесплатно 🎉"
    user_text += f"\n✅ Итого: {final_total:,}₽"
    user_text += (
        f"\n\n🚚 Получение: {delivery_label}\n"
        f"📍 Адрес: {address}\n"
        f"💳 Оплата: {pay_label}"
    )
    if comment:
        user_text += f"\n💬 Комментарий: {comment}"
    user_text += "\n\nОжидай подтверждения от продавца 🙌"

    await call.message.edit_text(user_text)

    seller_text = (
        f"🔥 Новый заказ! #{order_id}\n\n"
        f"👤 {contact} (ID: {uid})\n\n"
        f"📦 Состав:\n{summary}\n\n"
        f"💰 Сумма: {raw_total:,}₽"
    )
    if discount > 0:
        seller_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{int(raw_total * discount / 100):,}₽"
    if wheel_discount > 0:
        seller_text += f"\n🎰 Промокод колеса (-{wheel_discount}%): -{int(raw_total * wheel_discount / 100):,}₽"
    if delivery == "courier":
        if delivery_fee > 0:
            seller_text += f"\n🚚 Доставка: +{delivery_fee:,}₽"
        else:
            seller_text += f"\n🚚 Доставка: бесплатно 🎉"
    seller_text += f"\n✅ Итого: {final_total:,}₽"
    seller_text += (
        f"\n\n🚚 Тип: {delivery_label}\n"
        f"📍 Адрес: {address}\n"
        f"💳 Оплата: {pay_label}"
    )
    if comment:
        seller_text += f"\n💬 Комментарий: {comment}"

    for seller_id in SELLER_IDS:
        try:
            await bot.send_message(seller_id, seller_text,
                                   reply_markup=seller_kb(order_id, delivery, step=0))
        except Exception as e:
            logging.error(f"Ошибка отправки продавцу {seller_id}: {e}")


# ── Рассылка ─────────────────────────────────────────────────

@dp.message_handler(commands=["broadcast"], state="*")
async def broadcast_cmd(msg: types.Message, state: FSMContext):
    if msg.from_user.id not in SELLER_IDS:
        await msg.answer("❌ Команда доступна только продавцам.")
        return
    await state.finish()
    await BroadcastState.waiting_message.set()
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_broadcast"))
    await msg.answer(
        "📢 Введи текст рассылки (поддерживается Markdown).\n"
        "Отправь /cancel для отмены:",
        reply_markup=kb
    )

@dp.callback_query_handler(lambda c: c.data == "cancel_broadcast", state=BroadcastState.waiting_message)
async def cancel_broadcast(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.answer("Рассылка отменена")
    await call.message.edit_reply_markup(None)

@dp.message_handler(commands=["cancel"], state=BroadcastState.waiting_message)
async def cancel_broadcast_cmd(msg: types.Message, state: FSMContext):
    await state.finish()
    await msg.answer("Рассылка отменена.")

@dp.message_handler(state=BroadcastState.waiting_message)
async def do_broadcast(msg: types.Message, state: FSMContext):
    await state.finish()
    broadcast_text = msg.text or msg.caption or ""
    if not broadcast_text:
        await msg.answer("❌ Пустое сообщение. Рассылка отменена.")
        return

    try:
        records = clients_ws.get_all_records()
    except Exception as e:
        await msg.answer(f"❌ Ошибка получения клиентов: {e}")
        return

    uids = []
    for r in records:
        try:
            uid_val = int(r.get("ID", 0) or 0)
            if uid_val > 0:
                uids.append(uid_val)
        except (ValueError, TypeError):
            continue

    if not uids:
        await msg.answer("❌ Список клиентов пуст.")
        return

    status_msg = await msg.answer(f"📢 Начинаю рассылку для {len(uids)} пользователей…")
    sent, failed = 0, 0
    for uid in uids:
        try:
            await bot.send_message(uid, broadcast_text, parse_mode="Markdown")
            sent += 1
        except Exception:
            failed += 1
        await asyncio.sleep(0.05)

    await status_msg.edit_text(
        f"📢 Рассылка завершена!\n✅ Отправлено: {sent}\n❌ Ошибок: {failed}"
    )


# ── Уведомления о наличии ─────────────────────────────────────

# Структура: { uid: [product_keyword, ...] }
_notify_subscriptions: dict = {}

@dp.message_handler(commands=["notify"], state="*")
async def notify_cmd(msg: types.Message, state: FSMContext):
    await state.finish()
    await NotifyState.waiting_product.set()
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❌ Отмена", callback_data="cancel_notify"))
    await msg.answer(
        "🔔 Введи название товара или бренда, о поступлении которого хочешь получить уведомление:",
        reply_markup=kb
    )

@dp.callback_query_handler(lambda c: c.data == "cancel_notify", state=NotifyState.waiting_product)
async def cancel_notify(call: types.CallbackQuery, state: FSMContext):
    await state.finish()
    await call.answer("Отменено")
    await call.message.edit_reply_markup(None)

@dp.message_handler(state=NotifyState.waiting_product)
async def save_notify(msg: types.Message, state: FSMContext):
    await state.finish()
    keyword = msg.text.strip().lower()
    uid = msg.from_user.id
    if uid not in _notify_subscriptions:
        _notify_subscriptions[uid] = []
    if keyword not in _notify_subscriptions[uid]:
        _notify_subscriptions[uid].append(keyword)
    await msg.answer(
        f"✅ Подписка оформлена!\nКак только «{msg.text.strip()}» появится в наличии — уведомим тебя 🔔"
    )

@dp.message_handler(commands=["checkstock"], state="*")
async def checkstock_cmd(msg: types.Message):
    if msg.from_user.id not in SELLER_IDS:
        await msg.answer("❌ Команда доступна только продавцам.")
        return
    if not _notify_subscriptions:
        await msg.answer("📭 Нет активных подписок на уведомления.")
        return

    try:
        products = products_ws.get_all_records()
    except Exception as e:
        await msg.answer(f"❌ Ошибка: {e}")
        return

    notified = 0
    for uid, keywords in list(_notify_subscriptions.items()):
        still_waiting = []
        for kw in keywords:
            # Проверяем, есть ли товар в наличии
            matches = [
                p for p in products
                if (kw in p.get("Название", "").lower() or kw in p.get("Бренд", "").lower())
                and int(p.get("Остаток", 0) or 0) > 0
            ]
            if matches:
                names = ", ".join(m["Название"] for m in matches[:3])
                try:
                    await bot.send_message(
                        uid,
                        f"🔔 Товар появился в наличии!\n\n{names}\n\nОткрой магазин для покупки 🛒"
                    )
                    notified += 1
                except Exception as e:
                    logging.error(f"checkstock notify {uid}: {e}")
            else:
                still_waiting.append(kw)
        if still_waiting:
            _notify_subscriptions[uid] = still_waiting
        else:
            del _notify_subscriptions[uid]

    await msg.answer(f"✅ Проверка завершена. Уведомлено пользователей: {notified}")


# ── Mini App: заказ из веб-приложения ───────────────────────

@dp.message_handler(content_types=types.ContentType.WEB_APP_DATA)
async def web_app_order(msg: types.Message):
    try:
        data     = json.loads(msg.web_app_data.data)
        uid      = msg.from_user.id
        contact  = data.get("contact", "—")
        address  = data.get("address", PICKUP_ADDRESS)
        delivery = data.get("delivery", "pickup")
        pay         = data.get("pay", "card")
        items       = data.get("items", [])
        comment     = data.get("comment", "")
        vcoin_total = int(data.get("vcoin_total", 0) or 0)

        user_total  = get_user_total(uid)
        level_name, discount = get_loyalty(user_total)

        now         = datetime.now().strftime("%Y-%m-%d %H:%M")
        raw_total   = sum(i["price"] * i["qty"] for i in items)
        disc_sum    = int(raw_total * discount / 100)
        items_total = raw_total - disc_sum
        delivery_fee = DELIVERY_FEE if delivery == "courier" and items_total < FREE_DELIVERY_THRESHOLD else 0
        final_total = items_total + delivery_fee

        data_gs        = products_ws.get_all_records()
        order_lines    = []
        items_for_json = []

        for it in items:
            summ = it["price"] * it["qty"]
            # Ищем бренд и затяжки из таблицы товаров
            brand_str = ""
            puffs_str = ""
            for idx, row in enumerate(data_gs):
                if row["ID"] == it["id"]:
                    brand_str = row.get("Бренд", "")
                    puffs_val = row.get("Затяжки", "")
                    if puffs_val:
                        puffs_str = f" {puffs_val}"
                    # Резервируем товар
                    products_ws.update_cell(idx + 2, 7, max(0, row["Остаток"] - it["qty"]))
                    break
            order_lines.append(
                f"{brand_str}{puffs_str} {it['name']} х{it['qty']} = {summ:,}₽"
            )
            items_for_json.append({"id": it["id"], "qty": it["qty"]})

        summary = "\n".join(order_lines)

        # VCoin-оплата: проверяем и списываем VCoin
        if vcoin_total > 0:
            user_coins = get_vaypecoins(uid)
            if user_coins < vcoin_total:
                await msg.answer(f"❌ Недостаточно VCoin! Нужно {vcoin_total} VC, у тебя {user_coins} VC.")
                return
            add_vaypecoins(uid, -vcoin_total)

        if pay == "vcoin":
            pay_label = "VCoin 🪙"
        elif pay == "card":
            pay_label = "Перевод на карту"
        else:
            pay_label = "Наличные"

        delivery_label = "Доставка" if delivery == "courier" else "Самовывоз"
        order_id       = f"{uid}_{int(time.time())}"

        # Сохраняем заказ
        save_order(order_id, uid, contact, raw_total, final_total, delivery, address, pay,
                   summary, json.dumps(items_for_json))

        user_text = f"✅ Заказ из Mini App оформлен!\n\n{summary}\n\n💰 Сумма: {raw_total:,}₽"
        if discount > 0:
            user_text += f"\n🎁 Скидка {level_name} (-{discount}%): -{disc_sum:,}₽"
        if delivery == "courier":
            if delivery_fee > 0:
                user_text += f"\n🚚 Доставка: +{delivery_fee:,}₽"
            else:
                user_text += f"\n🚚 Доставка: бесплатно 🎉"
        user_text += f"\n✅ Итого: {final_total:,}₽"
        if vcoin_total > 0:
            user_text += f"\n🪙 Списано VCoin: {vcoin_total} VC"
        user_text += (
            f"\n\n🚚 Получение: {delivery_label}\n"
            f"📍 Адрес: {address}\n"
            f"💳 Оплата: {pay_label}\n\n"
            f"Ожидай подтверждения от продавца 🙌"
        )
        await msg.answer(user_text)

        seller_text = (
            f"🔥 Новый заказ (Mini App)! #{order_id}\n\n"
            f"👤 {contact} (ID: {uid})\n\n"
            f"📦 Состав:\n{summary}\n\n"
            f"💰 Сумма: {raw_total:,}₽"
        )
        if discount > 0:
            seller_text += f"\n🎁 Скидка {level_name}: -{disc_sum:,}₽"
        if delivery == "courier":
            if delivery_fee > 0:
                seller_text += f"\n🚚 Доставка: +{delivery_fee:,}₽"
            else:
                seller_text += f"\n🚚 Доставка: бесплатно 🎉"
        seller_text += f"\n✅ Итого: {final_total:,}₽"
        if vcoin_total > 0:
            seller_text += f"\n🪙 Оплачено VCoin: {vcoin_total} VC"
        seller_text += f"\n\n🚚 Тип: {delivery_label}\n📍 Адрес: {address}\n💳 Оплата: {pay_label}"
        if comment:
            seller_text += f"\n💬 Комментарий: {comment}"

        for seller_id in SELLER_IDS:
            try:
                await bot.send_message(seller_id, seller_text,
                                       reply_markup=seller_kb(order_id, delivery, step=0))
            except Exception as e:
                logging.error(f"Ошибка отправки продавцу {seller_id}: {e}")

    except Exception as e:
        logging.error(f"web_app_order error: {e}")
        await msg.answer("Ошибка при оформлении. Попробуй через бота.")


# ── Запуск ──────────────────────────────────────────────────

async def on_startup(dp):
    init_sheets()
    await bot.set_my_commands([
        types.BotCommand("start",      "Главное меню"),
        types.BotCommand("app",        "Открыть Mini App"),
        types.BotCommand("loyalty",    "Моя лояльность"),
        types.BotCommand("cart",       "Корзина"),
        types.BotCommand("notify",     "Уведомить о поступлении товара"),
        types.BotCommand("stock",      "Скорректировать остаток (продавцы)"),
        types.BotCommand("broadcast",  "Рассылка всем клиентам (продавцы)"),
        types.BotCommand("checkstock", "Проверить наличие и уведомить (продавцы)"),
    ])

if __name__ == "__main__":
    executor.start_polling(dp, skip_updates=True, on_startup=on_startup)
