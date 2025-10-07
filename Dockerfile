# Dockerfile (root) — corrected
# Build frontend with Node, then serve with Flask in final stage
FROM node:18 AS build-frontend
WORKDIR /app/frontend

# Copy only package files first (enables Docker layer caching)
# note: package-lock.json may not exist; use wildcard so COPY won't fail
COPY frontend/package.json frontend/package-lock.json* ./

# Install dependencies (use npm install so no lockfile required)
RUN npm install

# Copy the rest of the frontend source
COPY frontend/ ./

# Build production assets
RUN npm run build

# -------------------------
# Final stage: Python server
# -------------------------
FROM python:3.11-slim
WORKDIR /app

# Copy backend folder into container
COPY backend/ ./backend/

# Copy built frontend from previous stage
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
# Install backend dependencies
RUN pip install --no-cache-dir -r requirements.txt

ENV PORT=5000
EXPOSE 5000

# Start gunicorn to serve the Flask app (wsgi.py expected to export 'app')
CMD ["gunicorn", "wsgi:app", "-b", "0.0.0.0:5000", "-w", "2"]


