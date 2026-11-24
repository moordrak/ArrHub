// ArrHub — translations (en / hr)
// Static HTML uses data-i18n / data-i18n-ph / data-i18n-title / data-i18n-html attributes; dynamic text uses t(key, vars).
'use strict';
(() => {
  const DICT = {
    en: {
      // navigation
      'nav.overview': 'Overview', 'nav.downloads': 'Downloads', 'nav.calendar': 'Calendar', 'nav.history': 'History',
      'nav.requests': 'Requests', 'nav.add': 'Add', 'nav.logs': 'Logs', 'nav.settings': 'Settings',
      // common
      'c.loading': 'Loading…', 'c.error': 'Error: {msg}', 'c.done': 'Done', 'c.deleted': 'Deleted', 'c.removed': 'Removed',
      'hist.qbSub': 'completed torrents', 'hist.qbNote': 'qBittorrent keeps no history – torrents removed from it are not shown.', 'c.empty': 'Empty', 'c.noRecords': 'No records', 'c.free': '{size} free', 'c.ratio': 'ratio {r}', 'c.notConfigured': '{svc} is not configured',
      'c.movie': 'Movie', 'c.series': 'Series', 'c.refresh': 'Refresh', 'c.delete': 'Delete', 'c.remove': 'Remove',
      'c.start': 'Start', 'c.stop': 'Stop', 'c.downloaded': 'downloaded',
      'time.now': 'just now', 'time.min': '{n} min ago', 'time.h': '{n} h ago', 'time.d': '{n} d ago',
      // overview
      'ov.noServices': 'No services are configured yet.', 'ov.openSettings': 'Open settings',
      'ov.active': 'Active downloads', 'ov.upcoming': 'Upcoming', 'ov.nothingDownloading': 'Nothing is downloading right now',
      'ov.noUpcoming': 'No upcoming releases',
      'card.inQueue': 'in queue', 'card.comingSoon': 'Releasing soon', 'card.episodes14': 'Episodes (14 days)',
      'card.downloading': 'Downloading', 'card.seeding': 'Seeding', 'card.total': 'Total', 'card.paused': 'Paused', 'card.active': 'active',
      'card.queued': 'Queued', 'card.remaining': 'Remaining', 'card.diskFree': 'Free disk space',
      'card.pendingReq': 'pending requests', 'card.newVersion': 'new version', 'card.approved': 'Approved', 'card.processing': 'Processing',
      'card.available': 'Available', 'card.openRequests': 'Open requests',
      // downloads
      'dl.all': 'All', 'dl.active': 'Active', 'dl.downloading': 'Downloading', 'dl.seeding': 'Seeding', 'dl.paused': 'Paused', 'dl.errors': 'Errors',
      'dl.stopAll': 'Stop all', 'dl.startAll': 'Start all', 'dl.altSpeed': 'Alternative speed limits', 'dl.pauseAll': 'Pause all', 'dl.resumeAll': 'Resume all',
      'dl.radarrQueue': 'Radarr queue', 'dl.sonarrQueue': 'Sonarr queue', 'dl.noTorrents': 'No torrents', 'dl.queueEmpty': 'Queue is empty',
      'qb.error': 'error', 'qb.stopped': 'stopped', 'qb.stalled': 'stalled', 'qb.downloading': 'downloading', 'qb.seeding': 'seeding',
      'qb.queued': 'queued', 'qb.checking': 'checking',
      'act.stopped': 'Stopped', 'act.started': 'Started', 'act.altSpeed': 'Speed limit toggled', 'act.cmdSent': 'Command sent',
      'confirm.delTorrent': 'Delete torrent?', 'confirm.delFiles': 'Also delete files from disk?', 'confirm.delNzb': 'Remove from queue?',
      'confirm.arrRemove': 'Remove from queue and from the download client?', 'confirm.blocklist': 'Add to blocklist (will not be grabbed again)?',
      // calendar
      'cal.title': 'Next two weeks', 'cal.digital': 'digital', 'cal.physical': 'physical release', 'cal.cinemas': 'in cinemas', 'cal.none': 'No events',
      // history
      'ev.grabbed': 'grabbed', 'ev.imported': 'imported', 'ev.failed': 'failed', 'ev.deleted': 'deleted', 'ev.renamed': 'renamed', 'ev.ignored': 'ignored',
      // requests
      'req.title': 'Seerr requests', 'req.f.pending': 'Pending', 'req.f.all': 'All', 'req.f.processing': 'Processing', 'req.f.available': 'Available', 'req.f.declined': 'Declined',
      'req.total': 'Total', 'req.pending': 'Pending', 'req.approved': 'Approved', 'req.available': 'Available', 'req.declined': 'Declined',
      'req.s.pending': 'pending', 'req.s.approved': 'approved', 'req.s.declined': 'declined', 'req.s.failed': 'failed', 'req.s.completed': 'completed',
      'req.m.waiting': 'waiting to download', 'req.m.processing': 'downloading', 'req.m.partial': 'partially available', 'req.m.available': 'available', 'req.m.deleted': 'deleted',
      'req.approve': '✓ Approve', 'req.decline': '✕ Decline', 'req.deleteTitle': 'Delete request',
      'req.noPending': 'No pending requests 🎉', 'req.none': 'No requests',
      'req.confirmDelete': 'Delete request? (content in Radarr/Sonarr stays)', 'req.confirmDecline': 'Decline request?',
      'req.approvedToast': 'Request approved', 'req.declinedToast': 'Request declined', 'req.deletedToast': 'Request deleted',
      // add
      'add.placeholder': 'Movie or series title…', 'add.profile': 'Quality profile', 'add.folder': 'Folder', 'add.search': 'Search',
      'add.searching': 'Searching…', 'add.noResults': 'No results', 'add.inLibrary': 'Already in library', 'add.addSearch': 'Add and search',
      'add.addOnly': 'Add only', 'add.added': 'Added: {title}', 'add.seasons': '{n} seasons',
      // settings
      'set.appearance': 'Appearance', 'set.language': 'Language', 'set.langAuto': 'Automatic (browser)', 'set.theme': 'Theme',
      'set.accent': 'Accent colour', 'set.accentReset': 'Theme default colour', 'set.background': 'Dynamic background',
      'set.intensity': 'Intensity', 'set.reactive': 'Reacts to download speed', 'set.reactiveTitle': 'The animation speeds up while something is downloading',
      'set.checkMedia': 'Check library images',
      'set.appearanceHint': 'Changes are previewed instantly and saved with <b>Save settings</b>. “Poster wall” and “Library images” use artwork from Radarr and Sonarr.',
      'set.url': 'URL', 'set.webUiUrl': 'Web UI URL', 'set.apiKey': 'API key', 'set.user': 'Username', 'set.pass': 'Password', 'set.test': 'Test connection',
      'set.general': 'General', 'set.refresh': 'Refresh (seconds)', 'set.port': 'Port', 'set.portHint': 'Changing it requires a service restart',
      'set.login': 'ArrHub login', 'set.loginPh': 'empty = no login', 'set.authHint': 'Without a login anyone on the network can change these settings.',
      'set.reset': 'Reset', 'set.save': 'Save settings', 'set.savedIn': 'Saved in {file}', 'set.lockedN': '{n} fields locked by environment variables',
      'set.lockedTitle': 'Set by an environment variable', 'set.checking': 'Checking…', 'set.saved': 'Settings saved',
      'set.savedRestart': 'Saved. The new port applies after a service restart.',
      'set.fetchingLib': 'Fetching library…', 'set.noArr': 'Neither Radarr nor Sonarr is configured', 'set.imgOk': 'images ✓',
      'set.noImg': '✕ no images', 'set.imgFail': '✕ images fail to load: {msg}',
      'set.libLine': '{svc}: {items} {kind}, {posters} posters, {fanart} backgrounds, {img}', 'set.movies': 'movies', 'set.seriesPl': 'series',
      'about.title': 'About', 'about.notes': 'Release notes', 'about.check': 'Check for updates', 'about.checking': 'Checking for updates…',
      'about.upToDate': '✓ You are running the latest version', 'about.newVersion': 'New version {v} is available', 'about.whatsNew': "What's new",
      'about.checkFailed': 'Update check failed: {msg}', 'about.dev': 'Development build',
      'set.cardIconsTitle': 'Service icons on cards', 'set.cardIcons': 'Show a large service icon behind each card', 'set.iconStrength': 'Strength',
      'set.iconReload': 'Reload icons', 'set.iconOfficial': 'official icon', 'set.iconGeneric': 'generic icon',
      'c.openService': 'Open {svc}', 'set.link': 'Link in cards (optional)', 'set.linkPh': 'https://service.example.com',
      'set.linkHint': 'Opened from the cards – e.g. your reverse-proxy address. Empty = the URL above.',
      'set.insecure': 'Accept self-signed certificate', 'set.insecureHint': 'Only for your own https:// service on the local network – the certificate is not verified.',
      'set.tlsTitle': 'SSL / TLS – own CA certificate', 'set.ca': 'CA certificate (PEM)',
      'set.caHint': 'Paste the certificate of your own certificate authority (the public .crt / .pem, not the private key). ArrHub then fully verifies your https:// services against it. Several certificates (a chain) can be pasted one after another.',
      'set.caLoaded': 'Trusted: {list}', 'set.caValid': 'valid until {date}', 'set.caNone': 'No own CA certificate – only the system certificate authorities are trusted.',
      'log.level': 'Level', 'log.lv.all': 'All levels', 'log.lv.info': 'Info and above', 'log.lv.warn': 'Warnings and errors', 'log.lv.error': 'Errors only',
      'log.search': 'Search the log…', 'log.auto': 'Auto-refresh', 'log.reload': 'Refresh', 'log.download': 'Download',
      'log.info': '{shown} of {total} entries · newest first · updated {time}', 'log.empty': 'No entries match.', 'log.loading': 'Loading…',
      'log.arrhubNote': 'ArrHub keeps its last 1000 messages in memory; they are cleared on restart.',
      'req.perPage': 'Per page', 'req.page': 'Page {page} of {pages}', 'req.range': '{from}–{to} of {total}', 'req.first': 'First page', 'req.prev': 'Previous page', 'req.next': 'Next page', 'req.last': 'Last page',
      'set.netTitle': 'Network', 'set.offline': 'Offline mode – don\'t connect to the internet',
      'set.offlineHint': 'ArrHub then talks only to your services: no update check on GitHub and no images from TMDB/TVDB. Posters and backgrounds come only from Radarr and Sonarr (MediaCover), request posters from Seerr\'s image cache. Items without a local image show a placeholder.',
      'about.offline': 'Offline mode – update check is off',
      'nav.docker': 'Docker',
      'dk.check': 'Check for updates', 'dk.checking': 'Checking for updates…', 'dk.checkedAgo': 'Updates checked {ago}', 'dk.updateAll': 'Update all ({n})',
      'dk.f.all': 'All', 'dk.f.running': 'Running', 'dk.f.stopped': 'Stopped', 'dk.f.updates': 'Updates', 'dk.search': 'Search containers…',
      'dk.authWarn': 'ArrHub login is off – anyone on your network can stop or update your containers. Set a username and password in Settings.',
      'dk.runningOf': 'containers running', 'dk.stoppedN': 'Stopped', 'dk.unhealthyN': 'Unhealthy', 'dk.updatesN': 'Updates', 'dk.open': 'Open Docker',
      'dk.updAvailable': 'update available', 'dk.updCurrent': 'up to date', 'dk.updLocal': 'A newer image is already on the Docker host', 'dk.updUnknown': 'update unknown',
      'dk.pinned': 'pinned', 'dk.pinnedHint': 'The image is pinned to a digest – update it in your compose file',
      'dk.start': 'Start', 'dk.stop': 'Stop', 'dk.restart': 'Restart', 'dk.logs': 'Logs', 'dk.update': 'Update', 'dk.sharedNet': 'shared network',
      'dk.h.healthy': 'healthy', 'dk.h.unhealthy': 'unhealthy', 'dk.h.starting': 'starting', 'dk.noProject': 'Other containers',
      'dk.step.queued': 'Waiting…', 'dk.step.pulling': 'Downloading image…', 'dk.step.stopping': 'Stopping…', 'dk.step.creating': 'Creating new container…',
      'dk.step.starting': 'Starting…', 'dk.step.verifying': 'Checking that it runs…', 'dk.step.cleanup': 'Cleaning up…', 'dk.step.done': 'Done',
      'dk.updated': 'updated', 'dk.alreadyCurrent': 'already up to date', 'dk.showLog': 'Show details',
      'dk.confirmUpdate': 'Update {name}?\n\nThe new image is downloaded, then the container is recreated with the same settings. If the new version does not start, the old container is restored.',
      'dk.confirmUpdateAll': 'Update {n} containers one after another?\n\n{names}',
      'dk.confirm.stop': 'Stop {name}?', 'dk.confirm.restart': 'Restart {name}?',
      'dk.done.start': 'started', 'dk.done.stop': 'stopped', 'dk.done.restart': 'restarted', 'dk.done.pause': 'paused', 'dk.done.unpause': 'resumed',
      'set.dockerUrl': 'Docker address', 'set.dockerUrlHint': 'Address of the Docker host. Recommended: a <b>docker-socket-proxy</b> on that host (<code>http://host:2375</code>). Also <code>https://host:2376</code> with TLS certificates, or <code>unix:///var/run/docker.sock</code> if ArrHub runs on the same host. <a href="https://github.com/moordrak/ArrHub#docker-control" target="_blank" rel="noopener">Setup guide</a>',
      'set.dockerLinkPh': 'https://portainer.example.com', 'set.dockerLinkHint': 'E.g. Portainer or Dockge, opened from the Docker card.',
      'set.dockerCleanup': 'Remove the old image after an update', 'set.dockerTls': 'TLS client certificates (only for https://)',
      'set.dockerCa': 'CA certificate (ca.pem)', 'set.dockerCert': 'Client certificate (cert.pem)', 'set.dockerKey': 'Client key (key.pem)', 'set.dockerKeyHint': 'Stored like a password and never shown again.',
      // themes & backgrounds
      'theme.auto': 'Automatic', 'theme.dark': 'Dark', 'theme.oled': 'OLED black', 'theme.light': 'Light', 'theme.pastel-lavender': 'Pastel Lavender', 'theme.pastel-peach': 'Pastel Peach',
      'bg.none': 'No background', 'bg.aurora': 'Aurora', 'bg.stars': 'Starfield', 'bg.particles': 'Particle network', 'bg.waves': 'Waves',
      'bg.posters': 'Poster wall', 'bg.fanart': 'Library images',
      'bg.noPosters': 'No posters in the library', 'bg.noImages': 'No images in the library', 'bg.postersFail': 'Posters cannot be loaded',
      'bg.imagesFail': 'Library images cannot be loaded', 'bg.fallback': '{msg} – showing Aurora. Details are in Settings.',
    },
    hr: {
      'nav.overview': 'Pregled', 'nav.downloads': 'Preuzimanja', 'nav.calendar': 'Kalendar', 'nav.history': 'Povijest',
      'nav.requests': 'Zahtjevi', 'nav.add': 'Dodaj', 'nav.logs': 'Logovi', 'nav.settings': 'Postavke',
      'c.loading': 'Učitavanje…', 'c.error': 'Greška: {msg}', 'c.done': 'Gotovo', 'c.deleted': 'Obrisano', 'c.removed': 'Uklonjeno',
      'hist.qbSub': 'završeni torrenti', 'hist.qbNote': 'qBittorrent ne vodi povijest – torrenti koje ukloniš ovdje se ne prikazuju.', 'c.empty': 'Prazno', 'c.noRecords': 'Nema zapisa', 'c.free': '{size} slobodno', 'c.ratio': 'omjer {r}', 'c.notConfigured': '{svc} nije konfiguriran',
      'c.movie': 'Film', 'c.series': 'Serija', 'c.refresh': 'Osvježi', 'c.delete': 'Obriši', 'c.remove': 'Ukloni',
      'c.start': 'Pokreni', 'c.stop': 'Zaustavi', 'c.downloaded': 'preuzeto',
      'time.now': 'upravo', 'time.min': 'prije {n} min', 'time.h': 'prije {n} h', 'time.d': 'prije {n} d',
      'ov.noServices': 'Nijedna usluga još nije podešena.', 'ov.openSettings': 'Otvori postavke',
      'ov.active': 'Aktivna preuzimanja', 'ov.upcoming': 'Uskoro', 'ov.nothingDownloading': 'Ništa se trenutno ne preuzima',
      'ov.noUpcoming': 'Nema nadolazećih izdanja',
      'card.inQueue': 'u redu čekanja', 'card.comingSoon': 'Izlazi uskoro', 'card.episodes14': 'Epizode (14 dana)',
      'card.downloading': 'Preuzima', 'card.seeding': 'Seeda', 'card.total': 'Ukupno', 'card.paused': 'Pauzirano', 'card.active': 'aktivno',
      'card.queued': 'U redu', 'card.remaining': 'Preostalo', 'card.diskFree': 'Slobodno na disku',
      'card.pendingReq': 'zahtjeva na čekanju', 'card.newVersion': 'nova verzija', 'card.approved': 'Odobreno', 'card.processing': 'U obradi',
      'card.available': 'Dostupno', 'card.openRequests': 'Otvori zahtjeve',
      'dl.all': 'Svi', 'dl.active': 'Aktivni', 'dl.downloading': 'Preuzimaju', 'dl.seeding': 'Seedaju', 'dl.paused': 'Zaustavljeni', 'dl.errors': 'Greške',
      'dl.stopAll': 'Zaustavi sve', 'dl.startAll': 'Pokreni sve', 'dl.altSpeed': 'Alternativna ograničenja brzine', 'dl.pauseAll': 'Pauziraj sve', 'dl.resumeAll': 'Nastavi sve',
      'dl.radarrQueue': 'Radarr red čekanja', 'dl.sonarrQueue': 'Sonarr red čekanja', 'dl.noTorrents': 'Nema torrenata', 'dl.queueEmpty': 'Red čekanja je prazan',
      'qb.error': 'greška', 'qb.stopped': 'zaustavljen', 'qb.stalled': 'zastoj', 'qb.downloading': 'preuzima', 'qb.seeding': 'seeda',
      'qb.queued': 'u redu', 'qb.checking': 'provjera',
      'act.stopped': 'Zaustavljeno', 'act.started': 'Pokrenuto', 'act.altSpeed': 'Ograničenje brzine prebačeno', 'act.cmdSent': 'Naredba poslana',
      'confirm.delTorrent': 'Obrisati torrent?', 'confirm.delFiles': 'Obrisati i datoteke s diska?', 'confirm.delNzb': 'Obrisati iz reda čekanja?',
      'confirm.arrRemove': 'Ukloniti iz reda i iz download klijenta?', 'confirm.blocklist': 'Dodati na blocklist (neće se ponovno preuzeti)?',
      'cal.title': 'Sljedeća dva tjedna', 'cal.digital': 'digitalno', 'cal.physical': 'fizičko izdanje', 'cal.cinemas': 'u kinima', 'cal.none': 'Nema događaja',
      'ev.grabbed': 'preuzet', 'ev.imported': 'uvezen', 'ev.failed': 'neuspjeh', 'ev.deleted': 'obrisan', 'ev.renamed': 'preimenovan', 'ev.ignored': 'ignoriran',
      'req.title': 'Seerr zahtjevi', 'req.f.pending': 'Na čekanju', 'req.f.all': 'Svi', 'req.f.processing': 'U obradi', 'req.f.available': 'Dostupni', 'req.f.declined': 'Odbijeni',
      'req.total': 'Ukupno', 'req.pending': 'Na čekanju', 'req.approved': 'Odobreno', 'req.available': 'Dostupno', 'req.declined': 'Odbijeno',
      'req.s.pending': 'na čekanju', 'req.s.approved': 'odobreno', 'req.s.declined': 'odbijeno', 'req.s.failed': 'neuspjelo', 'req.s.completed': 'završeno',
      'req.m.waiting': 'čeka preuzimanje', 'req.m.processing': 'preuzima se', 'req.m.partial': 'djelomično dostupno', 'req.m.available': 'dostupno', 'req.m.deleted': 'obrisano',
      'req.approve': '✓ Odobri', 'req.decline': '✕ Odbij', 'req.deleteTitle': 'Obriši zahtjev',
      'req.noPending': 'Nema zahtjeva na čekanju 🎉', 'req.none': 'Nema zahtjeva',
      'req.confirmDelete': 'Obrisati zahtjev? (sadržaj u Radarru/Sonarru ostaje)', 'req.confirmDecline': 'Odbiti zahtjev?',
      'req.approvedToast': 'Zahtjev odobren', 'req.declinedToast': 'Zahtjev odbijen', 'req.deletedToast': 'Zahtjev obrisan',
      'add.placeholder': 'Naziv filma ili serije…', 'add.profile': 'Profil kvalitete', 'add.folder': 'Mapa', 'add.search': 'Traži',
      'add.searching': 'Tražim…', 'add.noResults': 'Nema rezultata', 'add.inLibrary': 'Već u knjižnici', 'add.addSearch': 'Dodaj i traži',
      'add.addOnly': 'Samo dodaj', 'add.added': 'Dodano: {title}', 'add.seasons': '{n} sezona',
      'set.appearance': 'Izgled', 'set.language': 'Jezik', 'set.langAuto': 'Automatski (preglednik)', 'set.theme': 'Tema',
      'set.accent': 'Naglasna boja', 'set.accentReset': 'Zadana boja teme', 'set.background': 'Dinamička pozadina',
      'set.intensity': 'Intenzitet', 'set.reactive': 'Reagira na brzinu preuzimanja', 'set.reactiveTitle': 'Animacija se ubrzava kad se nešto preuzima',
      'set.checkMedia': 'Provjeri slike knjižnice',
      'set.appearanceHint': 'Promjene se odmah vide kao pregled, a spremaju se gumbom <b>Spremi postavke</b>. „Zid postera” i „Slike iz knjižnice” koriste slike iz Radarra i Sonarra.',
      'set.url': 'URL', 'set.webUiUrl': 'URL Web UI-ja', 'set.apiKey': 'API ključ', 'set.user': 'Korisnik', 'set.pass': 'Lozinka', 'set.test': 'Testiraj vezu',
      'set.general': 'Općenito', 'set.refresh': 'Osvježavanje (sekundi)', 'set.port': 'Port', 'set.portHint': 'Promjena zahtijeva ponovno pokretanje servisa',
      'set.login': 'Prijava u ArrHub', 'set.loginPh': 'prazno = bez prijave', 'set.authHint': 'Bez prijave svatko u mreži može mijenjati ove postavke.',
      'set.reset': 'Poništi', 'set.save': 'Spremi postavke', 'set.savedIn': 'Spremljeno u {file}', 'set.lockedN': '{n} polja zaključano varijablama okruženja',
      'set.lockedTitle': 'Postavljeno varijablom okruženja', 'set.checking': 'Provjeravam…', 'set.saved': 'Postavke spremljene',
      'set.savedRestart': 'Spremljeno. Novi port vrijedi nakon ponovnog pokretanja servisa.',
      'set.fetchingLib': 'Dohvaćam knjižnicu…', 'set.noArr': 'Radarr ni Sonarr nisu podešeni', 'set.imgOk': 'slike ✓',
      'set.noImg': '✕ nema slika', 'set.imgFail': '✕ slike se ne učitavaju: {msg}',
      'set.libLine': '{svc}: {items} {kind}, {posters} postera, {fanart} pozadina, {img}', 'set.movies': 'filmova', 'set.seriesPl': 'serija',
      'about.title': 'O aplikaciji', 'about.notes': 'Bilješke izdanja', 'about.check': 'Provjeri ažuriranja', 'about.checking': 'Provjeravam ažuriranja…',
      'about.upToDate': '✓ Koristiš najnoviju verziju', 'about.newVersion': 'Dostupna je nova verzija {v}', 'about.whatsNew': 'Što je novo',
      'about.checkFailed': 'Provjera ažuriranja nije uspjela: {msg}', 'about.dev': 'Razvojna verzija',
      'set.cardIconsTitle': 'Ikone servisa na karticama', 'set.cardIcons': 'Prikaži veliku ikonu servisa iza svake kartice', 'set.iconStrength': 'Jačina',
      'set.iconReload': 'Ponovno učitaj ikone', 'set.iconOfficial': 'službena ikona', 'set.iconGeneric': 'generička ikona',
      'c.openService': 'Otvori {svc}', 'set.link': 'Poveznica u karticama (neobavezno)', 'set.linkPh': 'https://servis.primjer.hr',
      'set.linkHint': 'Otvara se iz kartica – npr. adresa preko reverse proxyja. Prazno = URL iznad.',
      'set.insecure': 'Prihvati samopotpisani certifikat', 'set.insecureHint': 'Samo za vlastiti https:// servis u lokalnoj mreži – certifikat se ne provjerava.',
      'set.tlsTitle': 'SSL / TLS – vlastiti CA certifikat', 'set.ca': 'CA certifikat (PEM)',
      'set.caHint': 'Zalijepi certifikat svog izdavatelja certifikata (javni .crt / .pem, ne privatni ključ). ArrHub će njime potpuno provjeravati tvoje https:// servise. Može se zalijepiti i više certifikata (lanac) jedan za drugim.',
      'set.caLoaded': 'Vjeruje se: {list}', 'set.caValid': 'vrijedi do {date}', 'set.caNone': 'Nema vlastitog CA certifikata – vjeruje se samo sistemskim izdavateljima certifikata.',
      'log.level': 'Razina', 'log.lv.all': 'Sve razine', 'log.lv.info': 'Info i više', 'log.lv.warn': 'Upozorenja i greške', 'log.lv.error': 'Samo greške',
      'log.search': 'Pretraži log…', 'log.auto': 'Automatski osvježi', 'log.reload': 'Osvježi', 'log.download': 'Preuzmi',
      'log.info': '{shown} od {total} zapisa · najnoviji prvi · osvježeno {time}', 'log.empty': 'Nema zapisa koji odgovaraju.', 'log.loading': 'Učitavanje…',
      'log.arrhubNote': 'ArrHub čuva zadnjih 1000 poruka u memoriji; brišu se pri ponovnom pokretanju.',
      'req.perPage': 'Po stranici', 'req.page': 'Stranica {page} od {pages}', 'req.range': '{from}–{to} od {total}', 'req.first': 'Prva stranica', 'req.prev': 'Prethodna stranica', 'req.next': 'Sljedeća stranica', 'req.last': 'Zadnja stranica',
      'set.netTitle': 'Mreža', 'set.offline': 'Bez interneta – ne spajaj se na internet',
      'set.offlineHint': 'ArrHub tada razgovara samo s tvojim servisima: nema provjere nove verzije na GitHubu ni slika s TMDB-a/TVDB-a. Posteri i pozadine dolaze samo iz Radarra i Sonarra (MediaCover), a posteri zahtjeva iz Seerrove predmemorije slika. Stavke bez lokalne slike prikazuju prazno polje.',
      'about.offline': 'Bez interneta – provjera nove verzije je isključena',
      'nav.docker': 'Docker',
      'dk.check': 'Provjeri ažuriranja', 'dk.checking': 'Provjera ažuriranja…', 'dk.checkedAgo': 'Ažuriranja provjerena {ago}', 'dk.updateAll': 'Ažuriraj sve ({n})',
      'dk.f.all': 'Svi', 'dk.f.running': 'Rade', 'dk.f.stopped': 'Zaustavljeni', 'dk.f.updates': 'Ažuriranja', 'dk.search': 'Pretraži kontejnere…',
      'dk.authWarn': 'Prijava u ArrHub je isključena – bilo tko na tvojoj mreži može zaustaviti ili ažurirati tvoje kontejnere. Postavi korisničko ime i lozinku u Postavkama.',
      'dk.runningOf': 'kontejnera radi', 'dk.stoppedN': 'Zaustavljeni', 'dk.unhealthyN': 'Nezdravi', 'dk.updatesN': 'Ažuriranja', 'dk.open': 'Otvori Docker',
      'dk.updAvailable': 'dostupno ažuriranje', 'dk.updCurrent': 'ažurno', 'dk.updLocal': 'Noviji image je već na Docker hostu', 'dk.updUnknown': 'nepoznato',
      'dk.pinned': 'fiksna verzija', 'dk.pinnedHint': 'Image je vezan na digest – ažuriraj ga u compose datoteci',
      'dk.start': 'Pokreni', 'dk.stop': 'Zaustavi', 'dk.restart': 'Restart', 'dk.logs': 'Logovi', 'dk.update': 'Ažuriraj', 'dk.sharedNet': 'dijeljena mreža',
      'dk.h.healthy': 'zdrav', 'dk.h.unhealthy': 'nezdrav', 'dk.h.starting': 'pokreće se', 'dk.noProject': 'Ostali kontejneri',
      'dk.step.queued': 'Čeka…', 'dk.step.pulling': 'Preuzimanje image-a…', 'dk.step.stopping': 'Zaustavljanje…', 'dk.step.creating': 'Stvaranje novog kontejnera…',
      'dk.step.starting': 'Pokretanje…', 'dk.step.verifying': 'Provjera radi li…', 'dk.step.cleanup': 'Čišćenje…', 'dk.step.done': 'Gotovo',
      'dk.updated': 'ažuriran', 'dk.alreadyCurrent': 'već je ažuran', 'dk.showLog': 'Prikaži detalje',
      'dk.confirmUpdate': 'Ažurirati {name}?\n\nPreuzima se novi image, a kontejner se ponovno stvara s istim postavkama. Ako se nova verzija ne pokrene, vraća se stari kontejner.',
      'dk.confirmUpdateAll': 'Ažurirati {n} kontejnera jedan za drugim?\n\n{names}',
      'dk.confirm.stop': 'Zaustaviti {name}?', 'dk.confirm.restart': 'Ponovno pokrenuti {name}?',
      'dk.done.start': 'pokrenut', 'dk.done.stop': 'zaustavljen', 'dk.done.restart': 'ponovno pokrenut', 'dk.done.pause': 'pauziran', 'dk.done.unpause': 'nastavljen',
      'set.dockerUrl': 'Adresa Dockera', 'set.dockerUrlHint': 'Adresa Docker hosta. Preporuka: <b>docker-socket-proxy</b> na tom hostu (<code>http://host:2375</code>). Može i <code>https://host:2376</code> s TLS certifikatima ili <code>unix:///var/run/docker.sock</code> ako ArrHub radi na istom hostu. <a href="https://github.com/moordrak/ArrHub/blob/main/README.hr.md#upravljanje-dockerom" target="_blank" rel="noopener">Upute za postavljanje</a>',
      'set.dockerLinkPh': 'https://portainer.example.com', 'set.dockerLinkHint': 'Npr. Portainer ili Dockge, otvara se iz Docker kartice.',
      'set.dockerCleanup': 'Obriši stari image nakon ažuriranja', 'set.dockerTls': 'TLS klijentski certifikati (samo za https://)',
      'set.dockerCa': 'CA certifikat (ca.pem)', 'set.dockerCert': 'Klijentski certifikat (cert.pem)', 'set.dockerKey': 'Klijentski ključ (key.pem)', 'set.dockerKeyHint': 'Sprema se kao lozinka i više se ne prikazuje.',
      'theme.auto': 'Automatski', 'theme.dark': 'Tamna', 'theme.oled': 'OLED crna', 'theme.light': 'Svijetla', 'theme.pastel-lavender': 'Pastel lavanda', 'theme.pastel-peach': 'Pastel breskva',
      'bg.none': 'Bez pozadine', 'bg.aurora': 'Aurora', 'bg.stars': 'Zvjezdano nebo', 'bg.particles': 'Mreža čestica', 'bg.waves': 'Valovi',
      'bg.posters': 'Zid postera', 'bg.fanart': 'Slike iz knjižnice',
      'bg.noPosters': 'Nema postera u knjižnici', 'bg.noImages': 'Nema slika u knjižnici', 'bg.postersFail': 'Posteri se ne mogu učitati',
      'bg.imagesFail': 'Slike iz knjižnice se ne mogu učitati', 'bg.fallback': '{msg} – prikazujem Auroru. Detalji su u Postavkama.',
    },
  };
  const LOCALES = { en: 'en-GB', hr: 'hr-HR' };
  let lang = 'en';

  function resolve(pref) {
    if (DICT[pref]) return pref;
    return (navigator.languages || [navigator.language || 'en']).some(l => /^hr\b/i.test(l)) ? 'hr' : 'en';
  }
  function t(key, vars) {
    const s = DICT[lang][key] ?? DICT.en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
  }
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    document.documentElement.lang = lang;
  }
  function setLang(pref) {
    const next = resolve(pref);
    const changed = next !== lang;
    lang = next;
    try { localStorage.setItem('arrhub-lang', lang); } catch {}
    apply();
    return changed;
  }
  // first paint: last used language (avoids a flash of the wrong language)
  try { const saved = localStorage.getItem('arrhub-lang'); if (DICT[saved]) lang = saved; } catch {}

  window.I18N = { t, apply, setLang, get lang() { return lang; }, get locale() { return LOCALES[lang]; } };
  window.t = t;
})();
