#!/usr/bin/env python3
"""Genera los recursos de los instaladores a partir de terminos.md y de la imagen de inicio.
   Windows (NSIS): licencia.txt, barra lateral 164x314 (BMP) y encabezado 150x57 (BMP).
   Mac (.pkg):     welcome.html, license.html, conclusion.html, background.png (y @2x).
Uso: python3 build/instalador/generar.py VERSION"""
import html, os, re, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

V = sys.argv[1] if len(sys.argv) > 1 else '0.0.0'
D = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(os.path.dirname(D))
OUT = os.path.join(D, 'gen'); os.makedirs(OUT, exist_ok=True)
md = open(os.path.join(D, 'terminos.md'), encoding='utf-8').read()

# ---------- licencia.txt (NSIS muestra texto plano: UTF-8 con BOM y CRLF)
def plain(md):
    out = []
    for ln in md.splitlines():
        if ln.startswith('# '): out += [ln[2:].upper(), '']
        elif ln.startswith('## '): out += ['', ln[3:].upper()]
        elif ln.startswith('- '): out.append('  • ' + ln[2:])
        else: out.append(ln)
    t = '\n'.join(out).replace('**', '')
    return re.sub(r'\n{3,}', '\n\n', t).strip() + '\n'
open(os.path.join(OUT, 'licencia.txt'), 'w', encoding='utf-8-sig', newline='\r\n').write(plain(md))

# ---------- HTML para el instalador de Mac
CSS = """<style>body{font:13px/1.55 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#1d2433;margin:0 4px}
h1{font-size:19px;margin:0 0 10px;color:#14204a}h2{font-size:13.5px;margin:16px 0 4px;color:#14204a}p{margin:0 0 9px}
ul{margin:0 0 9px;padding-left:20px}li{margin:2px 0}.muted{color:#5b6478}.box{background:#f2f5fc;border-radius:10px;padding:10px 12px;margin:12px 0}
@media (prefers-color-scheme:dark){body{color:#e6e9f2}h1,h2{color:#c9d4ff}.muted{color:#a3abc0}.box{background:#232a3d}}</style>"""
def md2html(md):
    out = []; ul = False
    for ln in md.splitlines():
        if ln.startswith('- '):
            if not ul: out.append('<ul>'); ul = True
            out.append('<li>' + html.escape(ln[2:]) + '</li>'); continue
        if ul: out.append('</ul>'); ul = False
        if ln.startswith('# '): out.append('<h1>' + html.escape(ln[2:]) + '</h1>')
        elif ln.startswith('## '): out.append('<h2>' + html.escape(ln[3:]) + '</h2>')
        elif ln.strip(): out.append('<p>' + html.escape(ln) + '</p>')
    if ul: out.append('</ul>')
    return '\n'.join(out)
page = lambda body: f'<!doctype html><html lang="es"><head><meta charset="utf-8">{CSS}</head><body>{body}</body></html>'
open(os.path.join(OUT, 'license.html'), 'w', encoding='utf-8').write(page(md2html(md)))
open(os.path.join(OUT, 'welcome.html'), 'w', encoding='utf-8').write(page(f"""
<h1>Bienvenido a PortalFirma Studio {V}</h1>
<p>Este asistente instalará PortalFirma Studio en la carpeta <b>Aplicaciones</b> de tu Mac.</p>
<p>Con PortalFirma Studio puedes:</p>
<ul><li>crear, editar y combinar documentos PDF, Word, Excel e imágenes;</li>
<li>enviar documentos a firmar con firma simple o avanzada;</li>
<li>gestionar firmas presenciales ante notario: escrituras públicas, protocolizaciones y reducciones;</li>
<li>usar plantillas, flujos documentales y el asistente legal con IA.</li></ul>
<div class="box">Si ya tienes una versión anterior, se reemplazará. Tus documentos, plantillas y configuración se conservan.</div>
<p class="muted">Requiere macOS 10.15 o posterior. Presiona <b>Continuar</b> para leer los términos y condiciones.</p>"""))
open(os.path.join(OUT, 'conclusion.html'), 'w', encoding='utf-8').write(page(f"""
<h1>PortalFirma Studio quedó instalado</h1>
<p>Encontrarás <b>PortalFirma Studio</b> en la carpeta Aplicaciones y en el Launchpad.</p>
<div class="box"><b>Primeros pasos</b><ul><li>Abre un documento o arrástralo a la ventana.</li>
<li>Inicia sesión con tu cuenta de Portalfirma para enviar a firmar y gestionar firmas presenciales.</li>
<li>Presiona el botón <b>?</b> para ver las guías.</li></ul></div>
<p class="muted">Versión {V} · www.portalfirma.cl</p>"""))

# ---------- imágenes
foto = Image.open(os.path.join(P, 'src/renderer/img/inicio-fondo.jpg')).convert('RGB')
logo = Image.open(os.path.join(P, 'src/renderer/assets/logo.png')).convert('RGBA')
icono = Image.open(os.path.join(P, 'build/icon.png')).convert('RGBA')
def F(s, b=False):
    for f in ('/usr/share/fonts/truetype/liberation/LiberationSans-' + ('Bold' if b else 'Regular') + '.ttf',
              'C:/Windows/Fonts/' + ('arialbd' if b else 'arial') + '.ttf',
              '/System/Library/Fonts/Supplemental/Arial' + (' Bold' if b else '') + '.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, s)
    return ImageFont.load_default()
def cover(im, w, h, cx=.5, cy=.45):
    r = max(w / im.width, h / im.height); im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x = round((im.width - w) * cx); y = round((im.height - h) * cy); return im.crop((x, y, x + w, y + h))
def gradient(w, h, top, bottom):
    g = Image.new('RGBA', (w, h)); d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(1, h - 1); d.line([(0, y), (w, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return g
def lateral(w, h, k=1):
    im = cover(foto, w, h, .55, .5).convert('RGBA')
    im = Image.alpha_composite(im, gradient(w, h, (20, 32, 90, 70), (16, 26, 74, 236)))
    ic = icono.resize((round(64 * k), round(64 * k)), Image.LANCZOS); im.alpha_composite(ic, (round(18 * k), round(h - 150 * k)))
    d = ImageDraw.Draw(im); d.text((round(18 * k), round(h - 78 * k)), 'PortalFirma', font=F(round(21 * k), True), fill='white')
    d.text((round(18 * k), round(h - 54 * k)), 'Studio', font=F(round(21 * k)), fill=(205, 216, 255))
    d.text((round(18 * k), round(h - 26 * k)), f'Versión {V}', font=F(round(11 * k)), fill=(185, 196, 230))
    return im
# NSIS: barra lateral de bienvenida y fin (164x314) y encabezado (150x57), BMP de 24 bits
lateral(164, 314).convert('RGB').save(os.path.join(OUT, 'sidebar.bmp'))
hdr = Image.new('RGB', (150, 57), 'white'); lg = logo.copy(); lg.thumbnail((128, 40), Image.LANCZOS)
hdr.paste(lg, (150 - lg.width - 8, (57 - lg.height) // 2), lg); hdr.save(os.path.join(OUT, 'header.bmp'))
# Mac: fondo de la columna de pasos (abajo a la izquierda), 1x y 2x
for k, n in ((1, 'background.png'), (2, 'background@2x.png')):
    w, h = 190 * k, 300 * k
    im = lateral(w, h, k)
    mask = gradient(w, h, (0, 0, 0, 0), (0, 0, 0, 255)).split()[3].point(lambda a: min(255, a * 2))
    im.putalpha(mask); im.save(os.path.join(OUT, n))
print('ok', OUT)
