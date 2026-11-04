@echo off
chcp 65001 >nul
title AI Xingtu - Local Server
cd /d "%~dp0"
node "%~dp0scripts\start-dev.mjs"
echo.
echo Server stopped. Press any key to close this window.
pause >nul
