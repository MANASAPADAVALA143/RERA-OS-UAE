@echo off
echo EstateCFO — Local demo mode (no Supabase)
start "EstateCFO API" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn main:app --reload --port 8001"
timeout /t 4 /nobreak >nul
start "EstateCFO Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo Backend:  http://localhost:8001
echo Frontend: http://localhost:5173  (or next free port shown in terminal)
echo.
echo Demo login: demo@estatecfo.com / demo1234
