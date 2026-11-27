#!/usr/bin/env bash
# ArrHub — creates a Debian LXC on a Proxmox VE host and installs ArrHub in it.
#
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/proxmox/arrhub-lxc.sh)"
#
# Every setting can be given as a variable to skip the questions, e.g.:
#   CTID=120 CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 RADARR_URL=... RADARR_KEY=... bash arrhub-lxc.sh
set -euo pipefail

REPO="${ARRHUB_REPO:-moordrak/arrhub}"
BRANCH="${ARRHUB_BRANCH:-main}"

c_ok=$'\e[32m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
msg() { echo "${c_ok}==>${c_0} ${c_b}$*${c_0}"; }
die() { echo "${c_err}ERROR:${c_0} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null || die "This is not a Proxmox VE host."

INTERACTIVE=1
[[ "${NONINTERACTIVE:-0}" == "1" || ! -t 0 ]] && INTERACTIVE=0
ask() {
  local var=$1 q=$2 def=${3:-} secret=${4:-} val
  [[ -n "${!var:-}" || $INTERACTIVE -eq 0 ]] && { printf -v "$var" '%s' "${!var:-$def}"; return; }
  if [[ -n $secret ]]; then read -rsp "  $q: " val; echo; else read -rp "  $q${def:+ [$def]}: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

echo
echo "${c_b}ArrHub — Proxmox LXC installer${c_0}"
echo

# ---------- container settings ----------
msg "Container"
ask CTID      "Container ID" "$(pvesh get /cluster/nextid)"
pct status "$CTID" &>/dev/null && die "Container $CTID already exists."
ask CT_NAME   "Hostname" arrhub
ask CT_CORES  "CPU cores" 1
ask CT_RAM    "RAM (MB)" 512
ask CT_DISK   "Disk (GB)" 4
DEF_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
ask CT_STORAGE "Disk storage ($(pvesm status -content rootdir 2>/dev/null | awk 'NR>1{printf "%s ", $1}'))" "${DEF_STORAGE:-local-lvm}"
DEF_TSTORE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
ask TPL_STORAGE "Template storage" "${DEF_TSTORE:-local}"
ask CT_BRIDGE "Network bridge" vmbr0
ask CT_VLAN   "VLAN tag (empty = none)"
ask CT_IP     "IP address with prefix or dhcp (e.g. 192.168.1.50/24)" dhcp
[[ "$CT_IP" != "dhcp" ]] && ask CT_GW "Gateway" "$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')"
ask CT_PASS   "Container root password (empty = 'pct enter' only)" "" secret

# ---------- ArrHub settings ----------
echo
msg "ArrHub (Enter = skip; everything can be changed later in ⚙ Settings)"
ask PORT "Port" 8686
ask ARRHUB_LANG "Language / Jezik (en, hr, auto)" en
ask ARRHUB_USER "ArrHub username (empty = no login)"
[[ -n "${ARRHUB_USER:-}" ]] && ask ARRHUB_PASS "ArrHub password" "" secret
ask RADARR_URL "Radarr URL (e.g. http://192.168.1.10:7878)"
[[ -n "${RADARR_URL:-}" ]] && ask RADARR_KEY "Radarr API key"
ask SONARR_URL "Sonarr URL (e.g. http://192.168.1.10:8989)"
[[ -n "${SONARR_URL:-}" ]] && ask SONARR_KEY "Sonarr API key"
ask NZBGET_URL "NZBGet URL (e.g. http://192.168.1.10:6789)"
[[ -n "${NZBGET_URL:-}" ]] && { ask NZBGET_USER "NZBGet username" nzbget; ask NZBGET_PASS "NZBGet password" "" secret; }
ask QBIT_URL "qBittorrent URL (e.g. http://192.168.1.10:8080)"
[[ -n "${QBIT_URL:-}" ]] && { ask QBIT_USER "qBittorrent username" admin; ask QBIT_PASS "qBittorrent password" "" secret; }
ask SEERR_URL "Seerr URL (e.g. http://192.168.1.10:5055)"
[[ -n "${SEERR_URL:-}" ]] && ask SEERR_KEY "Seerr API key"
ask PROWLARR_URL "Prowlarr URL (e.g. http://192.168.1.10:9696)"
[[ -n "${PROWLARR_URL:-}" ]] && ask PROWLARR_KEY "Prowlarr API key"
ask BAZARR_URL "Bazarr URL (e.g. http://192.168.1.10:6767)"
[[ -n "${BAZARR_URL:-}" ]] && ask BAZARR_KEY "Bazarr API key"
echo

# ---------- template ----------
msg "Looking for a Debian template"
pveam update >/dev/null 2>&1 || true
PVE_MAJOR="$(pveversion 2>/dev/null | sed -n 's#^pve-manager/\([0-9]*\).*#\1#p')"
TPL=""
# Debian 13 only on PVE 9+, otherwise Debian 12
(( ${PVE_MAJOR:-0} >= 9 )) && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-13-standard' | sort -V | tail -1)"
[[ -z "$TPL" ]] && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard' | sort -V | tail -1)"
[[ -n "$TPL" ]] || die "No Debian template found (pveam available)."
if ! pveam list "$TPL_STORAGE" | grep -q "$TPL"; then
  msg "Downloading $TPL"
  pveam download "$TPL_STORAGE" "$TPL" >/dev/null
fi

# ---------- container ----------
NET="name=eth0,bridge=$CT_BRIDGE"
[[ -n "${CT_VLAN:-}" ]] && NET+=",tag=$CT_VLAN"
if [[ "$CT_IP" == "dhcp" ]]; then NET+=",ip=dhcp"; else NET+=",ip=$CT_IP,gw=$CT_GW"; fi

msg "Creating LXC $CTID ($CT_NAME)"
args=(
  "$TPL_STORAGE:vztmpl/$TPL"
  --hostname "$CT_NAME" --cores "$CT_CORES" --memory "$CT_RAM" --swap 512
  --rootfs "$CT_STORAGE:$CT_DISK" --net0 "$NET"
  --unprivileged 1 --features nesting=1 --onboot 1
  --ostype debian --tags arrhub --description "ArrHub — https://github.com/$REPO"
)
[[ -n "${CT_PASS:-}" ]] && args+=(--password "$CT_PASS")
pct create "$CTID" "${args[@]}" >/dev/null
pct start "$CTID"

msg "Waiting for the network"
for i in {1..30}; do
  pct exec "$CTID" -- getent hosts deb.debian.org &>/dev/null && break
  (( i == 30 )) && die "The container has no internet access (check bridge/IP/gateway/DNS)."
  sleep 2
done

# ---------- installation ----------
msg "Downloading ArrHub"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || echo /nonexistent)"
if [[ -f "$SCRIPT_DIR/server.js" && -f "$SCRIPT_DIR/install.sh" ]]; then
  cp -r "$SCRIPT_DIR/server.js" "$SCRIPT_DIR/compose.js" "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/public" "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/config.example.json" "$SCRIPT_DIR/README.md" "$TMP/"
else
  auth=(); [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$TMP" --strip-components=1 \
    || die "Download from GitHub failed."
fi
tar cf "$TMP.tar" -C "$TMP" . && mv "$TMP.tar" "$TMP/src.tar"
pct exec "$CTID" -- mkdir -p /root/arrhub-src
pct push "$CTID" "$TMP/src.tar" /root/arrhub-src/src.tar
pct exec "$CTID" -- tar xf /root/arrhub-src/src.tar -C /root/arrhub-src

msg "Installing inside the container"
pct exec "$CTID" -- env NONINTERACTIVE=1 \
  PORT="$PORT" ARRHUB_LANG="${ARRHUB_LANG:-en}" ARRHUB_USER="${ARRHUB_USER:-}" ARRHUB_PASS="${ARRHUB_PASS:-}" \
  RADARR_URL="${RADARR_URL:-}" RADARR_KEY="${RADARR_KEY:-}" \
  SONARR_URL="${SONARR_URL:-}" SONARR_KEY="${SONARR_KEY:-}" \
  NZBGET_URL="${NZBGET_URL:-}" NZBGET_USER="${NZBGET_USER:-}" NZBGET_PASS="${NZBGET_PASS:-}" \
  QBIT_URL="${QBIT_URL:-}" QBIT_USER="${QBIT_USER:-}" QBIT_PASS="${QBIT_PASS:-}" \
  SEERR_URL="${SEERR_URL:-}" SEERR_KEY="${SEERR_KEY:-}" \
  PROWLARR_URL="${PROWLARR_URL:-}" PROWLARR_KEY="${PROWLARR_KEY:-}" BAZARR_URL="${BAZARR_URL:-}" BAZARR_KEY="${BAZARR_KEY:-}" \
  bash /root/arrhub-src/install.sh
pct exec "$CTID" -- rm -rf /root/arrhub-src

echo
msg "Done! Container $CTID ($CT_NAME)"
echo "   Upgrade:  pct exec $CTID -- bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh)\""
echo "   Settings: in the ArrHub UI (⚙ Settings)"
