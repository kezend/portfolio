const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');

function findSharp() {
  const candidates = [
    'sharp',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {}
  }
  throw new Error('sharp is required');
}

async function main() {
  const sharp = findSharp();
  let html = fs.readFileSync(htmlPath, 'utf8');
  const references = [...new Set(
    [...html.matchAll(/["']([^"'\n]+\.gif)(?:\?[^"']*)?["']/gi)].map(match => match[1])
  )];
  const report = [];

  for (const reference of references) {
    const input = path.join(root, reference);
    if (!fs.existsSync(input)) continue;
    const outputReference = reference.replace(/\.gif$/i, '.optimized.webp');
    const output = path.join(root, outputReference);
    if (!fs.existsSync(output)) {
      await sharp(input, { animated: true, limitInputPixels: false })
        .webp({ quality: 82, effort: 5 })
        .toFile(output);
    }
    const before = fs.statSync(input).size;
    const after = fs.statSync(output).size;
    if (after < before) {
      html = html.split(reference).join(outputReference);
      report.push({ input: reference, output: outputReference, before, after });
    }
  }

  fs.writeFileSync(htmlPath, html);
  report.forEach(item => {
    const saved = Math.round((1 - item.after / item.before) * 100);
    console.log(`${item.input} -> ${item.output} (${saved}% smaller)`);
  });
  console.log(`Optimized references: ${report.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
