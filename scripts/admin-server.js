const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4178);
const maxBody = 120 * 1024 * 1024;
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
};

function findSharp() {
  const candidates = [
    'sharp',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {}
  }
  return null;
}

const sharp = findSharp();

function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, payload) {
  cors(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBody) {
        reject(new Error('Payload is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function safeSegment(value, fallback) {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9а-яА-Я._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return cleaned || fallback;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.details = stderr || stdout;
        reject(error);
        return;
      }
      resolve((stdout || stderr || '').trim());
    });
  });
}

async function saveUpload(project, file) {
  const folder = path.join(root, 'uploads', safeSegment(project, 'project'));
  fs.mkdirSync(folder, { recursive: true });
  const extension = path.extname(file.name || '').toLowerCase();
  const baseName = safeSegment(path.basename(file.name || 'asset', extension), 'asset');
  const input = Buffer.from(String(file.data || '').split(',').pop(), 'base64');
  const image = /^image\//.test(file.type || '') || ['.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'].includes(extension);
  let outputName = `${baseName}-${Date.now()}`;
  let optimized = false;
  let output;

  if (image && sharp) {
    outputName += '.webp';
    output = await sharp(input, { animated: extension === '.gif', limitInputPixels: false })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    optimized = true;
  } else {
    outputName += extension || '.bin';
    output = input;
  }

  const absolute = path.join(folder, outputName);
  fs.writeFileSync(absolute, output);
  return {
    path: path.relative(root, absolute).split(path.sep).join('/'),
    bytesOriginal: input.length,
    bytes: output.length,
    optimized
  };
}

async function handleUpload(request, response) {
  const body = await readJson(request);
  const files = Array.isArray(body.files) ? body.files : [];
  const saved = [];
  for (const file of files) saved.push(await saveUpload(body.project, file));
  await run(process.execPath, [path.join(__dirname, 'build-asset-manifest.js')]);
  sendJson(response, 200, { ok: true, files: saved, sharp: Boolean(sharp) });
}

async function handlePublish(request, response) {
  const body = await readJson(request);
  if (!String(body.source || '').startsWith('window.__PORTFOLIO_PUBLISHED__')) {
    sendJson(response, 400, { ok: false, error: 'Invalid publish source' });
    return;
  }
  fs.writeFileSync(path.join(root, 'portfolio-published.js'), body.source);
  await run(process.execPath, [path.join(__dirname, 'build-asset-manifest.js')]);

  const candidates = [
    'index.html', 'admin-workbench.js', 'portfolio-published.js',
    'portfolio-asset-manifest.js', 'scripts', 'Electric Lines', 'Vesh', 'uploads'
  ].filter(item => fs.existsSync(path.join(root, item)));
  await run('git', ['add', '--', ...candidates]);
  const staged = await run('git', ['diff', '--cached', '--name-only']);
  let commit = '';
  if (staged) commit = await run('git', ['commit', '-m', body.message || 'Update portfolio from admin']);
  const branch = await run('git', ['branch', '--show-current']);
  const push = await run('git', ['push', 'origin', branch]);
  sendJson(response, 200, { ok: true, branch, staged: staged.split('\n').filter(Boolean), commit, push });
}

function serveFile(request, response) {
  const rawPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  const requested = rawPath === '/' ? '/index.html' : rawPath;
  const absolute = path.resolve(root, `.${requested}`);
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(absolute).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(absolute).pipe(response);
}

const server = http.createServer(async (request, response) => {
  cors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    if (request.method === 'GET' && request.url === '/api/status') {
      sendJson(response, 200, { ok: true, sharp: Boolean(sharp), root });
    } else if (request.method === 'POST' && request.url === '/api/upload') {
      await handleUpload(request, response);
    } else if (request.method === 'POST' && request.url === '/api/publish') {
      await handlePublish(request, response);
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      serveFile(request, response);
    } else {
      sendJson(response, 404, { ok: false, error: 'Not found' });
    }
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.details || error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Portfolio admin: http://${host}:${port}/index.html`);
  console.log(`Image optimization: ${sharp ? 'enabled' : 'unavailable'}`);
});
