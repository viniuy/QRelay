const puppeteer = require('puppeteer-core');
const path = require('path');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1920, height: 1080 });
  await pg.goto(require('url').pathToFileURL(path.resolve('index.html')).href);
  await pg.evaluate(() => window.ready);
  const ts = process.argv.slice(2).map(Number);
  require('fs').mkdirSync('stills', { recursive: true });
  for (const t of ts) {
    await pg.evaluate((t) => window.render(t), t);
    await pg.screenshot({ path: `stills/t${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 80 });
  }
  await b.close();
})();
