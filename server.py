"""
Flask-сервер для Telegram Mini App.
Локально: python server.py
Продакшен: gunicorn server:app (Render.com)
"""
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import logging
import os
import json
import tempfile

logging.basicConfig(level=logging.INFO)

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


@app.route("/")
def index():
    return send_from_directory(_static, "index.html")

@app.route("/api/products")
def get_products():
    try:
        data = products_ws.get_all_records()
        return jsonify([p for p in data if p.get("Остаток", 0) > 0])
    except Exception as e:
        logging.error(f"get_products: {e}")
        return jsonify([])

@app.route("/api/loyalty/<int:uid>")
def get_user_loyalty(uid: int):
    try:
        records = clients_ws.get_all_records()
        for r in records:
            if int(r.get("ID", 0)) == uid:
                total      = int(r.get("Итого", 0) or 0)
                vaypecoins = int(r.get("Вейпкоины", 0) or 0)
                ref_code   = r.get("Промокод", "") or ""

                level_name, discount = get_loyalty(total)
                sorted_loyalty = sorted(LOYALTY_LEVELS, key=lambda x: x[0])
                next_t = next((t for t, n, d in sorted_loyalty if total < t), None)

                # Реферальная статистика
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

                # Дополнительная попытка по индексу колонки если по имени = 0
                if vaypecoins == 0:
                    try:
                        row_vals = clients_ws.row_values(records.index(r) + 2)
                        if len(row_vals) >= 8:
                            vaypecoins = int(row_vals[7] or 0)
                    except Exception:
                        pass

                return jsonify({
                    "total":              total,
                    "level":              level_name,
                    "discount":           discount,
                    "next_threshold":     next_t,
                    "vaypecoins":         vaypecoins,
                    "ref_code":           ref_code,
                    "ref_count":          ref_count,
                    "ref_level":          ref_level_name,
                    "ref_pct":            ref_pct,
                    "next_ref_threshold": next_ref_t,
                })
    except Exception as e:
        logging.error(f"get_user_loyalty: {e}")

    return jsonify({
        "total": 0, "level": None, "discount": 0, "next_threshold": 20_000,
        "vaypecoins": 0, "ref_code": "", "ref_count": 0,
        "ref_level": None, "ref_pct": 0, "next_ref_threshold": 1,
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
