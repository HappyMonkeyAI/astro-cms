#!/bin/bash
# Combined deployment script for all demos to dev-215 (192.168.5.215)

set -e

HOST="192.168.5.215"

echo "=== Deploying All Demos to dev-215 ==="
echo "Host: ${HOST}"

# Deploy booking demo
echo ""
echo "=== Deploying Booking Demo ==="
cd /c/Users/steph/Documents/development/astro-cms/spike/demo-sites/booking-service
bash deploy-dev215.sh

# Deploy e-commerce demo
echo ""
echo "=== Deploying E-commerce Demo ==="
cd /c/Users/steph/Documents/development/astro-cms/spike/demo-sites/ecommerce-shop
bash deploy-dev215.sh

echo ""
echo "=== All Demos Deployed ==="
echo "Booking Demo: http://${HOST}:4520"
echo "E-commerce Demo: http://${HOST}:4521"
echo "Admin UI: http://${HOST}:4520/_emdash/admin and http://${HOST}:4521/_emdash/admin"
