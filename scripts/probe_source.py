"""Live source gate. Run before building or releasing the application."""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

import requests
from bs4 import BeautifulSoup


def probe():
    url = "https://buurtje.nl/koopwoningen/s-hertogenbosch/?prijs_max=500000&sorteer=nieuw"
    response = requests.get(url, timeout=(5, 25), headers={"User-Agent": "Woningzoeker/1.0 (+https://github.com/Nusnos/woningzoeker)"})
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    found = []
    for card in soup.select(".pc"):
        address, price, link = card.select_one(".pc-adres"), card.select_one(".pc-prijs"), card.select_one("a.pc-body")
        if not all([address, price, link]):
            continue
        amount = int("".join(c for c in price.get_text() if c.isdigit()))
        city = card.select_one(".pc-plaats").get_text(" ", strip=True)
        if 0 < amount <= 500000 and "hertogenbosch" in city.lower():
            found.append({"address": address.get_text(strip=True), "locality": city, "price": amount, "url": "https://buurtje.nl" + link["href"]})
    assert len(found) >= 3, "Live source did not return at least three matching homes"
    for home in found[:3]:
        detail = requests.get(home["url"], timeout=(5, 25))
        detail.raise_for_status()
        schemas = [json.loads(s.string or s.get_text()) for s in BeautifulSoup(detail.text, "html.parser").select('script[type="application/ld+json"]')]
        assert any(isinstance(s, dict) and s.get("offers", {}).get("price") == home["price"] and s.get("address", {}).get("streetAddress") == home["address"] and s.get("offers", {}).get("availability") == "https://schema.org/InStock" for s in schemas), "Detail page does not verify address, price and available status"
        home["detail_verified"] = True
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "source": url, "http_status": response.status_code, "matching_on_page": len(found), "verified_homes": found[:3], "scope": "Live public HTML, no API contract or uptime guarantee; production egress still needs testing."}
    Path("docs").mkdir(exist_ok=True)
    Path("docs/source-probe.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    probe()
