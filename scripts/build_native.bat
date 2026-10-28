@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo Building MuseGrid Native JUCE 8 C++ Binary
echo ========================================================

call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if %errorlevel% neq 0 (
    echo Error: Failed to initialize MSVC environment.
    exit /b %errorlevel%
)

ninja -C native/build
if %errorlevel% neq 0 (
    echo Error: Ninja compilation failed.
    exit /b %errorlevel%
)

echo Syncing native executable and assets to bin/...
if not exist "bin" mkdir "bin"
if not exist "bin\dist" mkdir "bin\dist"
if not exist "bin\public" mkdir "bin\public"

copy /Y "native\build\MuseGrid_artefacts\Release\MuseGrid.exe" "bin\MuseGrid.exe" >nul
xcopy /E /I /Y "dist\*" "bin\dist\" >nul
xcopy /E /I /Y "public\*" "bin\public\" >nul
copy /Y "assets\icon.ico" "bin\icon.ico" >nul

echo ========================================================
echo Build complete: bin\MuseGrid.exe (JUCE 8 Standalone)
echo ========================================================
