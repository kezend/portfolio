const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'portfolio-asset-manifest.js');
const mediaExtensions = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.mp4', '.png', '.svg', '.webm', '.webp'
]);
const ignoredDirectories = new Set(['.git', 'node_modules']);
const assets = {};

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) return;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      return;
    }
    if (!mediaExtensions.has(path.extname(entry.name).toLowerCase())) return;
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const stat = fs.statSync(absolute);
    assets[relative] = { bytes: stat.size, modified: Math.round(stat.mtimeMs) };
  });
}

walk(root);
const source = `window.__PORTFOLIO_ASSET_SIZES__ = ${JSON.stringify(assets, null, 2)};\n`;
fs.writeFileSync(output, source);
console.log(`Wrote ${Object.keys(assets).length} assets to ${path.basename(output)}`);
