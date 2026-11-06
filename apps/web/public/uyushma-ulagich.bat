@echo off
setlocal
title Uyushma ulagich
set "PS1=%TEMP%\uyushma-ulagich.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~f0'; $all=Get-Content -LiteralPath $p -Encoding UTF8; $i=[Array]::IndexOf($all,'::PS1_START'); if($i -lt 0){Write-Host 'Fayl buzilgan'; exit 1}; Set-Content -LiteralPath $env:TEMP\uyushma-ulagich.ps1 -Value $all[($i+1)..($all.Length-1)] -Encoding UTF8"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
del "%PS1%" >nul 2>&1
exit /b

::PS1_START
param([string]$Code = "")

# Uyushma ulagich: bir marta o'rnatiladi, keyin sayt o'zi ishga tushiradi.
# Faqat Windows + Chrome/Edge. Token serverga avtomatik yuboriladi.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl = "https://uyushma.bmbrutto.uz"
if ($env:UYUSHMA_BASE_URL) { $BaseUrl = $env:UYUSHMA_BASE_URL.TrimEnd("/") }
$SettingsUrl = "$BaseUrl/uz/settings"

$AppDir = Join-Path $env:LOCALAPPDATA "UyushmaUlagich"
$InstalledScript = Join-Path $AppDir "uyushma-connect.ps1"
$LauncherPath = Join-Path $AppDir "launch.vbs"
$MarkerPath = Join-Path $AppDir "installed.txt"
$LogPath = Join-Path $AppDir "ulagich.log"
$PSExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Version = "10"
$Mutex = $null

trap {
  Write-Log "FATAL: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"
  Write-Host ""
  Write-Host "Kutilmagan xato: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log fayli: $LogPath" -ForegroundColor DarkGray
  Pause-Exit 1
}

if ($PSVersionTable.PSVersion.Major -lt 3) {
  Write-Host "Windows PowerShell 3 yoki undan yangisi kerak." -ForegroundColor Red
  Write-Host "Windows Update orqali yangilang yoki boshqa kompyuterda sinab ko'ring." -ForegroundColor Yellow
  Pause-Exit 1
}

function Show-Header($text) {
  Write-Host ""
  Write-Host "===============================================" -ForegroundColor Green
  Write-Host " $text" -ForegroundColor Green
  Write-Host "===============================================" -ForegroundColor Green
}

function Pause-Exit($codeValue) {
  Write-Host ""
  [void](Read-Host "Davom etish uchun Enter bosing")
  exit $codeValue
}

function Write-Log($message) {
  try {
    if (-not (Test-Path -LiteralPath $AppDir)) {
      New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
    }
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    $item = Get-Item -LiteralPath $LogPath -ErrorAction SilentlyContinue
    if ($item -and $item.Length -gt 307200) {
      $tail = Get-Content -LiteralPath $LogPath -Tail 400 -ErrorAction SilentlyContinue
      Set-Content -LiteralPath $LogPath -Value $tail -Encoding UTF8
    }
  } catch { }
}

function Test-LocalPort([int]$port, [int]$timeoutMs = 300) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync("127.0.0.1", $port)
    if (-not $task.Wait($timeoutMs)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    try { $client.Dispose() } catch { }
  }
}

# Boshqa kompyuterlarda eski nusxa qolib ketmasin: o'rnatilgan skript har
# safar serverdagi yangi versiya bilan solishtiriladi va o'zi yangilanadi.
function Update-SelfIfNeeded {
  if (-not $PSCommandPath) { return }
  try {
    $current = (Resolve-Path -LiteralPath $PSCommandPath).Path
    $installed = Resolve-Path -LiteralPath $InstalledScript -ErrorAction SilentlyContinue
    if (-not $installed -or $current -ne $installed.Path) { return }

    $response = Invoke-WebRequest -Uri "$BaseUrl/uyushma-ulagich.ps1" -UseBasicParsing -TimeoutSec 15
    if ($response.Content -is [byte[]]) {
      $text = [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else {
      $text = [string]$response.Content
    }
    if ($text.Length -lt 500 -or $text -notmatch "UYUSHMA") { return }
    $match = [regex]::Match($text, '\$Version\s*=\s*"(\d+)"')
    if (-not $match.Success) { return }
    $remoteVersion = [int]$match.Groups[1].Value
    if ($remoteVersion -le [int]$Version) { return }

    $temp = Join-Path $AppDir "uyushma-connect.new.ps1"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temp, $text, $utf8)
    Move-Item -LiteralPath $temp -Destination $InstalledScript -Force
    Set-Content -LiteralPath $MarkerPath -Value ([string]$remoteVersion) -Encoding ASCII
    try { Install-Launcher } catch { }
    Write-Log "Self-update: $Version -> $remoteVersion"

    if ($Code) {
      $relaunch = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '" -Code ' + $Code
      Start-Process -FilePath $PSExe -ArgumentList $relaunch
      exit 0
    }
  } catch {
    Write-Log "Self-update skipped: $($_.Exception.Message)"
  }
}

function Get-BrowserPath {
  $candidates = @()
  $appPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
  )
  foreach ($exe in @("chrome.exe", "msedge.exe")) {
    foreach ($rootKey in $appPaths) {
      try {
        $value = (Get-ItemProperty -Path (Join-Path $rootKey $exe) -ErrorAction Stop).'(default)'
        if ($value) { $candidates += $value }
      } catch { }
    }
  }
  $candidates += @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

function Get-ConnectorProcesses([string]$profile) {
  $items = @()
  try {
    $items = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction Stop
  } catch {
    try {
      $items = Get-WmiObject Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction Stop
    } catch { return @() }
  }
  return @($items | Where-Object { $_.CommandLine -and ([string]$_.CommandLine).Contains($profile) })
}

function Enter-SingleInstance {
  try {
    $script:Mutex = New-Object System.Threading.Mutex($false, "Local\UyushmaUlagich")
    if (-not $script:Mutex.WaitOne(0)) {
      Show-Header "UYUSHMA ULGICHI ALLAQACHON OCHIQ"
      Write-Host ""
      Write-Host "Boshqa ulagich oynasi ishlayapti. Uni yopib, qayta urinib ko'ring." -ForegroundColor Yellow
      exit 0
    }
  } catch { }
}

# Ulagich o'z profiliga ega (Chrome 136+ faqat alohida profil bilan
# avtomatik token olishga ruxsat beradi). Nomini aniq qo'yamiz, shunda
# foydalanuvchi buni "ikkinchi profil" deb o'ylamaydi.
function Set-ConnectorProfileName([string]$profileDir) {
  $state = Join-Path $profileDir "Local State"
  if (Test-Path -LiteralPath $state) { return }
  $json = '{"profile":{"info_cache":{"Default":{"name":"Uyushma ulagich (avtomatik)","is_using_default_name":false,"avatar_icon":"chrome://theme/IDR_PROFILE_AVATAR_26"}}}}'
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($state, $json, $utf8)
  } catch { }
}

# ijara.soliq.uz ERI kalitlarini E-IMZO moduli orqali oladi.
# Modul ishlamayotgan bo'lsa, uni ishga tushiramiz.
function Start-EimzoIfNeeded {
  if (Test-LocalPort 64443) { return $true }

  $paths = @(
    "C:\Program Files (x86)\E-IMZO\E-IMZO.exe",
    "C:\Program Files\E-IMZO\E-IMZO.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\E-IMZO\E-IMZO.exe")
  )
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
      try { Start-Process -FilePath $path -WorkingDirectory (Split-Path -Parent $path) | Out-Null } catch { }
      break
    }
  }
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    if (Test-LocalPort 64443) { return $true }
  }
  return $false
}

# E-IMZO moduli "certkey" plaginini qollab-quvvatlaydimi?
function Test-EimzoCertKey {
  $ws = $null
  try {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ct = [System.Threading.CancellationToken]::None
    $connect = $ws.ConnectAsync([Uri]"wss://127.0.0.1:64443/service/cryptapi", $ct)
    if (-not $connect.Wait(5000)) { return $null }

    $payload = [System.Text.Encoding]::UTF8.GetBytes('{"plugin":"certkey","name":"list_all_certificates"}')
    $segment = New-Object System.ArraySegment[byte] -ArgumentList @(, $payload)
    $send = $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct)
    if (-not $send.Wait(4000)) { return $null }

    $buffer = New-Object byte[] 65536
    $ms = New-Object System.IO.MemoryStream
    $recvSegment = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    do {
      $recv = $ws.ReceiveAsync($recvSegment, $ct)
      if (-not $recv.Wait(4000)) { return $null }
      if ($recv.Result.Count -gt 0) { $ms.Write($buffer, 0, $recv.Result.Count) }
    } while (-not $recv.Result.EndOfMessage)

    $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
    if (-not $text) { return $null }
    return ($text -match '"success"\s*:\s*true')
  } catch {
    return $null
  } finally {
    if ($ws) { try { $ws.Dispose() } catch { } }
  }
}

# Faqat kerakli portal (yoki uning login) sahifalaridan token olamiz.
function Test-ProviderPage($page, $portalHost, $authHosts) {
  if ($page.type -ne "page" -or -not $page.webSocketDebuggerUrl) { return $false }
  $hostName = ""
  try { $hostName = ([Uri]$page.url).Host.ToLower() } catch { return $false }
  if ($hostName -eq $portalHost -or $hostName.EndsWith("." + $portalHost)) { return $true }
  foreach ($authHost in $authHosts) {
    if ($hostName -eq $authHost -or $hostName.EndsWith("." + $authHost)) { return $true }
  }
  return $false
}

function Send-Cdp($wsUrl, $json, $expectValue) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ct = [System.Threading.CancellationToken]::None
  try {
    $ws.ConnectAsync([Uri]$wsUrl, $ct).Wait(7000) | Out-Null
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait(7000) | Out-Null

    $buffer = New-Object byte[] 131072
    $segR = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    $ms = New-Object System.IO.MemoryStream
    do {
      $res = $ws.ReceiveAsync($segR, $ct).Result
      if ($res.Count -gt 0) { $ms.Write($buffer, 0, $res.Count) }
    } while (-not $res.EndOfMessage)
    $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
    if (-not $expectValue) { return $null }
    $obj = $text | ConvertFrom-Json
    return $obj.result.result.value
  } finally {
    try { $ws.Dispose() } catch { }
  }
}

function Install-Launcher {
  if (-not (Test-Path -LiteralPath $AppDir)) {
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  }

  $vbs = @"
' Uyushma ulagichini ishga tushiruvchi. Sayt uyushma:// havolasini yuborganda chaqiriladi.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
script = fso.GetParentFolderName(WScript.ScriptFullName) & "\uyushma-connect.ps1"
code = ""
If WScript.Arguments.Count > 0 Then
  arg = WScript.Arguments(0)
  If InStr(LCase(arg), "uyushma://") = 1 Then
    rest = Mid(arg, 11)
    q = InStr(rest, "?")
    If q > 0 Then rest = Left(rest, q - 1)
    Do While Len(rest) > 0 And Right(rest, 1) = "/"
      rest = Left(rest, Len(rest) - 1)
    Loop
    parts = Split(rest, "/")
    raw = parts(UBound(parts))
    For i = 1 To Len(raw)
      ch = Mid(raw, i, 1)
      If ch >= "0" And ch <= "9" Then code = code & ch
    Next
  End If
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """"
If code <> "" Then cmd = cmd & " -Code " & code
sh.Run cmd, 1, False
"@
  Set-Content -LiteralPath $LauncherPath -Value $vbs -Encoding ASCII
}

function Install-Connector {
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

  if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {
    if ($PSCommandPath -ne $InstalledScript) {
      Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
    }
  }

  Install-Launcher

  $key = "HKCU:\Software\Classes\uyushma"
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name "(default)" -Value "URL:Uyushma Connector" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  $commandKey = "$key\shell\open\command"
  New-Item -Path $commandKey -Force | Out-Null
  $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
  $command = '"' + $wscript + '" //nologo "' + $LauncherPath + '" "%1"'
  New-ItemProperty -Path $commandKey -Name "(default)" -Value $command -PropertyType String -Force | Out-Null

  try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcut = $shell.CreateShortcut((Join-Path $desktop "Uyushma bilan ulash.lnk"))
    $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '"'
    $shortcut.WorkingDirectory = $AppDir
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
    $shortcut.Description = "Uyushma: portalga ulanish"
    $shortcut.Save()
  } catch { }

  Set-Content -LiteralPath $MarkerPath -Value $Version -Encoding ASCII
}

# Protokol orqali kelgan kod (uyushma://connect/123456)
if ($Code -and $Code -notmatch '^[0-9]{4,12}$') {
  $digits = ($Code -replace '[^0-9]', '')
  if ($digits.Length -ge 4) { $Code = $digits }
}

# O'rnatilgan nusxa eskirgan bo'lsa, serverdagi yangi versiyaga o'tadi.
Update-SelfIfNeeded

# Eski o'rnatishlarda uyushma:// launcher ham eskirgan bo'ladi - yangilaymiz.
if ((Test-Path -LiteralPath $InstalledScript) -and (Test-Path -LiteralPath $LauncherPath)) {
  try {
    $launcherText = Get-Content -LiteralPath $LauncherPath -Raw -ErrorAction Stop
    if ($launcherText -notmatch "Len\(raw\)") { Install-Launcher }
  } catch { }
}

Write-Log "Start version=$Version code=$Code"

if (-not $Code) {
  if (-not (Test-Path -LiteralPath $InstalledScript)) {
    Show-Header "UYUSHMA ULGICHINI ORNATISH"
    Write-Host ""
    Write-Host "Bu fayl kompyuteringizga BIR MARTA ornatiladi." -ForegroundColor Cyan
    Write-Host "Keyin saytda 'Kompyuterda ulash' tugmasini bossangiz," -ForegroundColor Cyan
    Write-Host "Chrome oynasi ozi ochiladi va kod kiritish shart bolmaydi." -ForegroundColor Cyan
    Write-Host ""

    try {
      Install-Connector
    } catch {
      Write-Host "Ornatishda xatolik: $($_.Exception.Message)" -ForegroundColor Red
      Pause-Exit 1
    }

    Show-Header "ORRNATILDI! TAYYOR"
    Write-Host ""
    Write-Host "Endi quyidagilarni bajaring:" -ForegroundColor Green
    Write-Host "  1) Saytga kiring: Sozlamalar -> Tashqi tizimlar"
    Write-Host "  2) Kerakli tizimda 'Kompyuterda ulash' tugmasini bosing"
    Write-Host "  3) Brauzer 'Uyushma ulagichni ochish' deb so'rasa:"
    Write-Host "     'Ochish' ni tanlang va 'Har doim ruxsat berish' ni belgilang"
    Write-Host ""
    Write-Host "Shundan keyin bu faylni boshqa ochish kerak emas." -ForegroundColor Yellow
    Write-Host "Chrome oynasi ochilganda OneID / E-IMZO bilan kirasiz - token o'zi saqlanadi." -ForegroundColor Yellow
    Write-Host ""
    [void](Read-Host "Saytni ochish uchun Enter bosing")
    Start-Process $SettingsUrl
    exit 0
  }

  # Allaqachon o'rnatilgan: versiyani yangilab qo'yamiz va qo'lda rejimni taklif qilamiz.
  try {
    $installedVersion = (Get-Content -LiteralPath $MarkerPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($installedVersion -ne $Version -and $PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {
      Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
      Set-Content -LiteralPath $MarkerPath -Value $Version -Encoding ASCII
    }
  } catch { }

  Show-Header "UYUSHMA ULGICHI ALLAQACHON ORNATILGAN"
  Write-Host ""
  Write-Host "Saytda 'Kompyuterda ulash' tugmasini bosing - Chrome o'zi ochiladi." -ForegroundColor Cyan
  Write-Host "Kod kiritish shart emas." -ForegroundColor Cyan
  Write-Host ""
  $entered = Read-Host "Oyna ochilmasa, 6 xonali kodni kiriting (saytni ochish uchun bo'sh qoldiring)"
  $entered = ([string]$entered).Trim()
  if (-not $entered) {
    Start-Process $SettingsUrl
    exit 0
  }
  $Code = $entered
}

if ($Code -notmatch '^[0-9]{4,12}$') {
  Show-Header "KOD NOTOGRI"
  Write-Host "Kod faqat raqamlardan iborat bolishi kerak." -ForegroundColor Red
  Pause-Exit 1
}

Enter-SingleInstance
Show-Header "UYUSHMA - KOMPYUTERDAGI BRAUZER ORQALI ULASH"

try {
  $info = Invoke-RestMethod -Uri "$BaseUrl/api/v1/local-connector/pairing/$Code" -Method Get -TimeoutSec 20
  Write-Log "Pairing OK provider=$($info.provider)"
} catch {
  Write-Log "Pairing xato: $($_.Exception.Message)"
  Write-Host "Kod topilmadi yoki muddati o'tgan. Saytdan yangi kod oling." -ForegroundColor Red
  Pause-Exit 1
}

$portalUrl = $info.portalUrl
$provider = $info.provider
Write-Host "Portal: $provider" -ForegroundColor Yellow
Write-Host "Manzil: $portalUrl" -ForegroundColor DarkGray

if ($portalUrl -match "ijara\.soliq\.uz") {
  Write-Host ""
  Write-Host "E-IMZO moduli tekshirilmoqda..." -ForegroundColor DarkGray
  $eimzoReady = Start-EimzoIfNeeded
  if (-not $eimzoReady) {
    Write-Host "E-IMZO dasturi ishlamayapti." -ForegroundColor Yellow
    Write-Host "Uni oching yoki yangilang: https://e-imzo.soliq.uz/download" -ForegroundColor Yellow
  } else {
    $certKeyOk = Test-EimzoCertKey
    if ($certKeyOk -ne $true) {
      Write-Host "Diqqat: ornatilgan E-IMZO moduli ijara.soliq.uz talab qiladigan" -ForegroundColor Yellow
      Write-Host "yangi imkoniyatni qollab-quvvatlamaydi, shuning uchun ERI kalitlari" -ForegroundColor Yellow
      Write-Host "royxati bosh korinishi mumkin." -ForegroundColor Yellow
      Write-Host "Yangi modul: https://e-imzo.soliq.uz/download" -ForegroundColor Yellow
      Write-Host "Muqobil: saytda 'Token yordamida kirish' yoki OneID orqali kiring." -ForegroundColor DarkGray
    }
  }
}

$profileDir = Join-Path $AppDir "profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Set-ConnectorProfileName $profileDir

$browser = Get-BrowserPath
if (-not $browser) {
  Write-Host "Chrome yoki Edge topilmadi." -ForegroundColor Red
  Write-Host "Chrome o'rnating: https://www.google.com/chrome/" -ForegroundColor Yellow
  Write-Log "Browser topilmadi"
  Pause-Exit 1
}

# Oldingi urinishdan qolgan ulagich oynasi portni band qilib qo'yishi mumkin:
# faqat bizning profilimiz bilan ishlaydigan jarayonlarni yopamiz.
$existing = @(Get-ConnectorProcesses $profileDir)
if ($existing.Count -gt 0) {
  Write-Log "Eski ulagich jarayonlari yopilmoqda: $($existing.Count)"
  foreach ($item in $existing) {
    try { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
  }
  Start-Sleep -Milliseconds 900
}

$port = 0
foreach ($candidatePort in 9333..9345) {
  if (-not (Test-LocalPort $candidatePort)) {
    $port = $candidatePort
    break
  }
}
if (-not $port) {
  Write-Host "Brauzer uchun bo'sh port topilmadi. Kompyuterni qayta ishga tushiring." -ForegroundColor Red
  Write-Log "Port topilmadi"
  Pause-Exit 1
}

$chromeArgs = "--remote-debugging-port=$port --remote-allow-origins=* --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check `"$portalUrl`""
$proc = Start-Process -FilePath $browser -ArgumentList $chromeArgs -PassThru
Write-Log "Browser=$browser port=$port"

$cdpReady = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null
    $cdpReady = $true
    break
  } catch { }
}
if (-not $cdpReady) {
  Write-Host "Brauzer ulanishi ochilmadi. Chrome to'liq yopilganini tekshirib, qaytadan urinib ko'ring." -ForegroundColor Red
  Pause-Exit 1
}

Write-Host ""
Write-Host "Brauzer oynasi ochildi. Unda tizimga kiring (OneID / E-IMZO / login-parol)." -ForegroundColor Cyan
Write-Host "Agar korxona tanlash oynasi chiqsa - kerakli korxonani tanlang va davom eting." -ForegroundColor Cyan
Write-Host "Bu 'Uyushma ulagich' nomli alohida oyna - shaxsiy Chrome profilingizga tegmaydi." -ForegroundColor DarkGray
Write-Host "Kirgandan so'ng token avtomatik saqlanadi, oyna o'zi yopiladi." -ForegroundColor DarkGray
Write-Host "Kutish muddati: 10 daqiqa." -ForegroundColor DarkGray

$tokenExpression = @'
(function () {
  var re = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/;
  function grab(s) {
    if (typeof s !== "string") return null;
    var m = s.match(re);
    return m ? m[0] : null;
  }
  var stores = [];
  try { stores.push(window.localStorage); } catch (e) {}
  try { stores.push(window.sessionStorage); } catch (e) {}
  var token = null;
  var preferred = ["access_token", "token", "auth_token", "jwt"];
  for (var p = 0; p < preferred.length && !token; p++) {
    for (var s = 0; s < stores.length && !token; s++) {
      try { token = grab(stores[s].getItem(preferred[p])); } catch (e) {}
    }
  }
  for (var s2 = 0; s2 < stores.length && !token; s2++) {
    var st = stores[s2];
    for (var i = 0; i < st.length; i++) {
      var key = st.key(i);
      var value = null;
      try { value = st.getItem(key); } catch (e) { continue; }
      var found = grab(value);
      if (found) { token = found; break; }
      if (/token|jwt|auth/i.test(key) && typeof value === "string" && value.length > 30) {
        token = value.replace(/^Bearer\s+/i, "").replace(/["'`]/g, "").trim();
        break;
      }
    }
  }
  var profiles = [];
  try {
    var raw = window.localStorage.getItem("profiles");
    if (raw) {
      var list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (var j = 0; j < list.length; j++) {
          var item = list[j] || {};
          var id = item.id || item.profileId;
          if (!id) continue;
          profiles.push({
            id: String(id),
            organizationName: item.organizationName ? String(item.organizationName) : null,
            companyName: item.companyName ? String(item.companyName) : null,
            fullName: item.fullName ? String(item.fullName) : null,
            tin: item.tin || item.inn ? String(item.tin || item.inn) : null
          });
        }
      }
    }
  } catch (e) {}
  var selectedProfile = null;
  try { selectedProfile = window.localStorage.getItem("selectedProfile"); } catch (e) {}
  var refreshToken = null;
  try { refreshToken = window.localStorage.getItem("refresh_token") || window.localStorage.getItem("refreshToken"); } catch (e) {}
  return JSON.stringify({
    token: token,
    refreshToken: refreshToken,
    profiles: profiles,
    selectedProfile: selectedProfile ? true : false,
    path: window.location.pathname
  });
})()
'@

$evalJson = @{ id = 1; method = "Runtime.evaluate"; params = @{ expression = $tokenExpression; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress

$deadline = (Get-Date).AddMinutes(10)
$token = $null
$refreshToken = $null
$profiles = @()
$windowClosed = $false
$misses = 0
$selectionHint = $false
$portalHost = ([Uri]$portalUrl).Host.ToLower()
$authHosts = @("sso.egov.uz", "id.egov.uz", "my.soliq.uz", "soliq.uz", "e-imzo.uz")

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $targets = $null
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 3
    $misses = 0
  } catch {
    $misses++
    # Brauzer yopilgan bo'lsa, 10 soniyadan keyin kutishni to'xtatamiz.
    if ($misses -ge 5) { $windowClosed = $true; break }
    continue
  }
  $pages = @($targets | Where-Object { Test-ProviderPage $_ $portalHost $authHosts })
  foreach ($page in $pages) {
    try {
      $value = Send-Cdp -wsUrl $page.webSocketDebuggerUrl -json $evalJson -expectValue $true
      if (-not $value) { continue }

      $info = $null
      try { $info = [string]$value | ConvertFrom-Json } catch { $info = $null }

      if ($info) {
        $pagePath = [string]$info.path
        $profileList = @($info.profiles)
        $authPath = $pagePath -match "^/(log-in|sign-in|login)"
        $profilePath = $pagePath -match "^/sign-in/profiles"
        # Korxona tanlash oynasi ochiq turganda token olmaymiz: aks holda
        # hisobning standart (masalan, boshqa) korxonasi saqlanib qoladi.
        if ($profileList.Count -gt 1 -and ($authPath -or $profilePath)) {
          if (-not $selectionHint) {
            Write-Host ""
            Write-Host "Diqqat: hisobingizda bir nechta korxona bor." -ForegroundColor Yellow
            Write-Host "Oynada kerakli korxonani (masalan, CAR LUX) tanlab," -ForegroundColor Yellow
            Write-Host "'Davom etish' tugmasini bosing." -ForegroundColor Yellow
            $selectionHint = $true
          }
          continue
        }
        if ($info.token) {
          $token = [string]$info.token
          if ($info.refreshToken) { $refreshToken = [string]$info.refreshToken }
          $profiles = $profileList
          break
        }
      } elseif ($value -match "eyJ") {
        $token = [string]$value
        break
      }
    } catch { }
  }
  if ($token) { break }
}

if (-not $token) {
  if ($windowClosed) {
    Write-Host "Brauzer yopildi. Qaytadan urinib ko'ring." -ForegroundColor Red
  } elseif ($selectionHint) {
    Write-Host "Korxona tanlanmadi. Qaytadan urinib, kerakli korxonani tanlang." -ForegroundColor Red
  } else {
    Write-Host "Token topilmadi. Portalga kirganingizni tekshiring va qaytadan urinib ko'ring." -ForegroundColor Red
  }
  Pause-Exit 1
}

Write-Log "Token topildi provider=$provider"
Write-Host ""
Write-Host "Token topildi. Serverga yuborilmoqda..." -ForegroundColor Cyan

try {
  $payload = @{ code = $Code; token = $token }
  if ($refreshToken) { $payload.refreshToken = $refreshToken }
  if (@($profiles).Count -gt 0) { $payload.profiles = @($profiles) }
  $body = $payload | ConvertTo-Json -Depth 6 -Compress
  $result = Invoke-RestMethod -Uri "$BaseUrl/api/v1/local-connector/capture" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 90
} catch {
  $message = $_.Exception.Message
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $message = $_.ErrorDetails.Message }
  Write-Log "Capture xato: $message"
  Write-Host "Server xatosi: $message" -ForegroundColor Red
  Pause-Exit 1
}

Write-Log "Capture OK provider=$provider account=$($result.account)"
Write-Host ""
Write-Host "MUVAFFAQIYAT: $provider ulandi." -ForegroundColor Green
if ($result.account) { Write-Host "Hisob: $($result.account)" -ForegroundColor Green }

try {
  $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 3
  if ($version.webSocketDebuggerUrl) {
    Send-Cdp -wsUrl $version.webSocketDebuggerUrl -json '{"id":9,"method":"Browser.close"}' -expectValue $false | Out-Null
  }
} catch { }
Start-Sleep -Seconds 2
try { if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force } } catch { }

Write-Host "Brauzer oynasi yopildi. Saytga qaytib, malumotlar sinxronlanishini kuzating." -ForegroundColor Green
Write-Host ""
