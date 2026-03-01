#!/bin/bash
# Oracle Cloud VM Setup Script for Social Post Downloader API
# Run this on a fresh Ubuntu 22.04 VM:
#   chmod +x oracle-setup.sh && ./oracle-setup.sh

set -e
echo "=== Social Post Downloader API — Oracle Cloud Setup ==="

# ── 1. System updates ─────────────────────────────────────────────────────────
echo "[1/7] Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y

# ── 2. Install Node.js 22 ─────────────────────────────────────────────────────
echo "[2/7] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# ── 3. Install ffmpeg and python3 ─────────────────────────────────────────────
echo "[3/7] Installing ffmpeg and python3..."
sudo apt-get install -y ffmpeg python3 python3-pip curl git

# ── 4. Install yt-dlp ─────────────────────────────────────────────────────────
echo "[4/7] Installing yt-dlp..."
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

# ── 5. Clone and build the app ────────────────────────────────────────────────
echo "[5/7] Cloning and building the app..."
cd /home/ubuntu
git clone https://github.com/AravindS-Wick/postDownloaderApi.git app
cd app
git checkout task-7-batch-download-metric-connect

npm install
npm run build
npm prune --omit=dev
npm rebuild better-sqlite3

mkdir -p /home/ubuntu/data/downloads /home/ubuntu/data/db

# ── 6. Create environment file ────────────────────────────────────────────────
echo "[6/7] Creating .env file..."
JWT_SECRET=$(node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(64).toString('base64'));")

cat > /home/ubuntu/app/.env << EOF
NODE_ENV=production
PORT=2500
JWT_SECRET=${JWT_SECRET}
FREEMIUM_ENABLED=false
DATA_DIR=/home/ubuntu/data
EOF

echo "Generated JWT_SECRET — save this if you need it:"
echo "${JWT_SECRET}"

# ── 7. Create systemd service (auto-start on reboot) ──────────────────────────
echo "[7/7] Setting up systemd service..."
sudo tee /etc/systemd/system/social-downloader.service > /dev/null << EOF
[Unit]
Description=Social Post Downloader API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/app
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=social-downloader
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable social-downloader
sudo systemctl start social-downloader

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Your API is running at: http://$(curl -s ifconfig.me):2500"
echo "Health check:           http://$(curl -s ifconfig.me):2500/health"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status social-downloader   # check status"
echo "  sudo systemctl restart social-downloader  # restart"
echo "  sudo journalctl -u social-downloader -f   # view logs"
echo ""
echo "To update the app later:"
echo "  cd /home/ubuntu/app && git pull && npm install && npm run build && sudo systemctl restart social-downloader"
