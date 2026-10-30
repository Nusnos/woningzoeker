# Woningzoeker

Actuele koop- en huurwoningen zoeken op locatie, hemelsbrede straal, minimum- en maximumprijs en eigen zoekwoorden. Gebouwd voor het bestaande Vercel-project **nusnos-projects/woningzoeker**, gekoppeld aan **Nusnos/woningzoeker**.

## Funda-links en filter

Bij **Woningaanbod → Alleen met Funda-link** worden uitsluitend woningen getoond waarvoor Buurtje.nl een expliciete Funda-detailverwijzing vermeldt. Deze woningen hebben een knop **Bekijk op Funda**; de Funda-verwijzing staat ook in woningmails. Het filter blijft behouden bij opslaan, bevestigen en de dagelijkse controle. Bestaande zoekopdrachten houden hun werking en woning-ID’s blijven gelijk.

Dit is **geen rechtstreekse Funda-zoekkoppeling en geen garantie op het volledige Funda-aanbod**. Een rechtstreekse HTTP-proef op 30 oktober 2026 gaf voor zowel zoeken als een detailpagina een beveiligingspagina, ondanks HTTP 200. Alleen daadwerkelijk in de bron vermelde HTTPS-links naar Funda-woningdetails worden overgenomen; links worden niet geraden. Adres, prijs en beschikbaarheid worden gecontroleerd bij Buurtje.nl. De gelinkte Funda-pagina zelf is niet automatisch gecontroleerd. Zie [de live Funda-linktest](docs/funda-verification.json).

## Werkelijke woningbron

De eerste live proef is uitgevoerd **voordat de interface werd gebouwd**: koopwoningen in Den Bosch tot €500.000. Buurtje.nl gaf HTTP 200; adressen, prijzen en beschikbaarheid zijn op de directe woningpagina’s gecontroleerd. Zie [brononderzoek](docs/source-research.md), [eerste bronproef](docs/source-probe.json), [zoektest](docs/live-search.json) en [Vercel-test](docs/deployment-verification.json).

De app gebruikt de normale openbare zoekaanvraag van Buurtje.nl, gevolgd door controle van elke woningpagina. PDOK vertaalt Nederlandse plaatsnamen, postcodes en adressen naar een zoekpunt. De server past prijsgrenzen en de exacte afstand nogmaals toe. Alle kommagescheiden zoektermen moeten letterlijk voorkomen in de woningtekst van de bron; die tekst kan een samenvatting bevatten.

Er is **geen officiële aanbod-API-overeenkomst of garantie op volledige marktdekking**. Blokkades en onherkenbare antwoorden worden als fout gemeld. Er is geen verzonnen, gesimuleerde of historische resultatenfallback in productie. De HTML-parser is bewust strikt, zodat een bronwijziging opvalt.

## Lokaal starten

Gebruik Node.js 24 en de bestaande projectkoppeling:

```sh
vercel link --yes --project woningzoeker --scope nusnos-projects
vercel env pull .env.local --yes
npm ci
npm run dev
```

`APP_SECRET` en de Blob-token zijn nodig voor meldingen. Lokaal zoeken werkt zonder SMTP. De ontwikkel-, preview- en productiestaat hebben afzonderlijke opslagpaden en afzonderlijke sleutels. Vercel kan productiegeheimen voor SMTP niet lokaal teruggeven; de SMTP-verbinding wordt daarom ook in de gedeployde omgeving getest.

## E-mailmeldingen en opslag

- Double opt-in met ondertekende bevestigingslink, 48 uur geldig. GET-bezoeken veranderen geen abonnement; de bezoeker bevestigt met een knop/POST.
- Bij bevestigen wordt het volledige huidige aanbod als beginstand opgeslagen. Alleen daarna nog niet geziene matches worden verstuurd.
- Ondertekende afmeldlink en List-Unsubscribe One-Click. Afmelden verwijdert de betreffende zoekopdracht en het e-mailadres.
- AES-256-GCM-versleutelde gegevens in de **bestaande private Vercel Blob-store**. Er worden geen e-mailadressen of tokens naar applicatielogs geschreven.
- Sterke ETags en conditionele writes beschermen gelijktijdige updates. Reads gebruiken `Accept-Encoding: identity`: Brotli kon anders een zwakke ETag veroorzaken. Dit is in de echte mailtest gevonden en met grotere data opnieuw getest.
- Een dagelijkse lease, een verzendclaim en vaste Message-ID voorkomen dubbele verzending bij overlappende of herhaalde taken.
- SMTP kent geen gegarandeerde precies-eenmaalaflevering. Bij een onzekere verzenduitkomst wordt niet blind opnieuw verstuurd. De taak faalt zichtbaar, de verzendstatus blijft `uncertain` en de beheerder moet eerst SMTP-logs controleren. Een onderbroken proces kan een `sending`-status achterlaten die eveneens controle vereist.

Vereiste servervariabelen staan in [.env.example](.env.example). `SMTP_HOST` kan worden weggelaten voor een Gmail-account; anders moet deze expliciet worden ingesteld. `APP_SECRET` is een base64url-gecodeerde sleutel van 32 bytes en is ook de versleutelingssleutel: vervang hem niet zonder migratie van opgeslagen gegevens. Geheimen horen uitsluitend in Vercel of lokale genegeerde env-bestanden.

## Dagelijkse controle om 13.00 uur

[daily.yml](.github/workflows/daily.yml) gebruikt `cron: '0 13 * * *'` met `timezone: Europe/Amsterdam`. Dat volgt automatisch zomer- en wintertijd. De taak roept het beveiligde Vercel-endpoint aan en probeert tijdelijke fouten maximaal drie keer.

Daarnaast staan twee dagelijkse Vercel-crons op 11.00 en 12.00 UTC als onafhankelijk vangnet. De server start nooit vóór 13.00 Nederlandse tijd en verwerkt iedere dag hoogstens eenmaal succesvol. Zo valt in zomer- en wintertijd een vangnettaak in het juiste uur, ook als GitHub zijn planner tijdelijk niet start. Vercel Hobby kan binnen dat uur vertraagd starten; de GitHub-taak blijft de primaire 13.00-planning.

De GitHub-repositorygeheimen `CRON_SECRET` en `VERCEL_PROTECTION_BYPASS` zijn geconfigureerd. De eerste waarde komt overeen met de productieomgeving; de tweede geeft de planner toegang tot beschermde deployments zonder de bezoekersbescherming te verlagen. Handmatig controleren kan via Actions → Dagelijkse woningcontrole → Run workflow. Vóór 13.00 uur slaat een gewone uitvoering over; het `force`-argument is alleen beschikbaar achter het beheergeheim voor een bewuste test.

GitHub kan geplande taken vertraagd starten en schakelt planning in publieke repositories na 60 dagen zonder repositoryactiviteit uit. Controleer daarom de Actions-status en de laatste run. 13.00 uur is de geplande start, geen realtimegarantie. Zie [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Tests en gecontroleerd uitrollen

```sh
npm test
npm audit --omit=dev --audit-level=high
npm run test:live
node --env-file=.env.local scripts/check-blob.js
vercel deploy --prod --skip-domain --yes --scope nusnos-projects
node --env-file=.env.production.local scripts/verify-deployment.js https://DE-GETESTE-DEPLOYMENT.vercel.app
vercel promote https://DE-GETESTE-DEPLOYMENT.vercel.app --yes --scope nusnos-projects
```

De laatste regel mag pas na een geslaagde live zoektest van die build. De verificatiescripts gebruiken een lokaal genegeerde automation-bypass; `configure-bypass.js` configureert deze voor een beheerder. `configure-secrets.js` is een eenmalige bootstrap voor een nieuw project, geen commando om bestaande encryptiesleutels te vervangen.

`npm test` voert 36 offline unit- en HTTP-tests uit, waaronder ongeldige filters, prijs- en straalgrenzen, gewijzigde bronstructuur, ingetrokken woningen, tokens, toestemming, concurrentie, baselines, afmelden, dubbel uitvoeren, SMTP-fouten, zomer-/wintertijd en veilige Funda-links inclusief behoud van bestaande meldingen. De vastgelegde HTML-fixtures bevatten echte op 30 oktober 2026 opgehaalde brongegevens en zijn uitsluitend testdata.

De echte mailtest is alleen bedoeld voor een expliciet toegestaan testadres en een omgeving zonder andere actieve zoekopdrachten:

```sh
node --env-file=.env.production.local scripts/test-live-email.js https://DE-GETESTE-DEPLOYMENT.vercel.app TESTADRES
```

Deze stuurt een bevestiging en een als TEST gemarkeerde melding met een werkelijk geverifieerde woning, simuleert alleen de nieuw-detectie en meldt de tijdelijke zoekopdracht daarna af. Het testadres staat niet in de repository. SMTP-acceptatie bewijst niet dat de ontvanger de mail in de inbox ziet; dat moet de ontvanger bevestigen.

## Foutregistratie en grenzen

Vercel Runtime Logs bevatten JSON-regels met tijdstip, operatie, foutcode en request-ID. De interface toont bij een fout hetzelfde referentienummer. De beschermde `POST /api/diagnostics` controleert opslag/SMTP en toont het resultaat van de laatste dagelijkse run, zonder persoonsgegevens. De dagelijkse workflow wordt rood bij een fout; ingestelde GitHub-notificaties bepalen wie daarvan bericht krijgt.

Deze versie is begrensd op 500 opgeslagen zoekopdrachten en 20 bronpagina’s per volledige meldingscontrole. Te brede zoekopdrachten worden geweigerd in plaats van onvolledig verwerkt. De volledige dagelijkse taak heeft een verwerkingsbudget van circa vier minuten; bij overschrijding faalt hij zichtbaar en wordt de dag niet als voltooid gemarkeerd. Er is geen externe uptime-monitor of onafhankelijke dienstgarantie ingericht.

Zoekresultaten gebruiken expliciete paginering. De beginpagina toont alleen het aanbod dat al is gecontroleerd; gebruik **Meer woningen controleren** voor volgende bronpagina’s. Aantallen zijn nooit een claim dat dit alle Nederlandse woningen zijn.
