#!/usr/bin/env bash
# ArrHub — installs the arr stack on a Proxmox VE host, every app in its own LXC container:
#   Radarr, Sonarr, Prowlarr, Bazarr, NZBGet, qBittorrent, Seerr and ArrHub (already set up for all of them).
#
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/proxmox/arr-stack-lxc.sh)"
# or generate a copy with your settings in ArrHub → Tools and run that one.
#
# Every setting can be given as a variable (see "Settings" below) and is then only offered as the default;
# NONINTERACTIVE=1 skips all questions, e.g.:
#   APPS="radarr sonarr qbittorrent arrhub" NET_MODE=static IP_START=192.168.1.61/24 CT_GW=192.168.1.1 \
#   MEDIA_HOST_PATH=/tank/data NONINTERACTIVE=1 bash arr-stack-lxc.sh
#
# What every container gets: Debian 12/13, unprivileged, nesting, a "media" user (MEDIA_UID:MEDIA_GID, default 1000:1000),
# the shared media folder at /data (same layout as the Docker compose, so hardlinks work), your CA certificate if given.
set -Eeuo pipefail

# @@ARRHUB-PRESET@@

SCRIPT_VERSION="1.0"
REPO="${ARRHUB_REPO:-moordrak/arrhub}"
BRANCH="${ARRHUB_BRANCH:-main}"
LOG="${LOG:-/var/log/arr-stack-lxc.log}"

# ---------------------------------------------------------------- apps
ALL_APPS=(radarr sonarr prowlarr bazarr nzbget qbittorrent seerr arrhub)
declare -A NAME=([radarr]=Radarr [sonarr]=Sonarr [prowlarr]=Prowlarr [bazarr]=Bazarr [nzbget]=NZBGet [qbittorrent]=qBittorrent [seerr]=Seerr [arrhub]=ArrHub)
declare -A PORT=([radarr]=7878 [sonarr]=8989 [prowlarr]=9696 [bazarr]=6767 [nzbget]=6789 [qbittorrent]=8080 [seerr]=5055 [arrhub]=8686)
declare -A DESC=([radarr]="movies" [sonarr]="TV series" [prowlarr]="indexers" [bazarr]="subtitles" [nzbget]="Usenet downloader"
                 [qbittorrent]="torrent client" [seerr]="requests" [arrhub]="this dashboard, set up for the others")
# default resources: cores RAM(MB) disk(GB)
declare -A RES=([radarr]="2 1024 4" [sonarr]="2 1024 4" [prowlarr]="1 512 2" [bazarr]="1 1024 4" [nzbget]="2 1024 4"
                [qbittorrent]="2 1024 4" [seerr]="2 2048 8" [arrhub]="1 512 4")
# apps that get the shared media folder
declare -A MEDIA_APP=([radarr]=1 [sonarr]=1 [bazarr]=1 [nzbget]=1 [qbittorrent]=1)

# ---------------------------------------------------------------- output
c_ok=$'\e[32m'; c_err=$'\e[31m'; c_warn=$'\e[33m'; c_dim=$'\e[2m'; c_b=$'\e[1m'; c_acc=$'\e[38;5;75m'; c_0=$'\e[0m'
[[ -t 1 ]] || { c_ok=; c_err=; c_warn=; c_dim=; c_b=; c_acc=; c_0=; }
die()  { echo "${c_err}✗ ERROR:${c_0} $*" >&2; exit 1; }
warn() { echo "  ${c_warn}!${c_0} $*"; }
info() { echo "  ${c_dim}$*${c_0}"; }
head1() { echo; echo "${c_acc}${c_b}━━ $* ${c_0}"; }

SPIN='-\|/'; [[ "$(locale charmap 2>/dev/null)" == UTF-8 ]] && SPIN='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
# step "label" command… — runs the command with its output in $LOG, shows a spinner and ✓ / ✗
step() {
  local label=$1 rc=0 i=0 pid; shift
  echo "### $(date '+%F %T') $label" >>"$LOG"
  if [[ -t 1 ]]; then
    ( "$@" ) >>"$LOG" 2>&1 & pid=$!
    while kill -0 "$pid" 2>/dev/null; do printf '\r  %s %s' "${c_acc}${SPIN:i++%${#SPIN}:1}${c_0}" "$label"; sleep 0.12; done
    wait "$pid" || rc=$?
  else
    ( "$@" ) >>"$LOG" 2>&1 || rc=$?
  fi
  local cr='' el=''; [[ -t 1 ]] && cr=$'\r' el=$'\e[K'
  if (( rc == 0 )); then printf '%s  %s✓%s %s%s\n' "$cr" "$c_ok" "$c_0" "$label" "$el"
  else printf '%s  %s✗%s %s%s\n' "$cr" "$c_err" "$c_0" "$label" "$el"; tail -n 12 "$LOG" | sed "s/^/      ${c_dim}/;s/$/${c_0}/"; fi
  return $rc
}

# ---------------------------------------------------------------- checks
[[ $EUID -eq 0 ]] || die "Run as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null || die "This is not a Proxmox VE host."
: >>"$LOG" || die "Cannot write $LOG"

INTERACTIVE=1
[[ "${NONINTERACTIVE:-0}" == "1" || ! -t 0 ]] && INTERACTIVE=0
WT=0; (( INTERACTIVE )) && command -v whiptail >/dev/null && [[ "${NO_WHIPTAIL:-0}" != 1 ]] && WT=1
BT="ArrHub · arr stack → Proxmox LXC  v$SCRIPT_VERSION"

# ---------------------------------------------------------------- questions (whiptail, or plain prompts)
cancel() { clear 2>/dev/null || true; echo "Cancelled, nothing was changed."; exit 1; }
# ask VAR "title" "question" [secret]   – the current value of VAR is the default
ask() {
  local var=$1 title=$2 q=$3 secret=${4:-} val
  (( INTERACTIVE )) || return 0
  if (( WT )); then
    if [[ -n $secret ]]; then val=$(whiptail --backtitle "$BT" --title "$title" --passwordbox "$q" 11 72 3>&1 1>&2 2>&3) || cancel
    else val=$(whiptail --backtitle "$BT" --title "$title" --inputbox "$q" 11 72 "${!var:-}" 3>&1 1>&2 2>&3) || cancel; fi
  else
    if [[ -n $secret ]]; then read -rsp "  $q: " val; echo; else read -rp "  $q${!var:+ [${!var}]}: " val; val=${val:-${!var:-}}; fi
  fi
  printf -v "$var" '%s' "$val"
}
# yesno "title" "question" [default yes|no] → 0 = yes
yesno() {
  local def=${3:-yes} a
  if (( ! INTERACTIVE )); then [[ $def == yes ]]; return; fi
  if (( WT )); then
    local o=(); [[ $def == no ]] && o=(--defaultno)
    whiptail --backtitle "$BT" --title "$1" "${o[@]}" --yesno "$2" 14 74; return
  fi
  read -rp "  $2 [$([[ $def == yes ]] && echo Y/n || echo y/N)]: " a; a=${a:-$def}; [[ ${a,,} == y* ]]
}
# menu VAR "title" "question" tag desc …   – the current value is preselected
menu() {
  local var=$1 title=$2 q=$3 val; shift 3
  (( INTERACTIVE )) || return 0
  if (( WT )); then
    val=$(whiptail --backtitle "$BT" --title "$title" --default-item "${!var:-}" --menu "$q" 18 74 8 "$@" 3>&1 1>&2 2>&3) || cancel
  else
    local o=("$@") i; echo "  $q"; for ((i = 0; i < ${#o[@]}; i += 2)); do echo "     ${o[i]}  ${c_dim}${o[i+1]}${c_0}"; done
    read -rp "  > [${!var:-}]: " val; val=${val:-${!var:-}}
  fi
  printf -v "$var" '%s' "$val"
}
msgbox() { (( WT )) && whiptail --backtitle "$BT" --title "$1" --msgbox "$2" 16 76 || { (( INTERACTIVE )) && echo -e "  $2"; } || true; }

# ---------------------------------------------------------------- settings (defaults)
[[ -v APPS ]]            || APPS="${ALL_APPS[*]}"
[[ -v CTID_START ]]      || CTID_START="$(pvesh get /cluster/nextid 2>/dev/null || echo 200)"
[[ -v HOST_PREFIX ]]     || HOST_PREFIX=""
[[ -v CT_STORAGE ]]      || CT_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
[[ -v TPL_STORAGE ]]     || TPL_STORAGE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')"
[[ -v CT_BRIDGE ]]       || CT_BRIDGE=vmbr0
[[ -v CT_VLAN ]]         || CT_VLAN=""
[[ -v NET_MODE ]]        || NET_MODE=dhcp            # dhcp | static
[[ -v IP_START ]]        || IP_START=""              # static: first address with prefix, +1 for each next app
[[ -v CT_GW ]]           || CT_GW="$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')"
[[ -v CT_DNS ]]          || CT_DNS=""                # empty = the host's
[[ -v CT_DOMAIN ]]       || CT_DOMAIN=""             # search domain, e.g. int
[[ -v UNPRIVILEGED ]]    || UNPRIVILEGED=1
[[ -v ONBOOT ]]          || ONBOOT=1
[[ -v MEDIA_HOST_PATH ]] || MEDIA_HOST_PATH=""       # folder on the host, e.g. /tank/data or /mnt/pve/nas; empty = none
[[ -v MEDIA_CT_PATH ]]   || MEDIA_CT_PATH=/data
[[ -v MEDIA_UID ]]       || MEDIA_UID=1000
[[ -v MEDIA_GID ]]       || MEDIA_GID=1000
[[ -v MEDIA_DIRS ]]      || MEDIA_DIRS=1             # create torrents/ usenet/ media/ in the media folder
[[ -v CA_FILE ]]         || CA_FILE=""               # your own CA certificate (PEM) on the host, trusted in every container
[[ -v TZ_NAME ]]         || TZ_NAME="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo Europe/Zagreb)"
[[ -v CT_PASS ]]         || CT_PASS=""               # root password in the containers; empty = only 'pct enter'
[[ -v SSH_KEYS ]]        || SSH_KEYS=""              # authorized_keys file for root in the containers
[[ -v QBIT_USER ]]       || QBIT_USER=admin
[[ -v QBIT_PASS ]]       || QBIT_PASS=""             # empty = random
[[ -v NZBGET_USER ]]     || NZBGET_USER=nzbget
[[ -v NZBGET_PASS ]]     || NZBGET_PASS=""           # empty = random
[[ -v ARRHUB_USER ]]     || ARRHUB_USER=""
[[ -v ARRHUB_PASS ]]     || ARRHUB_PASS=""
[[ -v ARRHUB_LANG ]]     || ARRHUB_LANG=en
[[ -v PRESET ]]          || PRESET=0
for a in "${ALL_APPS[@]}"; do
  U=${a^^}; read -r c r d <<<"${RES[$a]}"
  v="CT_${U}_CORES"; [[ -v $v ]] || printf -v "$v" '%s' "$c"
  v="CT_${U}_RAM";   [[ -v $v ]] || printf -v "$v" '%s' "$r"
  v="CT_${U}_DISK";  [[ -v $v ]] || printf -v "$v" '%s' "$d"
done

rand() { tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "${1:-16}" || true; }
has_app() { [[ " $APPS " == *" $1 "* ]]; }
ip_add() { # 192.168.1.61/24 +2 → 192.168.1.63/24
  local ip=${1%/*} pre=${1#*/} n=$2 a b c d
  IFS=. read -r a b c d <<<"$ip"; local x=$(( (a << 24) + (b << 16) + (c << 8) + d + n ))
  echo "$(( (x >> 24) & 255 )).$(( (x >> 16) & 255 )).$(( (x >> 8) & 255 )).$(( x & 255 ))/$pre"
}
valid_cidr() { [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; }
free_ids() { # n start → n free CT/VM ids from start
  local n=$1 id=$2 out=()
  local used; used=" $(pvesh get /cluster/resources --type vm --output-format json 2>/dev/null | grep -o '"vmid":[0-9]*' | cut -d: -f2 | tr '\n' ' ') "
  while (( ${#out[@]} < n )); do [[ $used == *" $id "* ]] || pct status "$id" &>/dev/null || qm status "$id" &>/dev/null || out+=("$id"); ((id++)); done
  echo "${out[*]}"
}

summary_text() {
  local s="" i=0 a U id ip
  read -ra IDS <<<"$(free_ids "$(wc -w <<<"$APPS")" "$CTID_START")"
  s+="Apps:\n"
  for a in $APPS; do
    U=${a^^}; local vc="CT_${U}_CORES" vr="CT_${U}_RAM" vd="CT_${U}_DISK"
    if [[ $NET_MODE == static ]]; then ip=$(ip_add "$IP_START" $i); else ip=dhcp; fi
    s+="$(printf '  %-12s CT %-5s %-18s %sc / %sMB / %sGB' "${NAME[$a]}" "${IDS[$i]}" "$ip" "${!vc}" "${!vr}" "${!vd}")\n"
    ((i++)) || true
  done
  s+="\nStorage: ${CT_STORAGE}   templates: ${TPL_STORAGE}\n"
  s+="Network: ${CT_BRIDGE}${CT_VLAN:+ (VLAN $CT_VLAN)}, ${NET_MODE}${CT_GW:+, gw $CT_GW}${CT_DNS:+, dns $CT_DNS}${CT_DOMAIN:+, domain $CT_DOMAIN}\n"
  s+="Containers: $([[ $UNPRIVILEGED == 1 ]] && echo unprivileged || echo privileged), start on boot: $([[ $ONBOOT == 1 ]] && echo yes || echo no), TZ $TZ_NAME\n"
  s+="Media: ${MEDIA_HOST_PATH:-none}${MEDIA_HOST_PATH:+ → $MEDIA_CT_PATH (uid/gid $MEDIA_UID:$MEDIA_GID)}\n"
  [[ -n $CA_FILE ]] && s+="Own CA: $CA_FILE\n"
  echo -e "$s"
}

# ---------------------------------------------------------------- wizard
wizard() {
  local items=() a on
  for a in "${ALL_APPS[@]}"; do on=OFF; has_app "$a" && on=ON; items+=("$a" "${NAME[$a]} – ${DESC[$a]}" "$on"); done
  if (( WT )); then
    APPS=$(whiptail --backtitle "$BT" --title "Apps" --checklist "Which apps should get their own container?\n(space = select, Enter = continue)" 18 74 8 "${items[@]}" 3>&1 1>&2 2>&3) || cancel
    APPS=$(tr -d '"' <<<"$APPS")
  else
    echo "  Apps: ${ALL_APPS[*]}"; ask APPS "Apps" "Apps to install (space separated)"
  fi
  [[ -n ${APPS// } ]] || die "No app selected."

  # containers
  ask CTID_START "Container IDs" "First container ID (the next free IDs are used for the other apps)"
  [[ $CTID_START =~ ^[0-9]+$ ]] || die "Container ID must be a number."
  ask HOST_PREFIX "Hostnames" "Hostname prefix (empty = radarr, sonarr, …; e.g. 'arr-' → arr-radarr)"

  local st=() name type status total used avail pct
  while read -r name type status total used avail pct; do
    [[ $status == active ]] && st+=("$name" "$(printf '%-8s %6s GB free' "$type" "$(( avail / 1024 / 1024 ))")")
  done < <(pvesm status -content rootdir 2>/dev/null | tail -n +2)
  (( ${#st[@]} )) && menu CT_STORAGE "Storage" "Storage for the container disks" "${st[@]}"
  st=()
  while read -r name type status total used avail pct; do
    [[ $status == active ]] && st+=("$name" "$type")
  done < <(pvesm status -content vztmpl 2>/dev/null | tail -n +2)
  (( ${#st[@]} > 1 )) && menu TPL_STORAGE "Templates" "Storage for the Debian template" "${st[@]}"

  # network
  local br=() b
  for b in $(ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2}' | cut -d@ -f1); do br+=("$b" "$(ip -4 -o addr show "$b" 2>/dev/null | awk '{print $4}' | head -1)"); done
  if (( ${#br[@]} >= 4 )); then menu CT_BRIDGE "Network" "Network bridge" "${br[@]}"
  elif (( ${#br[@]} == 0 )); then ask CT_BRIDGE "Network" "Network bridge"
  else CT_BRIDGE=${br[0]}; fi
  ask CT_VLAN "Network" "VLAN tag (empty = none)"
  menu NET_MODE "Network" "How do the containers get their address?" dhcp "DHCP (see the addresses at the end)" static "Static addresses, one after another"
  if [[ $NET_MODE == static ]]; then
    while :; do
      ask IP_START "Static addresses" "First address with prefix, e.g. 192.168.1.61/24 (the next app gets .62, …)"
      valid_cidr "$IP_START" && break; msgbox "Static addresses" "'$IP_START' is not an address with a prefix (e.g. 192.168.1.61/24)."
      (( INTERACTIVE )) || die "IP_START must be like 192.168.1.61/24"
    done
    ask CT_GW "Static addresses" "Gateway"
  fi
  ask CT_DNS "Network" "DNS server (empty = same as the Proxmox host)"
  ask CT_DOMAIN "Network" "Search domain (empty = same as the host; e.g. int)"

  # media
  ask MEDIA_HOST_PATH "Shared media folder" "Folder on the Proxmox host with downloads and the library (e.g. /tank/data or /mnt/pve/nas).\nIt is mounted at $MEDIA_CT_PATH in Radarr, Sonarr, Bazarr, NZBGet and qBittorrent. Empty = none."
  if [[ -n $MEDIA_HOST_PATH ]]; then
    ask MEDIA_UID "Shared media folder" "User ID that owns the media files (the apps run as this user)"
    ask MEDIA_GID "Shared media folder" "Group ID of the media files"
    if yesno "Shared media folder" "Create the folders torrents/, usenet/ and media/ (movies, tv) in $MEDIA_HOST_PATH?\nExisting folders and files are not touched." yes; then MEDIA_DIRS=1; else MEDIA_DIRS=0; fi
  fi

  # containers, security
  if yesno "Containers" "Unprivileged containers? (recommended)\nThe media user is mapped 1:1 to the host so file ownership matches." yes; then UNPRIVILEGED=1; else UNPRIVILEGED=0; fi
  if yesno "Containers" "Start the containers when Proxmox boots?" yes; then ONBOOT=1; else ONBOOT=0; fi
  ask TZ_NAME "Containers" "Time zone"
  ask CA_FILE "Own CA" "Your own CA certificate on the host (PEM file) to trust in every container – for https:// .int services.\nEmpty = none."
  ask CT_PASS "Containers" "Root password in the containers (empty = only 'pct enter')" secret
  ask SSH_KEYS "Containers" "SSH public keys for root (path to an authorized_keys file, empty = none)"

  if yesno "Resources" "Use the default CPU / RAM / disk for every app?\n\n$(for a in $APPS; do U=${a^^}; vc="CT_${U}_CORES" vr="CT_${U}_RAM" vd="CT_${U}_DISK"; printf '%-12s %s cores, %s MB, %s GB\n' "${NAME[$a]}" "${!vc}" "${!vr}" "${!vd}"; done)" yes; then :; else
    for a in $APPS; do U=${a^^}
      ask "CT_${U}_CORES" "${NAME[$a]}" "${NAME[$a]}: CPU cores"
      ask "CT_${U}_RAM"   "${NAME[$a]}" "${NAME[$a]}: RAM (MB)"
      ask "CT_${U}_DISK"  "${NAME[$a]}" "${NAME[$a]}: disk (GB)"
    done
  fi

  # logins
  if has_app qbittorrent; then
    ask QBIT_USER "qBittorrent" "qBittorrent Web UI username"
    ask QBIT_PASS "qBittorrent" "qBittorrent Web UI password (empty = random, shown at the end)" secret
  fi
  if has_app nzbget; then
    ask NZBGET_USER "NZBGet" "NZBGet username"
    ask NZBGET_PASS "NZBGet" "NZBGet password (empty = random, shown at the end)" secret
  fi
  if has_app arrhub; then
    ask ARRHUB_USER "ArrHub" "ArrHub login username (empty = no login, e.g. behind Nginx Proxy Manager with its own login)"
    [[ -n $ARRHUB_USER ]] && ask ARRHUB_PASS "ArrHub" "ArrHub password" secret
    menu ARRHUB_LANG "ArrHub" "ArrHub language" en English hr Hrvatski auto "Browser"
  fi
}

# ---------------------------------------------------------------- start
clear 2>/dev/null || true
cat <<EOF
${c_acc}${c_b}   ___              __ __     __
  / _ | ___________/ // /_ __/ /
 / __ |/ __/ __/ _  / _  / // / _ \\
/_/ |_/_/ /_/ /_//_/_//_/\\_,_/_.__/ ${c_0}${c_dim} arr stack → Proxmox LXC  v$SCRIPT_VERSION${c_0}

EOF

if (( INTERACTIVE )); then
  if [[ $PRESET == 1 ]] && yesno "ArrHub preset" "This script was generated in ArrHub → Tools with these settings:\n\n$(summary_text)\n\nUse them? (No = go through all the questions)" yes; then :
  else
    (( WT )) && whiptail --backtitle "$BT" --title "Welcome" --msgbox "This creates one Debian LXC container per app on this Proxmox host and installs:\n\n Radarr, Sonarr, Prowlarr, Bazarr, NZBGet, qBittorrent, Seerr and ArrHub\n\nArrHub is set up with the addresses and API keys of the others.\nNothing is changed before the last confirmation." 15 76
    wizard
  fi
fi

# validate
for a in $APPS; do [[ -n ${NAME[$a]:-} ]] || die "Unknown app '$a' (known: ${ALL_APPS[*]})"; done
[[ -n $CT_STORAGE ]] || die "No storage for container disks (CT_STORAGE)."
[[ -n $TPL_STORAGE ]] || die "No storage for templates (TPL_STORAGE)."
if [[ $NET_MODE == static ]]; then valid_cidr "$IP_START" || die "IP_START must be like 192.168.1.61/24"; [[ -n $CT_GW ]] || die "CT_GW (gateway) is needed for static addresses."; fi
[[ -z $CA_FILE || -f $CA_FILE ]] || die "CA file $CA_FILE does not exist."
[[ -z $SSH_KEYS || -f $SSH_KEYS ]] || die "SSH key file $SSH_KEYS does not exist."
[[ -z $MEDIA_HOST_PATH || $MEDIA_HOST_PATH == /* ]] || die "MEDIA_HOST_PATH must be an absolute path."
[[ $MEDIA_UID =~ ^[0-9]+$ && $MEDIA_GID =~ ^[0-9]+$ ]] || die "MEDIA_UID / MEDIA_GID must be numbers."
# arrhub last: it is set up with the others' addresses
APPS="$(for a in "${ALL_APPS[@]}"; do has_app "$a" && echo -n "$a "; done)"; APPS=${APPS% }
[[ -n $QBIT_PASS ]] || QBIT_PASS_GEN=1 QBIT_PASS=$(rand 16)
[[ -n $NZBGET_PASS ]] || NZBGET_PASS_GEN=1 NZBGET_PASS=$(rand 16)

SUMMARY="$(summary_text)"
if (( INTERACTIVE )); then
  if (( WT )); then whiptail --backtitle "$BT" --title "Ready to install" --yes-button "Install" --no-button "Cancel" --yesno "$SUMMARY" 24 78 || cancel
  else echo; echo "$SUMMARY"; yesno "Install" "Install now?" yes || cancel; fi
  clear 2>/dev/null || true
fi
read -ra IDS <<<"$(free_ids "$(wc -w <<<"$APPS")" "$CTID_START")"
echo "${c_b}ArrHub · arr stack → Proxmox LXC${c_0}  ${c_dim}(log: $LOG)${c_0}"

# ---------------------------------------------------------------- template
head1 "Debian template"
PVE_MAJOR="$(pveversion 2>/dev/null | sed -n 's#^pve-manager/\([0-9]*\).*#\1#p')"
step "Updating the template list" pveam update || warn "pveam update failed, using the cached list"
TPL=""
(( ${PVE_MAJOR:-0} >= 9 )) && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-13-standard' | sort -V | tail -1)"
[[ -z $TPL ]] && TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-12-standard' | sort -V | tail -1)"
[[ -n $TPL ]] || die "No Debian template found (pveam available)."
if pveam list "$TPL_STORAGE" | grep -q "$TPL"; then info "$TPL is already downloaded"
else step "Downloading $TPL" pveam download "$TPL_STORAGE" "$TPL" || die "Template download failed."; fi

# ---------------------------------------------------------------- media folder on the host
if [[ -n $MEDIA_HOST_PATH ]]; then
  head1 "Shared media folder"
  make_media_dirs() {
    mkdir -p "$MEDIA_HOST_PATH"
    local d
    for d in torrents torrents/movies torrents/tv torrents/incomplete usenet usenet/incomplete usenet/complete usenet/complete/movies usenet/complete/tv media media/movies media/tv; do
      [[ -d "$MEDIA_HOST_PATH/$d" ]] || install -d -m 2775 -o "$MEDIA_UID" -g "$MEDIA_GID" "$MEDIA_HOST_PATH/$d"
    done
  }
  if [[ $MEDIA_DIRS == 1 ]]; then step "Folders in $MEDIA_HOST_PATH (owner $MEDIA_UID:$MEDIA_GID)" make_media_dirs || warn "Could not create every folder (NFS/SMB share? create them on the NAS)."
  else [[ -d $MEDIA_HOST_PATH ]] || die "$MEDIA_HOST_PATH does not exist."; fi
  if [[ $UNPRIVILEGED == 1 ]]; then
    # let root map the media uid/gid into containers 1:1
    grep -qx "root:$MEDIA_UID:1" /etc/subuid 2>/dev/null || echo "root:$MEDIA_UID:1" >>/etc/subuid
    grep -qx "root:$MEDIA_GID:1" /etc/subgid 2>/dev/null || echo "root:$MEDIA_GID:1" >>/etc/subgid
    info "uid $MEDIA_UID / gid $MEDIA_GID map 1:1 into the containers (/etc/subuid, /etc/subgid)"
  fi
fi

# ---------------------------------------------------------------- scripts that run inside the containers
inner_base() { cat <<'EOS'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
if [[ -n "${TZ_NAME:-}" && -f "/usr/share/zoneinfo/$TZ_NAME" ]]; then ln -sf "/usr/share/zoneinfo/$TZ_NAME" /etc/localtime; echo "$TZ_NAME" >/etc/timezone; fi
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold dist-upgrade
apt-get install -y -qq curl ca-certificates tar gzip unzip sudo
getent group "$MEDIA_GID" >/dev/null || groupadd -g "$MEDIA_GID" media
getent passwd "$MEDIA_UID" >/dev/null || useradd -u "$MEDIA_UID" -g "$MEDIA_GID" -d /var/lib/media -m -s /usr/sbin/nologin media
if [[ -f /root/.arr-ca.crt ]]; then
  install -m 644 /root/.arr-ca.crt /usr/local/share/ca-certificates/arrhub-own-ca.crt && rm -f /root/.arr-ca.crt
  update-ca-certificates >/dev/null
fi
systemctl disable -q --now systemd-networkd-wait-online.service 2>/dev/null || true
EOS
}
# common head for the app scripts
inner_head() { cat <<'EOS'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
U=$(getent passwd "$MEDIA_UID" | cut -d: -f1); G=$(getent group "$MEDIA_GID" | cut -d: -f1)
unit() { # name description exec [extra lines]
  cat >"/etc/systemd/system/$1.service" <<X
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target

[Service]
User=$U
Group=$G
UMask=0002
Type=simple
ExecStart=$3
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
$4

[Install]
WantedBy=multi-user.target
X
  systemctl daemon-reload
  systemctl enable -q --now "$1"
}
wait_port() { local i; for i in $(seq 1 "${2:-90}"); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" && return 0; sleep 2; done; echo "port $1 is not answering yet"; return 0; }
EOS
}
# Radarr, Sonarr, Prowlarr (same .NET build, config.xml with a known API key)
inner_servarr() { cat <<'EOS'
icu=$(apt-cache search --names-only '^libicu[0-9]+$' | awk '{print $1}' | sort -V | tail -1)
apt-get install -y -qq sqlite3 "$icu"
case "$(dpkg --print-architecture)" in amd64) A=x64 ;; arm64) A=arm64 ;; armhf) A=arm ;; *) echo "unsupported architecture"; exit 1 ;; esac
curl -fsSL "${DL_URL//@ARCH@/$A}" -o /tmp/app.tar.gz
rm -rf "/opt/$APPN"; tar xzf /tmp/app.tar.gz -C /opt; rm -f /tmp/app.tar.gz
chown -R "$U:$G" "/opt/$APPN"
data="/var/lib/$APP"; install -d -o "$U" -g "$G" "$data"
if [[ ! -f "$data/config.xml" ]]; then
  cat >"$data/config.xml" <<X
<Config>
  <BindAddress>*</BindAddress>
  <Port>$APP_PORT</Port>
  <UrlBase></UrlBase>
  <ApiKey>$API_KEY</ApiKey>
  <LaunchBrowser>False</LaunchBrowser>
  <Branch>$APP_BRANCH</Branch>
  <UpdateMechanism>BuiltIn</UpdateMechanism>
</Config>
X
  chown "$U:$G" "$data/config.xml"
fi
unit "$APP" "$APPN" "/opt/$APPN/$APPN -nobrowser -data=$data" "KillMode=process"
wait_port "$APP_PORT"
EOS
}
inner_bazarr() { cat <<'EOS'
apt-get install -y -qq python3 python3-venv python3-pip ffmpeg libxml2 libxslt1.1 unzip
rm -rf /opt/bazarr; mkdir -p /opt/bazarr
curl -fsSL https://github.com/morpheus65535/bazarr/releases/latest/download/bazarr.zip -o /tmp/bazarr.zip
unzip -qo /tmp/bazarr.zip -d /opt/bazarr; rm -f /tmp/bazarr.zip
python3 -m venv /opt/bazarr/venv
/opt/bazarr/venv/bin/pip install -q --upgrade pip wheel
/opt/bazarr/venv/bin/pip install -q -r /opt/bazarr/requirements.txt
data=/var/lib/bazarr; install -d -o "$U" -g "$G" "$data" "$data/config"
if [[ ! -f "$data/config/config.yaml" ]]; then
  printf 'auth:\n  apikey: %s\ngeneral:\n  ip: 0.0.0.0\n  port: %s\n' "$API_KEY" "$APP_PORT" >"$data/config/config.yaml"
fi
chown -R "$U:$G" /opt/bazarr "$data"
unit bazarr Bazarr "/opt/bazarr/venv/bin/python3 /opt/bazarr/bazarr.py --config $data" "WorkingDirectory=/opt/bazarr"
wait_port "$APP_PORT"
EOS
}
inner_nzbget() { cat <<'EOS'
apt-get install -y -qq python3 p7zip-full 2>/dev/null || apt-get install -y -qq python3 7zip || apt-get install -y -qq python3
url=$(curl -fsSL https://api.github.com/repos/nzbgetcom/nzbget/releases/latest | grep -o '"browser_download_url": *"[^"]*bin-linux\.run"' | head -1 | cut -d'"' -f4)
[[ -n "$url" ]] || { echo "NZBGet download not found on GitHub"; exit 1; }
curl -fsSL "$url" -o /tmp/nzbget.run
rm -rf /opt/nzbget; sh /tmp/nzbget.run --destdir /opt/nzbget; rm -f /tmp/nzbget.run
conf=/opt/nzbget/nzbget.conf
opt() { if grep -q "^$1=" "$conf"; then sed -i "s|^$1=.*|$1=$2|" "$conf"; else echo "$1=$2" >>"$conf"; fi; }
install -d -o "$U" -g "$G" /var/lib/nzbget
opt MainDir /var/lib/nzbget
if [[ -d "$MEDIA_CT_PATH/usenet" ]]; then opt DestDir "$MEDIA_CT_PATH/usenet/complete"; opt InterDir "$MEDIA_CT_PATH/usenet/incomplete"; fi
opt ControlIP 0.0.0.0
opt ControlPort "$APP_PORT"
opt ControlUsername "$NZB_USER"
opt ControlPassword "$NZB_PASS"
opt DaemonUsername "$U"
opt UMask 0002
chown -R "$U:$G" /opt/nzbget /var/lib/nzbget
unit nzbget NZBGet "/opt/nzbget/nzbget -c $conf -s -o OutputMode=log" ""
wait_port "$APP_PORT"
EOS
}
inner_qbittorrent() { cat <<'EOS'
arch=$(uname -m)
if curl -fsSL "https://github.com/userdocs/qbittorrent-nox-static/releases/latest/download/${arch}-qbittorrent-nox" -o /usr/local/bin/qbittorrent-nox; then
  chmod 755 /usr/local/bin/qbittorrent-nox
else
  echo "static build not available, using the Debian package"; apt-get install -y -qq qbittorrent-nox
fi
bin=$(command -v qbittorrent-nox)
prof=/var/lib/qbittorrent; cfgd=$prof/qBittorrent/config; conf=$cfgd/qBittorrent.conf
save=$prof/downloads; [[ -d "$MEDIA_CT_PATH/torrents" ]] && save="$MEDIA_CT_PATH/torrents"
install -d -o "$U" -g "$G" "$prof" "$prof/qBittorrent" "$cfgd"; [[ -d "$save" ]] || install -d -o "$U" -g "$G" "$save"
pwline=""; [[ -n "${QB_HASH:-}" ]] && pwline="WebUI\\Password_PBKDF2=\"$QB_HASH\""
if [[ ! -f "$conf" ]]; then
  cat >"$conf" <<X
[LegalNotice]
Accepted=true

[BitTorrent]
Session\DefaultSavePath=$save
Session\TempPath=$save/incomplete
Session\TempPathEnabled=true

[Preferences]
Downloads\SavePath=$save
Downloads\TempPath=$save/incomplete
Downloads\TempPathEnabled=true
WebUI\Port=$APP_PORT
WebUI\Username=$QB_USER
$pwline
WebUI\HostHeaderValidation=false
X
  chown "$U:$G" "$conf"; chmod 600 "$conf"
fi
flag=""; "$bin" --help 2>&1 | grep -q -- --confirm-legal-notice && flag=" --confirm-legal-notice"
unit qbittorrent-nox qBittorrent "$bin --profile=$prof --webui-port=$APP_PORT$flag" ""
wait_port "$APP_PORT"
EOS
}
inner_seerr() { cat <<'EOS'
apt-get install -y -qq git build-essential python3 gnupg
if ! command -v node >/dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < 22 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
tag=$(curl -fsSL https://api.github.com/repos/seerr-team/seerr/releases/latest 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
rm -rf /opt/seerr
git clone -q --depth 1 ${tag:+--branch "$tag"} https://github.com/seerr-team/seerr.git /opt/seerr
cd /opt/seerr
export CYPRESS_INSTALL_BINARY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_OPTIONS=--max-old-space-size=3072
corepack enable
pnpm install --frozen-lockfile
pnpm build
data=/var/lib/seerr; install -d -o "$U" -g "$G" "$data"
chown -R "$U:$G" /opt/seerr
unit seerr Seerr "/usr/bin/node dist/index.js" "WorkingDirectory=/opt/seerr
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=CONFIG_DIRECTORY=$data"
wait_port "$APP_PORT" 120
EOS
}

# ---------------------------------------------------------------- per app
# ct_sh ID "script" VAR=value … — runs the script in the container
ct_sh() {
  local id=$1 script=$2 f; shift 2
  f=$(mktemp); printf '%s\n' "$script" >"$f"
  pct push "$id" "$f" /root/.arr-setup.sh && rm -f "$f" || { rm -f "$f"; return 1; }
  pct exec "$id" -- env TZ_NAME="$TZ_NAME" MEDIA_UID="$MEDIA_UID" MEDIA_GID="$MEDIA_GID" MEDIA_CT_PATH="$MEDIA_CT_PATH" "$@" bash /root/.arr-setup.sh
  local rc=$?; pct exec "$id" -- rm -f /root/.arr-setup.sh || true; return $rc
}
create_ct() { # app id ip
  local a=$1 id=$2 ip=$3 U=${1^^}
  local vc="CT_${U}_CORES" vr="CT_${U}_RAM" vd="CT_${U}_DISK"
  local net="name=eth0,bridge=$CT_BRIDGE"
  [[ -n $CT_VLAN ]] && net+=",tag=$CT_VLAN"
  if [[ $ip == dhcp ]]; then net+=",ip=dhcp"; else net+=",ip=$ip,gw=$CT_GW"; fi
  local args=("$TPL_STORAGE:vztmpl/$TPL" --hostname "${HOST_PREFIX}${a}" --cores "${!vc}" --memory "${!vr}" --swap 512
    --rootfs "$CT_STORAGE:${!vd}" --net0 "$net" --unprivileged "$UNPRIVILEGED" --features nesting=1 --onboot "$ONBOOT"
    --ostype debian --tags "arrhub;$a" --description "${NAME[$a]} – installed by ArrHub (https://github.com/$REPO)")
  [[ -n $CT_DNS ]] && args+=(--nameserver "$CT_DNS")
  [[ -n $CT_DOMAIN ]] && args+=(--searchdomain "$CT_DOMAIN")
  [[ -n $CT_PASS ]] && args+=(--password "$CT_PASS")
  [[ -n $SSH_KEYS ]] && args+=(--ssh-public-keys "$SSH_KEYS")
  pct create "$id" "${args[@]}" || return 1
  if [[ -n $MEDIA_HOST_PATH && -n ${MEDIA_APP[$a]:-} ]]; then
    pct set "$id" -mp0 "$MEDIA_HOST_PATH,mp=$MEDIA_CT_PATH" || return 1
    if [[ $UNPRIVILEGED == 1 ]]; then
      local u=$MEDIA_UID g=$MEDIA_GID
      {
        echo "lxc.idmap: u 0 100000 $u"
        echo "lxc.idmap: u $u $u 1"
        echo "lxc.idmap: u $((u + 1)) $((100000 + u + 1)) $((65535 - u))"
        echo "lxc.idmap: g 0 100000 $g"
        echo "lxc.idmap: g $g $g 1"
        echo "lxc.idmap: g $((g + 1)) $((100000 + g + 1)) $((65535 - g))"
      } >>"/etc/pve/lxc/$id.conf"
    fi
  fi
}
wait_net() {
  local id=$1 i
  for i in {1..45}; do pct exec "$id" -- getent hosts deb.debian.org &>/dev/null && return 0; sleep 2; done
  echo "no internet in container $id (check bridge / IP / gateway / DNS)"; return 1
}
ct_ip() { local id=$1 i ip; for i in {1..30}; do ip=$(pct exec "$id" -- hostname -I 2>/dev/null | awk '{print $1}'); [[ -n $ip ]] && { echo "$ip"; return; }; sleep 2; done; }
qb_hash() { # qBittorrent stores PBKDF2-SHA512, 100000 rounds, 16-byte salt
  command -v python3 >/dev/null || return 0
  python3 -c 'import hashlib,os,base64,sys;s=os.urandom(16);h=hashlib.pbkdf2_hmac("sha512",sys.argv[1].encode(),s,100000);print("@ByteArray(%s:%s)"%(base64.b64encode(s).decode(),base64.b64encode(h).decode()))' "$1"
}

declare -A CT_OF IP_OF KEY_OF
FAILED=()
install_app() { # app id ip
  local a=$1 id=$2 ip=$3 rc=0
  head1 "${NAME[$a]}  ${c_dim}CT $id · ${HOST_PREFIX}${a}${c_0}"
  step "Creating the container" create_ct "$a" "$id" "$ip" || return 1
  step "Starting" pct start "$id" || return 1
  step "Waiting for the network" wait_net "$id" || return 1
  [[ -n $CA_FILE ]] && { pct push "$id" "$CA_FILE" /root/.arr-ca.crt || return 1; }
  step "Updating Debian, media user $MEDIA_UID:$MEDIA_GID" ct_sh "$id" "$(inner_base)" || return 1
  CT_OF[$a]=$id
  local key; key=$(openssl rand -hex 16 2>/dev/null || rand 32); key=${key,,}
  case $a in
    radarr)   step "Installing Radarr" ct_sh "$id" "$(inner_head; inner_servarr)" APP=radarr APPN=Radarr APP_PORT="${PORT[$a]}" API_KEY="$key" APP_BRANCH=master \
                DL_URL='https://radarr.servarr.com/v1/update/master/updatefile?os=linux&runtime=netcore&arch=@ARCH@' || rc=1 ;;
    sonarr)   step "Installing Sonarr" ct_sh "$id" "$(inner_head; inner_servarr)" APP=sonarr APPN=Sonarr APP_PORT="${PORT[$a]}" API_KEY="$key" APP_BRANCH=main \
                DL_URL='https://services.sonarr.tv/v1/download/main/latest?version=4&os=linux&arch=@ARCH@' || rc=1 ;;
    prowlarr) step "Installing Prowlarr" ct_sh "$id" "$(inner_head; inner_servarr)" APP=prowlarr APPN=Prowlarr APP_PORT="${PORT[$a]}" API_KEY="$key" APP_BRANCH=master \
                DL_URL='https://prowlarr.servarr.com/v1/update/master/updatefile?os=linux&runtime=netcore&arch=@ARCH@' || rc=1 ;;
    bazarr)   step "Installing Bazarr (Python packages take a few minutes)" ct_sh "$id" "$(inner_head; inner_bazarr)" APP_PORT="${PORT[$a]}" API_KEY="$key" || rc=1 ;;
    nzbget)   key=""; step "Installing NZBGet" ct_sh "$id" "$(inner_head; inner_nzbget)" APP_PORT="${PORT[$a]}" NZB_USER="$NZBGET_USER" NZB_PASS="$NZBGET_PASS" || rc=1 ;;
    qbittorrent)
              key=""; step "Installing qBittorrent" ct_sh "$id" "$(inner_head; inner_qbittorrent)" APP_PORT="${PORT[$a]}" QB_USER="$QBIT_USER" QB_HASH="$(qb_hash "$QBIT_PASS")" || rc=1 ;;
    seerr)    key=""
              # building Seerr needs more memory than running it
              local vr="CT_SEERR_RAM"; (( ${!vr} < 4096 )) && pct set "$id" -memory 4096 >/dev/null
              step "Building Seerr (10–20 minutes)" ct_sh "$id" "$(inner_head; inner_seerr)" APP_PORT="${PORT[$a]}" || rc=1
              (( ${!vr} < 4096 )) && pct set "$id" -memory "${!vr}" >/dev/null ;;
    arrhub)   key=""; install_arrhub "$id" || rc=1 ;;
  esac
  KEY_OF[$a]=$key
  if [[ $ip == dhcp ]]; then IP_OF[$a]=$(ct_ip "$id"); else IP_OF[$a]=${ip%/*}; fi
  [[ $rc == 0 ]] && info "→ http://${IP_OF[$a]:-?}:${PORT[$a]}"
  return $rc
}
install_arrhub() {
  local id=$1 tmp; tmp=$(mktemp -d)
  local SRC_DIR; SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || echo /nonexistent)"
  fetch() {
    if [[ -f "$SRC_DIR/server.js" && -f "$SRC_DIR/install.sh" ]]; then cp -r "$SRC_DIR/server.js" "$SRC_DIR/compose.js" "$SRC_DIR/package.json" "$SRC_DIR/lib" "$SRC_DIR/public" "$SRC_DIR/install.sh" "$SRC_DIR/config.example.json" "$tmp/"; mkdir -p "$tmp/proxmox"; cp "$SRC_DIR/proxmox/arr-stack-lxc.sh" "$tmp/proxmox/"
    else local auth=(); [[ -n ${GITHUB_TOKEN:-} ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
      curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$tmp" --strip-components=1; fi
    tar cf "$tmp.tar" -C "$tmp" . && pct exec "$id" -- mkdir -p /root/arrhub-src && pct push "$id" "$tmp.tar" /root/arrhub-src/src.tar \
      && pct exec "$id" -- tar xf /root/arrhub-src/src.tar -C /root/arrhub-src
  }
  step "Downloading ArrHub" fetch || { rm -rf "$tmp" "$tmp.tar"; return 1; }
  rm -rf "$tmp" "$tmp.tar"
  u() { [[ -n ${IP_OF[$1]:-} ]] && echo "http://${IP_OF[$1]}:${PORT[$1]}"; }
  step "Installing ArrHub and connecting the apps" pct exec "$id" -- env NONINTERACTIVE=1 PORT="${PORT[arrhub]}" ARRHUB_LANG="$ARRHUB_LANG" \
    ARRHUB_USER="$ARRHUB_USER" ARRHUB_PASS="$ARRHUB_PASS" \
    RADARR_URL="$(u radarr)" RADARR_KEY="${KEY_OF[radarr]:-}" SONARR_URL="$(u sonarr)" SONARR_KEY="${KEY_OF[sonarr]:-}" \
    PROWLARR_URL="$(u prowlarr)" PROWLARR_KEY="${KEY_OF[prowlarr]:-}" BAZARR_URL="$(u bazarr)" BAZARR_KEY="${KEY_OF[bazarr]:-}" \
    NZBGET_URL="$(u nzbget)" NZBGET_USER="$([[ -n $(u nzbget) ]] && echo "$NZBGET_USER")" NZBGET_PASS="$([[ -n $(u nzbget) ]] && echo "$NZBGET_PASS")" \
    QBIT_URL="$(u qbittorrent)" QBIT_USER="$([[ -n $(u qbittorrent) ]] && echo "$QBIT_USER")" QBIT_PASS="$([[ -n $(u qbittorrent) ]] && echo "$QBIT_PASS")" \
    SEERR_URL="$(u seerr)" SEERR_KEY="" \
    bash /root/arrhub-src/install.sh || return 1
  pct exec "$id" -- rm -rf /root/arrhub-src || true
}

i=0
for a in $APPS; do
  id=${IDS[$i]}
  if [[ $NET_MODE == static ]]; then ip=$(ip_add "$IP_START" $i); else ip=dhcp; fi
  ((i++)) || true
  install_app "$a" "$id" "$ip" || { FAILED+=("$a"); warn "${NAME[$a]} failed – details in $LOG (container $id is kept, remove it with: pct destroy $id --purge)"; }
done

# ---------------------------------------------------------------- summary
OUT="/root/arr-stack-$(date +%Y%m%d-%H%M).txt"
{
  echo "ArrHub arr stack – $(date '+%F %T')"
  printf '%-12s %-6s %-16s %-28s %s\n' APP CT IP URL "LOGIN / API KEY"
  for a in $APPS; do
    [[ -n ${CT_OF[$a]:-} ]] || continue
    cred="${KEY_OF[$a]:+API key ${KEY_OF[$a]}}"
    [[ $a == qbittorrent ]] && cred="$QBIT_USER / $QBIT_PASS"
    [[ $a == nzbget ]] && cred="$NZBGET_USER / $NZBGET_PASS"
    [[ $a == arrhub && -n $ARRHUB_USER ]] && cred="$ARRHUB_USER / (your password)"
    [[ $a == seerr ]] && cred="first visit: sign in with Jellyfin/Plex/Emby"
    printf '%-12s %-6s %-16s %-28s %s\n' "${NAME[$a]}" "${CT_OF[$a]}" "${IP_OF[$a]:-?}" "http://${IP_OF[$a]:-?}:${PORT[$a]}" "$cred"
  done
  echo
  echo "Paths inside the apps (same as the Docker compose):"
  echo "  downloads: $MEDIA_CT_PATH/torrents (qBittorrent), $MEDIA_CT_PATH/usenet/complete (NZBGet)"
  echo "  library:   $MEDIA_CT_PATH/media/movies (Radarr root folder), $MEDIA_CT_PATH/media/tv (Sonarr root folder)"
  echo "Connect in the apps: Prowlarr → Settings → Apps (Radarr, Sonarr); Radarr/Sonarr → Download clients (qBittorrent, NZBGet);"
  echo "Bazarr → Settings → Radarr/Sonarr; Seerr → Radarr/Sonarr servers. The API keys above are already set."
  if [[ -n $CT_DOMAIN ]]; then
    echo
    echo "Nginx Proxy Manager – proxy hosts:"
    for a in $APPS; do [[ -n ${IP_OF[$a]:-} ]] && printf '  %-28s → http://%s:%s\n' "${a}.${CT_DOMAIN}" "${IP_OF[$a]}" "${PORT[$a]}"; done
  fi
} >"$OUT"
chmod 600 "$OUT"

head1 "Done"
cat "$OUT" | sed 's/^/  /'
echo
[[ ${QBIT_PASS_GEN:-0} == 1 || ${NZBGET_PASS_GEN:-0} == 1 ]] && info "Generated passwords are in the table above."
info "Saved to $OUT (root only). Log: $LOG"
if (( ${#FAILED[@]} )); then echo "${c_err}✗ Not finished: ${FAILED[*]}${c_0}"; exit 1; fi
echo "${c_ok}✓ All done.${c_0}"
