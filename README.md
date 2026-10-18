# Talerstol Timer

En simpel webapp til at styre taletid til møder med mange talere: en dirigent
starter/pauser/justerer en nedtælling, og alle andre (talere og tilhørere) kan
følge med på deres egen telefon/skærm i realtid.

## Hurtig start

```bash
cd server
npm install
npm start
```

Åbn `http://localhost:3000` i en browser. Serveren afvikler både API'et og
client-siderne (statisk) på samme port, så der er kun én proces at starte.

Kør tests med:

```bash
cd server
npm test
```

## Sådan bruges den

1. Gå til `/` og opret et møde/punkt med en titel (valgfri) og en varighed i
   min:sek-format (f.eks. `01:30`). Du bliver sendt direkte videre til
   **styringssiden** (`/admin.html?token=...`) – hold dette link privat, det
   er her dirigenten starter, pauser, nulstiller og justerer tiden.
2. Styringssiden viser også **visningslinket** (`/view.html?token=...`) og en
   QR-kode til det – del det frit, f.eks. til talere/tilhørere. Det er
   skrivebeskyttet.
3. Alle åbne visninger opdateres automatisk, når dirigenten ændrer noget.

## Designvalg og afgrænsninger

- **In-memory, ingen database.** Alt data (møder, tokens) ligger i serverens
  hukommelse og forsvinder ved genstart. Det er en bevidst afgrænsning for at
  holde løsningen simpel — bevidst valgt fremfor at tilføje en database.
- **To tokens pr. møde** (admin/viewer) i stedet for login. Der er ingen
  brugerkonti — den der har admin-linket kan styre, alle andre kan kun se.
  Tokens er tilfældige (12 URL-sikre tegn), hvilket er "sikkert nok" til
  brugsscenariet (internt møde), men ikke tænkt som en sikkerhedsløsning i
  streng forstand.
- **Server-Sent Events (SSE)** i stedet for polling eller WebSockets: giver
  opdateringer med det samme uden ekstra bibliotek (indbygget `EventSource` i
  browseren), og passer godt til at trafikken kun går én vej (server →
  klienter) — kun dirigenten sender kommandoer, og det sker via almindelige
  REST-kald.
- **Klienten regner selv tiden lokalt.** Serveren gemmer kun et sluttidspunkt
  (`endsAt`) og pusher kun besked ved *ændringer* (start/pause/juster).
  Klienten tæller ned lokalt ud fra `endsAt` og sit eget ur, så visningen er
  jævn uden at spamme serveren med opdateringer hvert sekund.
- **Overtid i stedet for stop ved 0.** Nedtællingen fortsætter i minus, og
  visningen blinker rødt, så det er tydeligt at taleren er "gået i overtid" -
  i stedet for bare at vise "00:00".
- **Én taler ad gangen.** Der er bevidst ikke lavet en talerliste/dagsorden -
  dirigenten justerer varigheden manuelt mellem talere via "Sæt tid".
- **Justering af tid** nulstiller altid til den nye varighed (pauset), uanset
  om timeren kørte eller ej — enklere regel end at kræve pause først.
- **Vanilla JS/HTML/CSS uden build-step** for både server- og klientkode, så
  koden er let at læse og ændre uden værktøjskæde.
- **QR-koder genereres server-side** (npm-pakken `qrcode`) og leveres som
  SVG, så klienten ikke behøver noget QR-bibliotek i browseren.

## Struktur

```
server/            Express-server (REST API + SSE + statiske client-filer)
  server.js        Ruter og HTTP-håndtering
  meetingStore.js   In-memory datamodel og forretningslogik for møder/timere
  server.test.js    API-tests (node:test)
client/             Statiske sider, ingen build-step
  index.html        Opret nyt møde
  admin.html         Dirigentens styringsside
  view.html          Skrivebeskyttet visning
  js/api.js          Wrapper omkring REST + SSE
  js/timerDisplay.js Delt render-logik for nedtælling/cirkel-animation
  css/style.css
```

## API (kort oversigt)

| Metode | Sti                              | Beskrivelse                          |
|--------|-----------------------------------|---------------------------------------|
| POST   | `/api/meetings`                   | Opret møde `{ title?, duration }`     |
| GET    | `/api/meetings/:token`            | Aktuel status                         |
| GET    | `/api/meetings/:token/events`     | SSE-stream af statusændringer         |
| POST   | `/api/meetings/:token/start`      | Start (kræver admin-token)            |
| POST   | `/api/meetings/:token/pause`      | Pause (kræver admin-token)            |
| POST   | `/api/meetings/:token/reset`      | Nulstil til oprindelig varighed       |
| POST   | `/api/meetings/:token/adjust`     | Sæt ny varighed `{ duration }`        |
| GET    | `/api/qr?text=...`                | SVG QR-kode for en vilkårlig tekst    |

## Hvad der er skåret fra (givet tidsrammen)

- Ingen liste af flere talere/dagsordenspunkter i samme møde.
- Ingen historik/log over brugt taletid.
- Ingen autentificering ud over de tilfældige tokens.
- Ingen persistens — data er væk ved serverens genstart.

## Docker

```bash
make image                  # byg et image fra arbejdskopien
docker compose up -d        # kør det (meeting-timer:dev, eller MEETING_TIMER_IMAGE fra .env)
```

Containeren lytter kun på `127.0.0.1:3000` og er tænkt til at ligge bag en reverse proxy.

## Releasing

En version er dato og tidspunkt for buildet, f.eks. `2026-10-18-1530`. Den samme streng er tag på docker-imaget,
git-tag på det commit, det er bygget fra, og den version serveren logger ved opstart.

1. Ret [CHANGELOG.md](CHANGELOG.md): omdøb `## Unreleased` til datoen, f.eks. `## 2026-10-18`, og tilføj en ny, tom
   `## Unreleased` over den. Commit.
2. Kør `./release.sh` (eller `make release`). Den nægter at bygge, hvis der er ucommittede ændringer, eller hvis
   tagget findes i forvejen. Den bygger `meeting-timer:<version>`, tagger commit'et og skriver kommandoen til at
   pushe tagget. Den pusher aldrig selv.
3. Sæt `MEETING_TIMER_IMAGE=meeting-timer:<version>` i `.env` og kør `docker compose up -d`.

Koden til en kørende version: `git show <version>`; ændringerne siden sidste: `git log <forrige>..<version>`.

## Licens

EUPL-1.2, se [LICENSE](LICENSE). Licensen er angivet efter [REUSE](https://reuse.software)-specifikationen i
`REUSE.toml`, så filerne har ingen licensheadere. Tjek med `reuse lint`.

