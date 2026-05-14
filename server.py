"""
Flask-сервер для Telegram Mini App.
Локально: python server.py
Продакшен: gunicorn server:app (Render.com)
"""
from flask import Flask, jsonify, send_from_directory, request, Response
from flask_cors import CORS
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import logging
import os
import json
import tempfile
import time
import random
import string
import requests as http_requests

logging.basicConfig(level=logging.INFO)

# ── In-memory TTL cache ───────────────────────────────────────
_cache: dict = {}

def _cache_get(key: str, ttl: int):
    entry = _cache.get(key)
    if entry and time.time() - entry["ts"] < ttl:
        return entry["data"]
    return None

def _cache_set(key: str, data):
    _cache[key] = {"data": data, "ts": time.time()}

def _cache_del(key: str):
    _cache.pop(key, None)

import os as _os
_static = "webapp" if _os.path.isdir("webapp") else "."
app = Flask(__name__, static_folder=_static, static_url_path="")
CORS(app)

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

DEBUG_TOKEN = os.environ.get("DEBUG_TOKEN", "")

CREDS_JSON_ENV = os.environ.get("GOOGLE_CREDS_JSON")
if CREDS_JSON_ENV:
    creds_dict = json.loads(CREDS_JSON_ENV)
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(creds_dict, tmp)
    tmp.close()
    creds_file = tmp.name
else:
    creds_file = "creds.json"

creds        = ServiceAccountCredentials.from_json_keyfile_name(creds_file, scope)
client       = None
spreadsheet  = None
products_ws  = None
clients_ws   = None
referrals_ws = None
promos_ws    = None
orders_ws    = None

# НЕ подключаемся при импорте — gunicorn делает fork() и фоновые потоки теряются.
# Подключение происходит при первом вызове _gs_call().

def _connect_sheets():
    """Подключиться/переподключиться к Google Sheets. Не бросает исключений."""
    global client, spreadsheet, products_ws, clients_ws, referrals_ws, promos_ws, orders_ws
    try:
        client      = gspread.authorize(creds)
        spreadsheet = client.open("VAPE SHOP")
        products_ws = spreadsheet.worksheet("Товары")
        clients_ws  = spreadsheet.worksheet("Клиенты")
        try:    referrals_ws = spreadsheet.worksheet("Рефералы")
        except Exception: referrals_ws = None
        try:    orders_ws = spreadsheet.worksheet("Заказы")
        except Exception: orders_ws = None
        try:    promos_ws = spreadsheet.worksheet("Промокоды_колесо")
        except Exception:
            try:
                promos_ws = spreadsheet.add_worksheet("Промокоды_колесо", rows=1000, cols=6)
                promos_ws.append_row(["Код", "Тип", "Скидка", "UID", "Использован", "Дата"])
            except Exception: promos_ws = None
        logging.info("gspread connected OK")
    except Exception as e:
        logging.error(f"gspread connect failed: {e}")

def _gs_call(fn, *args, **kwargs):
    """Ленивое подключение + вызов fn.
    - Если sheets не инициализированы — подключается сейчас (первый вызов).
    - При 401/auth-ошибке — переподключается и повторяет.
    - При 429 — exponential backoff (до 3 попыток).
    """
    if products_ws is None:
        _connect_sheets()
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            err = str(e).lower()
            if any(k in err for k in ("401", "invalid_grant", "token", "transport", "connection")):
                _connect_sheets()
                return fn(*args, **kwargs)
            if "429" in err or "quota" in err or "rate" in err:
                if attempt < max_retries - 1:
                    wait = 5 * (2 ** attempt)
                    logging.warning(f"gspread 429, retry {attempt+1} after {wait}s")
                    time.sleep(wait)
                    continue
            raise

LOYALTY_LEVELS = [
    (300_000, "Платина 💎", 15),
    (100_000, "Золото 🥇",  10),
    (50_000,  "Серебро 🥈",  7),
    (20_000,  "Бронза 🥉",   5),
]

REFERRAL_LEVELS = [
    (100, "Платина 🔥", 10),
    (40,  "Золото 🥇",   7),
    (15,  "Серебро 🥈",  5),
    (1,   "Бронза 🥉",   3),
]

def get_loyalty(total: int):
    for threshold, name, discount in LOYALTY_LEVELS:
        if total >= threshold:
            return name, discount
    return None, 0

def get_referral_level(count: int):
    for threshold, name, pct in REFERRAL_LEVELS:
        if count >= threshold:
            return name, pct
    return None, 0


@app.route("/api/ping")
def api_ping():
    """Keep-alive endpoint — вызывается клиентом при первой загрузке."""
    return jsonify({"ok": True})

@app.route("/api/version")
def api_version():
    return jsonify({"version": "3.1", "build": "2026-05-13"})

@app.route("/")
def index():
    return send_from_directory(_static, "index.html")

@app.route("/api/products")
def get_products():
    cached = _cache_get("products", ttl=60)
    if cached is not None:
        return jsonify(cached)
    try:
        data = _gs_call(products_ws.get_all_records)
        # int(...or 0) защищает от пустой строки "" возвращаемой gspread для пустых ячеек
        result = [p for p in data if int(p.get("Остаток", 0) or 0) > 0]
        _cache_set("products", result)
        return jsonify(result)
    except Exception as e:
        logging.error(f"get_products: {e}")
        return jsonify([])

@app.route("/api/cache/clear", methods=["POST"])
def clear_cache():
    """Сбрасывает кэш продуктов — вызывается ботом после подтверждения заказа."""
    _cache_del("products")
    return jsonify({"ok": True})

@app.route("/api/debug/<int:uid>")
def debug_user(uid: int):
    """Диагностика пользователя — защищён токеном (?token=DEBUG_TOKEN)."""
    token = request.args.get("token", "")
    if not DEBUG_TOKEN or token != DEBUG_TOKEN:
        return jsonify({"error": "unauthorized"}), 403
    try:
        records = _gs_call(clients_ws.get_all_records)
        headers = _gs_call(clients_ws.row_values, 1)
        matches = []
        for idx, r in enumerate(records):
            try:
                if int(r.get("ID", 0) or 0) == uid:
                    row_vals = _gs_call(clients_ws.row_values, idx + 2)
                    matches.append({"row": idx + 2, "dict": r, "raw": row_vals})
            except Exception:
                continue
        return jsonify({
            "headers": headers,
            "matches": matches,
            "total_records": len(records)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/loyalty/<int:uid>")
def get_user_loyalty(uid: int):
    cache_key = f"loyalty:{uid}"
    cached = _cache_get(cache_key, ttl=30)
    if cached is not None:
        return jsonify(cached)
    try:
        records = _gs_call(clients_ws.get_all_records)
        for rec_idx, r in enumerate(records):
            try:
                row_uid = int(r.get("ID", 0) or 0)
            except (ValueError, TypeError):
                continue
            if row_uid == uid:
                sheet_row     = rec_idx + 2  # 1-indexed (+ header row)
                total         = int(r.get("Итого", 0) or 0)
                vaypecoins    = int(r.get("Вейпкоины", 0) or 0)
                ref_code      = r.get("Промокод", "") or ""
                wheel_discount = int(r.get("Промо_скидка", 0) or 0)

                level_name, discount = get_loyalty(total)
                sorted_loyalty = sorted(LOYALTY_LEVELS, key=lambda x: x[0])
                next_t = next((t for t, n, d in sorted_loyalty if total < t), None)

                ref_count = 0
                if referrals_ws:
                    try:
                        ref_records = _gs_call(referrals_ws.get_all_records)
                        ref_count = sum(
                            1 for rr in ref_records
                            if int(rr.get("Пригласивший_ID", 0)) == uid
                            and int(rr.get("Активирован", 0)) == 1
                        )
                    except Exception as e:
                        logging.error(f"referrals fetch: {e}")

                ref_level_name, ref_pct = get_referral_level(ref_count)
                sorted_ref = sorted(REFERRAL_LEVELS, key=lambda x: x[0])
                next_ref_t = next((t for t, n, p in sorted_ref if ref_count < t), None)

                # Fallback: читаем вейпкоины напрямую по индексу колонки (col 8 → index 7)
                if vaypecoins == 0:
                    try:
                        row_vals = _gs_call(clients_ws.row_values, sheet_row)
                        if len(row_vals) >= 8:
                            vaypecoins = int(row_vals[7] or 0)
                    except Exception:
                        pass

                # Fallback: читаем промокод напрямую по индексу колонки (col 6 → index 5)
                if not ref_code:
                    try:
                        row_vals = _gs_call(clients_ws.row_values, sheet_row)
                        if len(row_vals) >= 6:
                            candidate = str(row_vals[5] or "").strip()
                            if len(candidate) >= 4 and candidate.replace("-", "").isalnum():
                                ref_code = candidate
                    except Exception:
                        pass

                # Автогенерация промокода если у пользователя его нет
                if not ref_code:
                    try:
                        existing_codes = {
                            str(rr.get("Промокод", "") or "").upper()
                            for rr in records
                            if rr.get("Промокод")
                        }
                        for _ in range(100):
                            new_code = ''.join(
                                random.choices(string.ascii_uppercase + string.digits, k=6)
                            )
                            if new_code.upper() not in existing_codes:
                                break
                        _gs_call(clients_ws.update_cell, sheet_row, 6, new_code)
                        ref_code = new_code
                        _cache_del(cache_key)
                        logging.info(f"Auto-generated promo code {new_code} for uid {uid}")
                    except Exception as e:
                        logging.warning(f"promo_gen failed uid={uid}: {e}")

                result = {
                    "total":              total,
                    "level":              level_name,
                    "discount":           discount,
                    "wheel_discount":     wheel_discount,
                    "next_threshold":     next_t,
                    "vaypecoins":         vaypecoins,
                    "ref_code":           ref_code,
                    "ref_count":          ref_count,
                    "ref_level":          ref_level_name,
                    "ref_pct":            ref_pct,
                    "next_ref_threshold": next_ref_t,
                }
                _cache_set(cache_key, result)
                return jsonify(result)
    except Exception as e:
        logging.error(f"get_user_loyalty: {e}")

    return jsonify({
        "total": 0, "level": None, "discount": 0, "wheel_discount": 0,
        "next_threshold": 20_000, "vaypecoins": 0, "ref_code": "",
        "ref_count": 0, "ref_level": None, "ref_pct": 0, "next_ref_threshold": 1,
    })


@app.route("/api/register-promo", methods=["POST"])
def register_promo():
    """Регистрирует промокод из колеса фортуны в Google Sheets."""
    if not promos_ws:
        return jsonify({"ok": False, "error": "sheet unavailable"}), 500
    try:
        data     = request.get_json()
        code     = str(data.get("code", "")).strip().upper()
        promo_type = str(data.get("type", ""))
        discount = int(data.get("discount", 0))
        uid      = data.get("uid", "")
        if not code:
            return jsonify({"ok": False, "error": "no code"}), 400

        # Проверяем нет ли уже такого кода
        existing = _gs_call(promos_ws.get_all_records)
        if any(r.get("Код", "").upper() == code for r in existing):
            return jsonify({"ok": False, "error": "already exists"}), 409

        from datetime import datetime
        _gs_call(promos_ws.append_row,
                 [code, promo_type, discount, uid, 0,
                  datetime.now().strftime("%Y-%m-%d %H:%M")])
        return jsonify({"ok": True})
    except Exception as e:
        logging.error(f"register_promo: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/photo/<file_id>")
def proxy_photo(file_id: str):
    """Прокси для картинок Google Drive через сервисный аккаунт."""
    try:
        token = creds.get_access_token().access_token
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        resp = http_requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=10, stream=True)
        if resp.status_code != 200:
            return jsonify({"error": "not found"}), 404
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        return Response(resp.content, content_type=content_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        logging.error(f"proxy_photo: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/add-coins", methods=["POST"])
def add_coins():
    """Начисляет VCoin за собранный дымок в игре (10 дымков = 1 VC)."""
    try:
        data  = request.get_json()
        uid   = int(data.get("uid", 0) or 0)
        smoke = int(data.get("smoke", 0) or 0)
        if not uid or smoke <= 0:
            return jsonify({"ok": False, "error": "invalid params"}), 400

        vc_earned = round(smoke * 0.01, 2)
        if vc_earned < 0.01:
            return jsonify({"ok": True, "earned": 0})

        records = _gs_call(clients_ws.get_all_records)
        headers = _gs_call(clients_ws.row_values, 1)
        try:
            vc_col = headers.index("Вейпкоины") + 1
        except ValueError:
            return jsonify({"ok": False, "error": "no VC column"}), 500

        for idx, r in enumerate(records):
            try:
                if int(r.get("ID", 0) or 0) == uid:
                    current = float(r.get("Вейпкоины", 0) or 0)
                    new_val = round(current + vc_earned, 2)
                    _gs_call(clients_ws.update_cell, idx + 2, vc_col, new_val)
                    logging.info(f"add_coins uid={uid} smoke={smoke} +{vc_earned} => {new_val}")
                    _cache_del(f"loyalty:{uid}")
                    return jsonify({"ok": True, "earned": vc_earned, "total": new_val})
            except Exception:
                continue

        return jsonify({"ok": False, "error": "user not found"}), 404
    except Exception as e:
        logging.error(f"add_coins: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


# ── In-memory cart storage (cross-session sync) ──────────────
_server_carts: dict = {}   # uid → {product_id: qty}

@app.route("/api/orders/<int:uid>")
def get_user_orders(uid: int):
    """История заказов пользователя из Google Sheets."""
    try:
        if orders_ws is None:
            return jsonify([])
        records = _gs_call(orders_ws.get_all_records)
        user_orders = []
        for r in records:
            try:
                if int(r.get("Покупатель_ID", 0) or 0) == uid:
                    status_raw = str(r.get("Статус", "") or "").lower()
                    STATUS_LABELS = {
                        "pending":   "⏳ Ожидает",
                        "confirmed": "✅ Подтверждён",
                        "ready":     "📦 Готов",
                        "delivered": "🚀 Доставляется",
                        "done":      "✅ Выдан",
                        "cancelled": "❌ Отменён",
                    }
                    status_label = STATUS_LABELS.get(status_raw, status_raw or "⏳ Ожидает")
                    user_orders.append({
                        "id":     r.get("Заказ_ID", ""),
                        "date":   r.get("Дата", ""),
                        "total":  int(r.get("Финальная_сумма", 0) or 0),
                        "status": status_label,
                        "items":  r.get("Состав", ""),
                        "type":   r.get("Тип", ""),
                        "pay":    r.get("Оплата", ""),
                    })
            except Exception:
                continue
        user_orders.reverse()   # свежие сначала
        return jsonify(user_orders[:50])
    except Exception as e:
        logging.error(f"get_user_orders: {e}")
        return jsonify([])


@app.route("/api/cart/<int:uid>", methods=["GET"])
def get_cart(uid: int):
    """Возвращает сохранённую на сервере корзину пользователя."""
    return jsonify(_server_carts.get(uid, {}))


@app.route("/api/cart/<int:uid>", methods=["POST"])
def save_cart(uid: int):
    """Сохраняет корзину пользователя (dict product_id → qty)."""
    try:
        data = request.get_json(silent=True) or {}
        # Убираем товары с qty=0
        clean = {str(k): int(v) for k, v in data.items() if int(v or 0) > 0}
        _server_carts[uid] = clean
        return jsonify({"ok": True})
    except Exception as e:
        logging.error(f"save_cart: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
