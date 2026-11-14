#!/usr/bin/env bash
# ArrHub — instalacija / nadogradnja na Debian ili Ubuntu (npr. unutar Proxmox LXC-a)
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/install.sh)"
#
# Ponovno pokretanje nadograđuje ArrHub i zadržava postojeći /opt/arrhub/config.json.
# Bez pitanja: postavi varijable (PORT, ARRHUB_USER, ARRHUB_PASS, RADARR_URL, RADARR_KEY,
# SONARR_URL, SONARR_KEY, NZBGET_URL, NZBGET_USER, NZBGET_PASS, QBIT_URL, QBIT_USER, QBIT_PASS)
# i NONINTERACTIVE=1.
set -euo pipefail

REPO="${ARRHUB_REPO:-moordrak/arrhub}"
BRANCH="${ARRHUB_BRANCH:-main}"
APP_DIR="/opt/arrhub"
APP_USER="arrhub"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
msg()  { echo "${c_ok}==>${c_0} ${c_b}$*${c_0}"; }
warn() { echo "${c_warn}!!${c_0} $*"; }
die()  { echo "${c_err}GREŠKA:${c_0} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Pokreni kao root."
command -v apt-get >/dev/null || die "Podržani su samo Debian i Ubuntu."

INTERACTIVE=1
nl() { [[ $INTERACTIVE -eq 1 ]] && echo || true; }
[[ "${NONINTERACTIVE:-0}" == "1" || ! -t 0 ]] && INTERACTIVE=0

# ask VAR "Pitanje" [zadano] [secret]
ask() {
  local var=$1 q=$2 def=${3:-} secret=${4:-} val
  [[ -n "${!var:-}" || $INTERACTIVE -eq 0 ]] && { printf -v "$var" '%s' "${!var:-$def}"; return; }
  if [[ -n $secret ]]; then read -rsp "  $q: " val; echo; else read -rp "  $q${def:+ [$def]}: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

# ---------- paketi i Node.js ----------
msg "Instaliram pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar >/dev/null

node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if (( $(node_major) < 18 )); then
  apt-get install -y -qq nodejs >/dev/null 2>&1 || true
fi
if (( $(node_major) < 18 )); then
  msg "Instaliram Node.js 22 iz NodeSourcea"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
(( $(node_major) >= 18 )) || die "Node.js 18+ nije dostupan."
msg "Node.js $(node -v)"

# ---------- izvorni kod ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || echo /nonexistent)"
TMP=""
if [[ -f "$SCRIPT_DIR/server.js" && -d "$SCRIPT_DIR/public" ]]; then
  SRC="$SCRIPT_DIR"
  msg "Koristim lokalne datoteke iz $SRC"
else
  msg "Preuzimam $REPO ($BRANCH)"
  TMP="$(mktemp -d)"; trap '[[ -n $TMP ]] && rm -rf "$TMP"' EXIT
  auth=(); [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$TMP" --strip-components=1 \
    || die "Preuzimanje nije uspjelo (za privatni repozitorij postavi GITHUB_TOKEN)."
  SRC="$TMP"
fi

# ---------- korisnik i datoteke ----------
id "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/public"
cp -r "$SRC/server.js" "$SRC/public" "$SRC/config.example.json" "$SRC/README.md" "$APP_DIR/"

# ---------- konfiguracija ----------
if [[ -f "$APP_DIR/config.json" ]]; then
  msg "Postojeći config.json je zadržan"
else
  msg "Konfiguracija (Enter = preskoči uslugu)"
  ask PORT "Port" 8686
  ask ARRHUB_USER "Korisničko ime za ArrHub (prazno = bez prijave)"
  [[ -n "${ARRHUB_USER:-}" ]] && ask ARRHUB_PASS "Lozinka za ArrHub" "" secret
  nl; ask RADARR_URL "Radarr URL (npr. http://192.168.1.10:7878)"
  [[ -n "${RADARR_URL:-}" ]] && ask RADARR_KEY "Radarr API ključ"
  nl; ask SONARR_URL "Sonarr URL (npr. http://192.168.1.10:8989)"
  [[ -n "${SONARR_URL:-}" ]] && ask SONARR_KEY "Sonarr API ključ"
  nl; ask NZBGET_URL "NZBGet URL (npr. http://192.168.1.10:6789)"
  [[ -n "${NZBGET_URL:-}" ]] && { ask NZBGET_USER "NZBGet korisnik" nzbget; ask NZBGET_PASS "NZBGet lozinka" "" secret; }
  nl; ask QBIT_URL "qBittorrent URL (npr. http://192.168.1.10:8080)"
  [[ -n "${QBIT_URL:-}" ]] && { ask QBIT_USER "qBittorrent korisnik" admin; ask QBIT_PASS "qBittorrent lozinka" "" secret; }

  export PORT ARRHUB_USER ARRHUB_PASS RADARR_URL RADARR_KEY SONARR_URL SONARR_KEY \
         NZBGET_URL NZBGET_USER NZBGET_PASS QBIT_URL QBIT_USER QBIT_PASS
  node -e '
    const e = process.env, s = (u, o) => (u ? { url: u, ...o } : undefined);
    const cfg = {
      port: Number(e.PORT) || 8686,
      auth: { user: e.ARRHUB_USER || "", pass: e.ARRHUB_PASS || "" },
      radarr: s(e.RADARR_URL, { apiKey: e.RADARR_KEY || "" }),
      sonarr: s(e.SONARR_URL, { apiKey: e.SONARR_KEY || "" }),
      nzbget: s(e.NZBGET_URL, { user: e.NZBGET_USER || "", pass: e.NZBGET_PASS || "" }),
      qbittorrent: s(e.QBIT_URL, { user: e.QBIT_USER || "", pass: e.QBIT_PASS || "" }),
    };
    require("fs").writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n");
  ' "$APP_DIR/config.json"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/config.json"

# ---------- systemd ----------
msg "Postavljam systemd servis"
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
  msg "ArrHub radi: http://${IP:-localhost}:$PORT_NOW"
  echo "   Konfiguracija: $APP_DIR/config.json  (nakon izmjene: systemctl restart arrhub)"
  echo "   Zapisi:        journalctl -u arrhub -f"
  echo "   Nadogradnja:   ponovno pokreni ovu skriptu"
else
  warn "Servis ne odgovara. Provjeri: journalctl -u arrhub -n 50"
  exit 1
fi
