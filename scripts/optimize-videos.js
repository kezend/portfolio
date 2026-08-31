const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'myvibe.html'];
const outputDirectory = path.join(root, 'runtime-video');
const videoPattern = /["'`](?!https?:)([^"'`\n]+\.(?:mov|mp4|m4v|webm))["'`]/gi;
const minimumBytes = 5 * 1024 * 1024;

fs.mkdirSync(outputDirectory, { recursive: true });

const sources = new Map(htmlFiles.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const references = new Set();
sources.forEach(source => {
  for (const match of source.matchAll(videoPattern)) {
    const reference = match[1];
    const absolute = path.resolve(root, reference);
    if (absolute.startsWith(root + path.sep) && fs.existsSync(absolute)) references.add(reference);
  }
});

const replacements = new Map();
for (const reference of references) {
  const input = path.resolve(root, reference);
  const before = fs.statSync(input).size;
  if (before < minimumBytes) continue;
  const hash = crypto.createHash('sha1').update(`${reference}:${before}`).digest('hex').slice(0, 14);
  const outputReference = `runtime-video/${hash}.m4v`;
  const output = path.join(root, outputReference);
  const result = spawnSync('/usr/bin/avconvert', [
    '--source', input,
    '--preset', 'PresetAppleM4VWiFi',
    '--output', output,
    '--replace'
  ], { stdio: 'inherit' });
  if (result.status !== 0 || !fs.existsSync(output)) continue;
  const after = fs.statSync(output).size;
  if (after >= before * 0.9) {
    fs.rmSync(output, { force: true });
    continue;
  }
  replacements.set(reference, outputReference);
  console.log(`${reference}: ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB`);
}

sources.forEach((source, file) => {
  let output = source;
  replacements.forEach((replacement, reference) => {
    output = output.split(reference).join(replacement);
  });
  fs.writeFileSync(path.join(root, file), output);
});

console.log(`Optimized video references: ${replacements.size}`);
