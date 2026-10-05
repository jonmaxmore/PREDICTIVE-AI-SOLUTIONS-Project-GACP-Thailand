@echo off
chcp 65001 >nul
echo ==========================================
echo   GACP Development Server Starter
echo ==========================================
echo.

:: Check if running from correct directory
if not exist "apps\backend\package.json" (
    echo ERROR: Please run this script from project root directory
    pause
    exit /b 1
)

:: Start Backend
echo [1/3] Starting Backend Server...
start "Backend Server" cmd /k "cd apps\backend && npm run dev"

:: Wait for backend to start
timeout /t 5 /nobreak >nul

:: Start Frontend
echo [2/3] Starting Frontend Server...
start "Frontend Server" cmd /k "cd apps\web-app && npm run dev"

:: Wait for frontend
timeout /t 5 /nobreak >nul

echo.
echo ==========================================
echo   Servers Starting...
echo ==========================================
echo.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:5000
echo.
echo Wait 10 seconds then open browser...
timeout /t 10 /nobreak >nul

:: Open browser
echo [3/3] Opening browser...
start http://localhost:3000
start http://localhost:5000/api/health

echo.
echo ==========================================
echo   All servers started!
echo ==========================================
echo.
pause
