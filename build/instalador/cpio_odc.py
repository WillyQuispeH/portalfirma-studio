#!/usr/bin/env python3
"""Escribe un cpio «odc» comprimido con gzip, con rutas «./…» y dueño root:admin, como el Payload de pkgbuild.
Uso: cpio_odc.py DIRECTORIO SALIDA.gz"""
import gzip, os, stat, sys
src, out = sys.argv[1], sys.argv[2]
def entries(root):
    yield '.'
    for d, dirs, files in os.walk(root, followlinks=False):
        dirs.sort(); rel = os.path.relpath(d, root)
        for n in sorted(dirs + files):
            yield './' + (n if rel == '.' else os.path.join(rel, n).replace(os.sep, '/'))
ino = 0
with gzip.open(out, 'wb', compresslevel=9) as z:
    def hdr(name, st, size):
        global ino; ino += 1; nb = name.encode() + b'\0'
        z.write(b'070707' + b''.join(b'%0*o' % (w, v) for w, v in ((6, 0), (6, ino & 0o777777), (6, st.st_mode if st else 0), (6, 0), (6, 80), (6, 1), (6, 0), (11, int(st.st_mtime) if st else 0), (6, len(nb)), (11, size))) + nb)
    for name in entries(src):
        p = os.path.join(src, name); st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode): data = os.readlink(p).encode(); hdr(name, st, len(data)); z.write(data)
        elif stat.S_ISREG(st.st_mode):
            hdr(name, st, st.st_size)
            with open(p, 'rb') as f:
                while True:
                    b = f.read(1 << 20)
                    if not b: break
                    z.write(b)
        else: hdr(name, st, 0)
    hdr('TRAILER!!!', None, 0)
