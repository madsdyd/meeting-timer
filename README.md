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
   min:sek-format (f.eks. `01:30`), og tryk på **Opret og styr herfra**. Du
   bliver sendt direkte videre til **styringssiden** (`/admin.html?token=...`)
   – hold dette link privat, det er her dirigenten starter, pauser, nulstiller
   og justerer tiden.
2. Styringssiden viser også **visningslinket** (`/view.html?token=...`) og en
   QR-kode til det – del det frit, f.eks. til talere/tilhørere. Det er
   skrivebeskyttet.
3. Alle åbne visninger opdateres automatisk, når dirigenten ændrer noget.

Visningen holder skærmen tændt, så længe den er åben (kræver https eller
localhost), og har en knap til fuldskærm, der vises de første 30 sekunder og
i 5 sekunder, når man rører musen eller skærmen.

### Visning på den enhed, mødet er oprettet på

Hvis mødet oprettes på den skærm, der skal vise timeren (f.eks. en tablet
eller en laptop ved talerstolen), styres det fra en telefon:

1. Opret mødet på skærmen med **Opret og vis på denne skærm**. Skærmen
   viser **Forbind din telefon** med en stor QR-kode til styringslinket
   (`/admin.html?token=...&setup=visning`).
2. Scan QR-koden med telefonen. Telefonen har nu styringssiden.
3. Tryk **Start visning** på skærmen. Den skifter til visningen og går i
   fuldskærm, hvor browseren kan. Adressen og historikken skiftes til
   visningslinket, så man ikke kan gå "tilbage" til styringen fra visningen,
   og en genindlæsning viser bare visningen.

Har man valgt **Opret og styr herfra** og vil skifte, findes det samme på
styringssiden: **Styr fra en anden enhed** viser QR-koden, og **Brug denne
skærm som visning** skifter til visningen.

### Vejledning

`/vejledning.html` er en kort vejledning til brugerne, linket fra forsiden. Den fylder én A4-side, når den
udskrives fra browseren. Skærmbillederne i `client/img/` tages med:

```bash
./tools/vejledning-billeder
```

Scriptet starter sin egen server (port 3199) og headless Chrome via `tools/claude-chrome` (port 9334), så det ikke
forstyrrer en server, der allerede kører. Kør det igen, når brugerfladen ændrer sig, og tjek udskriften.

## Designvalg og afgrænsninger

- **In-memory, ingen database.** Alt data (møder, tokens) ligger i serverens
  hukommelse og forsvinder ved genstart. Det er en bevidst afgrænsning for at
  holde løsningen simpel — bevidst valgt fremfor at tilføje en database.
  Et møde slettes efter 24 timer uden aktivitet (ingen handlinger og ingen
  åben visning), så møderne ikke hober sig op i hukommelsen. Der kan højst
  være 100 møder ad gangen: et nyt møde erstatter det, der har været ubrugt
  længst og ikke har en åben visning. Har alle en åben visning, afvises det.
  Et møde kan højst have 10 åbne visninger (inklusive styringssiden); en ny
  lukker den ældste, som så selv forbinder igen.
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
- **Klienten regner selv tiden lokalt.** Serveren pusher besked ved
  *ændringer* (start/pause/juster) og, mens timeren kører, en puls hvert 10.
  sekund. Hver besked har den resterende tid i millisekunder (`remainingMs`),
  og klienten tæller ned lokalt fra det tidspunkt beskeden ankom, så visningen
  er jævn uden at spamme serveren med opdateringer hvert sekund.
- **Ingen vægure i nedtællingen.** Både server og klient måler tid med et
  monotont ur (`performance.now()`), så et forkert eller justeret systemur
  (NTP, dvale, en telefon der retter sit ur) ikke flytter nedtællingen.
  Afvigelsen er den tid en besked er undervejs, og pulsen sørger for at den
  ikke hober sig op. Når en fane bliver synlig igen, genåbnes SSE-forbindelsen
  med det samme.
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
  vejledning.html    Kort vejledning til brugerne, én A4-side i print
  img/               Skærmbilleder til vejledningen (tools/vejledning-billeder)
  js/api.js          Wrapper omkring REST + SSE
  js/viewer.js       Visningen; bruges af view.html og når admin.html skifter til visning
  js/timerDisplay.js Delt render-logik for nedtælling/cirkel-animation
  css/style.css
```

## API (kort oversigt)

| Metode | Sti                              | Beskrivelse                          |
|--------|-----------------------------------|---------------------------------------|
| POST   | `/api/meetings`                   | Opret møde `{ title?, duration }`     |
| GET    | `/api/meetings/:token`            | Aktuel status                         |
| GET    | `/api/meetings/:token/events`     | SSE-stream af statusændringer og puls |
| POST   | `/api/meetings/:token/start`      | Start (kræver admin-token)            |
| POST   | `/api/meetings/:token/pause`      | Pause (kræver admin-token)            |
| POST   | `/api/meetings/:token/reset`      | Nulstil til oprindelig varighed       |
| POST   | `/api/meetings/:token/restart`    | Nulstil og start i ét trin            |
| POST   | `/api/meetings/:token/adjust`     | Sæt ny varighed `{ duration }`        |
| GET    | `/api/qr?text=...`                | SVG QR-kode for en vilkårlig tekst    |

Status (`GET`, SSE-begivenheden `state` og svaret på handlingerne) er
`{ id, title, role, duration, remaining, remainingMs, running, endsAt }`, og for
admin-token også `viewerToken`. `duration` og `remaining` er i sekunder,
`remainingMs` i millisekunder og negativ i overtid. Klienten tæller ned fra
`remainingMs`; `endsAt` er kun til information.

`duration` er højst 24 timer (86400 sekunder), ellers svarer serveren 400
`invalid-duration`. `title` er valgfri, men skal være en tekst på højst 200
tegn (efter trim), ellers 400 `invalid-title`. Kroppen må højst være 1 kB.
Er alle 100 møder i brug, svarer oprettelsen 503 `too-many-meetings`.

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

`.env` committes ikke; kopiér skabelonen og ret den: `cp .env.example .env`.

Containeren lytter kun på `127.0.0.1:3000` og er tænkt til at ligge bag en reverse proxy.

## Releasing

En version er dato og tidspunkt for buildet, f.eks. `2026-10-18-1530`. Den samme streng er tag på docker-imaget,
git-tag på det commit, det er bygget fra, og den version serveren logger ved opstart.

1. Ret [CHANGELOG.md](CHANGELOG.md): omdøb `## Unreleased` til datoen, f.eks. `## 2026-10-18`, og tilføj en ny, tom
   `## Unreleased` over den. Commit.
2. Kør `./release.sh` (eller `make release`). Den nægter at bygge, hvis der er ucommittede ændringer, eller hvis
   tagget findes i forvejen. Den bygger `meeting-timer:<version>`, tagger commit'et og skriver kommandoen til at
   pushe tagget. Den pusher aldrig selv.
3. Sæt `MEETING_TIMER_IMAGE=meeting-timer:<version>` i `.env` (se `.env.example`) og kør `docker compose up -d`.

Koden til en kørende version: `git show <version>`; ændringerne siden sidste: `git log <forrige>..<version>`.

## Licens

EUPL-1.2, se [LICENSE](LICENSE). Licensen er angivet efter [REUSE](https://reuse.software)-specifikationen i
`REUSE.toml`, så filerne har ingen licensheadere. Tjek med `reuse lint`.

