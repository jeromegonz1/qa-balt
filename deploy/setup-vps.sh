#!/bin/bash
# ═══════════════════════════════════════════════════════════
# QA-BALT — Setup VPS complet
#
# Compatible : Ubuntu 22.04 / 24.04 / Debian 12
# Prérequis : accès root, 4GB RAM min
#
# Usage :
#   scp -r qa-balt/ root@votre-vps:/opt/
#   ssh root@votre-vps "bash /opt/qa-balt/deploy/setup-vps.sh"
# ═══════════════════════════════════════════════════════════
set -e

echo "═══════════════════════════════════════"
echo "  QA-BALT — Installation VPS"
echo "═══════════════════════════════════════"

# ─── 1. Dépendances système ───
echo "📦 Installation des dépendances système..."
apt-get update -qq
apt-get install -y -qq \
  curl \
  git \
  nginx \
  certbot \
  python3-certbot-nginx \
  xvfb \
  fonts-liberation \
  fonts-noto-color-emoji \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxss1 \
  libasound2 \
  openssl

# ─── 2. Node.js 22 LTS ───
echo "📦 Installation Node.js 22..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "   Node $(node -v) / npm $(npm -v)"

# ─── 3. Utilisateur qa-balt (pas root pour Chrome) ───
echo "👤 Création utilisateur qa-balt..."
if ! id qa-balt &>/dev/null; then
  useradd -r -m -d /opt/qa-balt -s /bin/bash qa-balt
fi
chown -R qa-balt:qa-balt /opt/qa-balt

# ─── 4. Installation des dépendances Node ───
echo "📦 Installation des dépendances Node..."
cd /opt/qa-balt
sudo -u qa-balt npm install --production

# ─── 5. Installation Playwright + Chromium ───
echo "🎭 Installation Playwright + Chromium..."
sudo -u qa-balt npx playwright install chromium
sudo -u qa-balt npx playwright install-deps chromium 2>/dev/null || true
# Fallback si install-deps échoue (besoin de root)
npx playwright install-deps chromium 2>/dev/null || true

# ─── 6. Fichier .env ───
if [ ! -f /opt/qa-balt/.env ]; then
  echo "📝 Création du fichier .env..."
  cp /opt/qa-balt/.env.example /opt/qa-balt/.env
  echo ""
  echo "⚠️  IMPORTANT: Éditer /opt/qa-balt/.env avec votre token ClickUp"
  echo "   nano /opt/qa-balt/.env"
  echo ""
fi

# ─── 7. Service systemd ───
echo "⚙️  Configuration du service systemd..."
cat > /etc/systemd/system/qa-balt.service << 'EOF'
[Unit]
Description=QA-BALT Webhook Server
After=network.target

[Service]
Type=simple
User=qa-balt
Group=qa-balt
WorkingDirectory=/opt/qa-balt
# Xvfb pour Chrome headed (GSAP a besoin d'un vrai rendu)
ExecStartPre=/usr/bin/bash -c 'Xvfb :99 -screen 0 1440x900x24 &'
Environment=DISPLAY=:99
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=10
# Limites
LimitNOFILE=65535
# Mémoire max 4GB (sécurité)
MemoryMax=4G

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable qa-balt

# ─── 8. Nginx reverse proxy ───
echo "🌐 Configuration Nginx..."
cat > /etc/nginx/sites-available/qa-balt << 'NGINX'
server {
    listen 80;
    server_name _; # Remplacer par votre domaine (ex: qa.azko.fr)

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Timeout long pour les QA qui prennent du temps
        proxy_read_timeout 600;
        proxy_send_timeout 600;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/qa-balt /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ─── 9. Démarrage ───
echo "🚀 Démarrage du service..."
systemctl start qa-balt
sleep 3

if systemctl is-active --quiet qa-balt; then
  echo ""
  echo "═══════════════════════════════════════"
  echo "  ✅ QA-BALT installé et démarré !"
  echo "═══════════════════════════════════════"
  echo ""
  echo "  Service : systemctl status qa-balt"
  echo "  Logs    : journalctl -u qa-balt -f"
  echo "  Config  : nano /opt/qa-balt/.env"
  echo ""
  echo "  Test    : curl http://localhost/health"
  echo ""
  echo "  HTTPS (optionnel) :"
  echo "    1. Pointer un domaine vers ce serveur (ex: qa.azko.fr)"
  echo "    2. Modifier server_name dans /etc/nginx/sites-available/qa-balt"
  echo "    3. certbot --nginx -d qa.azko.fr"
  echo ""
  echo "  ClickUp webhook URL :"
  echo "    https://qa.azko.fr/api/qa"
  echo ""
else
  echo "❌ Le service n'a pas démarré. Vérifier les logs :"
  echo "   journalctl -u qa-balt -n 50"
fi
