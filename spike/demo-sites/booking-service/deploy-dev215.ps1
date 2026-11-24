# Deployment script for booking-service demo to dev-215 (192.168.5.215)

$HOST = "192.168.5.215"
$PORT = "4520"
$SITE_NAME = "booking-demo"
$SITE_DIR = "/home/stephen/sites/${SITE_NAME}"
$IMAGE_NAME = "astro-cms/site:booking-demo"

Write-Host "=== Deploying Booking Demo to dev-215 ===" -ForegroundColor Cyan
Write-Host "Host: ${HOST}"
Write-Host "Port: ${PORT}"
Write-Host "Site: ${SITE_NAME}"
Write-Host "Image: ${IMAGE_NAME}"

# Step 1: Build the booking plugin
Write-Host "Building booking plugin..." -ForegroundColor Yellow
Set-Location "C:\Users\steph\Documents\development\astro-cms\spike\emdash-site\plugins\booking-plugin"
& pnpm install
& pnpm run build

# Step 2: Build the demo site image
Write-Host "Building demo site image..." -ForegroundColor Yellow
Set-Location "C:\Users\steph\Documents\development\astro-cms\spike\demo-sites\booking-service"

$dockerfile = @"
FROM node:24-bookworm-slim

WORKDIR /app

# Install postgres client and ca-certificates
RUN apt-get update && apt-get install -y postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY astro.config.mjs ./
COPY seed/ ./seed/
COPY src/ ./src/

# Install dependencies
RUN npm install

# Build the site
RUN npm run build

# Expose port
EXPOSE ${PORT}

# Start the site
CMD ["npm", "run", "start"]
"@

$dockerfile | Out-File -FilePath "Dockerfile" -Encoding utf8

docker build -t ${IMAGE_NAME} .

# Step 3: Create site directory on dev-215
Write-Host "Creating site directory on dev-215..." -ForegroundColor Yellow
ssh stephen@${HOST} "mkdir -p ${SITE_DIR}"

# Step 4: Create compose file on dev-215
Write-Host "Creating compose file..." -ForegroundColor Yellow
$composeYaml = @"
version: '3.8'

services:
  booking-demo:
    image: ${IMAGE_NAME}
    ports:
      - '${PORT}:4321'
    environment:
      - DATABASE_URL=postgresql://emdash:emdash@postgres:5432/emdash_booking
      - UPLOADS_DIR=/app/uploads
      - HOST=0.0.0.0
      - PORT=4321
    volumes:
      - ./uploads:/app/uploads
    depends_on:
      - postgres

  postgres:
    image: postgres:17
    environment:
      - POSTGRES_USER=emdash
      - POSTGRES_PASSWORD=emdash
      - POSTGRES_DB=emdash_booking
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
"@

$composeYaml | Out-File -FilePath "${SITE_DIR}/compose.yaml" -Encoding utf8 -Force

# Step 5: Start the site on dev-215
Write-Host "Starting booking demo site..." -ForegroundColor Yellow
ssh stephen@${HOST} "cd ${SITE_DIR} && docker compose up -d --build"

Write-Host "=== Deployment complete ===" -ForegroundColor Green
Write-Host "Access the booking demo at: http://${HOST}:${PORT}" -ForegroundColor Green
Write-Host "Admin UI: http://${HOST}:${PORT}/_emdash/admin" -ForegroundColor Green
