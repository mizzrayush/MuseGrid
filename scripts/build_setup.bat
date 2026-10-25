@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo Building MuseGrid Native Complete Setup (WASM + JUCE + AI Models)
echo ========================================================

echo.
echo [1/4] Compiling AssemblyScript Audio DSP to WASM...
call npm run build:wasm
if %errorlevel% neq 0 (
    echo Error: WASM compilation failed.
    exit /b %errorlevel%
)

echo.
echo [2/4] Building Vite Frontend Bundle (Monaco, Tone.js, AI Models)...
call npx vite build
if %errorlevel% neq 0 (
    echo Error: Vite bundle build failed.
    exit /b %errorlevel%
)

echo.
echo [3/4] Building JUCE 8 Native Standalone Executable...
call scripts\build_native.bat
if %errorlevel% neq 0 (
    echo Error: Native build failed.
    exit /b %errorlevel%
)

echo.
echo [4/4] Creating Native Windows Setup Installer with Inno Setup...
if not exist "release" mkdir "release"

set "ISCC_EXE=ISCC.exe"
if exist "C:\ProgramData\chocolatey\bin\ISCC.exe" (
    set "ISCC_EXE=C:\ProgramData\chocolatey\bin\ISCC.exe"
)
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC_EXE=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC_EXE=C:\Program Files\Inno Setup 6\ISCC.exe"
)

echo Using Inno Setup Compiler: %ISCC_EXE%
"%ISCC_EXE%" installer\MuseGrid.iss
if %errorlevel% neq 0 (
    echo Error: Inno Setup compilation failed.
    exit /b %errorlevel%
)

echo.
echo ========================================================
echo Setup build complete!
echo Output: release\MuseGrid-Native-Setup-1.1.0.exe
echo ========================================================
