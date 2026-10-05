@echo off
REM ===================================
REM Database Cleanup Tool - Windows
REM ===================================

echo.
echo ====================================
echo   GACP Database Cleanup Tool
echo ====================================
echo.

if "%1"=="" goto show_menu
if "%1"=="--help" goto show_help
if "%1"=="-h" goto show_help

REM Execute with parameter
cd /d "%~dp0.."
node scripts\database-cleanup.js %*
goto end

:show_menu
echo Select cleanup mode:
echo.
echo 1. Dry Run (Preview only - Safe)
echo 2. Execute Basic Cleanup
echo 3. Execute Deep Cleanup
echo 4. Show Help
echo 5. Exit
echo.
set /p choice="Enter your choice (1-5): "

if "%choice%"=="1" goto dry_run
if "%choice%"=="2" goto execute
if "%choice%"=="3" goto deep
if "%choice%"=="4" goto show_help
if "%choice%"=="5" goto end
goto show_menu

:dry_run
echo.
echo Running in DRY RUN mode (no changes will be made)...
cd /d "%~dp0.."
node scripts\database-cleanup.js --dry-run
goto end

:execute
echo.
echo WARNING: This will make actual changes to the database!
set /p confirm="Are you sure? (yes/no): "
if not "%confirm%"=="yes" (
    echo Cancelled.
    goto end
)
echo.
echo Executing cleanup...
cd /d "%~dp0.."
node scripts\database-cleanup.js --execute
goto end

:deep
echo.
echo WARNING: Deep cleanup will optimize and compact the database!
echo This may take several minutes.
set /p confirm="Are you sure? (yes/no): "
if not "%confirm%"=="yes" (
    echo Cancelled.
    goto end
)
echo.
echo Executing deep cleanup...
cd /d "%~dp0.."
node scripts\database-cleanup.js --execute --deep
goto end

:show_help
cd /d "%~dp0.."
node scripts\database-cleanup.js --help
goto end

:end
echo.
pause
