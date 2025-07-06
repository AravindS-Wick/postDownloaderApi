#!/bin/bash

# Development setup script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🛠️  Setting up development environment...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo -e "${YELLOW}Please install Node.js 20 or later${NC}"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version is too old (${NODE_VERSION}). Please install Node.js 18 or later${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ npm version: $(npm -v)${NC}"

# Install dependencies
echo -e "${GREEN}📦 Installing dependencies...${NC}"
npm install

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}📝 Please edit .env file with your actual configuration${NC}"
fi

# Check if yt-dlp is installed
if ! command -v yt-dlp &> /dev/null; then
    echo -e "${YELLOW}⚠️  yt-dlp is not installed${NC}"
    echo -e "${YELLOW}Installing yt-dlp...${NC}"
    
    # Try to install yt-dlp using pip
    if command -v pip3 &> /dev/null; then
        pip3 install yt-dlp
    elif command -v pip &> /dev/null; then
        pip install yt-dlp
    else
        echo -e "${RED}❌ pip is not installed. Please install yt-dlp manually${NC}"
        echo -e "${YELLOW}Visit: https://github.com/yt-dlp/yt-dlp#installation${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ yt-dlp version: $(yt-dlp --version)${NC}"

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${YELLOW}⚠️  ffmpeg is not installed${NC}"
    echo -e "${YELLOW}Please install ffmpeg for video processing${NC}"
    
    # Provide installation instructions based on OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}On macOS: brew install ffmpeg${NC}"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo -e "${YELLOW}On Ubuntu/Debian: sudo apt install ffmpeg${NC}"
        echo -e "${YELLOW}On CentOS/RHEL: sudo yum install ffmpeg${NC}"
    fi
else
    echo -e "${GREEN}✅ ffmpeg is installed${NC}"
fi

# Create downloads directory
echo -e "${GREEN}📁 Creating downloads directory...${NC}"
mkdir -p downloads

# Run type checking
echo -e "${GREEN}🔍 Running type checking...${NC}"
npm run type-check

# Run linting
echo -e "${GREEN}🧹 Running linting...${NC}"
npm run lint

echo -e "${GREEN}✅ Development environment setup complete!${NC}"
echo -e "${YELLOW}📝 Next steps:${NC}"
echo -e "${YELLOW}1. Edit .env file with your API keys${NC}"
echo -e "${YELLOW}2. Run 'npm run dev' to start development server${NC}"
echo -e "${YELLOW}3. Visit http://localhost:2500 to test the API${NC}"
echo -e "${YELLOW}4. Visit http://localhost:2500/documentation for API docs${NC}"
