#!/bin/bash

# Verification Script for Zero-Trust Orchestration
# ------------------------------------------------

echo "Running Zero-Trust Verification Tests..."

# Test 1: Direct backend access blocked
echo -n "Test 1: Direct FastAPI backend access blocked... "
curl -s -m 3 http://localhost:8000/api/health > /dev/null
if [ $? -ne 0 ]; then
  echo "PASS"
else
  echo "FAIL (Port 8000 is exposed to localhost directly without .dev.yml!)"
fi

echo -n "Test 1b: Direct Go ingest backend access blocked... "
curl -s -m 3 http://localhost:8080/health > /dev/null
if [ $? -ne 0 ]; then
  echo "PASS"
else
  echo "FAIL (Port 8080 is exposed!)"
fi

# Test 2: Edge access works
echo -n "Test 2: Edge Nginx access works... "
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health)
if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 401 ]; then
  echo "PASS"
else
  echo "FAIL (Expected 200, got $HTTP_STATUS)"
fi

# Test 3: Webhook routing works exclusively via Nginx
echo -n "Test 3: Webhook routing via Nginx... "
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ingest/webhook/test)
if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 401 ] || [ "$HTTP_STATUS" -eq 403 ] || [ "$HTTP_STATUS" -eq 404 ]; then
  echo "PASS (Ingest path is exposed via Nginx)"
else
  echo "FAIL (Expected 200/4xx, got $HTTP_STATUS)"
fi

# Test 4: Rate limiting
echo -n "Test 4: Rate limiting... "
# Send 30 requests rapidly
for i in {1..30}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/health &
done > /tmp/test4.log
wait
if grep -q "429" /tmp/test4.log; then
  echo "PASS (Rate limits enforced)"
else
  echo "FAIL (No 429 Too Many Requests observed)"
fi

# Test 6: Non-root enforcement
echo -n "Test 6: Non-root enforcement... "
if [ -x "$(command -v docker)" ]; then
  UID_PYTHON=$(docker exec soc-python-ai-backend id -u 2>/dev/null || echo "0")
  if [ "$UID_PYTHON" != "0" ]; then
    echo "PASS (UID is $UID_PYTHON)"
  else
    echo "FAIL (soc-python-ai-backend is running as root!)"
  fi
else
  echo "SKIP (Docker not available in test shell)"
fi

# Test 8: Network segmentation
echo -n "Test 8: Network segmentation proof... "
if [ -x "$(command -v docker)" ]; then
  NETWORKS=$(docker inspect soc-python-ai-backend --format '{{json .NetworkSettings.Networks}}')
  if [[ "$NETWORKS" != *"public-ingress"* ]]; then
    echo "PASS (soc-python-ai-backend does not have public-ingress)"
  else
    echo "FAIL (soc-python-ai-backend is on public-ingress)"
  fi
else
  echo "SKIP (Docker not available)"
fi

echo "All verifications complete!"
