#!/usr/bin/env bash
# ArrHub — stvara Debian LXC na Proxmox VE hostu i instalira ArrHub u njega.
#
# Pokreni na Proxmox hostu kao root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/proxmox/arrhub-lxc.sh)"
#
# Sve postavke se mogu zadati varijablama i preskočiti pitanja, npr.:
#   CTID=120 CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 RADARR_URL=... RADARR_KEY=... bash arrhub-lxc.sh
set -euo pipefail

REPO="${ARRHUB_REPO:-moordrak/arrhub}"
BRANCH="${ARRHUB_BRANCH:-main}"

c_ok=$'\e[32m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
msg() { echo "${c_ok}==>${c_0} ${c_b}$*${c_0}"; }
die() { echo "${c_err}GREŠKA:${c_0} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Pokreni kao root na Proxmox hostu."
command -v pct >/dev/null && command -v pveam >/dev/null || die "Ovo nije Proxmox VE host."

INTERACTIVE=1
[[ "${NONINTERACTIVE:-0}" == "1" || ! -t 0 ]] && INTERACTIVE=0
ask() {
  local var=$1 q=$2 def=${3:-} secret=${4:-} val
  [[ -n "${!var:-}" || $INTERACTIVE -eq 0 ]] && { printf -v "$var" '%s' "${!var:-$def}"; return; }
  if [[ -n $secret ]]; then read -rsp "  $q: " val; echo; else read -rp "  $q${def:+ [$def]}: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

echo
echo "${c_b}ArrHub — Proxmox LXC instalacija${c_0}"
echo

# ---------- postavke kontejnera ----------
msg "Kontejner"
ask CTID      "ID kontejnera" "$(pvesh get /cluster/nextid)"
pct status "$CTID" &>/dev/null && die "Kontejner $CTID već postoji."
ask CT_NAME   "Hostname" arrhub
ask CT_CORES  "CPU jezgre" 1
ask CT_RAM    "RAM (MB)" 512
ask CT_DISK   "Disk (GB)" 4
DEF_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
ask CT_STORAGE "Storage za disk ($(pvesm status -content rootdir 2>/dev/null | awk 'NR>1{printf "%s ", $1}'))" "${DEF_STORAGE:-local-lvm}"
DEF_TSTORE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
ask TPL_STORAGE "Storage za predloške" "${DEF_TSTORE:-local}"
ask CT_BRIDGE "Mrežni most" vmbr0
ask CT_VLAN   "VLAN tag (prazno = bez)"
ask CT_IP     "IP adresa s maskom ili dhcp (npr. 192.168.1.50/24)" dhcp
[[ "$CT_IP" != "dhcp" ]] && ask CT_GW "Gateway" "$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')"
ask CT_PASS   "Root lozinka kontejnera (prazno = samo 'pct enter')" "" secret

# ---------- postavke ArrHuba ----------
echo
msg "ArrHub (Enter = preskoči; sve se može kasnije urediti u ⚙ Postavke)"
ask PORT "Port" 8686
ask ARRHUB_USER "Korisničko ime za ArrHub (prazno = bez prijave)"
[[ -n "${ARRHUB_USER:-}" ]] && ask ARRHUB_PASS "Lozinka za ArrHub" "" secret
ask RADARR_URL "Radarr URL (npr. http://192.168.1.10:7878)"
[[ -n "${RADARR_URL:-}" ]] && ask RADARR_KEY "Radarr API ključ"
ask SONARR_URL "Sonarr URL (npr. http://192.168.1.10:8989)"
[[ -n "${SONARR_URL:-}" ]] && ask SONARR_KEY "Sonarr API ključ"
ask NZBGET_URL "NZBGet URL (npr. http://192.168.1.10:6789)"
[[ -n "${NZBGET_URL:-}" ]] && { ask NZBGET_USER "NZBGet korisnik" nzbget; ask NZBGET_PASS "NZBGet lozinka" "" secret; }
ask QBIT_URL "qBittorrent URL (npr. http://192.168.1.10:8080)"
[[ -n "${QBIT_URL:-}" ]] && { ask QBIT_USER "qBittorrent korisnik" admin; ask QBIT_PASS "qBittorrent lozinka" "" secret; }
ask SEERR_URL "Seerr URL (npr. http://192.168.1.10:5055)"
[[ -n "${SEERR_URL:-}" ]] && ask SEERR_KEY "Seerr API ključ"
echo

# ---------- predložak ----------
msg "Tražim Debian predložak"
pveam update >/dev/null 2>&1 || true
PVE_MAJOR="$(pveversion 2>/dev/null | sed -n 's#^pve-manager/\([0-9]*\).*#\1#p')"
TPL=""
# Debian 13 tek od PVE 9, inače Debian 12
(( ${PVE_MAJOR:-0} >= 9 )) && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-13-standard' | sort -V | tail -1)"
[[ -z "$TPL" ]] && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard' | sort -V | tail -1)"
[[ -n "$TPL" ]] || die "Debian predložak nije pronađen (pveam available)."
if ! pveam list "$TPL_STORAGE" | grep -q "$TPL"; then
  msg "Preuzimam $TPL"
  pveam download "$TPL_STORAGE" "$TPL" >/dev/null
fi

# ---------- kontejner ----------
NET="name=eth0,bridge=$CT_BRIDGE"
[[ -n "${CT_VLAN:-}" ]] && NET+=",tag=$CT_VLAN"
if [[ "$CT_IP" == "dhcp" ]]; then NET+=",ip=dhcp"; else NET+=",ip=$CT_IP,gw=$CT_GW"; fi

msg "Stvaram LXC $CTID ($CT_NAME)"
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

msg "Čekam mrežu"
for i in {1..30}; do
  pct exec "$CTID" -- getent hosts deb.debian.org &>/dev/null && break
  (( i == 30 )) && die "Kontejner nema pristup internetu (provjeri bridge/IP/gateway/DNS)."
  sleep 2
done

# ---------- instalacija ----------
msg "Preuzimam ArrHub"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || echo /nonexistent)"
if [[ -f "$SCRIPT_DIR/server.js" && -f "$SCRIPT_DIR/install.sh" ]]; then
  cp -r "$SCRIPT_DIR/server.js" "$SCRIPT_DIR/public" "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/config.example.json" "$SCRIPT_DIR/README.md" "$TMP/"
else
  auth=(); [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$TMP" --strip-components=1 \
    || die "Preuzimanje s GitHuba nije uspjelo."
fi
tar cf "$TMP.tar" -C "$TMP" . && mv "$TMP.tar" "$TMP/src.tar"
pct exec "$CTID" -- mkdir -p /root/arrhub-src
pct push "$CTID" "$TMP/src.tar" /root/arrhub-src/src.tar
pct exec "$CTID" -- tar xf /root/arrhub-src/src.tar -C /root/arrhub-src

msg "Instaliram u kontejneru"
pct exec "$CTID" -- env NONINTERACTIVE=1 \
  PORT="$PORT" ARRHUB_USER="${ARRHUB_USER:-}" ARRHUB_PASS="${ARRHUB_PASS:-}" \
  RADARR_URL="${RADARR_URL:-}" RADARR_KEY="${RADARR_KEY:-}" \
  SONARR_URL="${SONARR_URL:-}" SONARR_KEY="${SONARR_KEY:-}" \
  NZBGET_URL="${NZBGET_URL:-}" NZBGET_USER="${NZBGET_USER:-}" NZBGET_PASS="${NZBGET_PASS:-}" \
  QBIT_URL="${QBIT_URL:-}" QBIT_USER="${QBIT_USER:-}" QBIT_PASS="${QBIT_PASS:-}" \
  SEERR_URL="${SEERR_URL:-}" SEERR_KEY="${SEERR_KEY:-}" \
  bash /root/arrhub-src/install.sh
pct exec "$CTID" -- rm -rf /root/arrhub-src

echo
msg "Gotovo! Kontejner $CTID ($CT_NAME)"
echo "   Nadogradnja: pct exec $CTID -- bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh)\""
echo "   Postavke: u sučelju ArrHuba (⚙ Postavke)"
