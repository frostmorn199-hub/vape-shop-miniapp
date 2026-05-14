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

CREDS_JSON_ENV = os.environ.get("GOOGLE_CREDS_JSON")
if CREDS_JSON_ENV:
    creds_dict = json.loads(CREDS_JSON_ENV)
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(creds_dict, tmp)
    tmp.close()
    creds_file = tmp.name
else:
    creds_file = "creds.json"

creds = ServiceAccountCredentials.from_json_keyfile_name(creds_file, scope)
client = gspread.authorize(creds)
spreadsheet = client.open("VAPE SHOP")
products_ws  = spreadsheet.worksheet("Товары")
clients_ws   = spreadsheet.worksheet("Клиенты")

try:
    referrals_ws = spreadsheet.worksheet("Рефералы")
except Exception:
    referrals_ws = None

try:
    promos_ws = spreadsheet.worksheet("Промокоды_колесо")
except Exception:
    try:
        promos_ws = spreadsheet.add_worksheet("Промокоды_колесо", rows=1000, cols=6)
        promos_ws.append_row(["Код", "Тип", "Скидка", "UID", "Использован", "Дата"])
    except Exception as e:
        logging.error(f"promos_ws init: {e}")
        promos_ws = None

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
        data = products_ws.get_all_records()
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
    """Временный эндпоинт для диагностики."""
    try:
        records = clients_ws.get_all_records()
        headers = clients_ws.row_values(1)
        matches = []
        for idx, r in enumerate(records):
            try:
                if int(r.get("ID", 0) or 0) == uid:
                    row_vals = clients_ws.row_values(idx + 2)
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
        records = clients_ws.get_all_records()
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
                        ref_records = referrals_ws.get_all_records()
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
                        row_vals = clients_ws.row_values(sheet_row)
                        if len(row_vals) >= 8:
                            vaypecoins = int(row_vals[7] or 0)
                    except Exception:
                        pass

                # Fallback: читаем промокод напрямую по индексу колонки (col 6 → index 5)
                if not ref_code:
                    try:
                        row_vals = clients_ws.row_values(sheet_row)
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
                        clients_ws.update_cell(sheet_row, 6, new_code)
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
        existing = promos_ws.get_all_records()
        if any(r.get("Код", "").upper() == code for r in existing):
            return jsonify({"ok": False, "error": "already exists"}), 409

        from datetime import datetime
        promos_ws.append_row([code, promo_type, discount, uid, 0,
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

        records = clients_ws.get_all_records()
        headers = clients_ws.row_values(1)
        try:
            vc_col = headers.index("Вейпкоины") + 1
        except ValueError:
            return jsonify({"ok": False, "error": "no VC column"}), 500

        for idx, r in enumerate(records):
            try:
                if int(r.get("ID", 0) or 0) == uid:
                    current = float(r.get("Вейпкоины", 0) or 0)
                    new_val = round(current + vc_earned, 2)
                    clients_ws.update_cell(idx + 2, vc_col, new_val)
                    logging.info(f"add_coins uid={uid} smoke={smoke} +{vc_earned} => {new_val}")
                    _cache_del(f"loyalty:{uid}")
                    return jsonify({"ok": True, "earned": vc_earned, "total": new_val})
            except Exception:
                continue

        return jsonify({"ok": False, "error": "user not found"}), 404
    except Exception as e:
        logging.error(f"add_coins: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
