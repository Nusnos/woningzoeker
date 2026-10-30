# Brononderzoek — 30 oktober 2026

## Uitgangspunt en volgorde

De GitHub-repository bevatte uitsluitend requirements voor Flask en pyfunda; de gekoppelde Vercel-deployment bevatte een afzonderlijke Bing RSS-proef. De gerapporteerde pyfunda-blokkade is niet omzeild. Eerst zijn alternatieve bronnen onderzocht en rechtstreeks getest, daarna is pas de interface gebouwd.

## Rechtstreekse aanvragen

| Bron | Uitkomst van deze test | Besluit |
| --- | --- | --- |
| Pararius | HTTP 403 voor aanbod en robots.txt | Niet ingebouwd |
| Huislijn | HTTP 403 | Niet ingebouwd |
| ZAH | HTTP 403 | Niet ingebouwd |
| Huispedia publieke aanbodpagina | HTTP 403 | Niet ingebouwd |
| Huispedia zakelijke API | API-product gevonden, geen account/licentie of API-sleutel beschikbaar | Geen ongeteste API-integratie claimen |
| De Koster Makelaars | Aanbod en directe woningpagina HTTP 200 | Bruikbaar als lokale bronproef; onvoldoende landelijke dekking |
| Buurtje.nl | Aanbod, openbare zoekaanvraag, robots.txt en directe woningpagina’s HTTP 200 | Gekozen en vervolgens vanuit Vercel getest |

Publiek aanbod: [Den Bosch koopwoningen](https://buurtje.nl/koopwoningen/s-hertogenbosch/). De geraadpleegde [robots.txt](https://buurtje.nl/robots.txt) blokkeerde de gebruikte openbare aanbod- en woningroutes niet. Dit is geen licentie of beschikbaarheidsgarantie. Voor gebruik op grotere schaal is een vaste dataovereenkomst wenselijk.

## Eerste verplichte live proef

`scripts/probe_source.py` haalde koopwoningen tot €500.000 op en verifieerde op drie directe woningpagina’s een gelijk adres, gelijke prijs en schema.org `InStock`:

| Adres | Vraagprijs | Directe woninglink |
| --- | --- | --- |
| Orthenstraat 41 | €398.000 | [woningpagina](https://buurtje.nl/appartement/orthenstraat-41-s-hertogenbosch/) |
| Aartshertogenlaan 263 | €450.000 | [woningpagina](https://buurtje.nl/appartement/aartshertogenlaan-263-s-hertogenbosch/) |
| Verwersstraat 108B | €275.000 | [woningpagina](https://buurtje.nl/appartement/verwersstraat-108b-s-hertogenbosch/) |

Tijdstip en resultaat staan in [source-probe.json](source-probe.json). De definitieve server voert deze controles uit voor **elk getoond resultaat**. Vervallen aanbod, een gewijzigde prijs of onleesbare pagina levert geen ongecontroleerde woningkaart op.

## Zoekmethode

De openbare broninterface is onderzocht om de normale aanvraag voor beschikbaar aanbod met prijsgrenzen, paginering en een geografische rechthoek te gebruiken. Er worden geen anti-bot-cookies, proxyrotatie of CAPTCHA-omzeiling gebruikt. De server verfijnt de rechthoek tot de gevraagde cirkel via de haversineafstand en controleert zoekwoorden op de woningtekst. Er lopen maximaal vier detailaanvragen tegelijk binnen één zoekopdracht.

PDOK levert het zoekpunt via de [Locatieserver](https://github.com/PDOK/open-api-specs/blob/master/locatieserver/oas.yaml). De herkende locatie wordt in de interface getoond. De eerste kaartaanvraag en de bronpagination zijn afzonderlijk getest; een landelijke HTML-GET bleek de kaartgrenzen niet toe te passen en is daarom niet als geografische zoekmethode gebruikt.

## Bewijs en beperkingen

De [Vercel-verificatie](deployment-verification.json) legt echte koop-, huur-, prijs-, zoekwoord- en locatieaanvragen vast. Een zoekopdracht met een onrealistisch lage prijs moet daadwerkelijk nul resultaten geven; er is geen demo-fallback. HTML kan wijzigen en de bron kan ook in de toekomst toegang weigeren. De app registreert die fouten en markeert onvolledige controles niet als succesvol.

Buurtje.nl kan gegevens hebben die achterlopen op een makelaar of afwijkende oppervlakten bevatten. De app controleert adres, vraagprijs en de beschikbaarheidsstatus volgens Buurtje.nl. Het is geen onafhankelijke verificatie bij iedere makelaar en geen garantie op de volledige Nederlandse markt.
