#!/bin/bash
set -e

echo "📁 DFX KYC File Uploader"
echo "========================"
echo ""

API_URL="${API_URL:-http://localhost:3000}"

# Check if API is running
echo "🔍 Checking if API is running at $API_URL..."
if ! curl -s "$API_URL/v1/health" > /dev/null 2>&1; then
  echo "❌ API is not running at $API_URL"
  echo ""
  echo "Please start the API first with:"
  echo "   npm start"
  echo ""
  echo "Then run this script again."
  exit 1
fi
echo "✅ API is running"
echo ""

# Run kyc-storage.js
echo "🗄️  Running kyc-storage.js..."
if [ -f "scripts/kyc/kyc-storage.js" ]; then
  node scripts/kyc/kyc-storage.js
  echo ""
else
  echo "⚠️  kyc-storage.js not found, skipping"
fi

# Run upload-kyc-files.js
echo "📤 Running upload-kyc-files.js..."
if [ -f "scripts/kyc/upload-kyc-files.js" ]; then
  node scripts/kyc/upload-kyc-files.js
  echo ""
else
  echo "⚠️  upload-kyc-files.js not found, skipping"
fi

echo ""
echo "✅ KYC file upload complete!"
echo ""
echo "⚠️  Note: Files are stored in memory and will be lost when the API restarts."
echo "    The API will return dummy images for missing files in local dev mode."
echo ""
