// Server-side messages (en / hr) and the per-request language
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

// The language of each request comes from the X-Lang header the UI sends (falls back to the configured UI language).
const MSG = {
  en: {
    urlInvalid: '{svc}: invalid URL', linkInvalid: '{svc}: the link must be a full http:// or https:// address', urlScheme: '{svc}: URL must start with http:// or https://',
    needsKey: '{svc} needs an API key', authNeedsPass: 'An ArrHub login also needs a password', badPort: 'Invalid port',
    badTheme: 'Unknown theme', badBackground: 'Unknown background', badColor: 'Colour must be in #rrggbb format', badLang: 'Unknown language',
    unknownService: 'Unknown service', urlMissing: 'URL is not set', wrongApp: 'That address is {app}, not {svc}', user: 'user',
    badLogin: 'Wrong username or password', loginFailed: 'Login failed: {msg}', unknownAction: 'Unknown action', unknown: 'Unknown',
    badId: 'Invalid ID', unexpectedResponse: 'Unexpected response',
    imgRedirect: 'redirected to login ({status}) – authentication is enabled', imgDenied: 'access denied ({status})', img404: 'image does not exist (404)',
    notImage: 'not an image ({type})', unknownImage: 'Unknown image', local: 'local', noRemote: 'no internet URL available',
    timeout: 'Timed out (service is not responding)', noWrite: 'No permission to write {file}',
    netRefused: 'Connection refused – check the address and port', netNotFound: 'Host not found (DNS)', netHost: 'Host unreachable',
    netNet: 'Network unreachable', netTimeout: 'Connection timed out', netReset: 'Connection reset',
    netSelfSigned: 'The certificate is self-signed or locally signed – add your CA certificate in Settings or enable “Accept self-signed certificate” for this service',
    caInvalid: 'The CA certificate is not valid – paste the PEM text starting with -----BEGIN CERTIFICATE-----',
    caPrivateKey: 'That is a private key – paste only the CA certificate (-----BEGIN CERTIFICATE-----), never the key',
    netCertExpired: 'The TLS certificate has expired', netCertName: 'The TLS certificate does not match the address – the URL must use a name or IP listed in the certificate', fetchFailed: 'Connection failed',
    e401: 'Invalid API key or username/password (401)', e403: 'Access denied – check the API key (403)', e404: 'Not found (404) – check the URL and URL Base',
    noIcon: 'No icon found on the service', loginRequired: 'Login required', notFound: 'Not found', notConfigured: '{svc} is not configured', forbidden: 'Forbidden', badRequest: 'Bad request', offlineBlocked: 'Offline mode – ArrHub does not connect to {host}', offlineNoRemote: 'offline mode – no image from the internet',
    dockerNotConfigured: 'Docker is not configured', dockerBadUrl: 'Docker address must start with http://, https://, tcp://, ssh:// or unix:///',
    dockerBadCert: 'The Docker certificate must be PEM text starting with -----BEGIN CERTIFICATE-----', dockerBadKey: 'The Docker client key must be a PEM private key',
    dockerForbidden: 'The Docker socket proxy refused this request – allow CONTAINERS, IMAGES, NETWORKS, DISTRIBUTION, INFO, POST and ALLOW_LOGS',
    dockerForbiddenVar: 'The Docker socket proxy refused {what} – set {vars} on the socket-proxy container and recreate it',
    dockerNoSocket: 'Docker socket {path} not found', dockerSocketPerm: 'No permission for the Docker socket {path}',
    stackBadName: 'Stack name: lowercase letters, digits, - and _ (e.g. arr)', stackEmpty: 'The compose file is empty',
    stackConflict: 'These containers already exist and do not belong to this stack: {names} – tick "Replace existing containers" to replace them',
    stackNoNetwork: 'External network "{name}" does not exist – create it first (docker network create {name})', stackNoVolume: 'External volume "{name}" does not exist',
    stackNoImage: 'Image {image} is not on the Docker host and pull_policy is never', stackDepFailed: 'Dependency {name} did not start ({why})',
    stackBusy: 'This stack is already being deployed or removed', imageInUse: 'used by {names}',
    nIndexers: '{n} indexers',
    dockerOk: 'Connected – Docker {version}, {n} containers', dockerSelf: 'This is ArrHub\'s own container – it cannot stop or replace itself',
    dockerPinned: 'The image is pinned to a fixed version (digest) – change it in your compose file', dockerNoImage: 'The image could not be found after pulling',
    dockerAutoRemove: 'The container was started with --rm and would disappear when stopped – recreate it with docker compose',
    dockerCrashed: 'The new container stopped or kept restarting right after starting (exit code {code})',
    sshMissing: 'The ssh client is not installed (install the openssh-client package)', sshAuth: 'SSH login refused – add ArrHub\'s public key to ~/.ssh/authorized_keys of that user on the Docker host',
    sshHostKey: 'The Docker host\'s SSH key has changed – if that is expected, delete its line from {file}', sshNoDocker: 'Docker is not installed for that user on the Docker host (docker: command not found)',
    sshDockerGroup: 'That SSH user may not use Docker – add it to the docker group on the Docker host (sudo usermod -aG docker <user>)',
    sshBadKey: 'The SSH key is not a valid private key (OpenSSH format, -----BEGIN OPENSSH PRIVATE KEY-----)', sshPassphrase: 'The SSH key is protected with a passphrase – use a key without one',
    sshClosed: 'The SSH connection was closed by the Docker host', dockerUnhealthy: 'The new container reports itself as unhealthy', termNotRunning: 'The container is not running', npmBadUrl: 'Nginx Proxy Manager address must start with http:// or https:// (e.g. http://192.168.1.10:81)', npmAuth: 'Nginx Proxy Manager refused the login – check the e-mail and password', npmNotNpm: 'That address does not answer like Nginx Proxy Manager (use its admin address, usually port 81)', npmOk: 'Connected – {n} proxy hosts, {https} with SSL', termEnded: '[session ended]', termNoShell: 'This container has no shell (/bin/sh), so a terminal is not possible – this is normal for minimal (distroless) images.',
  },
  hr: {
    urlInvalid: '{svc}: neispravan URL', linkInvalid: '{svc}: poveznica mora biti puna http:// ili https:// adresa', urlScheme: '{svc}: URL mora počinjati s http:// ili https://',
    needsKey: '{svc} treba API ključ', authNeedsPass: 'Za prijavu u ArrHub treba i lozinka', badPort: 'Neispravan port',
    badTheme: 'Nepoznata tema', badBackground: 'Nepoznata pozadina', badColor: 'Boja mora biti u obliku #rrggbb', badLang: 'Nepoznat jezik',
    unknownService: 'Nepoznata usluga', urlMissing: 'URL nije upisan', wrongApp: 'Na toj adresi je {app}, ne {svc}', user: 'korisnik',
    badLogin: 'Pogrešno korisničko ime ili lozinka', loginFailed: 'Prijava nije uspjela: {msg}', unknownAction: 'Nepoznata akcija', unknown: 'Nepoznato',
    badId: 'Neispravan ID', unexpectedResponse: 'Neočekivan odgovor',
    imgRedirect: 'preusmjereno na prijavu ({status}) – uključena je autentifikacija', imgDenied: 'pristup odbijen ({status})', img404: 'slika ne postoji (404)',
    notImage: 'nije slika ({type})', unknownImage: 'Nepoznata slika', local: 'lokalno', noRemote: 'nema adrese na internetu',
    timeout: 'Isteklo vrijeme čekanja (usluga ne odgovara)', noWrite: 'Nema dozvole za pisanje u {file}',
    netRefused: 'Veza odbijena – provjeri adresu i port', netNotFound: 'Adresa nije pronađena (DNS)', netHost: 'Računalo nije dostupno',
    netNet: 'Mreža nije dostupna', netTimeout: 'Isteklo vrijeme povezivanja', netReset: 'Veza prekinuta',
    netSelfSigned: 'Certifikat je samopotpisan ili lokalno potpisan – dodaj svoj CA certifikat u Postavkama ili uključi „Prihvati samopotpisani certifikat” za ovaj servis',
    caInvalid: 'CA certifikat nije ispravan – zalijepi PEM tekst koji počinje s -----BEGIN CERTIFICATE-----',
    caPrivateKey: 'To je privatni ključ – zalijepi samo CA certifikat (-----BEGIN CERTIFICATE-----), nikad ključ',
    netCertExpired: 'TLS certifikat je istekao', netCertName: 'TLS certifikat ne odgovara adresi – URL mora koristiti ime ili IP naveden u certifikatu', fetchFailed: 'Povezivanje nije uspjelo',
    e401: 'Neispravan API ključ ili korisničko ime/lozinka (401)', e403: 'Pristup odbijen – provjeri API ključ (403)', e404: 'Nije pronađeno (404) – provjeri URL i URL Base',
    noIcon: 'Servis nema dostupnu ikonu', loginRequired: 'Potrebna prijava', notFound: 'Nije pronađeno', notConfigured: '{svc} nije konfiguriran', forbidden: 'Zabranjeno', badRequest: 'Neispravan zahtjev', offlineBlocked: 'Način bez interneta – ArrHub se ne spaja na {host}', offlineNoRemote: 'način bez interneta – nema slike s interneta',
    dockerNotConfigured: 'Docker nije podešen', dockerBadUrl: 'Adresa Dockera mora počinjati s http://, https://, tcp://, ssh:// ili unix:///',
    dockerBadCert: 'Docker certifikat mora biti PEM tekst koji počinje s -----BEGIN CERTIFICATE-----', dockerBadKey: 'Docker klijentski ključ mora biti PEM privatni ključ',
    dockerForbidden: 'Docker socket proxy je odbio zahtjev – dopusti CONTAINERS, IMAGES, NETWORKS, DISTRIBUTION, INFO, POST i ALLOW_LOGS',
    dockerForbiddenVar: 'Docker socket proxy je odbio {what} – postavi {vars} na socket-proxy kontejneru i ponovno ga pokreni',
    dockerNoSocket: 'Docker socket {path} nije pronađen', dockerSocketPerm: 'Nema dozvole za Docker socket {path}',
    stackBadName: 'Ime stacka: mala slova, brojke, - i _ (npr. arr)', stackEmpty: 'Compose datoteka je prazna',
    stackConflict: 'Ovi kontejneri već postoje i ne pripadaju ovom stacku: {names} – označi „Zamijeni postojeće kontejnere” da ih zamijeniš',
    stackNoNetwork: 'Vanjska mreža „{name}” ne postoji – prvo je napravi (docker network create {name})', stackNoVolume: 'Vanjski volumen „{name}” ne postoji',
    stackNoImage: 'Image {image} nije na Docker hostu, a pull_policy je never', stackDepFailed: 'Ovisnost {name} se nije pokrenula ({why})',
    stackBusy: 'Ovaj stack se upravo pokreće ili uklanja', imageInUse: 'koristi ga {names}',
    nIndexers: 'indeksera: {n}',
    dockerOk: 'Spojeno – Docker {version}, {n} kontejnera', dockerSelf: 'Ovo je ArrHubov vlastiti kontejner – ne može sam sebe zaustaviti ni zamijeniti',
    dockerPinned: 'Image je vezan na fiksnu verziju (digest) – promijeni ga u compose datoteci', dockerNoImage: 'Image nije pronađen nakon preuzimanja',
    dockerAutoRemove: 'Kontejner je pokrenut s --rm i nestao bi kad se zaustavi – ponovno ga stvori s docker compose',
    dockerCrashed: 'Novi kontejner se zaustavio ili se stalno ponovno pokreće odmah nakon pokretanja (izlazni kod {code})',
    sshMissing: 'SSH klijent nije instaliran (instaliraj paket openssh-client)', sshAuth: 'SSH prijava odbijena – dodaj ArrHubov javni ključ u ~/.ssh/authorized_keys tog korisnika na Docker hostu',
    sshHostKey: 'SSH ključ Docker hosta se promijenio – ako je to očekivano, obriši njegov redak iz {file}', sshNoDocker: 'Docker nije instaliran za tog korisnika na Docker hostu (docker: command not found)',
    sshDockerGroup: 'Taj SSH korisnik ne smije koristiti Docker – dodaj ga u grupu docker na Docker hostu (sudo usermod -aG docker <korisnik>)',
    sshBadKey: 'SSH ključ nije ispravan privatni ključ (OpenSSH format, -----BEGIN OPENSSH PRIVATE KEY-----)', sshPassphrase: 'SSH ključ je zaštićen lozinkom – koristi ključ bez nje',
    sshClosed: 'Docker host je zatvorio SSH vezu', dockerUnhealthy: 'Novi kontejner javlja da nije zdrav (unhealthy)', termNotRunning: 'Kontejner ne radi', npmBadUrl: 'Adresa Nginx Proxy Managera mora počinjati s http:// ili https:// (npr. http://192.168.1.10:81)', npmAuth: 'Nginx Proxy Manager je odbio prijavu – provjeri e-mail i lozinku', npmNotNpm: 'Ta adresa ne odgovara kao Nginx Proxy Manager (koristi njegovu admin adresu, obično port 81)', npmOk: 'Spojeno – {n} proxy hostova, {https} sa SSL-om', termEnded: '[sesija završena]', termNoShell: 'Ovaj kontejner nema ljusku (/bin/sh), pa terminal nije moguć – to je normalno za minimalne (distroless) image-e.',
  },
};
const LANGS = ['auto', 'en', 'hr'];
const langStore = new AsyncLocalStorage();
function T(key, vars = {}) {
  const lang = langStore.getStore() || 'en';
  const str = MSG[lang]?.[key] ?? MSG.en[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

module.exports = { LANGS, T, langStore, MSG };
