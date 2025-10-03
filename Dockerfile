# Build frontend then serve with Flask
FROM node:18 AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/vite.config.js frontend/index.html frontend/src ./
RUN npm install
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/ ./backend/
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=5000
EXPOSE 5000
CMD ["gunicorn", "wsgi:app", "-b", "0.0.0.0:5000", "-w", "2"]
