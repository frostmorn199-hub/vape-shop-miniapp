$Host.UI.RawUI.WindowTitle = "VAPE SHOP - Autorun"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step { param($msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  [x]  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host "         VAPE SHOP - автозапуск              " -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""

Set-Location $Root

# ── 1. Проверка Python ──────────────────────────────
Write-Step "Проверяем Python..."
try {
    $pyVer = & python --version 2>&1
    Write-OK $pyVer
} catch {
    Write-Fail "Python не найден. Установи Python и повтори."
    Read-Host "Нажми Enter для выхода"; exit 1
}

# ── 2. Зависимости ──────────────────────────────────
Write-Step "Проверяем зависимости..."
& python -m pip install -r requirements.txt -q --disable-pip-version-check
Write-OK "Зависимости установлены"

# ── 3. Flask сервер (Mini App) ──────────────────────
Write-Step "Запускаем Flask сервер (порт 5000)..."
$serverProc = Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "cd '$Root'; python server.py" `
    -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2
Write-OK "Flask сервер запущен (PID $($serverProc.Id))"

# ── 4. Cloudflare Tunnel ────────────────────────────
$cfExe = Join-Path $Root "cloudflared.exe"
$tunnelUrl = ""

if (Test-Path $cfExe) {
    Write-Step "Запускаем Cloudflare Tunnel..."
    $cfLog = Join-Path $Root "cf_tunnel.log"
    if (Test-Path $cfLog) { Remove-Item $cfLog -Force }

    $cfProc = Start-Process -FilePath $cfExe `
        -ArgumentList "tunnel", "--url", "http://localhost:5000" `
        -RedirectStandardError $cfLog `
        -PassThru -WindowStyle Hidden

    # ждём URL в логе (до 30 сек)
    Write-Step "Ожидаем HTTPS-ссылку от Cloudflare..."
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $cfLog) {
            $content = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
            if ($content -match "(https://[^\s]+\.trycloudflare\.com)") {
                $tunnelUrl = $Matches[1]
                break
            }
        }
    }

    if ($tunnelUrl) {
        Write-OK "Tunnel: $tunnelUrl"

        # вставляем URL в bot.py автоматически
        $botPath = Join-Path $Root "bot.py"
        $botContent = Get-Content $botPath -Raw -Encoding UTF8
        $botContent = $botContent -replace 'WEBAPP_URL\s*=\s*"[^"]*"', "WEBAPP_URL = `"$tunnelUrl`""
        Set-Content $botPath $botContent -Encoding UTF8
        Write-OK "WEBAPP_URL в bot.py обновлён автоматически"
    } else {
        Write-Warn "Не удалось получить URL туннеля. Mini App недоступен через HTTPS."
        Write-Warn "Cloudflare лог: $cfLog"
    }
} else {
    Write-Warn "cloudflared.exe не найден - Mini App будет недоступен."
    Write-Warn "Скачай: https://github.com/cloudflare/cloudflared/releases/latest"
}

# ── 5. Telegram Bot ─────────────────────────────────
Write-Host ""
Write-Step "Запускаем Telegram бота..."
$botProc = Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "cd '$Root'; python bot.py" `
    -PassThru -WindowStyle Normal
Write-OK "Бот запущен (PID $($botProc.Id))"

# ── Итог ────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host "   Все сервисы запущены!" -ForegroundColor Green
if ($tunnelUrl) {
    Write-Host "   Mini App: $tunnelUrl" -ForegroundColor White
}
Write-Host ""
Write-Host "   Закрой это окно или нажми Enter для" -ForegroundColor DarkGray
Write-Host "   остановки ВСЕХ процессов." -ForegroundColor DarkGray
Write-Host "  ============================================" -ForegroundColor DarkCyan
Write-Host ""

Read-Host "Enter - остановить всё"

# ── Остановка ───────────────────────────────────────
Write-Host ""
Write-Step "Останавливаем процессы..."
foreach ($proc in @($serverProc, $botProc, $cfProc)) {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
# убиваем дочерние окна PowerShell
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-OK "Готово. До свидания!"
Start-Sleep -Seconds 2
