import zlib
import struct
import math
import base64
import json
import urllib.parse

def make_png(w, h, pixels):
    raw = b''
    for y in range(h):
        raw += b'\x00' + b''.join(struct.pack('!BBB', *pixels[y*w + x]) for x in range(w))
    
    idat = zlib.compress(raw)
    
    def chunk(type, data):
        return struct.pack('!I', len(data)) + type + data + struct.pack('!I', zlib.crc32(type + data) & 0xffffffff)
    
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('!IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', idat)
    png += chunk(b'IEND', b'')
    return png

w, h = 200, 46
r = 23
pixels = []
for y in range(h):
    for x in range(w):
        if x < r:
            dx = x - r
            dy = y - r
        elif x >= w - r:
            dx = x - (w - r)
            dy = y - r
        else:
            dx = 0
            dy = 0
            
        d2 = dx**2 + dy**2
        if d2 <= r**2:
            nz = math.sqrt(r**2 - d2)
            cur_r = int(((dx / r) * 0.5 + 0.5) * 255)
            cur_g = int(((dy / r) * 0.5 + 0.5) * 255)
        else:
            cur_r = 127
            cur_g = 127
            
        pixels.append((cur_r, cur_g, 127))

png_data = make_png(w, h, pixels)
displacement_b64 = "data:image/png;base64," + base64.b64encode(png_data).decode('ascii')

specular_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <defs>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="20%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="80%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.3"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="{r-0.5}" fill="none" stroke="url(#s)" stroke-width="1.5" opacity="0.8"/>
</svg>'''
specular_b64 = 'data:image/svg+xml;charset=utf-8,' + urllib.parse.quote(specular_svg.replace('\n', ''))

with open('maps.json', 'w') as f:
    json.dump({'displacement': displacement_b64, 'specular': specular_b64}, f)
