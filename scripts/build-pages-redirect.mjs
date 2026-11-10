import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const target = String(process.env.REDIRECT_URL || 'https://m1-bus.hheylau.workers.dev/').trim();

if (!/^https:\/\/[^\s"<>]+$/.test(target)) {
  throw new Error('REDIRECT_URL must be an https:// URL');
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const html = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <title>Harry Stoke · Live departures</title>
  </head>
  <body>
    <p>The live board has moved to <a href="${target}">${target}</a>…</p>
  </body>
</html>
`;

fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log(`[build] Wrote Pages redirect to ${target}`);
