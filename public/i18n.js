// ArrHub — translations (en / hr)
// Static HTML uses data-i18n / data-i18n-ph / data-i18n-title / data-i18n-html attributes; dynamic text uses t(key, vars).
'use strict';
(() => {
  const DICT = {
    en: {
      // navigation
      'nav.overview': 'Overview', 'nav.downloads': 'Downloads', 'nav.calendar': 'Calendar', 'nav.history': 'History',
      'nav.requests': 'Requests', 'nav.add': 'Add', 'nav.settings': '⚙ Settings',
      // common
      'c.loading': 'Loading…', 'c.error': 'Error: {msg}', 'c.done': 'Done', 'c.deleted': 'Deleted', 'c.removed': 'Removed',
      'c.empty': 'Empty', 'c.noRecords': 'No records', 'c.free': '{size} free', 'c.ratio': 'ratio {r}', 'c.notConfigured': '{svc} is not configured',
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
      // themes & backgrounds
      'theme.auto': 'Automatic', 'theme.dark': 'Dark', 'theme.oled': 'OLED black', 'theme.light': 'Light',
      'bg.none': 'No background', 'bg.aurora': 'Aurora', 'bg.stars': 'Starfield', 'bg.particles': 'Particle network', 'bg.waves': 'Waves',
      'bg.posters': 'Poster wall', 'bg.fanart': 'Library images',
      'bg.noPosters': 'No posters in the library', 'bg.noImages': 'No images in the library', 'bg.postersFail': 'Posters cannot be loaded',
      'bg.imagesFail': 'Library images cannot be loaded', 'bg.fallback': '{msg} – showing Aurora. Details are in Settings.',
    },
    hr: {
      'nav.overview': 'Pregled', 'nav.downloads': 'Preuzimanja', 'nav.calendar': 'Kalendar', 'nav.history': 'Povijest',
      'nav.requests': 'Zahtjevi', 'nav.add': 'Dodaj', 'nav.settings': '⚙ Postavke',
      'c.loading': 'Učitavanje…', 'c.error': 'Greška: {msg}', 'c.done': 'Gotovo', 'c.deleted': 'Obrisano', 'c.removed': 'Uklonjeno',
      'c.empty': 'Prazno', 'c.noRecords': 'Nema zapisa', 'c.free': '{size} slobodno', 'c.ratio': 'omjer {r}', 'c.notConfigured': '{svc} nije konfiguriran',
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
      'theme.auto': 'Automatski', 'theme.dark': 'Tamna', 'theme.oled': 'OLED crna', 'theme.light': 'Svijetla',
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
