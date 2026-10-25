# ClinicQueue - Start All Services
Write-Host "Starting ClinicQueue Services..." -ForegroundColor Cyan

# 1. Start Python AI Service
Write-Host "1. Starting AI Service (Port 8001)..."
Start-Process powershell -ArgumentList "-NoExit -Command `"cd ai-service; python -m uvicorn app.main:app --host 127.0.0.1 --port 8001`""

# 2. Start Node.js Integration API & Telegram Bot
Write-Host "2. Starting Node.js Integration API (Port 3000)..."
Start-Process powershell -ArgumentList "-NoExit -Command `"cd integration; npm run dev`""

# 3. Start React Frontend
Write-Host "3. Starting React Frontend (Port 5173)..."
Start-Process powershell -ArgumentList "-NoExit -Command `"cd frontend; npm run dev`""

Write-Host "All services launched in separate windows!" -ForegroundColor Green
Write-Host "Access the app at: http://localhost:5173" -ForegroundColor Yellow
