#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build GACP Mobile App for Android and iOS
.DESCRIPTION
    This script builds the mobile app using Capacitor
.PARAMETER Platform
    Target platform: android, ios, or both
.PARAMETER BuildType
    Build type: debug or release
.PARAMETER Sync
    Sync web assets before building
.EXAMPLE
    .\scripts\build-mobile.ps1 -Platform android
    .\scripts\build-mobile.ps1 -Platform ios -BuildType release
    .\scripts\build-mobile.ps1 -Platform both -Sync
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("android", "ios", "both")]
    [string]$Platform,
    
    [ValidateSet("debug", "release")]
    [string]$BuildType = "debug",
    
    [switch]$Sync
)

$ErrorActionPreference = "Stop"
$MobileAppDir = "apps/mobile-app"
$WebAppDir = "apps/web-app"

function Write-Header($text) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Test-Prerequisites {
    Write-Header "Checking Prerequisites"
    
    # Check Node.js
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Node.js not found" -ForegroundColor Red
        exit 1
    }
    
    # Check Capacitor CLI
    if (-not (Get-Command "npx" -ErrorAction SilentlyContinue)) {
        Write-Host "❌ npx not found" -ForegroundColor Red
        exit 1
    }
    
    # Check platform-specific requirements
    if ($Platform -eq "android" -or $Platform -eq "both") {
        if (-not ($env:ANDROID_SDK_ROOT -or $env:ANDROID_HOME)) {
            Write-Host "⚠️  ANDROID_SDK_ROOT not set" -ForegroundColor Yellow
            Write-Host "   Please install Android Studio and set ANDROID_SDK_ROOT" -ForegroundColor Gray
        }
    }
    
    if ($Platform -eq "ios" -or $Platform -eq "both") {
        if (-not (Get-Command "xcodebuild" -ErrorAction SilentlyContinue)) {
            Write-Host "⚠️  Xcode not found" -ForegroundColor Yellow
            Write-Host "   Please install Xcode for iOS builds" -ForegroundColor Gray
        }
    }
    
    Write-Host "✅ Prerequisites check complete" -ForegroundColor Green
}

function Build-WebAssets {
    Write-Header "Building Web Assets"
    
    Set-Location $WebAppDir
    
    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        npm install
    }
    
    # Build production
    Write-Host "Building Next.js app..." -ForegroundColor Yellow
    $env:NODE_ENV = "production"
    $env:NEXT_PUBLIC_IS_MOBILE = "true"
    npm run build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Web build failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Web assets built" -ForegroundColor Green
    Set-Location "../.."
}

function Sync-Capacitor {
    Write-Header "Syncing Capacitor"
    
    Set-Location $WebAppDir
    
    Write-Host "Syncing with Capacitor..." -ForegroundColor Yellow
    npx cap sync
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Capacitor sync failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Capacitor sync complete" -ForegroundColor Green
    Set-Location "../.."
}

function Build-Android {
    param([string]$Type = "debug")
    
    Write-Header "Building Android ($Type)"
    
    Set-Location "$MobileAppDir/android"
    
    if ($Type -eq "release") {
        # Check for signing config
        if (-not (Test-Path "release-key.jks")) {
            Write-Host "⚠️  No release keystore found. Creating debug build instead." -ForegroundColor Yellow
            .\gradlew.bat assembleDebug
        } else {
            .\gradlew.bat assembleRelease
        }
    } else {
        .\gradlew.bat assembleDebug
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Android build failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Android build complete" -ForegroundColor Green
    Write-Host "   Output: $MobileAppDir/android/app/build/outputs/apk/" -ForegroundColor Gray
    
    Set-Location "../.."
}

function Build-iOS {
    param([string]$Type = "debug")
    
    Write-Header "Building iOS ($Type)"
    
    # Check if running on macOS
    if ($env:OS -eq "Windows_NT") {
        Write-Host "❌ iOS builds require macOS" -ForegroundColor Red
        return
    }
    
    Set-Location "$MobileAppDir/ios"
    
    # Install pods if needed
    if (-not (Test-Path "Pods")) {
        Write-Host "Installing CocoaPods..." -ForegroundColor Yellow
        pod install
    }
    
    # Build
    if ($Type -eq "release") {
        xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' build
    } else {
        xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' build
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ iOS build failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ iOS build complete" -ForegroundColor Green
    Set-Location "../.."
}

function Open-IDE {
    param([string]$Platform)
    
    Write-Header "Opening IDE"
    
    Set-Location $WebAppDir
    
    if ($Platform -eq "android") {
        Write-Host "Opening Android Studio..." -ForegroundColor Yellow
        npx cap open android
    } elseif ($Platform -eq "ios") {
        Write-Host "Opening Xcode..." -ForegroundColor Yellow
        npx cap open ios
    }
    
    Set-Location "../.."
}

# Main execution
Write-Header "GACP Mobile Build Script"

Test-Prerequisites
Build-WebAssets

if ($Sync) {
    Sync-Capacitor
}

switch ($Platform) {
    "android" { 
        Build-Android -Type $BuildType
        Open-IDE -Platform "android"
    }
    "ios" { 
        Build-iOS -Type $BuildType
        Open-IDE -Platform "ios"
    }
    "both" {
        Build-Android -Type $BuildType
        if ($env:OS -ne "Windows_NT") {
            Build-iOS -Type $BuildType
        }
    }
}

Write-Header "Build Complete!"
Write-Host "📱 Next steps:" -ForegroundColor Cyan
if ($Platform -eq "android" -or $Platform -eq "both") {
    Write-Host "   Android: Install APK from $MobileAppDir/android/app/build/outputs/apk/" -ForegroundColor White
}
if (($Platform -eq "ios" -or $Platform -eq "both") -and $env:OS -ne "Windows_NT") {
    Write-Host "   iOS: Open Xcode and run on device/simulator" -ForegroundColor White
}
