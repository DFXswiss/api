#!/bin/bash
set -e

echo "=== DFX API Local Setup ==="

# Check prerequisites
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not installed"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not installed"
  exit 1
fi

# Start database
echo "📦 Starting database..."
docker-compose up -d

# Wait for db-init
echo "⏳ Waiting for database initialization..."
until docker-compose logs db-init 2>&1 | grep -q "Database 'dfx' ready"; do
  sleep 2
done
echo "✅ Database ready"

# Setup environment
if [ ! -f .env ]; then
  echo "📝 Creating .env from template..."
  cp .env.local.example .env
else
  echo "ℹ️  .env already exists, skipping"
fi

# Install dependencies
echo "📥 Installing dependencies..."
npm install

echo ""
echo "=== Setup complete ==="
echo "Run 'npm start' to start the dev server"
