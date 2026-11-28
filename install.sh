#!/usr/bin/env bash
# ArrHub — install / upgrade on Debian or Ubuntu (e.g. inside a Proxmox LXC)
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/install.sh)"
#
# Running it again upgrades ArrHub and keeps the existing /opt/arrhub/config.json.
# Unattended: set the variables (PORT, ARRHUB_USER, ARRHUB_PASS, RADARR_URL, RADARR_KEY,
# SONARR_URL, SONARR_KEY, NZBGET_URL, NZBGET_USER, NZBGET_PASS, QBIT_URL, QBIT_USER, QBIT_PASS,
# SEERR_URL, SEERR_KEY, PROWLARR_URL, PROWLARR_KEY, BAZARR_URL, BAZARR_KEY, ARRHUB_LANG)
# and NONINTERACTIVE=1.
set -euo pipefail

REPO="${ARRHUB_REPO:-moordrak/arrhub}"
BRANCH="${ARRHUB_BRANCH:-main}"
APP_DIR="/opt/arrhub"
APP_USER="arrhub"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
msg()  { echo "${c_ok}==>${c_0} ${c_b}$*${c_0}"; }
warn() { echo "${c_warn}!!${c_0} $*"; }
die()  { echo "${c_err}ERROR:${c_0} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."
command -v apt-get >/dev/null || die "Only Debian and Ubuntu are supported."

INTERACTIVE=1
nl() { [[ $INTERACTIVE -eq 1 ]] && echo || true; }
[[ "${NONINTERACTIVE:-0}" == "1" || ! -t 0 ]] && INTERACTIVE=0

# ask VAR "Question" [default] [secret]
ask() {
  local var=$1 q=$2 def=${3:-} secret=${4:-} val
  [[ -n "${!var:-}" || $INTERACTIVE -eq 0 ]] && { printf -v "$var" '%s' "${!var:-$def}"; return; }
  if [[ -n $secret ]]; then read -rsp "  $q: " val; echo; else read -rp "  $q${def:+ [$def]}: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

# ---------- packages and Node.js ----------
msg "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar openssh-client >/dev/null

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if (( $(node_major) < 18 )); then
  apt-get install -y -qq nodejs >/dev/null 2>&1 || true
fi
if (( $(node_major) < 18 )); then
  msg "Installing Node.js 22 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
(( $(node_major) >= 18 )) || die "Node.js 18+ is not available."
msg "Node.js $(node -v)"

# ---------- source ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || echo /nonexistent)"
TMP=""
if [[ -f "$SCRIPT_DIR/server.js" && -d "$SCRIPT_DIR/public" ]]; then
  SRC="$SCRIPT_DIR"
  msg "Using local files from $SRC"
else
  msg "Downloading $REPO ($BRANCH)"
  TMP="$(mktemp -d)"; trap '[[ -n $TMP ]] && rm -rf "$TMP"' EXIT
  auth=(); [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$TMP" --strip-components=1 \
    || die "Download failed (set GITHUB_TOKEN for a private repository)."
  SRC="$TMP"
fi

# ---------- user and files ----------
id "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/public" "$APP_DIR/lib"
cp -r "$SRC/server.js" "$SRC/compose.js" "$SRC/package.json" "$SRC/lib" "$SRC/public" "$SRC/config.example.json" "$APP_DIR/"
mkdir -p "$APP_DIR/proxmox" && cp "$SRC/proxmox/arr-stack-lxc.sh" "$APP_DIR/proxmox/" 2>/dev/null || true
cp "$SRC"/README*.md "$APP_DIR/" 2>/dev/null || true

# ---------- configuration ----------
if [[ -f "$APP_DIR/config.json" ]]; then
  msg "Existing config.json kept"
else
  msg "Configuration (Enter = skip; everything can be changed later in ⚙ Settings)"
  ask PORT "Port" 8686
  ask ARRHUB_USER "ArrHub username (empty = no login)"
  [[ -n "${ARRHUB_USER:-}" ]] && ask ARRHUB_PASS "ArrHub password" "" secret
  nl; ask RADARR_URL "Radarr URL (e.g. http://192.168.1.10:7878)"
  [[ -n "${RADARR_URL:-}" ]] && ask RADARR_KEY "Radarr API key"
  nl; ask SONARR_URL "Sonarr URL (e.g. http://192.168.1.10:8989)"
  [[ -n "${SONARR_URL:-}" ]] && ask SONARR_KEY "Sonarr API key"
  nl; ask NZBGET_URL "NZBGet URL (e.g. http://192.168.1.10:6789)"
  [[ -n "${NZBGET_URL:-}" ]] && { ask NZBGET_USER "NZBGet username" nzbget; ask NZBGET_PASS "NZBGet password" "" secret; }
  nl; ask QBIT_URL "qBittorrent URL (e.g. http://192.168.1.10:8080)"
  [[ -n "${QBIT_URL:-}" ]] && { ask QBIT_USER "qBittorrent username" admin; ask QBIT_PASS "qBittorrent password" "" secret; }
  nl; ask SEERR_URL "Seerr URL (e.g. http://192.168.1.10:5055)"
  [[ -n "${SEERR_URL:-}" ]] && ask SEERR_KEY "Seerr API key"
  nl; ask PROWLARR_URL "Prowlarr URL (e.g. http://192.168.1.10:9696)"
  [[ -n "${PROWLARR_URL:-}" ]] && ask PROWLARR_KEY "Prowlarr API key"
  nl; ask BAZARR_URL "Bazarr URL (e.g. http://192.168.1.10:6767)"
  [[ -n "${BAZARR_URL:-}" ]] && ask BAZARR_KEY "Bazarr API key"

  export PORT ARRHUB_USER ARRHUB_PASS RADARR_URL RADARR_KEY SONARR_URL SONARR_KEY \
         NZBGET_URL NZBGET_USER NZBGET_PASS QBIT_URL QBIT_USER QBIT_PASS SEERR_URL SEERR_KEY PROWLARR_URL PROWLARR_KEY BAZARR_URL BAZARR_KEY ARRHUB_LANG
  node -e '
    const e = process.env, s = (u, o) => (u ? { url: u, ...o } : undefined);
    const cfg = {
      port: Number(e.PORT) || 8686,
      auth: { user: e.ARRHUB_USER || "", pass: e.ARRHUB_PASS || "" },
      radarr: s(e.RADARR_URL, { apiKey: e.RADARR_KEY || "" }),
      sonarr: s(e.SONARR_URL, { apiKey: e.SONARR_KEY || "" }),
      nzbget: s(e.NZBGET_URL, { user: e.NZBGET_USER || "", pass: e.NZBGET_PASS || "" }),
      qbittorrent: s(e.QBIT_URL, { user: e.QBIT_USER || "", pass: e.QBIT_PASS || "" }),
      seerr: s(e.SEERR_URL, { apiKey: e.SEERR_KEY || "" }),
      prowlarr: s(e.PROWLARR_URL, { apiKey: e.PROWLARR_KEY || "" }),
      bazarr: s(e.BAZARR_URL, { apiKey: e.BAZARR_KEY || "" }),
      ui: { lang: ["en", "hr", "auto"].includes(e.ARRHUB_LANG) ? e.ARRHUB_LANG : "en" },
    };
    require("fs").writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n");
  ' "$APP_DIR/config.json"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/config.json"

# ---------- systemd ----------
msg "Setting up the systemd service"
cat > /etc/systemd/system/arrhub.service <<EOF
[Unit]
Description=ArrHub dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
User=$APP_USER
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q arrhub
systemctl restart arrhub

PORT_NOW="$(node -p "require('$APP_DIR/config.json').port || 8686")"
for _ in {1..15}; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_NOW/api/config" || true)"
  [[ "$code" == "200" || "$code" == "401" ]] && break
  sleep 1
done
if [[ "$code" == "200" || "$code" == "401" ]]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  msg "ArrHub is running: http://${IP:-localhost}:$PORT_NOW"
  echo "   Settings:  in the UI (⚙ Settings) or $APP_DIR/config.json + systemctl restart arrhub"
  echo "   Logs:      journalctl -u arrhub -f"
  echo "   Upgrade:   run this script again"
else
  warn "The service is not responding. Check: journalctl -u arrhub -n 50"
  exit 1
fi
