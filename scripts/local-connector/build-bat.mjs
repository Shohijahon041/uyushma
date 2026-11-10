import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = join(here, "uyushma-ulagich.ps1");
const target = join(root, "apps", "web", "public", "uyushma-ulagich.bat");
const targetPs1 = join(root, "apps", "web", "public", "uyushma-ulagich.ps1");

const script = readFileSync(source, "utf8").replace(/\r\n/g, "\n");

if (/[^\x09\x0a\x0d\x20-\x7e]/.test(script)) {
  throw new Error("uyushma-ulagich.ps1 faqat ASCII belgilardan iborat bo'lishi kerak");
}

const header = [
  "@echo off",
  "setlocal",
  "title Uyushma ulagich",
  'set "PS1=%TEMP%\\uyushma-ulagich.ps1"',
  "where powershell >nul 2>&1",
  "if errorlevel 1 (",
  "  echo Windows PowerShell topilmadi. Windows Update orqali yangilang.",
  "  pause",
  "  exit /b 1",
  ")",
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$p='%~f0'; $all=Get-Content -LiteralPath $p -Encoding UTF8; $i=[Array]::IndexOf($all,'::PS1_START'); if($i -lt 0 -or ($all.Length - $i) -lt 100){Write-Host 'Fayl buzilgan'; exit 2}; Set-Content -LiteralPath $env:TEMP\\uyushma-ulagich.ps1 -Value $all[($i+1)..($all.Length-1)] -Encoding UTF8\"",
  "if errorlevel 1 (",
  "  echo Faylni tayyorlab bolmadi. Uni qayta yuklab oling: https://uyushma.bmbrutto.uz",
  "  pause",
  "  exit /b 1",
  ")",
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"',
  "set \"RC=%ERRORLEVEL%\"",
  'del "%PS1%" >nul 2>&1',
  'if not "%RC%"=="0" pause',
  "exit /b %RC%",
  "",
  "::PS1_START",
  "",
].join("\r\n");

writeFileSync(target, header + script.replace(/\n/g, "\r\n"), "ascii");
writeFileSync(targetPs1, script.replace(/\n/g, "\r\n"), "ascii");
console.log(`Wrote ${target}`);
console.log(`Wrote ${targetPs1}`);
