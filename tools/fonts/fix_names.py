# Corrige nombres internos y peso de las fuentes instanciadas (negrita/cursiva reales).
import json, sys, os, re
from fontTools.ttLib import TTFont
D = sys.argv[1]; cat = json.load(open(os.path.join(D, 'catalog.json')))
SN = {'Regular': 'Regular', 'Bold': 'Bold', 'Italic': 'Italic', 'BoldItalic': 'Bold Italic'}
for f in cat['families']:
    for st in f['real']:
        p = os.path.join(D, f['files'][st]); t = TTFont(p); n = t['name']
        fam = (n.getDebugName(16) or n.getDebugName(1) or f['label']).strip()
        fam = re.sub(r'\s+(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black|Italic)(\s+\w+)*$', '', fam) or fam
        ps = re.sub(r'[^A-Za-z0-9]', '', fam) + '-' + st
        for rec in list(n.names):
            if rec.nameID in (16, 17, 21, 22, 25): n.removeNames(nameID=rec.nameID)
        n.setName(fam, 1, 3, 1, 0x409); n.setName(SN[st], 2, 3, 1, 0x409); n.setName(f'{fam} {SN[st]}', 4, 3, 1, 0x409); n.setName(ps, 6, 3, 1, 0x409)
        n.setName(fam, 1, 1, 0, 0); n.setName(SN[st], 2, 1, 0, 0); n.setName(f'{fam} {SN[st]}', 4, 1, 0, 0); n.setName(ps, 6, 1, 0, 0)
        b, i = 'Bold' in st, 'Italic' in st
        os2 = t['OS/2']; os2.usWeightClass = 700 if b else 400
        os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0x20 if b else 0) | (0x01 if i else 0) | (0x40 if not b and not i else 0)
        t['head'].macStyle = (1 if b else 0) | (2 if i else 0)
        if 'post' in t and i and t['post'].italicAngle == 0: t['post'].italicAngle = -10
        t['glyf'].padding = 4
        t.save(p)
print('ok')
