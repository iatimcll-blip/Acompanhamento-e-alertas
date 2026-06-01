#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/painel-acionamentos}"
REPO_URL="${REPO_URL:-https://github.com/iatimcll-blip/Acompanhamento-e-alertas.git}"
BRANCH="${BRANCH:-master}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo nao encontrado. Execute em uma VM Ubuntu padrao com usuario ubuntu." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/deploy/oracle/controle.env.example" "$APP_DIR/.env"
  echo
  echo "Arquivo $APP_DIR/.env criado. Edite JWT_SECRET e senhas antes de iniciar em producao."
fi

cd "$APP_DIR"
sudo docker compose --env-file .env -f docker-compose.controle.yml up -d --build

echo
echo "Controle iniciado. Verifique com:"
echo "  sudo docker compose -f $APP_DIR/docker-compose.controle.yml logs -f"
echo "  curl http://127.0.0.1:3001/api/config"
