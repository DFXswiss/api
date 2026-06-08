#!/bin/bash
set -e

echo "🚀 DFX API Local Development Setup"
echo "===================================="
echo ""

# Check prerequisites
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not installed. Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not installed. Please install Node.js LTS from https://nodejs.org"
  exit 1
fi

# Check if Docker is running, start if needed
if ! docker info &> /dev/null; then
  echo "❌ Docker is not running"
  echo ""

  # Try to start Docker automatically (macOS only)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "📦 Attempting to start Docker Desktop..."
    open -a Docker

    # Wait for Docker to start (max 60 seconds)
    echo "⏳ Waiting for Docker to start..."
    for i in {1..30}; do
      if docker info &> /dev/null; then
        echo "✅ Docker is ready"
        break
      fi
      if [ $i -eq 30 ]; then
        echo "❌ Docker failed to start within 60 seconds"
        echo "Please start Docker Desktop manually and run this script again"
        exit 1
      fi
      sleep 2
      echo -n "."
    done
  else
    # Linux/Windows - cannot auto-start
    echo "Please start Docker and run this script again:"
    echo ""
    echo "  Linux:   sudo systemctl start docker"
    echo "  Windows: Start Docker Desktop from Start Menu"
    echo ""
    exit 1
  fi
else
  echo "✅ Docker is running"
fi

# Install dependencies
if [ ! -d "node_modules" ]; then
  echo ""
  echo "📥 Installing npm dependencies..."
  npm install
else
  echo "✅ Dependencies already installed"
fi

# Setup environment
if [ ! -f .env ]; then
  echo ""
  echo "⚙️  Creating .env from template..."
  cp .env.local.example .env
  echo "✅ .env file created"
else
  echo "✅ .env file already exists"
fi

# Start database
echo ""
echo "🗄️  Starting database..."
docker compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
  if docker compose exec -T db pg_isready -U sa -d dfx &> /dev/null; then
    echo "✅ Database ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Database failed to become ready within 60 seconds"
    echo "Run 'docker compose logs' to see what went wrong"
    exit 1
  fi
  sleep 2
  echo -n "."
done

# Seed test data
echo ""
echo "🌱 Seeding test data..."
if [ -f "scripts/testdata.js" ]; then
  node scripts/testdata.js
  echo "✅ Test data seeded"
else
  echo "⚠️  testdata.js not found, skipping"
fi

echo ""
echo "🔐 Seeding KYC test data..."
if [ -f "scripts/kyc/kyc-testdata.js" ]; then
  node scripts/kyc/kyc-testdata.js
  echo "✅ KYC test data seeded"
else
  echo "⚠️  kyc-testdata.js not found, skipping"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 To start the API server, run:"
echo "   npm start"
echo ""
echo "📝 The server will be available at: http://localhost:3000"
echo "📝 All external services are automatically mocked in local mode"
echo ""
echo "📁 To upload KYC files (after API is running), run:"
echo "   ./scripts/kyc/upload-kyc-files.sh"
echo ""
