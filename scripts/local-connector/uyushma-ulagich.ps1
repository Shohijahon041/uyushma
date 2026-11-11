param([string]$Code = "", [string]$Uri = "", [switch]$Diagnose)

# Uyushma ulagich: bir marta o'rnatiladi, keyin sayt o'zi ishga tushiradi.
# Faqat Windows + Chrome/Edge. Token serverga avtomatik yuboriladi.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl = "https://uyushma.bmbrutto.uz"
if ($env:UYUSHMA_BASE_URL) { $BaseUrl = $env:UYUSHMA_BASE_URL.TrimEnd("/") }
$SettingsUrl = "$BaseUrl/uz/settings"
$GuideUrl = "$BaseUrl/uyushma-ulagich-yoriqnoma.html"

$Version = "19"
$Mutex = $null
$LogPath = $null
$script:ProtocolFailed = $false

# Log va sozlama papkasi har xil Windows sozlamalarida ham topilishi uchun
# bir nechta joy sinaladi: LOCALAPPDATA -> TEMP -> foydalanuvchi papkasi.
$LogDirs = @()
foreach ($dir in @(
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "UyushmaUlagich" }),
    $(if ($env:TEMP) { Join-Path $env:TEMP "UyushmaUlagich" }),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE "UyushmaUlagich" })
  )) {
  if ($dir -and ($LogDirs -notcontains $dir)) { $LogDirs += $dir }
}

trap {
  try { Write-Log "FATAL: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" } catch { }
  Write-Host ""
  Write-Host "Kutilmagan xato: $($_.Exception.Message)" -ForegroundColor Red
  if ($script:LogPath -and (Test-Path -LiteralPath $script:LogPath)) {
    Write-Host "Log fayli: $script:LogPath" -ForegroundColor DarkGray
  } else {
    Write-Host "Log fayli yaratilmadi. Tashxis uchun saytdagi yo'riqnomaga qarang." -ForegroundColor DarkGray
  }
  Write-Host "Yo'riqnoma: $GuideUrl" -ForegroundColor DarkGray
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
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  foreach ($dir in $script:LogDirs) {
    try {
      if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
      $path = Join-Path $dir "ulagich.log"
      Add-Content -LiteralPath $path -Value $line -Encoding UTF8 -ErrorAction Stop
      $script:LogPath = $path
      $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
      if ($item -and $item.Length -gt 307200) {
        $tail = Get-Content -LiteralPath $path -Tail 400 -ErrorAction SilentlyContinue
        Set-Content -LiteralPath $path -Value $tail -Encoding UTF8
      }
      return
    } catch { }
  }
}

# Yozish mumkin bo'lgan birinchi papkani tanlaydi.
function Resolve-AppDir {
  foreach ($dir in $script:LogDirs) {
    try {
      if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
      $probe = Join-Path $dir "write-check.tmp"
      Set-Content -LiteralPath $probe -Value "ok" -Encoding ASCII -ErrorAction Stop
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
      return $dir
    } catch { }
  }
  return $null
}

if ($PSVersionTable.PSVersion.Major -lt 3) {
  Write-Host "Windows PowerShell 3 yoki undan yangisi kerak." -ForegroundColor Red
  Write-Host "Windows Update orqali yangilang yoki boshqa kompyuterda sinab ko'ring." -ForegroundColor Yellow
  Pause-Exit 1
}

$AppDir = Resolve-AppDir
if (-not $AppDir) {
  Write-Host "Uyushma ulagichi uchun papka yaratib bo'lmadi (ruxsat yo'q)." -ForegroundColor Red
  Write-Host "Administrator sifatida qayta urinib ko'ring." -ForegroundColor Yellow
  Pause-Exit 1
}

$InstalledScript = Join-Path $AppDir "uyushma-connect.ps1"
$MarkerPath = Join-Path $AppDir "installed.txt"
$ElevationSkipPath = Join-Path $AppDir "elevation-skip.txt"
$PSExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

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
    Write-Log "Self-update: $Version -> $remoteVersion"

    if ($Code) {
      $relaunch = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '" -Code ' + $Code
      Start-Process -FilePath $PSExe -ArgumentList $relaunch
      exit 0
    }
    if ($Diagnose) {
      $relaunch = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '" -Diagnose'
      Start-Process -FilePath $PSExe -ArgumentList $relaunch
      exit 0
    }
    $relaunch = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '"'
    Start-Process -FilePath $PSExe -ArgumentList $relaunch
    exit 0
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
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      $ms = New-Object System.IO.MemoryStream
      do {
        $res = $ws.ReceiveAsync($segR, $ct).Result
        if ($res.Count -gt 0) { $ms.Write($buffer, 0, $res.Count) }
      } while (-not $res.EndOfMessage)
      $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
      if (-not $text) { continue }
      try {
        $obj = $text | ConvertFrom-Json
        if ($obj.id -eq 1 -or $obj.result) {
          if (-not $expectValue) { return $null }
          if ($obj.error) { return $null }
          return $obj.result.result.value
        }
      } catch { }
    }
    return $null
  } catch {
    return $null
  } finally {
    try { $ws.Dispose() } catch { }
  }
}

# Fayl yozish ba'zi kompyuterlarda antivirus tufayli birinchi urinishda
# bloklanishi mumkin. Uch marta qayta urinamiz va aniq xatoni qaytaramiz.
function Write-TextFile($path, $text) {
  $lastError = $null
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      if (Test-Path -LiteralPath $path) {
        try { (Get-Item -LiteralPath $path).IsReadOnly = $false } catch { }
      }
      Set-Content -LiteralPath $path -Value $text -Encoding ASCII -ErrorAction Stop
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds 400
    }
  }
  throw $lastError.Exception
}

# Sayt uyushma:// havolasini yuborganda Windows to'g'ridan-to'g'ri shu
# skriptni ishga tushiradi - oraliq VBS kerak emas. VBS ba'zi korporativ
# kompyuterlarda siyosat yoki antivirus tomonidan butunlay bloklangan.
function Get-ProtocolCommand {
  return '"' + $PSExe + '" -NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '" -Uri "%1"'
}

# Administrator ruxsati bilan protokolni yozadi. Foydalanuvchi faqat
# chiqqan oynada "Ha" (Yes) ni bosadi - boshqa hech narsa qilmaydi.
function Request-ProtocolElevation {
  if (Test-Path -LiteralPath $ElevationSkipPath) {
    $skip = (Get-Content -LiteralPath $ElevationSkipPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($skip -eq $Version) {
      Write-Log "Administrator ruxsati avval berilmagan - qayta soramaymiz"
      return $false
    }
  }

  Write-Host ""
  Write-Host "Windows registrga yozishni bloklayapti." -ForegroundColor Yellow
  Write-Host "Hozir administrator ruxsati so'raladi." -ForegroundColor Yellow
  Write-Host "Chiqgan oynada 'Ha' (Yes) tugmasini bosing - qolganini ulagich o'zi qiladi." -ForegroundColor Yellow
  Write-Host ""

  $adminScript = Join-Path $AppDir "protokol-admin.ps1"
  $command = (Get-ProtocolCommand).Replace("'", "''")
  $lines = @(
    '$ErrorActionPreference = "SilentlyContinue"',
    '$key = "HKCU:\Software\Classes\uyushma"',
    'New-Item -Path $key -Force | Out-Null',
    'New-ItemProperty -Path $key -Name "(default)" -Value "URL:Uyushma Connector" -PropertyType String -Force | Out-Null',
    'New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null',
    '$commandKey = "$key\shell\open\command"',
    'New-Item -Path $commandKey -Force | Out-Null',
    ('New-ItemProperty -Path $commandKey -Name "(default)" -Value ''' + $command + ''' -PropertyType String -Force | Out-Null')
  )
  try {
    Write-TextFile $adminScript (($lines -join "`r`n") + "`r`n")
    Start-Process -FilePath $PSExe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $adminScript + '"')
    )
  } catch {
    Write-Log "Administrator ruxsati berilmadi: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $adminScript -Force -ErrorAction SilentlyContinue
  }

  if (Test-ProtocolRegistration) {
    Remove-Item -LiteralPath $ElevationSkipPath -Force -ErrorAction SilentlyContinue
    Write-Log "Protokol yozildi (administrator ruxsati bilan)"
    return $true
  }

  Set-Content -LiteralPath $ElevationSkipPath -Value $Version -Encoding ASCII -ErrorAction SilentlyContinue
  Write-Log "Administrator ruxsati bilan ham registr yozilmadi"
  return $false
}

function Install-Protocol {
  $script:ProtocolFailed = $true
  # Administrator ruxsati bu versiyada allaqachon rad etilgan - qayta urinib
  # antivirus ogohlantirishini chiqarmaymiz.
  if (Test-Path -LiteralPath $ElevationSkipPath) {
    $skip = (Get-Content -LiteralPath $ElevationSkipPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($skip -eq $Version) {
      throw "Windows bu kompyuterda protokol yozuvini bloklaydi."
    }
  }
  $command = Get-ProtocolCommand
  $providerError = $null
  try {
    $key = "HKCU:\Software\Classes\uyushma"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "(default)" -Value "URL:Uyushma Connector" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
    $commandKey = "$key\shell\open\command"
    New-Item -Path $commandKey -Force | Out-Null
    New-ItemProperty -Path $commandKey -Name "(default)" -Value $command -PropertyType String -Force | Out-Null
  } catch {
    $providerError = $_
  }
  if (-not $providerError -and (Test-ProtocolRegistration)) {
    $script:ProtocolFailed = $false
    Write-Log "Protokol yozildi (PowerShell)"
    return
  }
  if ($providerError) {
    Write-Log "PowerShell registr yozuvi ishlamadi: $($providerError.Exception.Message)"
  }

  $output = @()
  try {
    $output += (& reg.exe ADD "HKCU\Software\Classes\uyushma" /ve /d "URL:Uyushma Connector" /f 2>&1)
    $output += (& reg.exe ADD "HKCU\Software\Classes\uyushma" /v "URL Protocol" /t REG_SZ /d '""' /f 2>&1)
    $output += (& reg.exe ADD "HKCU\Software\Classes\uyushma\shell\open\command" /ve /d $command /f 2>&1)
  } catch {
    $output += $_.Exception.Message
  }
  if (Test-ProtocolRegistration) {
    $script:ProtocolFailed = $false
    Write-Log "Protokol yozildi (reg.exe)"
    return
  }
  Write-Log "Registr yozilmadi: $((($output | Out-String).Trim() -replace '\s+', ' '))"

  if (Request-ProtocolElevation) {
    $script:ProtocolFailed = $false
    return
  }

  throw "Windows bu kompyuterda protokol yozuvini bloklaydi."
}

function Test-ProtocolRegistration {
  try {
    $key = "HKCU:\Software\Classes\uyushma\shell\open\command"
    $current = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)'
    return ($current -eq (Get-ProtocolCommand))
  } catch {
    return $false
  }
}

# Tashxis hisobotida qaysi usul ishlayotganini ko'rsatadi.
function Get-ProtocolMethod {
  try {
    $current = (Get-ItemProperty -Path 'HKCU:\Software\Classes\uyushma\shell\open\command' -ErrorAction Stop).'(default)'
  } catch {
    return "topilmadi"
  }
  if (-not $current) { return "topilmadi" }
  if ($current -match '(?i)wscript') { return "VBS (eski usul)" }
  if ($current -match '(?i)powershell') { return "PowerShell (to'g'ridan-to'g'ri)" }
  return "boshqa dastur"
}

# Buzilgan protokol yozuvini o'zi tuzatadi. VBS endi ishlatilmaydi, shuning
# uchun antivirus bloklaydigan .vbs fayl umuman yozilmaydi.
function Repair-Installation {
  if (-not (Test-Path -LiteralPath $InstalledScript)) { return }
  if (-not (Test-ProtocolRegistration)) {
    try {
      Install-Protocol
      Write-Log "Protokol tuzatildi"
    } catch {
      Write-Log "Protokol tuzatilmadi: $($_.Exception.GetType().Name): $($_.Exception.Message)"
      # Bloklangan kompyuterda har ochilishda bir xil ogohlantirish chiqmasin -
      # asosiy oyna baribir kod bilan ulash yo'lini tushuntiradi.
      if (-not (Test-Path -LiteralPath $ElevationSkipPath)) {
        Write-Host ""
        Write-Host "Bu kompyuterda avtomatik ochish bloklangan - bu xato emas." -ForegroundColor Yellow
        Write-Host "Saytda 'Kompyuterda ulash' tugmasi 6 xonali kod ko'rsatadi." -ForegroundColor Cyan
        Write-Host "Shu kodni quyida kiriting yoki ish stolidagi 'Uyushma bilan ulash' yorlig'ini oching." -ForegroundColor Cyan
        Write-Host "Batafsil: $GuideUrl" -ForegroundColor DarkGray
      }
    }
  }
}

# Muammoni aniqlash uchun hisobot fayli yaratadi. Maxfiy ma'lumot yozilmaydi.
function Invoke-Diagnose {
  Show-Header "UYUSHMA ULGICH - TASHXIS"
  Write-Host ""
  Write-Host "Kompyuter tekshirilmoqda, biroz kuting..." -ForegroundColor Cyan

  $lines = @()
  $lines += "Uyushma ulagich - tashxis hisoboti"
  $lines += "Sana: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  $lines += "Kompyuter: $env:COMPUTERNAME"
  $lines += "Skript versiyasi: $Version"
  try { $lines += "Windows: $((Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption)" } catch { $lines += "Windows: $([Environment]::OSVersion.VersionString)" }
  $lines += "PowerShell: $($PSVersionTable.PSVersion)"
  $lines += "64-bit tizim: $([Environment]::Is64BitOperatingSystem)"
  try { $lines += "ExecutionPolicy: $(Get-ExecutionPolicy)" } catch { }
  $lines += "Papka: $AppDir"
  try {
    $probe = Join-Path $AppDir "write-check.tmp"
    Set-Content -LiteralPath $probe -Value "ok" -Encoding ASCII -ErrorAction Stop
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    $lines += "Papkaga yozish: HA"
  } catch {
    $lines += "Papkaga yozish: YOQ ($($_.Exception.Message))"
  }
  $lines += "Ornatilgan skript: $(Test-Path -LiteralPath $InstalledScript)"
  if (Test-Path -LiteralPath $InstalledScript) {
    $installedVersion = [regex]::Match((Get-Content -LiteralPath $InstalledScript -Raw), '\$Version\s*=\s*"(\d+)"').Groups[1].Value
    $lines += "Ornatilgan versiya: $installedVersion"
  }
  $lines += "Protokol royxati togri: $(Test-ProtocolRegistration)"
  $lines += "Protokol usuli: $(Get-ProtocolMethod)"
  $lines += "Administrator ruxsati: $(if (Test-Path -LiteralPath $ElevationSkipPath) { 'berilmagan (registr bloklangan)' } else { 'kerak emas yoki berilgan' })"
  try {
    $lines += "Protokol buyrugi: $((Get-ItemProperty -Path 'HKCU:\Software\Classes\uyushma\shell\open\command' -ErrorAction Stop).'(default)')"
  } catch {
    $lines += "Protokol buyrugi: topilmadi"
  }

  $browser = Get-BrowserPath
  $lines += "Brauzer: $(if ($browser) { $browser } else { 'topilmadi' })"
  $lines += "E-IMZO porti 64443: $(if (Test-LocalPort 64443) { 'ochiq' } else { 'yopiq' })"

  $freePorts = @()
  foreach ($candidatePort in 9333..9345) {
    if (-not (Test-LocalPort $candidatePort)) { $freePorts += $candidatePort }
  }
  $lines += "Bosh portlar: $($freePorts -join ', ')"

  try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/local-connector/pairing/0000" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    $lines += "Server javobi: HTTP $([int]$response.StatusCode)"
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status) {
      $lines += "Server aloqasi: HA (HTTP $status - kutilgan 404)"
    } else {
      $lines += "Server aloqasi: YOQ ($($_.Exception.Message))"
    }
  }

  try {
    $remote = Invoke-WebRequest -Uri "$BaseUrl/uyushma-ulagich.ps1" -UseBasicParsing -TimeoutSec 15
    $remoteText = if ($remote.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($remote.Content) } else { [string]$remote.Content }
    $remoteVersion = [regex]::Match($remoteText, '\$Version\s*=\s*"(\d+)"').Groups[1].Value
    $lines += "Saytdagi versiya: $remoteVersion"
  } catch {
    $lines += "Saytdagi versiya: olinmadi ($($_.Exception.Message))"
  }

  $logFile = $script:LogPath
  if (-not $logFile) {
    $candidate = Join-Path $AppDir "ulagich.log"
    if (Test-Path -LiteralPath $candidate) { $logFile = $candidate }
  }
  if ($logFile -and (Test-Path -LiteralPath $logFile)) {
    $lines += ""
    $lines += "Log fayli: $logFile"
    $lines += "Oxirgi 15 qator:"
    $lines += @(Get-Content -LiteralPath $logFile -Tail 15 -ErrorAction SilentlyContinue)
  } else {
    $lines += "Log fayli: hali yaratilmagan"
  }

  $reportPath = Join-Path $AppDir "uyushma-tashxis.txt"
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllLines($reportPath, [string[]]$lines, $utf8)
    Write-Host ""
    Write-Host "Hisobot tayyor: $reportPath" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList ('/select,"' + $reportPath + '"')
  } catch {
    Write-Host "Hisobotni yozib bolmadi: $($_.Exception.Message)" -ForegroundColor Red
  }

  Write-Host ""
  Write-Host "Bu faylni yuboring yoki yo'riqnoma bilan solishtiring:" -ForegroundColor Cyan
  Write-Host $GuideUrl -ForegroundColor DarkGray
  Pause-Exit 0
}

function Install-Connector {
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

  if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {
    if ($PSCommandPath -ne $InstalledScript) {
      Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
    }
  }

  try {
    Install-Protocol
  } catch {
    Write-Log "Protokol yozilmadi: $($_.Exception.Message)"
  }

  $shortcutsCreated = $false
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

    $diag = $shell.CreateShortcut((Join-Path $desktop "Uyushma ulagich - tekshirish.lnk"))
    $diag.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $diag.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $InstalledScript + '" -Diagnose'
    $diag.WorkingDirectory = $AppDir
    $diag.IconLocation = "$env:SystemRoot\System32\shell32.dll,23"
    $diag.Description = "Uyushma ulagich: holatni tekshirish"
    $diag.Save()
    $shortcutsCreated = $true
  } catch { }

  # Yorliq (COM) bloklangan bo'lsa ham ish stolida oddiy .cmd fayl qoldiramiz.
  if (-not $shortcutsCreated) {
    try {
      $desktop = [Environment]::GetFolderPath("Desktop")
      $runCmd = "@echo off`r`n`"$PSExe`" -NoProfile -ExecutionPolicy Bypass -File `"$InstalledScript`"`r`npause`r`n"
      Write-TextFile (Join-Path $desktop "Uyushma bilan ulash.cmd") $runCmd
      $diagCmd = "@echo off`r`n`"$PSExe`" -NoProfile -ExecutionPolicy Bypass -File `"$InstalledScript`" -Diagnose`r`npause`r`n"
      Write-TextFile (Join-Path $desktop "Uyushma ulagich - tekshirish.cmd") $diagCmd
      Write-Log "Ish stoliga .cmd fayllar yozildi"
    } catch {
      Write-Log "Ish stoliga yorliq yozilmadi: $($_.Exception.Message)"
    }
  }

  Set-Content -LiteralPath $MarkerPath -Value $Version -Encoding ASCII
}

# Protokol orqali kelgan havola (uyushma://connect/123456 yoki uyushma://diagnose).
# v12 dan boshlab Windows havolani to'g'ridan-to'g'ri PowerShell'ga beradi.
if ($Uri) {
  $Uri = ([string]$Uri).Trim().Trim('"')
  if ($Uri -match '(?i)diagnose') {
    $Diagnose = $true
  } elseif (-not $Code) {
    $digits = ($Uri -replace '[^0-9]', '')
    if ($digits.Length -ge 4) { $Code = $digits }
  }
}

if ($Code -and $Code -notmatch '^[0-9]{4,12}$') {
  $digits = ($Code -replace '[^0-9]', '')
  if ($digits.Length -ge 4) { $Code = $digits }
}

# O'rnatilgan nusxa eskirgan bo'lsa, serverdagi yangi versiyaga o'tadi.
Update-SelfIfNeeded

# Protokol va papkalarni har safar tekshirib, buzilganini tuzatamiz.
Repair-Installation

if ($Diagnose) { Invoke-Diagnose }

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
    if ($script:ProtocolFailed) {
      Write-Host ""
      Write-Host "Bu kompyuter Windows registrga yozishni bloklaydi." -ForegroundColor Yellow
      Write-Host "Muammo emas: ulagich kod bilan ishlaydi." -ForegroundColor Green
      Write-Host ""
      Write-Host "  1) Saytda 'Kompyuterda ulash' tugmasini bosing - 6 xonali kod chiqadi." -ForegroundColor Cyan
      Write-Host "  2) Shu kodni quyida kiriting." -ForegroundColor Cyan
      Write-Host "Keyingi safar: ish stolidagi 'Uyushma bilan ulash' yorlig'ini oching." -ForegroundColor Cyan
      Write-Host ""
      $entered = Read-Host "6 xonali kod (saytni ochish uchun bo'sh qoldiring)"
      $entered = ([string]$entered).Trim()
      if (-not $entered) {
        Start-Process $SettingsUrl
        exit 0
      }
      $Code = $entered
    } else {
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
  if ($script:ProtocolFailed) {
    Write-Host "Bu kompyuter Windows registr yozuvini bloklaydi - bu xato emas." -ForegroundColor Yellow
    Write-Host "Ulanish kod bilan amalga oshiriladi:" -ForegroundColor Cyan
    Write-Host "  1) Saytda 'Kompyuterda ulash' tugmasini bosing - 6 xonali kod chiqadi." -ForegroundColor Cyan
    Write-Host "  2) Shu kodni quyida kiriting." -ForegroundColor Cyan
  } else {
    Write-Host "Saytda 'Kompyuterda ulash' tugmasini bosing - Chrome o'zi ochiladi." -ForegroundColor Cyan
    Write-Host "Kod kiritish shart emas." -ForegroundColor Cyan
  }
  Write-Host ""
  Write-Host "Muammo bo'lsa: ish stolidagi 'Uyushma ulagich - tekshirish' yorlig'ini" -ForegroundColor DarkGray
  Write-Host "oching yoki quyidagi yo'riqnomani ko'ring:" -ForegroundColor DarkGray
  Write-Host $GuideUrl -ForegroundColor DarkGray
  Write-Host ""
  $entered = Read-Host "6 xonali kodni kiriting (saytni ochish uchun bo'sh qoldiring)"
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
  var jwtRegex = /eyJ[a-zA-Z0-9_-]+.[a-zA-Z0-9_-]+.[a-zA-Z0-9_-]+/;
  function grabJwt(s) {
    if (typeof s !== "string") return null;
    var m = s.match(jwtRegex);
    return m ? m[0] : null;
  }
  function cleanToken(s) {
    if (typeof s !== "string") return null;
    var str = s.replace(/^Bearer\s+/i, "").replace(/["'`]/g, "").trim();
    if (str.length < 20) return null;
    return str;
  }

  var stores = [];
  try { if (window.localStorage) stores.push(window.localStorage); } catch (e) {}
  try { if (window.sessionStorage) stores.push(window.sessionStorage); } catch (e) {}

  var token = null;
  var refreshToken = null;

  var preferred = [
    "access_token", "token", "auth_token", "jwt", "kc-token",
    "keycloak-token", "authToken", "accessToken", "state"
  ];

  for (var p = 0; p < preferred.length && !token; p++) {
    for (var s = 0; s < stores.length && !token; s++) {
      try {
        var rawVal = stores[s].getItem(preferred[p]);
        if (!rawVal) continue;
        var jwt = grabJwt(rawVal);
        if (jwt) { token = jwt; break; }
        if (rawVal.charCodeAt(0) === 123) {
          try {
            var parsed = JSON.parse(rawVal);
            if (parsed) {
              var inner = parsed.token || parsed.access_token || parsed.accessToken || (parsed.auth && (parsed.auth.token || parsed.auth.accessToken));
              if (inner && typeof inner === "string") {
                var innerJwt = grabJwt(inner) || cleanToken(inner);
                if (innerJwt) { token = innerJwt; break; }
              }
            }
          } catch (e) {}
        }
        var clean = cleanToken(rawVal);
        if (clean && !clean.startsWith("{") && !clean.startsWith("[")) {
          token = clean;
          break;
        }
      } catch (e) {}
    }
  }

  if (!token) {
    for (var s2 = 0; s2 < stores.length && !token; s2++) {
      var st = stores[s2];
      try {
        for (var i = 0; i < st.length && !token; i++) {
          var k = st.key(i);
          var v = null;
          try { v = st.getItem(k); } catch (e) { continue; }
          if (!v) continue;
          var foundJwt = grabJwt(v);
          if (foundJwt) { token = foundJwt; break; }
          if (k === "persist:root" || k === "state" || k === "vuex" || k === "auth") {
            try {
              var root = JSON.parse(v);
              for (var rk in root) {
                var rval = root[rk];
                if (typeof rval === "string" && rval.charCodeAt(0) === 123) {
                  try { rval = JSON.parse(rval); } catch (e) {}
                }
                if (rval && typeof rval === "object") {
                  var sub = rval.token || rval.access_token || rval.accessToken || rval.jwt;
                  if (sub && typeof sub === "string") {
                    var subJwt = grabJwt(sub) || cleanToken(sub);
                    if (subJwt) { token = subJwt; break; }
                  }
                }
              }
            } catch (e) {}
          }
          if (/token|jwt|auth/i.test(k) && typeof v === "string") {
            var candidate = cleanToken(v);
            if (candidate && !candidate.startsWith("{") && !candidate.startsWith("[")) {
              token = candidate;
              break;
            }
          }
        }
      } catch (e) {}
    }
  }

  if (!token) {
    try {
      var cookieMatch = document.cookie.match(/(?:access_token|token|auth_token|jwt)=([^;]+)/i);
      if (cookieMatch && cookieMatch[1]) {
        var cVal = decodeURIComponent(cookieMatch[1].trim());
        var cJwt = grabJwt(cVal) || cleanToken(cVal);
        if (cJwt) token = cJwt;
      }
    } catch (e) {}
  }

  try {
    var rawRt = window.localStorage.getItem("refresh_token") || window.localStorage.getItem("refreshToken");
    if (rawRt) {
      refreshToken = grabJwt(rawRt) || cleanToken(rawRt);
    }
  } catch (e) {}

  var profiles = [];
  try {
    var rawProfiles = window.localStorage.getItem("profiles");
    if (rawProfiles) {
      var list = JSON.parse(rawProfiles);
      if (Array.isArray(list)) {
        for (var j = 0; j < list.length; j++) {
          var item = list[j] || {};
          var pid = item.id || item.profileId;
          if (!pid) continue;
          profiles.push({
            id: String(pid),
            organizationName: item.organizationName ? String(item.organizationName) : null,
            companyName: item.companyName ? String(item.companyName) : null,
            fullName: item.fullName ? String(item.fullName) : null,
            tin: item.tin || item.inn ? String(item.tin || item.inn) : null
          });
        }
      }
    }
  } catch (e) {}

  var hasSelectedProfile = false;
  try {
    var sp = window.localStorage.getItem("selectedProfile");
    if (sp && sp !== "null" && sp !== "undefined" && sp.trim().length > 2) {
      hasSelectedProfile = true;
    }
  } catch (e) {}

  return JSON.stringify({
    token: token,
    refreshToken: refreshToken,
    profiles: profiles,
    selectedProfile: hasSelectedProfile,
    path: window.location.pathname,
    url: window.location.href
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
$authHosts = @("sso.egov.uz", "id.egov.uz", "my.soliq.uz", "soliq.uz", "e-imzo.uz", "dtransport.uz", "uztrans.uz")

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $targets = $null
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 3
    $misses = 0
  } catch {
    $misses++
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
        $hasToken = -not [string]::IsNullOrWhiteSpace($info.token)
        $hasSelectedProfile = [bool]$info.selectedProfile
        $isProfilePicker = ($pagePath -match "^/sign-in/profiles")

        # Faqat bir nechta korxona chiqsa, foydalanuvchi hali tanlamagan bo'lsa va
        # ayni paytda profil tanlash sahifasida turgan bo'lsa kutamiz.
        # Profil tanlangan yoki token mavjud bo'lsa - darhol qabul qilamiz!
        if ($profileList.Count -gt 1 -and -not $hasSelectedProfile -and $isProfilePicker -and -not $hasToken) {
          if (-not $selectionHint) {
            Write-Host ""
            Write-Host "Diqqat: hisobingizda bir nechta korxona bor." -ForegroundColor Yellow
            Write-Host "Oynada kerakli korxonani (masalan, CAR LUX) tanlab," -ForegroundColor Yellow
            Write-Host "'Davom etish' tugmasini bosing." -ForegroundColor Yellow
            $selectionHint = $true
          }
          continue
        }

        if ($hasToken) {
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
Write-Host "MUVAFFAQIYAT: $provider muvaffaqiyatli ulandi." -ForegroundColor Green
if ($result.account) { Write-Host "Hisob: $($result.account)" -ForegroundColor Green }

try {
  $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 3
  if ($version.webSocketDebuggerUrl) {
    Send-Cdp -wsUrl $version.webSocketDebuggerUrl -json '{"id":99,"method":"Browser.close"}' -expectValue $false | Out-Null
  }
} catch { }

Start-Sleep -Milliseconds 800
$remainingProcs = @(Get-ConnectorProcesses $profileDir)
foreach ($rp in $remainingProcs) {
  try { Stop-Process -Id $rp.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
}
try { if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } catch { }

Write-Host "Brauzer oynasi yopildi. Saytga qaytib, malumotlar sinxronlanishini kuzating." -ForegroundColor Green
Write-Host ""
