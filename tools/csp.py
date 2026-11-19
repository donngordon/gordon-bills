#!/usr/bin/env python3
"""Stamp a strict Content-Security-Policy (with the inline script's SHA-256 hash) into each page.
Run after every edit:  python3 tools/csp.py"""
import base64, hashlib, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
POLICY = ("default-src 'self'; script-src 'self' {h}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
          "font-src https://fonts.gstatic.com; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; "
          "connect-src 'self' https://script.google.com https://script.googleusercontent.com; "
          "object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests")
for name in ("index.html", "install.html"):
    f = ROOT / name; s = f.read_text(encoding="utf-8")
    scripts = re.findall(r"<script>(.*?)</script>", s, re.S)
    hashes = " ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(x.encode("utf-8")).digest()).decode() for x in scripts)
    meta = ('<meta http-equiv="Content-Security-Policy" content="%s">\n<meta name="referrer" content="no-referrer">' % POLICY.format(h=hashes))
    s = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n<meta name="referrer"[^>]*>', meta, s) if 'Content-Security-Policy' in s \
        else s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + meta, 1)
    f.write_text(s, encoding="utf-8"); print(name, hashes)
