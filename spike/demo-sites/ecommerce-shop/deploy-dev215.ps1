# Deployment script for ecommerce-shop demo to dev-215 (192.168.5.215)

$HOST = "192.168.5.215"
$PORT = "4521"
$SITE_NAME = "ecommerce-demo"
$SITE_DIR = "/home/stephen/sites/${SITE_NAME}"
$IMAGE_NAME = "astro-cms/site:ecommerce-demo"

Write-Host "=== Deploying E-commerce Demo to dev-215 ===" -ForegroundColor Cyan
Write-Host "Host: ${HOST}"
Write-Host "Port: ${PORT}"
Write-Host "Site: ${SITE_NAME}"
Write-Host "Image: ${IMAGE_NAME}"

# Step 1: Create site directory on dev-215
Write-Host "Creating site directory on dev-215..." -ForegroundColor Yellow
ssh stephen@${HOST} "mkdir -p ${SITE_DIR}"

# Step 2: Create compose file on dev-215
Write-Host "Creating compose file..." -ForegroundColor Yellow
$composeYaml = @"
version: '3.8'

services:
  ecommerce-demo:
    image: ${IMAGE_NAME}
    ports:
      - '${PORT}:4321'
    environment:
      - DATABASE_URL=postgresql://emdash:emdash@postgres:5432/emdash_ecommerce
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
      - POSTGRES_DB=emdash_ecommerce
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
"@

$composeYaml | Out-File -FilePath "${SITE_DIR}/compose.yaml" -Encoding utf8 -Force

# Step 3: Start the site on dev-215
Write-Host "Starting e-commerce demo site..." -ForegroundColor Yellow
ssh stephen@${HOST} "cd ${SITE_DIR} && docker compose up -d --build"

Write-Host "=== Deployment complete ===" -ForegroundColor Green
Write-Host "Access the e-commerce demo at: http://${HOST}:${PORT}" -ForegroundColor Green
Write-Host "Admin UI: http://${HOST}:${PORT}/_emdash/admin" -ForegroundColor Green
