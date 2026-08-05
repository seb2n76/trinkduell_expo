# TrinkDuell Backend – frischer LXC-Container mit Docker + Cloudflare Tunnel

Diese Anleitung baut das Backend (Express + Postgres, via `server/docker-compose.yml`)
komplett neu auf einem frischen Proxmox-LXC-Container auf und macht es über einen
Cloudflare Tunnel erreichbar — ohne dass am Proxmox-Host irgendein Port nach außen
geöffnet werden muss.

## Warum neu aufsetzen statt den alten Container weiterzuverwenden?

Das alte Postgres-Passwort war eine Zeit lang öffentlich auf GitHub sichtbar. Ein
frischer Container mit neu generierten Secrets ist die sauberste Garantie, dass
nirgendwo (Docker-Volume, Shell-History, Logs) noch ein Rest des alten Passworts
übrig bleibt, das man sonst mühsam einzeln aufspüren müsste.

## Voraussetzungen

- Zugriff auf die Proxmox-WebUI oder -Shell
- Ein Cloudflare-Account mit der Domain, unter der `api.deine-domain.de` (oder
  ähnlich) laufen soll, im Cloudflare-DNS verwaltet

---

## 1. Neuen LXC-Container erstellen

**Proxmox WebUI → Node auswählen → "Create CT"**

- **General**: Hostname z. B. `trinkduell-backend`, Passwort setzen
- **Template**: Debian 12 ("bookworm") oder Ubuntu 24.04 — falls noch nicht
  vorhanden, unter *Node → local (Storage) → CT Templates → Templates* herunterladen
- **Disks**: 8–16 GB reichen für dieses Setup
- **CPU**: 2 Cores
- **Memory**: 2048 MB RAM, 512 MB Swap
- **Network**: DHCP oder feste IP in deinem internen Netz, Bridge `vmbr0`

### Docker-Unterstützung aktivieren (wichtig, vor dem ersten Start!)

Container auswählen → **Options → Features** bearbeiten → Häkchen setzen bei:

- `nesting`
- `keyctl`

Speichern, dann Container starten.

> Falls Docker später trotzdem mit "permission denied" bei bestimmten
> Capabilities meckert: Container als **privilegiert** neu anlegen (beim
> Erstellen "Unprivileged container" deaktivieren). Etwas weniger isoliert,
> aber unkompliziert und für einen dedizierten Backend-Container ein
> akzeptabler Kompromiss.

---

## 2. Docker & Docker Compose im Container installieren

Konsole/SSH in den neuen Container, dann (Debian-Beispiel; bei Ubuntu
`debian` durch `ubuntu` in der Repo-URL ersetzen):

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

docker run hello-world
```

Wenn `hello-world` erfolgreich durchläuft, funktioniert Docker im Container.

---

## 3. Repo klonen

```bash
cd /opt
git clone https://github.com/seb2n76/trinkduell_expo.git
cd trinkduell_expo/server
```

---

## 4. Secrets erzeugen und in `.env` eintragen

```bash
cp .env.example .env
openssl rand -hex 32       # → als JWT_SECRET verwenden
openssl rand -base64 24    # → als POSTGRES_PASSWORD verwenden
nano .env
```

Trage die beiden generierten Werte ein (`POSTGRES_USER`/`POSTGRES_DB` können die
Standardwerte aus `.env.example` behalten). **Wichtig:** `.env` niemals committen
— sie ist bereits in `.gitignore` gelistet.

---

## 5. Backend starten

```bash
cd /opt/trinkduell_expo
docker compose -f server/docker-compose.yml up -d --build
docker compose -f server/docker-compose.yml logs -f backend
```

Erwartete Ausgabe u. a.:

```
[TrinkDuell Backend] Server läuft auf http://localhost:5000
[Migration] No plaintext passwords found — db is up-to-date.
```

Kurzer Funktionstest von innerhalb des Containers:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@test.de","password":"test1234"}'
```

Antwort sollte JSON mit `user` und `token` sein.

---

## 6. Cloudflare Tunnel einrichten

Kurzfassung, da du das Prinzip schon kennst:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
dpkg -i cloudflared.deb

cloudflared tunnel login
cloudflared tunnel create trinkduell-backend
```

Config-Datei anlegen (Pfad steht in der Ausgabe von `tunnel create`, meist
`/root/.cloudflared/config.yml`):

```yaml
tunnel: <TUNNEL-ID aus der Ausgabe>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: api.deine-domain.de
    service: http://localhost:5000
  - service: http_status:404
```

DNS-Eintrag automatisch anlegen:

```bash
cloudflared tunnel route dns trinkduell-backend api.deine-domain.de
```

Als Systemdienst installieren, damit der Tunnel Neustarts übersteht:

```bash
cloudflared service install
systemctl enable --now cloudflared
```

---

## 7. App auf den neuen Server zeigen lassen

In [`src/services/config.ts`](../src/services/config.ts):

```ts
const PRODUCTION_API_URL = "https://api.deine-domain.de";
export const ACTIVE_ENV: "local" | "production" = "production";
```

Sag mir kurz Bescheid, sobald die Domain feststeht — dann trage ich das ein und
wir testen zusammen.

---

## 8. Checkliste vor dem Live-Schalten

- [ ] `docker compose -f server/docker-compose.yml ps` zeigt `db` und `backend`
      als `running`
- [ ] Registrierung/Login über die App funktioniert gegen die echte Domain
- [ ] `docker volume ls` zeigt ein `pgdata`-Volume (Datenpersistenz über
      Neustarts hinweg)
- [ ] Alten Container/Setup erst stilllegen, wenn der neue nachweislich läuft
- [ ] Regelmäßiges Backup einrichten, bevor echte Nutzer:innen draufkommen
      (siehe unten)

## Optional: Einfaches automatisches Backup

Cronjob im Container, der täglich einen `pg_dump` in ein lokales Verzeichnis
schreibt (für mehr Sicherheit zusätzlich auf den Proxmox-Host oder extern
kopieren):

```bash
# Crontab-Eintrag (crontab -e), täglich um 03:00 Uhr:
0 3 * * * docker exec trinkduell-db pg_dump -U trinkduell_user trinkduell > /opt/backups/trinkduell_$(date +\%F).sql
```

`/opt/backups` vorher anlegen (`mkdir -p /opt/backups`).
