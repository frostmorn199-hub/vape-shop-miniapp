import subprocess, sys, os, re, time

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

def log(msg, ok=True):
    tag = "[OK]" if ok else "[!] "
    print(f"  {tag} {msg}")

print("\n  ============================")
print("    VAPE SHOP - autorun")
print("  ============================\n")

# 1. Зависимости
print("  Проверяем зависимости...")
subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt",
                "-q", "--disable-pip-version-check"])
log("Зависимости установлены")

# 2. Flask сервер
subprocess.Popen(
    f'start "Flask Server" cmd /k "cd /d {ROOT} && python server.py"',
    shell=True
)
time.sleep(2)
log("Flask сервер запущен (порт 5000)")

# 3. Cloudflare Tunnel
cf_exe = os.path.join(ROOT, "cloudflared.exe")
tunnel_url = ""

if os.path.exists(cf_exe):
    log_file = os.path.join(ROOT, "cf_tunnel.log")
    with open(log_file, "w") as f:
        pass

    subprocess.Popen(
        [cf_exe, "tunnel", "--url", "http://localhost:5000", "--protocol", "http2"],
        stderr=open(log_file, "w"),
        creationflags=subprocess.CREATE_NO_WINDOW
    )

    print("  Ждём HTTPS-ссылку от Cloudflare...")
    for _ in range(30):
        time.sleep(1)
        try:
            with open(log_file, "r", errors="ignore") as f:
                content = f.read()
            match = re.search(r"(https://[^\s]+\.trycloudflare\.com)", content)
            if match:
                tunnel_url = match.group(1)
                break
        except Exception:
            pass

    if tunnel_url:
        log(f"Tunnel: {tunnel_url}")
        bot_path = os.path.join(ROOT, "bot.py")
        with open(bot_path, "r", encoding="utf-8") as f:
            bot = f.read()
        bot = re.sub(r'WEBAPP_URL\s*=\s*"[^"]*"', f'WEBAPP_URL = "{tunnel_url}"', bot)
        with open(bot_path, "w", encoding="utf-8") as f:
            f.write(bot)
        log("WEBAPP_URL в bot.py обновлён")
    else:
        log("Не удалось получить URL туннеля", ok=False)
else:
    log("cloudflared.exe не найден — Mini App недоступен", ok=False)

# 4. Telegram бот
subprocess.Popen(
    f'start "Telegram Bot" cmd /k "cd /d {ROOT} && python bot.py"',
    shell=True
)
log("Telegram бот запущен")

print("\n  ============================")
print("  Всё запущено!")
if tunnel_url:
    print(f"  Mini App: {tunnel_url}")
print("  Нажми Enter чтобы остановить всё.")
print("  ============================\n")

input()
subprocess.run(["taskkill", "/f", "/im", "python.exe"], capture_output=True)
print("  Остановлено. До свидания!")
