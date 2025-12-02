#!/bin/bash

# Test script for Balance PDF endpoint
# Usage: ./test-balance-pdf.sh [API_URL]

API_URL="${1:-http://localhost:3000}"

# Test parameters
ADDRESS="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # Vitalik's address
BLOCKCHAIN="Ethereum"
CURRENCY="CHF"
DATE="2024-12-01"
LANGUAGE="DE"

echo "=== Balance PDF Test ==="
echo "API URL: $API_URL"
echo "Address: $ADDRESS"
echo "Blockchain: $BLOCKCHAIN"
echo "Currency: $CURRENCY"
echo "Date: $DATE"
echo "Language: $LANGUAGE"
echo ""

# Make request
echo "Making request to /balance/pdf..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$API_URL/balance/pdf?address=$ADDRESS&blockchain=$BLOCKCHAIN&currency=$CURRENCY&date=$DATE&language=$LANGUAGE")

# Extract HTTP code and body
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "Success! Response received."

  # Check if response contains pdfData
  if echo "$BODY" | grep -q '"pdfData"'; then
    echo "Response contains pdfData field."

    # Extract base64 and save to file
    PDF_BASE64=$(echo "$BODY" | sed 's/.*"pdfData":"\([^"]*\)".*/\1/')

    if [ -n "$PDF_BASE64" ] && [ "$PDF_BASE64" != "$BODY" ]; then
      echo "$PDF_BASE64" | base64 -d > /tmp/balance-report.pdf 2>/dev/null

      if [ -f /tmp/balance-report.pdf ] && [ -s /tmp/balance-report.pdf ]; then
        echo "PDF saved to: /tmp/balance-report.pdf"
        echo "PDF size: $(wc -c < /tmp/balance-report.pdf) bytes"

        # Try to open PDF on macOS
        if command -v open &> /dev/null; then
          echo ""
          echo "Opening PDF..."
          open /tmp/balance-report.pdf
        fi
      else
        echo "Failed to decode PDF"
      fi
    else
      echo "Could not extract base64 data"
      echo "Response preview: ${BODY:0:200}..."
    fi
  else
    echo "Response does not contain pdfData field"
    echo "Response: $BODY"
  fi
else
  echo "Error response:"
  echo "$BODY" | head -20
fi

echo ""
echo "=== Test Complete ==="
