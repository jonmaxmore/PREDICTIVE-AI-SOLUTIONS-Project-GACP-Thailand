@echo off
echo [GACP] Starting Services...

echo [1/3] Attempting to start Database & Redis (Docker)...
docker-compose up -d db redis
IF %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Docker failed to start. Ensure Docker Desktop is running.
    echo [INFO] Usage: Make sure you have a local PostgreSQL running on port 5432 if Docker fails.
)

echo.
echo [2/3] Checking Backend Config...
cd apps/backend
IF NOT EXIST .env (
    echo [ERROR] .env file missing in apps/backend!
    pause
    exit /b 1
)

echo.
echo [3/3] Starting Backend Server...
echo [INFO] Use Ctrl+C to stop.
npm run dev
pause
