import os
import re
import ssl
import urllib.request

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
PARTNERS = os.path.join(BASE, "partners")
CLIENTES = os.path.join(BASE, "clientes")
os.makedirs(PARTNERS, exist_ok=True)
os.makedirs(CLIENTES, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url: str, out: str) -> bool:
    try:
        req = urllib.request.Request(url, headers=UA)
        data = urllib.request.urlopen(req, context=ctx, timeout=20).read()
        if len(data) < 500:
            return False
        with open(out, "wb") as f:
            f.write(data)
        print(f"OK {out} ({len(data)} bytes)")
        return True
    except Exception as e:
        print(f"FAIL {url}: {e}")
        return False


def scrape_logos(site: str) -> list[str]:
    try:
        req = urllib.request.Request(site, headers=UA)
        html = urllib.request.urlopen(req, context=ctx, timeout=20).read().decode("utf-8", "ignore")
        imgs = re.findall(r'(?:src|content)=["\']([^"\']+)["\']', html, re.I)
        scored = []
        for img in imgs:
            if not re.search(r"\.(png|jpg|jpeg|svg|webp)", img, re.I):
                continue
            score = 0
            for kw in ("logo", "brand", "header", "favicon", "og:image"):
                if kw in img.lower():
                    score += 2
            scored.append((score, img))
        scored.sort(reverse=True)
        return [u for _, u in scored[:10]]
    except Exception as e:
        print(f"ERR scrape {site}: {e}")
        return []


candidates = [
    (PARTNERS, "oxibio.png", [
        "https://oxibio.com.ar/wp-content/uploads/2020/06/cropped-logo-oxibio-1.png",
        "https://oxibio.com.ar/wp-content/uploads/2019/06/cropped-oxibio-favicon-192x192.png",
    ]),
    (PARTNERS, "redtl.png", [
        "https://www.redtl.com.ar/resources/img/logo-redtl.png",
        "https://redtl.com.ar/resources/img/logo-redtl.png",
    ]),
    (PARTNERS, "cobra-gym.png", [
        "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1",
    ]),
    (CLIENTES, "mapaci.png", [
        "https://www.mapaci.com.ar/images/logo-mapaci.png",
        "https://mapaci.com.ar/wp-content/uploads/logo.png",
    ]),
    (CLIENTES, "gamen.png", [
        "https://www.hospitalgamen.org/images/logo.png",
        "https://hospitalgamen.org/img/logo_hospital.png",
    ]),
    (CLIENTES, "zona-norte.png", [
        "https://www.rosario.gob.ar/cms/media/footer/logo-rosario.png",
    ]),
    (CLIENTES, "funal.png", [
        "https://funalsrl.com.ar/img/logo.png",
        "https://funalsrl.com.ar/images/logo.png",
    ]),
    (CLIENTES, "zona-norte.png", [
        "https://www.hnzn.org.ar/images/logo.png",
        "https://hnzn.org.ar/img/logo.png",
    ]),
]

for folder, name, urls in candidates:
    out = os.path.join(folder, name)
    if os.path.exists(out) and os.path.getsize(out) > 500:
        print(f"SKIP exists {out}")
        continue
    for url in urls:
        if fetch(url, out):
            break

for site, prefix in [
    ("https://oxibio.com.ar/", "oxibio"),
    ("https://www.mapaci.com.ar/", "mapaci"),
    ("https://www.hospitalgamen.org/", "gamen"),
    ("https://www.redtl.com.ar/", "redtl"),
]:
    imgs = scrape_logos(site)
    print(f"\n{site}:")
    for img in imgs[:5]:
        print(" ", img)
