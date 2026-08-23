"""
Bundle mockup.html into a single self-contained HTML file.

The mockup links theme.css and references art/*.jpg relatively, which is right
for local editing and for foo_uie_webview (both read from disk). A published
page cannot reach either, so this inlines the stylesheet and rewrites every
image reference to a data: URI.

Nothing about the design changes -- this is packaging only.
"""

import base64
import mimetypes
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'mockup.html')
CSS = os.path.join(HERE, 'theme.css')
OUT = os.environ.get('BUNDLE_OUT') or os.path.join(HERE, 'mockup-standalone.html')

html = open(SRC, 'r', encoding='utf-8').read()
css = open(CSS, 'r', encoding='utf-8').read()

# 1. inline theme.css in place of the <link>
html, n = re.subn(
    r'<link rel="stylesheet" href="theme\.css">',
    '<style>\n/* inlined from theme.css (generated from palette.json) */\n' + css + '</style>',
    html)
assert n == 1, "theme.css link not found"

# 2. inline every referenced image as a data: URI
used = set()


def to_data_uri(m):
    rel = m.group(1)
    path = os.path.join(HERE, rel.replace('/', os.sep))
    if not os.path.exists(path):
        print("  MISSING, left as-is:", rel)
        return m.group(0)
    mime = mimetypes.guess_type(path)[0] or 'image/jpeg'
    blob = open(path, 'rb').read()
    used.add(rel)
    return "url('data:%s;base64,%s')" % (mime, base64.b64encode(blob).decode('ascii'))


html = re.sub(r"url\('([^']+\.(?:jpg|jpeg|png))'\)", to_data_uri, html)

# 3. give the page a real name
html = re.sub(r'<title>.*?</title>', '<title>Caelestia Player</title>', html, flags=re.S)

with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

print("bundled %d image(s):" % len(used))
for u in sorted(used):
    print("   ", u)
print("out: %s (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024))

leftover = re.findall(r'(?:href|src)="(?!data:|#)([^"]+)"', html)
leftover += re.findall(r"url\('(?!data:)([^']+)'\)", html)
print("remaining external refs:", leftover if leftover else "none")
