# Credenciales que NO van en el código

Por seguridad, este paquete de código no incluye estos archivos. Antes de compilar, agrégalos en su ruta:

| Archivo | Para qué sirve | Cómo se genera |
|---|---|---|
| `build/ia/clave.bin` | Clave de IA incluida en la app (ofuscada) | `node tools/ia/incluir-clave.js <archivo> openai [modelo]` |
| `build/google/oauth.json` | Cliente OAuth «App de escritorio» de Google (proyecto `portalfirma-studio`) más la sección `picker` (api_key, app_id) | Consola de Google Cloud → Credenciales del proyecto `portalfirma-studio` |
| `build/portalfirma/api.json` | Clave de cabecera `id` de la API de partners: `{ "id": "…" }` | La entrega Portalfirma |

Tampoco van `node_modules/` (`npm install` los restaura) ni `dist/` (compilados). Las dos pruebas que usan archivos grandes (`test/fixtures/foto.png` y `plano_A0.pdf`) los necesitan aparte.
