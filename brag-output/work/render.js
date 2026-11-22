// Renders index.html frame by frame through Edge and pipes PNGs into ffmpeg with music.wav.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const url = require('url');
const ffmpeg = require('ffmpeg-static');
const FPS = 30, DUR = 21.5, FRAMES = Math.round(FPS * DUR);

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1920, height: 1080 });
  await pg.goto(url.pathToFileURL(path.resolve('index.html')).href);
  await pg.evaluate(() => window.ready);
  const ff = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', 'music.wav',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', 'raw.mp4'], { stdio: ['pipe', 'ignore', 'inherit'] });
  for (let f = 0; f < FRAMES; f++) {
    await pg.evaluate((t) => window.render(t), f / FPS);
    const png = await pg.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) console.log('frame', f, '/', FRAMES);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await b.close();
})();
