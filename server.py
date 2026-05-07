"""
Flask-сервер для Telegram Mini App.
Локально: python server.py
Продакшен: gunicorn server:app (Render.com)
"""
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import logging
import os
import json
import tempfile

logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder="webapp", static_url_path="")
CORS(app)

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

# Render.com: creds из переменной окружения GOOGLE_CREDS_JSON
# Локально: читаем creds.json
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
products_ws = spreadsheet.worksheet("Товары")
clients_ws  = spreadsheet.worksheet("Клиенты")

LOYALTY_LEVELS = [
    (300_000, "Платина 💎", 15),
    (100_000, "Золото 🥇",  10),
    (50_000,  "Серебро 🥈",  7),
    (20_000,  "Бронза 🥉",   5),
]

def get_loyalty(total: int):
    for threshold, name, discount in LOYALTY_LEVELS:
        if total >= threshold:
            return name, discount
    return None, 0


@app.route("/")
def index():
    return send_from_directory("webapp", "index.html")

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
        for r in clients_ws.get_all_records():
            if int(r.get("ID", 0)) == uid:
                total = int(r.get("Итого", 0))
                level_name, discount = get_loyalty(total)
                next_t = next((t for t, n, d in LOYALTY_LEVELS if total < t), None)
                return jsonify({
                    "total":          total,
                    "level":          level_name,
                    "discount":       discount,
                    "next_threshold": next_t,
                })
    except Exception as e:
        logging.error(f"get_user_loyalty: {e}")
    return jsonify({"total": 0, "level": None, "discount": 0, "next_threshold": 20_000})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
