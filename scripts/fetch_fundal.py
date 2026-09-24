import os
import re
import ssl
import urllib.request

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

UA = {"User-Agent": "Mozilla/5.0"}
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "clientes", "fundal.png")

candidates = [
    "https://fundal.org/wp-content/uploads/2020/06/logo-fundal.png",
    "https://fundal.org/wp-content/uploads/2019/06/cropped-fundal-favicon-192x192.png",
    "https://fundalsfe.org/wp-content/uploads/2021/06/logo-fundal.png",
    "https://fundalsfe.org/wp-content/uploads/2020/06/logo.png",
]

for url in candidates:
    try:
        req = urllib.request.Request(url, headers=UA)
        data = urllib.request.urlopen(req, context=ctx, timeout=20).read()
        if len(data) > 500:
            with open(OUT, "wb") as f:
                f.write(data)
            print(f"OK {url} ({len(data)} bytes)")
            break
    except Exception as e:
        print(f"FAIL {url}: {e}")
else:
    for site in ("https://fundal.org/", "https://fundalsfe.org/"):
        try:
            req = urllib.request.Request(site, headers=UA)
            html = urllib.request.urlopen(req, context=ctx, timeout=20).read().decode("utf-8", "ignore")
            imgs = re.findall(r'https?://[^\s"\']+\.(?:png|jpg|jpeg|webp|svg)', html, re.I)
            print(f"\n{site}:")
            for img in imgs[:10]:
                print(" ", img)
        except Exception as e:
            print(f"ERR {site}: {e}")
