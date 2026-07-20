const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
const parsedEntries = ['index.html', 'myvibe.html', 'admin-workbench.js', 'portfolio-published.js'];
const copiedEntries = [...parsedEntries, 'portfolio-asset-manifest.js'];
const extensionPattern = '(?:avif|css|gif|jpe?g|js|m4a|mov|mp3|mp4|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?)';
const referencePattern = new RegExp(
  `["'\\\`](?!https?:|data:|#)([^"'\\\`\\n]+\\.${extensionPattern})(?:\\?[^"'\\\`]*)?["'\\\`]`,
  'gi'
);

function safeDecode(value) {
  try { return decodeURIComponent(value); }
  catch (error) { return value; }
}

function copy(relativePath) {
  const source = path.resolve(root, relativePath);
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const files = new Set(copiedEntries);
parsedEntries.forEach(entry => {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) return;
  const source = fs.readFileSync(absolute, 'utf8');
  for (const match of source.matchAll(referencePattern)) {
    const reference = safeDecode(match[1]);
    const resolved = path.resolve(root, reference);
    if (resolved.startsWith(root + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      files.add(reference);
    }
  }
});

let bytes = 0;
files.forEach(file => {
  if (copy(file)) bytes += fs.statSync(path.join(root, file)).size;
});
fs.writeFileSync(path.join(output, '.nojekyll'), '');

console.log(`Pages artifact: ${files.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
