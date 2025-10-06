# DME CDFA Tool

Full-stack app: React frontend + Flask backend. Computes CDFA DIST/ALT and ROD tables.

## Run locally (Docker)
1. Build:
   docker build -t dme-cdfa-tool .
2. Run:
   docker run -p 5000:5000 dme-cdfa-tool

Frontend dev:
- cd frontend
- npm install
- npm run dev
(Proxy configured to /api -> localhost:5000)

Backend:
- cd backend
- python -m venv venv
- source venv/bin/activate
- pip install -r requirements.txt
- FLASK_APP=app.py flask run --host=0.0.0.0 --port=5000

## Deploy
Push repo to GitHub, create Render Web Service using Dockerfile and connect the repo (Render will build & deploy).
