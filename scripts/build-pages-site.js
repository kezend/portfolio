const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
const textEntries = ['index.html', 'myvibe.html', 'portfolio-published.js'];
const directEntries = ['CNAME', 'PPNeueMontreal-Regular.ttf'];
const extensionPattern = '(?:avif|css|gif|jpe?g|js|m4a|mov|mp3|mp4|m4v|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?)';
const referencePattern = new RegExp(
  `["'\\\`](?!https?:|data:|#)([^"'\\\`\\n]+\\.${extensionPattern})(?:\\?[^"'\\\`]*)?["'\\\`]`,
  'gi'
);
const rasterExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const passthroughExtensions = new Set(['.m4a', '.mov', '.mp3', '.mp4', '.m4v', '.ogg', '.svg', '.wav', '.webm']);

function safeDecode(value) {
  try { return decodeURIComponent(value); }
  catch (error) { return value; }
}

function normalizeReference(value) {
  return safeDecode(value).replaceAll('&amp;', '&').replace(/^\.\//, '').split('?')[0];
}

function sourcePath(relativePath) {
  const absolute = path.resolve(root, relativePath);
  return absolute.startsWith(root + path.sep) ? absolute : null;
}

function hashFor(relativePath, stat, suffix) {
  return crypto
    .createHash('sha1')
    .update(`${relativePath}:${stat.size}:${Math.round(stat.mtimeMs)}:${suffix}`)
    .digest('hex')
    .slice(0, 14);
}

function write(relativePath, contents) {
  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function copy(relativePath) {
  const source = sourcePath(relativePath);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function replaceReferences(source, replacements) {
  let result = source;
  replacements.forEach((replacement, reference) => {
    result = result.split(reference).join(replacement);
    result = result.split(reference.replaceAll('&', '&amp;')).join(replacement);
    const encoded = encodeURI(reference);
    if (encoded !== reference) result = result.split(encoded).join(replacement);
  });
  return result;
}

function collectThumbnailReferences(indexSource) {
  const references = new Set();
  const loaderBlock = indexSource.match(/const thumbs = \[([\s\S]*?)\n\s*\];/);
  if (loaderBlock) {
    for (const match of loaderBlock[0].matchAll(/src:\s*["']([^"']+)["']/g)) {
      references.add(normalizeReference(match[1]));
    }
  }
  for (const match of indexSource.matchAll(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    references.add(normalizeReference(match[1]));
  }
  return references;
}

function collectMyVibeThumbnailReferences(source) {
  const references = new Set();
  const projectsBlock = source.match(/const projects = \[([\s\S]*?)\n\s*\];/);
  if (projectsBlock) {
    for (const match of projectsBlock[0].matchAll(/src:\s*["']([^"']+)["']/g)) {
      const reference = normalizeReference(match[1]);
      if (rasterExtensions.has(path.extname(reference).toLowerCase())) references.add(reference);
    }
  }
  for (const match of source.matchAll(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    references.add(normalizeReference(match[1]));
  }
  return references;
}

function replaceThumbnailReferences(indexSource, thumbnailMap) {
  const replaceSegment = segment => replaceReferences(segment, thumbnailMap);
  let result = indexSource.replace(/const thumbs = \[([\s\S]*?)\n\s*\];/, replaceSegment);
  result = result.replace(/<img\b[^>]*\b(?:src|data-src)=["'][^"']+["'][^>]*>/gi, replaceSegment);
  return result;
}

function replaceMyVibeThumbnailReferences(source, thumbnailMap) {
  const replaceSegment = segment => replaceReferences(segment, thumbnailMap);
  let result = source.replace(/const projects = \[([\s\S]*?)\n\s*\];/, replaceSegment);
  result = result.replace(/<img\b[^>]*\b(?:src|data-src)=["'][^"']+["'][^>]*>/gi, replaceSegment);
  return result;
}

async function createWebp(relativePath, role) {
  const input = sourcePath(relativePath);
  if (!input || !fs.existsSync(input)) return null;
  const stat = fs.statSync(input);
  const image = sharp(input, { animated: role !== 'thumb', limitInputPixels: false, pages: role === 'thumb' ? 1 : -1 });
  const metadata = await image.metadata();
  const animated = role !== 'thumb' && Number(metadata.pages || 1) > 1;
  const maxWidth = role === 'thumb' ? 720 : animated ? 1280 : 1920;
  const quality = role === 'thumb' ? 70 : animated ? 68 : 78;
  const effort = animated ? 4 : 5;
  const hash = hashFor(relativePath, stat, `${role}:${maxWidth}:${quality}`);
  const destinationReference = `media/${hash}-${role}.webp`;
  const destination = path.join(output, destinationReference);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  let pipeline = image;
  if (metadata.width && metadata.width > maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }
  await pipeline.webp({ quality, effort, smartSubsample: true, loop: metadata.loop }).toFile(destination);
  return destinationReference;
}

function extractAssets(indexSource, filename, scriptPrefix = '') {
  const style = indexSource.match(/<style>([\s\S]*?)<\/style>/);
  const script = indexSource.match(/<script>([\s\S]*?)<\/script>/);
  let html = indexSource;
  if (style) {
    const cssPath = `styles/${filename}.css`;
    const css = style[1]
      .replace(/url\((["']?)PPNeueMontreal-Regular\.ttf\1\)/g, "url('../PPNeueMontreal-Regular.ttf')")
      .trim() + '\n';
    write(cssPath, css);
    html = html.replace(style[0], `<link rel="stylesheet" href="${cssPath}">`);
  }
  if (script) {
    const jsPath = `scripts/${filename}.js`;
    write(jsPath, scriptPrefix + script[1].trim() + '\n');
    html = html.replace(script[0], `<script src="${jsPath}" defer></script>`);
  }
  return html;
}

function createServiceWorker(shellFiles, version) {
  return `const CACHE = 'portfolio-${version}';
const SHELL = ${JSON.stringify(shellFiles)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  const request = event.request;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(response => response || caches.match('/index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
`;
}

async function main() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  const textSources = new Map();
  textEntries.forEach(entry => {
    const absolute = path.join(root, entry);
    if (fs.existsSync(absolute)) textSources.set(entry, fs.readFileSync(absolute, 'utf8'));
  });

  const references = new Set();
  textSources.forEach(source => {
    for (const match of source.matchAll(referencePattern)) {
      const reference = normalizeReference(match[1]);
      const absolute = sourcePath(reference);
      if (absolute && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) references.add(reference);
    }
  });

  const indexSource = textSources.get('index.html') || '';
  const myVibeSource = textSources.get('myvibe.html') || '';
  const myVibeThumbnailReferences = collectMyVibeThumbnailReferences(myVibeSource);
  const thumbnailReferences = collectThumbnailReferences(indexSource);
  myVibeThumbnailReferences.forEach(reference => thumbnailReferences.add(reference));
  const detailMap = new Map();
  const thumbnailMap = new Map();
  let optimizedBefore = 0;
  let optimizedAfter = 0;

  for (const reference of [...references].sort()) {
    const extension = path.extname(reference).toLowerCase();
    const absolute = sourcePath(reference);
    if (!absolute) continue;
    if (rasterExtensions.has(extension)) {
      const detailReference = await createWebp(reference, 'detail');
      if (detailReference) {
        detailMap.set(reference, detailReference);
        optimizedBefore += fs.statSync(absolute).size;
        optimizedAfter += fs.statSync(path.join(output, detailReference)).size;
      }
      if (thumbnailReferences.has(reference)) {
        const thumbnailReference = await createWebp(reference, 'thumb');
        if (thumbnailReference) thumbnailMap.set(reference, thumbnailReference);
      }
    } else if (passthroughExtensions.has(extension)) {
      copy(reference);
    }
  }

  textSources.forEach((source, entry) => {
    let transformed = source;
    if (entry === 'index.html') transformed = replaceThumbnailReferences(transformed, thumbnailMap);
    if (entry === 'myvibe.html') transformed = replaceMyVibeThumbnailReferences(transformed, thumbnailMap);
    transformed = replaceReferences(transformed, detailMap);
    if (entry === 'index.html' || entry === 'myvibe.html') {
      if (entry === 'index.html') {
        transformed = transformed.replace(
          /<script>\s*\(function loadAdminOnlyWhenRequested\(\)[\s\S]*?<\/script>/,
          ''
        );
      }
      let scriptPrefix = '';
      if (entry === 'myvibe.html') {
        const detailMedia = {};
        myVibeThumbnailReferences.forEach(reference => {
          const thumb = thumbnailMap.get(reference);
          const detail = detailMap.get(reference);
          if (thumb && detail) detailMedia[thumb] = detail;
        });
        scriptPrefix = `window.__PORTFOLIO_DETAIL_MEDIA__ = ${JSON.stringify(detailMedia)};\n`;
      }
      transformed = extractAssets(transformed, path.basename(entry, '.html'), scriptPrefix);
      transformed = transformed.replace(
        '</body>',
        `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') { addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }</script>\n</body>`
      );
    }
    write(entry, transformed);
  });

  directEntries.forEach(copy);
  write('.nojekyll', '');

  const shell = ['/index.html', '/styles/index.css', '/scripts/index.js', '/PPNeueMontreal-Regular.ttf'];
  const version = crypto.createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 10);
  write('sw.js', createServiceWorker(shell, version));

  let bytes = 0;
  let files = 0;
  function measure(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) measure(absolute);
      else { files++; bytes += fs.statSync(absolute).size; }
    });
  }
  measure(output);
  const reduction = optimizedBefore ? Math.round((1 - optimizedAfter / optimizedBefore) * 100) : 0;
  console.log(`Pages artifact: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Raster assets: ${(optimizedBefore / 1024 / 1024).toFixed(1)} MB -> ${(optimizedAfter / 1024 / 1024).toFixed(1)} MB (${reduction}% smaller)`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
