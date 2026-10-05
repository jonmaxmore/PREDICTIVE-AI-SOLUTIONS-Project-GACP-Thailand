@echo off
chcp 65001 >nul
echo ==========================================
echo   GACP Production Server Starter
echo ==========================================
echo.

:: Check if running from correct directory
if not exist "docker-compose.production.yml" (
    echo ERROR: Please run this script from project root directory
    pause
    exit /b 1
)

:: Stop any running development servers
echo [1/5] Stopping development servers...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM chrome.exe 2>nul

:: Stop any existing Docker containers
echo [2/5] Stopping existing containers...
docker-compose -f docker-compose.production.yml down 2>nul

:: Clean up old images (optional)
echo [3/5] Cleaning up old images...
docker rmi gacp-frontend gacp-backend 2>nul

:: Build and start production containers
echo [4/5] Building and starting production containers...
docker-compose -f docker-compose.production.yml up --build -d

:: Wait for services to start
echo [5/5] Waiting for services to be ready...
timeout /t 10 /nobreak >nul

:: Check health
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ==========================================
echo   Production servers started!
echo ==========================================
echo.
echo Access URLs:
echo   - Application: https://localhost (or your domain)
echo   - API: http://localhost/api
echo.
echo To view logs: docker-compose -f docker-compose.production.yml logs -f
echo To stop: docker-compose -f docker-compose.production.yml down
echo.
pause
