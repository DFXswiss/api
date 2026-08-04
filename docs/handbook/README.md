# DFX API Handbook

Statische, deutschsprachige Übersichtsseite aller dokumentarischen und visuellen
Baseline-Artefakte dieses Backend-Repos. Ausgeliefert von nginx in einem Docker-Image
hinter Basic Auth unter [handbook.api.dfx.swiss](https://handbook.api.dfx.swiss).

## Keine Bild-Baselines

Dieses Repository hat **keine** Playwright-, Storybook- oder Visual-Regression-Screenshots
und keine `__screenshots__`-Ordner. Das Handbook zeigt bewusst nur die Artefakte, die
tatsächlich existieren (PDFs, Mail-Vorschauen, Markdown, Diagramme, Laufzeit-Assets,
AsyncAPI). Fehlende Screenshot-Sektionen sind **kein Bug**.

## Wie es funktioniert

Das Assembly-Script `scripts/handbook/build.js` **findet** Artefakte selbst (kein
handgepflegtes Mapping, kein exakter Count-Guard):

| Kategorie | Schlüssel | Quelle |
|-----------|-----------|--------|
| Beispielbelege | `pdfs` | rekursiver `*.pdf`-Scan ab Repo-Root (mit Ausschlussliste) |
| Mail-Vorschauen | `mails` | Generator `scripts/generate-realunit-previews.js` → `scripts/email-previews/realunit/` |
| Dokumentation | `docs` | rekursiver `*.md`-Scan ab Repo-Root (mit Ausschlussliste) |
| Diagramme | `diagrams` | `src/subdomains/supporting/dex/docs/DEX_Module.{jpg,drawio}` |
| Assets | `assets` | `assets/*.png` (Open-CryptoPay-Sticker) |
| Spezifikationen | `specs` | `src/integration/exchange/docs/scrypt-asyncapi.yaml` (+ README) |

Ausgabe pro Build:

```
docs/handbook/build/
  index.html
  manifest.json
  pdfs/…
  mails/…
  docs/…
  diagrams/…
  assets/…
  specs/…
```

Guards (Build bricht ab bei Verletzung; Überschreitung ist nie ein Fehler):

- **Floor:** mindestens 11 PDFs, 24 Mails, 17 Docs, 10 Assets
- **Magic-Bytes + Mindestgrösse:** PDF `%PDF`, PNG, JPEG; jeweils > 1000 Bytes
- **HTML-Integrität:** jedes Artefakt im Manifest muss auf Disk existieren; jedes lokale `src`/`href` in generierten Doc-Seiten muss auf eine Repo-Datei zeigen (existierende, aber nicht ins Handbook kopierte Dateien → Warnung; fehlende Pfade → Fehler;
  Verweise, die aus dem Repo-Root ausbrechen → Fehler). Verweise auf Handbook-Artefakte (Dokumente,
  Assets, Specs, PDFs) werden beim Rendern auf deren Ausgabepfad umgeschrieben, damit sie im ausgelieferten
  Handbook nicht ins Leere zeigen
- **Mail-Trigger:** stdout- und stderr-Zeilen, die mit `[trigger] Missing` beginnen, sind ein Fehler

Metadaten in `scripts/handbook/metadata.json` sind **nur Anreicherung** (deutsche Titel/
Beschreibungen). Fehlende Einträge sind kein Fehler; verwaiste Einträge erzeugen nur
eine Warnung auf stderr.

## Lokal bauen

`handlebars` und `marked` werden **isoliert** installiert — nicht in `package.json` /
Lockfile des Repos:

```bash
npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund handlebars marked@15.0.7
NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js docs/handbook/build
```

Anschliessend `docs/handbook/build/index.html` im Browser öffnen.

Die Verzeichnisse `_handbook-deps/` und `docs/handbook/build/` sind gitignored.

Optional: `GIT_SHA=…` setzt den Stand im Seitenkopf (Fallback `unknown`).

## PDF-Beispiele regenerieren

```bash
GENERATE_RECEIPT_EXAMPLES=true npx jest realunit-receipt-example
GENERATE_STATEMENT_EXAMPLE=true npx jest realunit-statement-example
```

Die Specs liegen unter
`src/subdomains/supporting/payment/services/__tests__/`.

## Docker-Image lokal

**BuildKit ist Pflicht.** Das Handbook braucht Pfade, die die allgemeine
`.dockerignore` ausschliesst (`.github/`, `infrastructure/`, `README.md`), und holt
sie sich über die dateispezifische `Dockerfile.handbook.dockerignore` zurück. Diese
Konvention kennt **nur** BuildKit. Baut man mit dem Legacy-Builder, gilt die
allgemeine `.dockerignore`, vier Markdown-Dateien fehlen im Kontext, und der
Floor-Guard bricht mit `found 16 markdown docs, need at least MIN_DOCS=17` ab —
korrektes fail-loud-Verhalten, aber die Ursache ist ohne diesen Hinweis nicht zu
erraten. Abhilfe: `DOCKER_BUILDKIT=1` setzen oder das `buildx`-Plugin installieren.
In der CI ist das kein Thema, dort läuft `docker/setup-buildx-action`.

```bash
DOCKER_BUILDKIT=1 docker build -f Dockerfile.handbook \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  -t dfx-api-handbook:local .

# Credentials nur zur lokalen Prüfung — echte Werte kommen von der Deployment-Umgebung
docker run --rm -p 8080:8080 \
  -e HANDBOOK_USER=local \
  -e HANDBOOK_PASSWORD=local \
  dfx-api-handbook:local
```

- `http://127.0.0.1:8080/healthz` → `200 OK` ohne Auth
- `http://127.0.0.1:8080/` → `401` ohne Auth, `200` mit Basic Auth
- PDFs unter `/pdfs/…` werden mit `Content-Disposition: inline` ausgeliefert

Ohne `HANDBOOK_USER` / `HANDBOOK_PASSWORD` startet der Container **nicht** (fail loud).

## Neue Artefakte

1. Datei am erwarteten Ort ablegen und committen (z. B. neues PDF unter
   `docs/examples/…`, neues `*.md`, neues `assets/*.png`).
2. Nächster Handbook-Build nimmt sie per Auto-Discovery auf — **keine** Mapping-Tabelle
   und **keinen** Count anpassen.
3. Optional: in `scripts/handbook/metadata.json` deutschen Titel/Beschreibung ergänzen.

## Deployment

Bei Push auf `develop` (relevante Pfade) baut `.github/workflows/handbook-deploy.yaml`
das Image `dfxswiss/dfx-api-handbook:latest` (linux/arm64), pusht es und löst den
serverseitigen Deploy-Hook aus. Anschliessend Smoke gegen
`https://handbook.api.dfx.swiss/healthz`.

Pull Requests (nicht-Draft) laufen über `.github/workflows/handbook-check.yaml`
(Image-Build ohne Push + Container-Smoke).

Basic-Auth-Zugangsdaten werden **ausschliesslich** in der Deployment-Umgebung als
`HANDBOOK_USER` / `HANDBOOK_PASSWORD` gesetzt. Weder Klartext noch Hash gehören in
dieses Repository.
