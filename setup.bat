@echo off
echo ===================================================
echo Setting up DubParty - Local AI Movie Re-Dubbing Game
echo ===================================================

echo.
echo [1/3] Creating Python Virtual Environment...
python -m venv venv

echo.
echo [2/3] Activating environment and installing dependencies...
call venv\Scripts\activate
pip install -r backend\requirements.txt

echo.
echo [3/3] Setup complete!
echo ===================================================
echo To start the server, run the following commands:
echo call venv\Scripts\activate
echo cd backend\app
echo uvicorn main:app --host 0.0.0.0 --port 8000 --reload
echo ===================================================
pause
