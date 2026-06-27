@echo off
chcp 65001 >nul
title LeaveSystem
where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Vui long cai Node.js 22.5 tro len.
  pause
  exit /b 1
)
if not exist node_modules\mysql2 (
  echo Dang cai thu vien MySQL...
  call npm install
  if errorlevel 1 (
    echo Khong the cai thu vien. Vui long kiem tra ket noi Internet.
    pause
    exit /b 1
  )
)
if not exist .env (
  copy /Y .env.example .env >nul
  echo.
  echo Da tao file .env. Hay mo file nay va dien tai khoan MySQL, sau do chay lai.
  pause
  exit /b 0
)
echo Dang khoi dong LeaveSystem...
echo Mo trinh duyet tai: http://127.0.0.1:3000
echo Nhan Ctrl+C de dung website.
node server.js
pause
