# ArrHub

![ArrHub](docs/screenshot.png)

Jedinstvena web nadzorna ploča za **Radarr, Sonarr, NZBGet i qBittorrent**.
Mali Node.js poslužitelj (bez ovisnosti, Node 18+) drži API ključeve i lozinke na strani poslužitelja
i prosljeđuje pozive, pa preglednik nikad ne vidi tajne i nema CORS problema.

## Mogućnosti
- **Pregled** – stanje svih usluga, verzije, brzine, slobodan prostor, health upozorenja, aktivna preuzimanja i nadolazeća izdanja
- **Preuzimanja** – qBittorrent (filter, pauza/pokretanje, brisanje s/bez datoteka, alt. ograničenje brzine),
  NZBGet (pauza/nastavak po stavci i globalno, brisanje), Radarr/Sonarr red čekanja (uklanjanje + blocklist)
- **Kalendar** – filmovi i epizode za sljedeća 2 tjedna
- **Povijest** – zadnji događaji iz Radarra, Sonarra i NZBGeta
- **Dodaj** – pretraga i dodavanje filmova/serija (odabir profila kvalitete i mape, opcionalno odmah traži)
- Automatsko osvježavanje svakih 5 s, opcionalna Basic Auth prijava
- Podržava qBittorrent 4.x i 5.x (stop/start i pause/resume)

## Postavljanje
```bash
cp config.example.json config.json   # upiši URL-ove, API ključeve i lozinke
node server.js                       # http://<ip>:8686
```
API ključ: Radarr/Sonarr → Settings → General → Security → API Key.
Usluge koje ne trebaš samo izbriši iz `config.json` – sučelje ih sakrije.

Sve se može zadati i varijablama okruženja: `PORT, ARRHUB_USER, ARRHUB_PASS, RADARR_URL, RADARR_KEY,
SONARR_URL, SONARR_KEY, NZBGET_URL, NZBGET_USER, NZBGET_PASS, QBIT_URL, QBIT_USER, QBIT_PASS`.

### Proxmox — automatska instalacija (preporučeno)
Na Proxmox hostu, kao root:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/proxmox/arrhub-lxc.sh)"
```
Skripta pita za postavke kontejnera (ID, RAM, disk, storage, bridge, VLAN, statična IP ili DHCP) i
za adrese i ključeve usluga. Zatim stvara neprivilegirani Debian LXC (Debian 13 na PVE 9+, inače 12),
instalira Node.js i ArrHub te ga pokreće kao systemd servis. Usluge koje ne koristiš preskoči s Enter.

Bez pitanja, npr. za automatizaciju:
```bash
NONINTERACTIVE=1 CTID=120 CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 \
RADARR_URL=http://192.168.1.10:7878 RADARR_KEY=xxx \
QBIT_URL=http://192.168.1.10:8080 QBIT_USER=admin QBIT_PASS=xxx \
bash proxmox/arrhub-lxc.sh
```
Varijable kontejnera: `CTID, CT_NAME, CT_CORES, CT_RAM, CT_DISK, CT_STORAGE, TPL_STORAGE, CT_BRIDGE, CT_VLAN, CT_IP, CT_GW, CT_PASS`.

### Postojeći LXC ili Debian/Ubuntu poslužitelj
Unutar kontejnera ili na poslužitelju, kao root:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/install.sh)"
```
Instalira u `/opt/arrhub`, stvara korisnika `arrhub` i servis `arrhub.service`.

### Nadogradnja
Ponovno pokreni `install.sh` (postojeći `config.json` se zadržava). S Proxmox hosta:
```bash
pct exec <CTID> -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/arrhub/main/install.sh)"
```

### Ručno (systemd)
```bash
useradd -r -s /usr/sbin/nologin arrhub
mkdir -p /opt/arrhub && cp -r server.js public config.json /opt/arrhub/
chown -R arrhub: /opt/arrhub && chmod 600 /opt/arrhub/config.json
cp arrhub.service /etc/systemd/system/ && systemctl enable --now arrhub
```

### Docker
```bash
docker compose up -d --build
```

### Nginx Proxy Manager
Dodaj Proxy Host → `http://<ip-lxc>:8686`. Ako je dostupno izvan LAN-a, obavezno uključi
`auth` u config.json ili Access List u NPM-u – ploča može brisati i dodavati sadržaj.

## qBittorrent napomena
Ako je u qBittorrentu uključeno *Bypass authentication for clients on localhost / whitelisted subnets*,
korisnik/lozinka mogu ostati prazni. Ako prijava pada s `Fails.`, provjeri da IP ArrHuba nije
zabranjen zbog previše neuspjelih pokušaja (Options → Web UI → ban).
