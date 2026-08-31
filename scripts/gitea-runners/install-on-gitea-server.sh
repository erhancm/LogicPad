#!/usr/bin/env bash
# Install Gitea act_runner on the Gitea SERVER (Linux).
#
# Run on the machine that hosts Gitea (SSH), not on a developer PC.
# The runner talks to Gitea over the internal URL (localhost / docker network),
# so Cloudflare Access is not involved.
#
# Usage (on Gitea server as root or with sudo):
#   curl -fsSL .../install-on-gitea-server.sh | sudo bash
#   # or copy this repo and:
#   sudo GITEA_INTERNAL_URL=http://127.0.0.1:3000 bash scripts/gitea-runners/install-on-gitea-server.sh
#
# Before running:
#   1. Gitea Actions enabled ([actions] ENABLED=true in app.ini)
#   2. Registration token from Site Admin -> Actions -> Runners
#      or: GITEA_RUNNER_REGISTRATION_TOKEN=<token>

set -euo pipefail

GITEA_INTERNAL_URL="${GITEA_INTERNAL_URL:-http://127.0.0.1:3000}"
GITEA_INTERNAL_URL="${GITEA_INTERNAL_URL%/}"
RUNNER_ROOT="${GITEA_RUNNER_ROOT:-/opt/gitea-runners/logicpad}"
RUNNER_NAME="${GITEA_RUNNER_NAME:-logicpad-linux}"
ACT_VERSION="${ACT_RUNNER_VERSION:-0.2.12}"
# Labels for release.yml ubuntu-22.04 / ubuntu-latest jobs (host mode on this server)
RUNNER_LABELS="${GITEA_RUNNER_LABELS:-ubuntu-22.04:host,ubuntu-latest:host}"
RUNNER_USER="${GITEA_RUNNER_USER:-git}"

if [[ -z "${GITEA_RUNNER_REGISTRATION_TOKEN:-}" ]]; then
  echo "Set GITEA_RUNNER_REGISTRATION_TOKEN (Site Admin -> Actions -> Runners -> Create token)." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) ACT_URL="https://gitea.com/gitea/act_runner/releases/download/v${ACT_VERSION}/act_runner-${ACT_VERSION}-linux-amd64" ;;
  aarch64) ACT_URL="https://gitea.com/gitea/act_runner/releases/download/v${ACT_VERSION}/act_runner-${ACT_VERSION}-linux-arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

echo "Installing act_runner ${ACT_VERSION} for LogicPad releases..."
echo "  Gitea URL: ${GITEA_INTERNAL_URL}"
echo "  Runner root: ${RUNNER_ROOT}"
echo "  Labels: ${RUNNER_LABELS}"

apt-get update
apt-get install -y curl ca-certificates git \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev build-essential

id -u "$RUNNER_USER" >/dev/null 2>&1 || useradd --system --home "$RUNNER_ROOT" --shell /usr/sbin/nologin "$RUNNER_USER"
mkdir -p "$RUNNER_ROOT"
curl -fsSL "$ACT_URL" -o "${RUNNER_ROOT}/act_runner"
chmod +x "${RUNNER_ROOT}/act_runner"
chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_ROOT"

IFS=',' read -ra LABEL_ARRAY <<< "$RUNNER_LABELS"
{
  echo "log:"
  echo "  level: info"
  echo "runner:"
  echo "  file: .runner"
  echo "  capacity: 1"
  echo "  timeout: 3h"
  echo "  labels:"
  for label in "${LABEL_ARRAY[@]}"; do
    echo "    - \"${label// /}\""
  done
  echo "cache:"
  echo "  enabled: true"
  echo "host:"
  echo "  workdir_parent:"
} > "${RUNNER_ROOT}/config.yaml"
chown "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_ROOT}/config.yaml"

if [[ -f "${RUNNER_ROOT}/.runner" ]]; then
  echo "Already registered (${RUNNER_ROOT}/.runner exists). Remove it to re-register."
else
  sudo -u "$RUNNER_USER" env HOME="$RUNNER_ROOT" \
    "${RUNNER_ROOT}/act_runner" register --config "${RUNNER_ROOT}/config.yaml" --no-interactive \
    --instance "$GITEA_INTERNAL_URL" \
    --token "$GITEA_RUNNER_REGISTRATION_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS"
fi

cat > /etc/systemd/system/logicpad-gitea-runner.service <<EOF
[Unit]
Description=LogicPad Gitea Actions runner (linux)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_ROOT}
ExecStart=${RUNNER_ROOT}/act_runner daemon --config ${RUNNER_ROOT}/config.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now logicpad-gitea-runner.service
systemctl --no-pager status logicpad-gitea-runner.service

echo ""
echo "Linux runner installed. Verify: Site Admin -> Actions -> Runners"
echo "Re-push a v* tag to trigger .gitea/workflows/release.yml"
