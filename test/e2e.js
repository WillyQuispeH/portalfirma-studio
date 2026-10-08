const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, PF_MOCK: '1' }, cwd: path.join(__dirname, '..') });
  const w = await app.firstWindow();
  const errs = []; w.on('pageerror', e => errs.push(e.message + ' @ ' + String(e.stack).split('\n').slice(0, 4).join(' | '))); w.on('console', m => m.type()==='error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1000, height: 760 });
  await w.waitForSelector('.hub-card'); await w.click('.tab[data-view="send"]'); await w.waitForSelector('#loginBtn'); await w.screenshot({ path: 'test/1-login.png' });
  await w.click('#loginBtn'); await w.waitForSelector('#dropzone:visible'); await w.screenshot({ path: 'test/2-drop.png' });
  // simular archivo abierto (como arrastrar al Dock)
  await w.evaluate((f) => startAnalysis({ name: 'contrato_prueba.pdf', size: 2000, path: f }), path.resolve(__dirname, 'fixtures/contrato_prueba.pdf'));
  await w.waitForSelector('#view-review:visible', { timeout: 10000 }); await w.screenshot({ path: 'test/3-review.png', fullPage: true });
  await w.click('#sendBtn'); await w.waitForTimeout(300);
  console.log('error shown:', await w.textContent('#reviewError'));
  // completar datos faltantes
  const fill = async (i,k,v)=>{ const s=`input[data-i="${i}"][data-k="${k}"]`; await w.fill(s,v); await w.dispatchEvent(s,'change'); };
  await fill(0,'email','juan@correo.cl'); await fill(0,'phone','912345678');
  await fill(1,'email','maria@correo.cl'); await fill(1,'phone','987654321');
  await w.selectOption('#typeSignAll','visada'); await w.selectOption('#protocolization','legalization');
  await w.fill('#payerEmail','jgomez@portalfirma.cl');
  await w.click('#sendBtn'); await w.waitForSelector('#modal:not(.hidden)'); await w.screenshot({ path: 'test/4-confirm.png' });
  await w.click('#mOk'); await w.waitForSelector('#view-done:visible'); await w.waitForTimeout(800); await w.screenshot({ path: 'test/5-done.png', fullPage: true });
  await w.click('#viewOpBtn'); await w.waitForTimeout(900); await w.screenshot({ path: 'test/6-ops.png' });
  console.log('page errors:', errs);
  await app.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
