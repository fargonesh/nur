#!/usr/bin/env node
// Live git browser backend: serves web/dist, builds repo JSON at request time
// from bare repos ($REPOS_DIR), and handles clone+push via `git http-backend`.
// Node stdlib only. Env: PORT=3001 REPOS_DIR=./repos
//   SITE_ORIGIN=https://nix.fargone.sh (flake refs; default: request host)
//   GIT_ALLOW_ANON_PUSH=1 (demo/LAN; front with auth proxy on public nets)
// # ponytail: no auth layer, add reverse-proxy basic-auth when untrusted pushers arrive
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOS = path.resolve(process.env.REPOS_DIR ?? path.join(HERE, '..', 'repos'));
const DIST = fs.existsSync(path.join(HERE, 'dist')) ? path.join(HERE, 'dist') : path.join(HERE, 'public');
const PORT = Number(process.env.PORT ?? 3001);
const MAX_COMMITS = 500;
const MAX_BYTES = 200000;
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain' };

// --- git plumbing (sync; repos are small, requests are cheap) ---
const dirOf = (name) => path.join(REPOS, name.endsWith('.git') ? name : `${name}.git`);
const git = (dir, args, input) => {
  const r = spawnSync('git', ['--git-dir', dir, ...args], { input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
  return r.stdout;
};

function commitsOf(dir, head) {
  let raw;
  try {
    raw = git(dir, ['log', head, '-n', String(MAX_COMMITS + 1), '--format=tformat:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x00']).toString('utf8');
  } catch { return { commits: [], truncated: false }; }
  const recs = raw.split('\x00').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim());
  return {
    truncated: recs.length > MAX_COMMITS,
    commits: recs.slice(0, MAX_COMMITS).map((r) => {
      const [id, parents, author, email, date, subject, body] = r.split('\x1f');
      const stats = git(dir, ['diff-tree', '--numstat', '-r', '--root', '--format=', id])
        .toString('utf8').split('\n').filter(Boolean).slice(0, 200)
        .map((l) => { const [add, del, p] = l.split('\t'); return { add, del, path: p }; });
      return { id, parents: parents.split(' ').filter(Boolean), author, email, date, subject, body: body.trim(), stats };
    }),
  };
}

function treeOf(dir, head) {
  let entries;
  try {
    entries = git(dir, ['ls-tree', '-r', '-l', '-z', head]);
  } catch { return { files: [], contents: {}, skipped: [] }; }
  const files = [], want = [], skipped = [];
  const recs = [];
  for (let s = 0;;) {
    const z = entries.indexOf(0, s);
    if (z < 0) break;
    recs.push(entries.subarray(s, z));
    s = z + 1;
  }
  for (const e of recs) {
    if (!e.length) continue;
    const tab = e.indexOf(9);
    const [mode, type, sha, size] = e.subarray(0, tab).toString().split(' ');
    if (type !== 'blob') continue;
    const p = e.subarray(tab + 1).toString('utf8');
    files.push({ path: p, size: Number(size) });
    if (Number(size) <= MAX_BYTES) want.push([p, sha]); else skipped.push(p);
  }
  const contents = {};
  if (want.length) {
    let out = git(dir, ['cat-file', '--batch'], Buffer.from(want.map(([, s]) => `${s}\n`).join('')));
    for (const [p] of want) {
      const nl = out.indexOf(10);
      const size = Number(out.subarray(0, nl).toString().split(' ')[2]);
      const data = out.subarray(nl + 1, nl + 1 + size);
      out = out.subarray(nl + 1 + size + 1);
      if (!data.subarray(0, 8192).includes(0)) contents[p] = data.toString('utf8');
      else skipped.push(p);
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, contents, skipped: skipped.sort() };
}

const metaOf = (src, k) => (src.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]+)"`)) || [])[1] ?? '';

function repoJson(name, origin) {
  const dir = dirOf(name);
  let head = 'main';
  try { head = git(dir, ['symbolic-ref', '--short', 'HEAD']).toString('utf8').trim(); } catch {}
  const branches = git(dir, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'])
    .toString('utf8').split('\n').filter(Boolean)
    .map((l) => { const [b, id] = [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)]; return { name: b, id }; });
  const { commits, truncated } = commitsOf(dir, head);
  const { files, contents, skipped } = treeOf(dir, head);
  const packages = files.filter((f) => /^pkgs\/[^/]+\/default\.nix$/.test(f.path)).map((f) => {
    const src = contents[f.path] ?? '';
    const pkg = f.path.split('/')[1];
    return {
      name: pkg,
      bin: (src.match(/writeShellScriptBin\s+"([^"]+)"/) || [])[1] ?? pkg,
      description: metaOf(src, 'description'),
      license: (src.match(/licenses\.([\w-]+)/) || [])[1] ?? '',
      flake: `git+${origin}/git/${name}.git#${pkg}`,
    };
  });
  const authors = {};
  for (const c of commits) authors[`${c.author} <${c.email}>`] = (authors[`${c.author} <${c.email}>`] ?? 0) + 1;
  return { name, head, branches, commits, truncatedCommits: truncated, files, contents, skippedFiles: skipped, packages, authors };
}

// --- git smart HTTP via real git ---
function gitHttp(req, res) {
  const q = req.url.indexOf('?');
  const qs = q < 0 ? '' : req.url.slice(q + 1);
  const pathInfo = decodeURIComponent(q < 0 ? req.url.slice(4) : req.url.slice(4, q));
  const push = /git-receive-pack/.test(pathInfo + qs);
  if (push && (process.env.GIT_ALLOW_ANON_PUSH ?? '1') !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('push disabled (GIT_ALLOW_ANON_PUSH=1 to allow)');
    return;
  }
  const env = {
    ...process.env, GIT_PROJECT_ROOT: REPOS, GIT_HTTP_EXPORT_ALL: '1',
    REQUEST_METHOD: req.method, QUERY_STRING: qs, PATH_INFO: pathInfo,
    CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: req.headers['content-length'] ?? '',
    REMOTE_ADDR: req.socket.remoteAddress ?? '',
  };
  if (req.headers['git-protocol']) env.GIT_PROTOCOL = req.headers['git-protocol'];
  const child = spawn('git', ['http-backend'], { env });
  req.pipe(child.stdin);
  let head = Buffer.alloc(0), sent = false;
  const sendHead = (buf) => {
    let i = buf.indexOf('\r\n\r\n'), sep = 4;
    if (i < 0) { i = buf.indexOf('\n\n'); sep = 2; }
    if (i < 0) return null;
    const headers = {};
    let status = 200;
    for (const line of buf.subarray(0, i).toString().split(/\r?\n/)) {
      const c = line.indexOf(':');
      if (c < 0) continue;
      const k = line.slice(0, c).trim().toLowerCase(), v = line.slice(c + 1).trim();
      if (k === 'status') status = Number(v.split(' ')[0]);
      else headers[k] = v;
    }
    res.writeHead(status, headers);
    return buf.subarray(i + sep);
  };
  child.stdout.on('data', (c) => {
    if (!sent) {
      head = Buffer.concat([head, c]);
      const rest = sendHead(head);
      if (rest) { sent = true; res.write(rest); }
    } else res.write(c);
  });
  child.stdout.on('end', () => { if (!sent) res.writeHead(502).end(); else res.end(); });
  child.stderr.on('data', (c) => process.stderr.write(c));
  child.on('error', () => res.writeHead(500).end('git http-backend failed'));
}

const originOf = (req) =>
  (process.env.SITE_ORIGIN ?? `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`).replace(/\/$/, '');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.url.startsWith('/git/')) return gitHttp(req, res);
  if (u.pathname === '/api/repos') {
    const repos = fs.readdirSync(REPOS).filter((d) => d.endsWith('.git'))
      .map((d) => d.slice(0, -4)).map((n) => {
        try {
          const r = repoJson(n, originOf(req));
          return { name: n, head: r.head, commits: r.commits.length, files: r.files.length, packages: r.packages.length };
        } catch (e) { console.error('repos api:', n, e.message); return null; }
      }).filter(Boolean);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(repos));
    return;
  }
  const m = u.pathname.match(/^\/api\/repo\/([^/]+)(\/blob)?$/);
  if (m) {
    try {
      if (m[2]) {
        const rev = u.searchParams.get('rev') ?? 'HEAD', p = u.searchParams.get('path') ?? '';
        const data = git(dirOf(m[1]), ['show', `${rev}:${p}`]);
        if (data.subarray(0, 8192).includes(0) || data.length > 1024 * 1024) {
          res.writeHead(400, { 'content-type': 'text/plain' }); res.end('binary or too large'); return;
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(data); return;
      }
      const body = JSON.stringify(repoJson(m[1], originOf(req)));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    } catch (e) { console.error('repo api:', e.message); res.writeHead(404).end('no such repo'); }
    return;
  }
  if (u.pathname === '/api/packages') {
    const origin = originOf(req);
    const all = [];
    for (const d of fs.readdirSync(REPOS).filter((x) => x.endsWith('.git'))) {
      try { for (const p of repoJson(d.slice(0, -4), origin).packages) all.push({ repo: d.slice(0, -4), ...p }); } catch {}
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(all));
    return;
  }
  let file = path.normalize(path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname.slice(1)));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

fs.mkdirSync(REPOS, { recursive: true });
server.listen(PORT, () => console.log(`fargone-nur web+git on :${PORT} (repos: ${REPOS})`));
