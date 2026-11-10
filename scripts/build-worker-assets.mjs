import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const outDir = path.join(root, 'worker', 'assets');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Copy every static file except index.html, which is generated below.
for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name !== 'index.html') {
    fs.copyFileSync(path.join(publicDir, entry.name), path.join(outDir, entry.name));
  }
}

let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

// Serve the same-origin API: no api-base meta, relative asset URLs.
const css = /href="(\/styles\.css\?v=[^"]*)"/.exec(html);
const js = /src="(\/app\.js\?v=[^"]*)"/.exec(html);
if (!css || !js) {
  throw new Error('Could not find versioned stylesheet/script links in public/index.html');
}
html = html
  .replace(css[0], `href=".${css[1]}"`)
  .replace(js[0], `src=".${js[1]}"`);

if (html.includes('name="api-base"')) {
  throw new Error('Worker HTML must not carry an api-base meta tag');
}

fs.writeFileSync(path.join(outDir, 'index.html'), html);

console.log(`[build] Wrote worker assets to ${path.relative(root, outDir)}`);
