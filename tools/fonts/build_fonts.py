#!/usr/bin/env python3
"""Arma el catálogo de fuentes de PortalFirma Studio.
Fuentes libres (OFL / Apache / GUST): Google Fonts, TeX Gyre, DejaVu.
Para cada familia deja 4 archivos TTF estáticos (normal, negrita, cursiva, negrita cursiva),
recortados a los caracteres latinos (español completo) para que pesen poco."""
import io, json, os, re, sys, urllib.request, copy
from fontTools.ttLib import TTFont, newTable
from fontTools.varLib import instancer
from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = sys.argv[1]
CACHE = os.path.join(os.path.dirname(__file__), 'cache'); os.makedirs(CACHE, exist_ok=True)
APT = os.path.join(os.path.dirname(__file__), 'apt', 'x')
RAW = 'https://raw.githubusercontent.com/google/fonts/main/'

# (clave, etiqueta, categoría, fuente, nombre en Word, alias para reconocer el PDF)
O, S, SE, M, D = 'office', 'sans', 'serif', 'mono', 'script'
CATALOG = [
  # Compatibles / equivalentes a fuentes de Office y Windows
  ('georgia', 'Georgia', O, ('gf', 'ofl/gelasio'), 'Georgia', r'georgia|gelasio'),
  ('garamond', 'Garamond', O, ('gf', 'ofl/ebgaramond'), 'Garamond', r'(?<!cormorant ?)garamond|ebgaramond'),
  ('centurygothic', 'Century Gothic', O, ('apt', 'texgyreadventor'), 'Century Gothic', r'century ?gothic|avant ?garde|adventor|urw ?gothic'),
  ('palatino', 'Book Antiqua / Palatino', O, ('apt', 'texgyrepagella'), 'Book Antiqua', r'palatino|book ?antiqua|pagella|palladio'),
  ('bookman', 'Bookman Old Style', O, ('apt', 'texgyrebonum'), 'Bookman Old Style', r'bookman|bonum'),
  ('schoolbook', 'Century Schoolbook', O, ('apt', 'texgyreschola'), 'Century Schoolbook', r'schoolbook|schola|newcentury'),
  ('narrow', 'Arial Narrow', O, ('apt', 'texgyreheroscn'), 'Arial Narrow', r'arial ?narrow|arialn|helvetica ?(narrow|condensed)|heros ?(cn|cond)|sans ?narrow'),
  ('verdana', 'Verdana / Tahoma', O, ('apt', 'DejaVuSans'), 'Verdana', r'verdana|tahoma|dejavu ?sans|bitstream ?vera ?sans'),
  ('dejavuserif', 'DejaVu Serif', O, ('apt', 'DejaVuSerif'), 'DejaVu Serif', r'dejavu ?serif|vera ?serif'),
  ('franklin', 'Franklin Gothic', O, ('gf', 'ofl/librefranklin'), 'Franklin Gothic Book', r'franklin'),
  ('baskerville', 'Baskerville', O, ('gf', 'ofl/librebaskerville'), 'Baskerville Old Face', r'baskerville|librebaskerville'),
  ('comic', 'Comic Sans', O, ('gf', 'ofl/comicneue'), 'Comic Sans MS', r'comic'),
  ('corsiva', 'Monotype Corsiva', O, ('apt', 'texgyrechorus'), 'Monotype Corsiva', r'corsiva|chancery|chorus'),
  ('segoe', 'Segoe UI', O, ('gf', 'ofl/opensans'), 'Segoe UI', r'segoe'),
  ('trebuchet', 'Trebuchet MS', O, ('gf', 'ofl/firasans'), 'Trebuchet MS', r'trebuchet'),
  # Sin serifa
  ('roboto', 'Roboto', S, ('gf', 'ofl/roboto'), 'Roboto', None),
  ('opensans', 'Open Sans', S, ('gf', 'ofl/opensans'), 'Open Sans', None),
  ('lato', 'Lato', S, ('gf', 'ofl/lato'), 'Lato', None),
  ('montserrat', 'Montserrat', S, ('gf', 'ofl/montserrat'), 'Montserrat', None),
  ('poppins', 'Poppins', S, ('gf', 'ofl/poppins'), 'Poppins', None),
  ('raleway', 'Raleway', S, ('gf', 'ofl/raleway'), 'Raleway', None),
  ('inter', 'Inter', S, ('gf', 'ofl/inter'), 'Inter', r'^inter\b|inter-|interdisplay'),
  ('nunito', 'Nunito', S, ('gf', 'ofl/nunito'), 'Nunito', r'nunito(?!sans)'),
  ('sourcesans', 'Source Sans', S, ('gf', 'ofl/sourcesans3'), 'Source Sans 3', r'source ?sans'),
  ('notosans', 'Noto Sans', S, ('gf', 'ofl/notosans'), 'Noto Sans', r'noto ?sans(?!.*mono)'),
  ('ptsans', 'PT Sans', S, ('gf', 'ofl/ptsans'), 'PT Sans', r'pt ?sans|ptsans'),
  ('worksans', 'Work Sans', S, ('gf', 'ofl/worksans'), 'Work Sans', None),
  ('dmsans', 'DM Sans', S, ('gf', 'ofl/dmsans'), 'DM Sans', None),
  ('firasans', 'Fira Sans', S, ('gf', 'ofl/firasans'), 'Fira Sans', None),
  ('plexsans', 'IBM Plex Sans', S, ('gf', 'ofl/ibmplexsans'), 'IBM Plex Sans', r'plex ?sans'),
  ('ubuntu', 'Ubuntu', S, ('gf', 'ufl/ubuntu'), 'Ubuntu', r'ubuntu(?!.*mono)'),
  ('mulish', 'Mulish', S, ('gf', 'ofl/mulish'), 'Mulish', None),
  ('barlow', 'Barlow', S, ('gf', 'ofl/barlow'), 'Barlow', None),
  ('rubik', 'Rubik', S, ('gf', 'ofl/rubik'), 'Rubik', None),
  ('manrope', 'Manrope', S, ('gf', 'ofl/manrope'), 'Manrope', None),
  ('oswald', 'Oswald', S, ('gf', 'ofl/oswald'), 'Oswald', None),
  ('archivo', 'Archivo', S, ('gf', 'ofl/archivo'), 'Archivo', None),
  ('quicksand', 'Quicksand', S, ('gf', 'ofl/quicksand'), 'Quicksand', None),
  ('josefin', 'Josefin Sans', S, ('gf', 'ofl/josefinsans'), 'Josefin Sans', None),
  ('cabin', 'Cabin', S, ('gf', 'ofl/cabin'), 'Cabin', None),
  ('karla', 'Karla', S, ('gf', 'ofl/karla'), 'Karla', None),
  ('titillium', 'Titillium Web', S, ('gf', 'ofl/titilliumweb'), 'Titillium Web', r'titillium'),
  ('exo', 'Exo 2', S, ('gf', 'ofl/exo2'), 'Exo 2', r'exo ?2'),
  ('heebo', 'Heebo', S, ('gf', 'ofl/heebo'), 'Heebo', None),
  ('comfortaa', 'Comfortaa', S, ('gf', 'ofl/comfortaa'), 'Comfortaa', None),
  # Con serifa
  ('merriweather', 'Merriweather', SE, ('gf', 'ofl/merriweather'), 'Merriweather', r'merriweather(?!sans)'),
  ('lora', 'Lora', SE, ('gf', 'ofl/lora'), 'Lora', r'^lora|lora-'),
  ('playfair', 'Playfair Display', SE, ('gf', 'ofl/playfairdisplay'), 'Playfair Display', r'playfair'),
  ('ptserif', 'PT Serif', SE, ('gf', 'ofl/ptserif'), 'PT Serif', r'pt ?serif|ptserif'),
  ('notoserif', 'Noto Serif', SE, ('gf', 'ofl/notoserif'), 'Noto Serif', r'noto ?serif'),
  ('sourceserif', 'Source Serif', SE, ('gf', 'ofl/sourceserif4'), 'Source Serif 4', r'source ?serif'),
  ('crimson', 'Crimson Pro', SE, ('gf', 'ofl/crimsonpro'), 'Crimson Pro', r'crimson'),
  ('cormorant', 'Cormorant Garamond', SE, ('gf', 'ofl/cormorantgaramond'), 'Cormorant Garamond', r'cormorant'),
  ('robotoslab', 'Roboto Slab', SE, ('gf', 'apache/robotoslab'), 'Roboto Slab', r'roboto ?slab'),
  ('bitter', 'Bitter', SE, ('gf', 'ofl/bitter'), 'Bitter', None),
  ('spectral', 'Spectral', SE, ('gf', 'ofl/spectral'), 'Spectral', None),
  ('domine', 'Domine', SE, ('gf', 'ofl/domine'), 'Domine', None),
  ('alegreya', 'Alegreya', SE, ('gf', 'ofl/alegreya'), 'Alegreya', r'alegreya(?!sans)'),
  ('cardo', 'Cardo', SE, ('gf', 'ofl/cardo'), 'Cardo', None),
  ('oldstandard', 'Old Standard', SE, ('gf', 'ofl/oldstandardtt'), 'Old Standard TT', r'old ?standard'),
  ('vollkorn', 'Vollkorn', SE, ('gf', 'ofl/vollkorn'), 'Vollkorn', None),
  ('zillaslab', 'Zilla Slab', SE, ('gf', 'ofl/zillaslab'), 'Zilla Slab', r'zilla'),
  ('arvo', 'Arvo', SE, ('gf', 'ofl/arvo'), 'Arvo', None),
  ('cinzel', 'Cinzel', SE, ('gf', 'ofl/cinzel'), 'Cinzel', None),
  # Monoespaciadas
  ('robotomono', 'Roboto Mono', M, ('gf', 'ofl/robotomono'), 'Roboto Mono', r'roboto ?mono'),
  ('sourcecode', 'Source Code Pro', M, ('gf', 'ofl/sourcecodepro'), 'Source Code Pro', r'source ?code'),
  ('plexmono', 'IBM Plex Mono', M, ('gf', 'ofl/ibmplexmono'), 'IBM Plex Mono', r'plex ?mono'),
  ('courierprime', 'Courier Prime', M, ('gf', 'ofl/courierprime'), 'Courier Prime', r'courier ?prime'),
  ('inconsolata', 'Inconsolata', M, ('gf', 'ofl/inconsolata'), 'Consolas', r'inconsolata|consolas'),
  ('jetbrains', 'JetBrains Mono', M, ('gf', 'ofl/jetbrainsmono'), 'JetBrains Mono', r'jetbrains'),
  ('firacode', 'Fira Code', M, ('gf', 'ofl/firacode'), 'Fira Code', r'fira ?(code|mono)'),
  ('spacemono', 'Space Mono', M, ('gf', 'ofl/spacemono'), 'Space Mono', None),
  ('cousine', 'Cousine', M, ('gf', 'apache/cousine'), 'Cousine', None),
  ('specialelite', 'Special Elite (máquina de escribir)', M, ('gf', 'apache/specialelite'), 'Special Elite', r'special ?elite'),
  # Manuscritas y decorativas
  ('dancing', 'Dancing Script', D, ('gf', 'ofl/dancingscript'), 'Dancing Script', r'dancing'),
  ('greatvibes', 'Great Vibes', D, ('gf', 'ofl/greatvibes'), 'Great Vibes', None),
  ('pacifico', 'Pacifico', D, ('gf', 'ofl/pacifico'), 'Pacifico', None),
  ('caveat', 'Caveat', D, ('gf', 'ofl/caveat'), 'Caveat', None),
  ('satisfy', 'Satisfy', D, ('gf', 'apache/satisfy'), 'Satisfy', None),
  ('allura', 'Allura', D, ('gf', 'ofl/allura'), 'Allura', None),
  ('parisienne', 'Parisienne', D, ('gf', 'ofl/parisienne'), 'Parisienne', None),
  ('sacramento', 'Sacramento', D, ('gf', 'ofl/sacramento'), 'Sacramento', None),
  ('alexbrush', 'Alex Brush', D, ('gf', 'ofl/alexbrush'), 'Alex Brush', r'alex ?brush'),
  ('pinyon', 'Pinyon Script', D, ('gf', 'ofl/pinyonscript'), 'Pinyon Script', r'pinyon'),
  ('homemade', 'Homemade Apple', D, ('gf', 'apache/homemadeapple'), 'Homemade Apple', r'homemade'),
  ('kaushan', 'Kaushan Script', D, ('gf', 'ofl/kaushanscript'), 'Kaushan Script', r'kaushan'),
  ('indieflower', 'Indie Flower', D, ('gf', 'ofl/indieflower'), 'Indie Flower', r'indie ?flower'),
  ('shadows', 'Shadows Into Light', D, ('gf', 'ofl/shadowsintolight'), 'Shadows Into Light', r'shadows ?into'),
  ('architects', "Architects Daughter", D, ('gf', 'ofl/architectsdaughter'), "Architects Daughter", r'architects'),
  ('permanent', 'Permanent Marker', D, ('gf', 'apache/permanentmarker'), 'Permanent Marker', r'permanent ?marker'),
  ('lobster', 'Lobster', D, ('gf', 'ofl/lobster'), 'Lobster', None),
  ('bebas', 'Bebas Neue', D, ('gf', 'ofl/bebasneue'), 'Bebas Neue', r'bebas'),
  ('abril', 'Abril Fatface', D, ('gf', 'ofl/abrilfatface'), 'Abril Fatface', r'abril'),
  ('amatic', 'Amatic SC', D, ('gf', 'ofl/amaticsc'), 'Amatic SC', r'amatic'),
]
CAT_LABEL = {'office': 'Equivalentes a fuentes de Office', 'sans': 'Sin serifa', 'serif': 'Con serifa', 'mono': 'Monoespaciadas', 'script': 'Manuscritas y decorativas'}

UNICODES = 'U+0000-024F,U+0259,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2212,U+2215,U+221E,U+2248,U+2260,U+2264,U+2265,U+25A0-25FF,U+2610-2612,U+2713,U+2714,U+2717,U+FB01,U+FB02'

def fetch(url):
    p = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9._-]', '_', url[len(RAW):] if url.startswith(RAW) else url))
    if not os.path.exists(p):
        with urllib.request.urlopen(url.replace('[', '%5B').replace(']', '%5D'), timeout=60) as r: data = r.read()
        open(p, 'wb').write(data)
    return open(p, 'rb').read()

def gf_entries(d):
    meta = fetch(RAW + d + '/METADATA.pb').decode()
    fonts = []
    for blk in re.findall(r'fonts \{(.*?)\n\}', meta, re.S):
        st = re.search(r'style: "(\w+)"', blk).group(1); w = int(re.search(r'weight: (\d+)', blk).group(1)); fn = re.search(r'filename: "([^"]+)"', blk).group(1)
        fonts.append((st, w, fn))
    axes = {m[0]: (float(m[1]), float(m[2])) for m in re.findall(r'axes \{\s*tag: "(\w+)"\s*min_value: ([\d.]+)\s*max_value: ([\d.]+)', meta)}
    return fonts, axes

def otf_to_ttf(font):
    if 'CFF ' not in font: return font
    gs = font.getGlyphSet(); order = font.getGlyphOrder(); glyf = {}
    for g in order:
        pen = TTGlyphPen(gs); gs[g].draw(Cu2QuPen(pen, 1.0, reverse_direction=True)); glyf[g] = pen.glyph()
    del font['CFF ']
    if 'VORG' in font: del font['VORG']
    t = newTable('glyf'); t.glyphOrder = order; t.glyphs = glyf; font['glyf'] = t; font['loca'] = newTable('loca')
    mx = newTable('maxp'); mx.tableVersion = 0x00010000; mx.maxZones = 1
    for k in ('maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs', 'maxStackElements', 'maxSizeOfInstructions', 'maxComponentElements', 'maxPoints', 'maxContours', 'maxCompositePoints', 'maxCompositeContours', 'maxComponentDepth'): setattr(mx, k, 0)
    font['maxp'] = mx; font['head'].glyphDataFormat = 0
    font['post'].formatType = 2.0; font['post'].extraNames = []; font['post'].mapping = {}
    font.sfntVersion = '\x00\x01\x00\x00'
    return font

def finish(font, path):
    font = otf_to_ttf(font)
    for t in ('DSIG', 'STAT', 'MVAR', 'HVAR', 'VVAR', 'fvar', 'gvar', 'avar', 'cvar'):
        if t in font: del font[t]
    opts = subset.Options(); opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.name_languages = ['*']; opts.hinting = False; opts.notdef_outline = True; opts.drop_tables += ['DSIG']
    opts.glyph_names = False; opts.legacy_kern = True
    s = subset.Subsetter(opts); s.populate(unicodes=subset.parse_unicodes(UNICODES)); s.subset(font)
    font['glyf'].padding = 4  # fontkit (pdf-lib) necesita glifos alineados para recortar la fuente
    font.save(path)

def instance(vf_bytes, axes, wght):
    f = TTFont(io.BytesIO(vf_bytes))
    loc = {}
    for tag, (mn, mx) in ((a.axisTag, (a.minValue, a.maxValue)) for a in f['fvar'].axes):
        dflt = next(a.defaultValue for a in f['fvar'].axes if a.axisTag == tag)
        if tag == 'wght': loc[tag] = max(mn, min(mx, wght))
        else: loc[tag] = dflt
    loc = {k: v for k, v in loc.items() if v is not None}
    try: return instancer.instantiateVariableFont(f, loc, updateFontNames=False)
    except Exception: return instancer.instantiateVariableFont(f, loc)

STYLES = [('Regular', 'normal', 400), ('Bold', 'normal', 700), ('Italic', 'italic', 400), ('BoldItalic', 'italic', 700)]
def build_gf(key, d):
    fonts, axes = gf_entries(d)
    out = {}
    for name, st, w in STYLES:
        cands = [x for x in fonts if x[0] == st] or ([] if st == 'italic' else fonts)
        if not cands: continue
        var = [x for x in cands if '[' in x[2]]
        if var:
            fn = var[0][2]; mn, mx = axes.get('wght', (400, 400))
            if w == 700 and mx < 600: continue  # sin negrita real
            if w == 400 and mn > 450 and st == 'normal' and name != 'Regular': continue
            f = instance(fetch(RAW + d + '/' + fn), axes, w)
        else:
            best = min(cands, key=lambda x: abs(x[1] - w))
            if abs(best[1] - w) > 150 and name != 'Regular': continue
            f = TTFont(io.BytesIO(fetch(RAW + d + '/' + best[2])))
        out[name] = f
    return out

def build_apt(key, base):
    files = {}
    for root, _, fs in os.walk(APT):
        for fn in fs: files[fn] = os.path.join(root, fn)
    m = {'Regular': [f'{base}-regular.otf', f'{base}.ttf', f'{base}-mediumitalic.otf'], 'Bold': [f'{base}-bold.otf', f'{base}-Bold.ttf'],
         'Italic': [f'{base}-italic.otf', f'{base}-Oblique.ttf', f'{base}-Italic.ttf'], 'BoldItalic': [f'{base}-bolditalic.otf', f'{base}-BoldOblique.ttf', f'{base}-BoldItalic.ttf']}
    out = {}
    for name, cands in m.items():
        for c in cands:
            if c in files: out[name] = TTFont(files[c]); break
    return out

def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    only = set(sys.argv[2:])
    for key, label, cat, src, word, match in CATALOG:
        if only and key not in only: continue
        try:
            faces = build_gf(key, src[1]) if src[0] == 'gf' else build_apt(key, src[1])
        except Exception as e:
            print('!!', key, e); continue
        if 'Regular' not in faces: print('!! sin regular', key); continue
        stem = 'PF-' + key
        files = {}
        for name, f in faces.items():
            p = os.path.join(OUT, f'{stem}-{name}.ttf'); finish(f, p); files[name] = f'{stem}-{name}.ttf'
        full = {n: files.get(n) or files.get({'BoldItalic': 'Bold' if 'Bold' in files else 'Italic', 'Bold': 'Regular', 'Italic': 'Regular'}.get(n, 'Regular')) or files['Regular'] for n, _, _ in STYLES}
        full['BoldItalic'] = files.get('BoldItalic') or files.get('Bold') or files.get('Italic') or files['Regular']
        manifest.append({'key': key, 'label': label, 'cat': cat, 'word': word, 'match': match or re.sub(r'[^a-z0-9]', '', label.lower()), 'files': full,
                         'real': sorted(files.keys())})
        print('ok', key, sorted(files.keys()), sum(os.path.getsize(os.path.join(OUT, v)) for v in files.values()) // 1024, 'KB')
    json.dump({'cats': CAT_LABEL, 'families': manifest}, open(os.path.join(OUT, 'catalog.json'), 'w'), ensure_ascii=False, indent=1)

main()
