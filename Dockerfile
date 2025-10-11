# Dockerfile — corrected (Option A)
# Build frontend with Node, then serve with Flask in final stage

############
# Build frontend
############
FROM node:18 AS build-frontend
WORKDIR /app/frontend

# Copy package files first for caching (package-lock optional)
COPY frontend/package.json frontend/package-lock.json* ./

# Install frontend deps (use --legacy-peer-deps in CI if needed,
# but local npm install here is fine)
RUN npm install

# Copy frontend source and build
COPY frontend/ ./
RUN npm run build


############
# Final stage: Python server
############
FROM python:3.11-slim
WORKDIR /app

# Install system packages required by OCR / image processing libs
# NOTE: replaced libgl1-mesa-glx (no candidate) with libgl1 and libgl1-mesa-dri
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    default-jre \
    pkg-config \
    poppler-utils \
    libpoppler-cpp-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    libtesseract-dev \
    libleptonica-dev \
    ghostscript \
    libjpeg-dev \
    zlib1g-dev \
    libgl1 \
    libgl1-mesa-dri \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend assets from the previous stage
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

# Install Python (backend) dependencies
WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt

ENV PORT=5000
EXPOSE 5000

# Run Gunicorn to serve the Flask app (wsgi.py -> app)
CMD ["gunicorn", "wsgi:app", "-b", "0.0.0.0:5000", "-w", "2"]
