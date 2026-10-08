# Credenciales que NO van en el código

Por seguridad, este paquete de código no incluye estos archivos. Antes de compilar, agrégalos en su ruta:

| Archivo | Para qué sirve | Cómo se genera |
|---|---|---|
| `build/ia/clave.bin` | Clave de IA incluida en la app (ofuscada) | `node tools/ia/incluir-clave.js <archivo> openai [modelo]` |
| `build/google/oauth.json` | Cliente OAuth «App de escritorio» de Google (proyecto `portalfirma-studio`) más la sección `picker` (api_key, app_id) | Consola de Google Cloud → Credenciales del proyecto `portalfirma-studio` |
| `build/portalfirma/api.json` | Clave de cabecera `id` de la API de partners: `{ "id": "…" }` | La entrega Portalfirma |

## En GitHub Actions (para `yarn publicar`)

Las mismas credenciales se guardan como secretos del repo en **Settings → Secrets and variables → Actions → New repository secret**. Si falta alguno, la versión se publica igual, pero sin esa función, y Actions muestra un aviso.

| Secreto | Contenido |
|---|---|
| `PF_IA_CLAVE_B64` | `clave.bin` en base64. En PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("build\ia\clave.bin")) \| Set-Clipboard` |
| `PF_GOOGLE_OAUTH_JSON` | Contenido completo de `build/google/oauth.json` |
| `PF_API_JSON` | Contenido completo de `build/portalfirma/api.json` |

Ojo: lo que va dentro del instalador se puede extraer de la app instalada; los secretos de GitHub solo evitan que queden en el código público.

Tampoco van `node_modules/` (`npm install` los restaura) ni `dist/` (compilados). Las dos pruebas que usan archivos grandes (`test/fixtures/foto.png` y `plano_A0.pdf`) los necesitan aparte.
