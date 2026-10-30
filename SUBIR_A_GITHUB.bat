@echo off
title Subiendo IMPERION Security Bot a GitHub (imperion-security-bott)...
cd /d "C:\Users\tino\.gemini\antigravity\scratch\imperion-security-bot"
echo ========================================================
echo   SUBIENDO PROYECTO A GITHUB (imperion-security-bott)
echo ========================================================
echo.
echo Si se abre una ventana de GitHub, toca "Sign in with your browser"
echo.
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/valentinolucioni5-beep/imperion-security-bott.git
git add .
git commit -m "Imperion Security Bot + Dashboard completo v2.5" 2>nul
git push -u origin main
echo.
echo ========================================================
echo   LISTO! YA PODES CONECTARLO EN RENDER.COM
echo ========================================================
pause
