"""
Скрипт для открытия публичного доступа к фото товаров из Google Drive.
Запускай каждый раз когда добавляешь новые товары с фотографиями:
  venv_new\Scripts\python.exe fix_photos.py
"""
import re
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from googleapiclient.discovery import build

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_name("creds.json", scope)
drive = build("drive", "v3", credentials=creds)
client = gspread.authorize(creds)

ws = client.open("VAPE SHOP").worksheet("Товары")
rows = ws.get_all_records()

file_ids = set()
for r in rows:
    url = r.get("Фото", "") or ""
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        file_ids.add(m.group(1))
    m2 = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m2 and "drive.google.com" in url:
        file_ids.add(m2.group(1))

print(f"Найдено файлов в таблице: {len(file_ids)}")
ok = err = skip = 0

for fid in file_ids:
    try:
        # Проверяем, уже ли есть публичный доступ
        perms = drive.permissions().list(fileId=fid, fields="permissions(type,role)").execute()
        already_public = any(
            p.get("type") == "anyone" and p.get("role") == "reader"
            for p in perms.get("permissions", [])
        )
        if already_public:
            skip += 1
            continue

        drive.permissions().create(
            fileId=fid,
            body={"type": "anyone", "role": "reader"},
        ).execute()
        print(f"  [OK] Открыт доступ: {fid}")
        ok += 1
    except Exception as e:
        print(f"  [ERR] {fid}: {e}")
        print(f"     -> Расшари папку с файлом аккаунту:")
        print(f"        sheet-bot-551@vape-shop-495306.iam.gserviceaccount.com")
        err += 1

print(f"\nГотово: {ok} новых открыто, {skip} уже публичные, {err} ошибок")
