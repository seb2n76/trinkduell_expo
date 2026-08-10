# E-Mail-Versand einrichten (Resend)

Kurzanleitung, um echten E-Mail-Versand für den Passwort-Reset-Flow zu aktivieren.
Solange kein API-Key gesetzt ist, schreibt der Server den Reset-Code ins
**Server-Log** (`docker compose logs backend`) statt ihn zu verschicken. Der
Code wird **nie** an den Client ausgeliefert — früher war das der Fall, und
weil `sendEmail()` auch bei jedem Resend-Ausfall „nicht gesendet" meldet,
reichten damit zwei HTTP-Requests für eine Account-Übernahme.

Sobald ein API-Key gesetzt ist, schaltet der Server automatisch auf echten
E-Mail-Versand um, ganz ohne Code-Änderung.

## 1. Resend-Account anlegen

- Auf [resend.com](https://resend.com) kostenlos registrieren (3.000 E-Mails/Monat gratis)

## 2. Domain verifizieren

- Dashboard → **Domains** → **Add Domain** → `trinkduell.com` eingeben
- Resend zeigt dir mehrere DNS-Einträge (SPF-, DKIM-, ggf. DMARC-TXT-Records)
- Diese Einträge in deiner **Cloudflare-DNS-Zone** für `trinkduell.com` genauso anlegen
  (Cloudflare → DNS → Records → Add Record, Typ/Name/Wert 1:1 von Resend übernehmen)
- Zurück im Resend-Dashboard auf **Verify** klicken — läuft über Cloudflare meist
  innerhalb weniger Minuten durch

## 3. API-Key erstellen

- Dashboard → **API Keys** → **Create API Key**
- Permission auf **Sending access** einschränken (nicht "Full access" — der
  Key muss nur E-Mails verschicken können, sonst nichts)
- Den Key **einmalig** angezeigt bekommen, direkt kopieren

## 4. Key auf dem Server eintragen

In `/opt/trinkduell/server/.env` (auf deinem Proxmox-Container) ergänzen:

```bash
RESEND_API_KEY=re_dein_echter_key
RESEND_FROM_EMAIL=TrinkDuell <noreply@trinkduell.com>
```

Danach Backend neu starten, damit die neue Variable geladen wird:

```bash
cd /opt/trinkduell
docker compose -f server/docker-compose.yml up -d --build
```

## 5. Testen

„Passwort vergessen" in der App durchspielen — die E-Mail sollte innerhalb
weniger Sekunden ankommen (ggf. Spam-Ordner prüfen, direkt nach der
Domain-Verifizierung kann die Reputation noch niedrig sein). Kommt keine Mail
an: `docker compose -f server/docker-compose.yml logs backend` prüfen, dort
loggt der Server Zustellfehler mit `[Email]`-Präfix.

## Ohne eigene Domain

Falls du das erstmal ohne Domain-Verifizierung testen willst: Resend erlaubt
Versand über eine Sandbox-Domain (`onboarding@resend.dev`), aber **nur an die
E-Mail-Adresse, mit der du dich bei Resend registriert hast**. Für die
Freundes-Beta reicht das nicht (andere Empfänger), aber zum schnellen
Durchtesten des eigenen Accounts genügt es — dafür `RESEND_FROM_EMAIL` einfach
auf `onboarding@resend.dev` lassen bzw. weglassen (Server nutzt dann den
Default).
