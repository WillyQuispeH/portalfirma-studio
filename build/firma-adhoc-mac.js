// afterPack: en Mac, sin certificado de Apple, firma la app "ad-hoc" (codesign -s -).
// Sin firma, las Mac con chip Apple (arm64) dicen que la app "está dañada".
// Si hay certificado (CSC_LINK), no hace nada: electron-builder firma de verdad después.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • firma ad-hoc  ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
