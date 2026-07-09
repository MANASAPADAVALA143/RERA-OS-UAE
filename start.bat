@echo off
echo Starting RERA OS Demo...

REM Kill anything already on ports 8000 and 5173
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do taskkill /F /PID %%a >nul 2>&1

REM Start backend (system Python, no venv)
start "RERA OS API" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --reload --port 8000"

REM Wait for backend to start
timeout /t 6 /nobreak >nul

REM Start frontend
start "RERA OS Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --port 5173"

timeout /t 5 /nobreak >nul

echo.
echo ============================================
echo  RERA OS Demo is ready!
echo ============================================
echo  Open:  http://localhost:5173
echo  Login: demo@reraos.demo / DemoRera2026!
echo ============================================

start "" "http://localhost:5173"
