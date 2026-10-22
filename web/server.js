#!/usr/bin/env node
// Live git browser backend: serves web/dist, builds repo JSON at request time
// from bare repos ($REPOS_DIR), and handles clone+push via `git http-backend`.
// Node stdlib only. Env: PORT=3001 REPOS_DIR=./repos
//   SITE_ORIGIN=https://nix.fargone.sh (flake refs; default: request host)
//   DATA_DIR=./data (stub users' SSH keys)
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Minimal .env load (stdlib only): repo-root .env provides PORT/OAUTH_* for `node web/server.js`.
for (const f of [path.join(HERE, '..', '.env'), path.join(HERE, '.env')]) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#') || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
const REPOS = path.resolve(process.env.REPOS_DIR ?? path.join(HERE, '..', 'repos'));
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(HERE, '..', 'data'));
const KEYS_FILE = path.join(DATA, 'ssh-keys.json');
const USERS_FILE = path.join(DATA, 'users.json');
const DIST = fs.existsSync(path.join(HERE, 'dist')) ? path.join(HERE, 'dist') : path.join(HERE, 'public');
const PORT = Number(process.env.PORT ?? 3001);
const MAX_COMMITS = 500;
const MAX_BYTES = 200000;
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain' };
const readKeys = () => { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return []; } };
const writeKeys = (keys) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2)); };
const readUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUser = (p) => {
  if (!p?.id) return;
  const users = readUsers();
  // userinfo shape (fargone): { id, name, email, avatar, role: MEMBER|OPERATOR|ADMIN, status, scopes }
  const role = typeof p.role === 'string' ? p.role : '';
  const user = { id: p.id, name: p.name ?? p.preferred_username ?? p.id, email: p.email ?? '', avatar: p.avatar ?? '', role, isAdmin: role === 'ADMIN' };
  const i = users.findIndex((u) => u.id === user.id);
  if (i < 0) users.push(user); else users[i] = user;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const bodyOf = (req) => new Promise((resolve, reject) => { let body = ''; req.on('data', (c) => body += c); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('invalid JSON')); } }); });
const oauthUser = async (req) => {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const r = await fetch(`${(process.env.OAUTH_ORIGIN ?? 'https://fargone.sh').replace(/\/$/, '')}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } });
    return r.ok ? r.json() : null;
  } catch { return null; }
};

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
    const [mode, type, sha, size] = e.subarray(0, tab).toString().split(/\s+/);
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


// --- linguist-lite (stdlib only): ext/filename -> language, % by file size ---
// ponytail: heuristic ext-map, not github/linguist; swap when accuracy matters.
const LANG_BY_EXT = {
  nix: 'Nix', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  mjs: 'JavaScript', cjs: 'JavaScript', py: 'Python', rs: 'Rust', go: 'Go',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
  cc: 'C++', java: 'Java', rb: 'Ruby', php: 'PHP', lua: 'Lua', pl: 'Perl',
  hs: 'Haskell', ex: 'Elixir', exs: 'Elixir', clj: 'Clojure', ml: 'OCaml',
  swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', r: 'R',
  jl: 'Julia', dart: 'Dart', zig: 'Zig', vue: 'Vue', svelte: 'Svelte',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  md: 'Markdown', markdown: 'Markdown', tex: 'TeX', sql: 'SQL',
  tf: 'HCL', vim: 'Vim Script', el: 'Emacs Lisp',
};
const LANG_BY_NAME = {
  dockerfile: 'Dockerfile', makefile: 'Makefile', gnumakefile: 'Makefile', justfile: 'Just',
};
const LANG_COLORS = {
  Nix: '#7e7eff', TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Shell: '#89e051', C: '#555', 'C++': '#f34b7d',
  Markdown: '#083fa1', HTML: '#e34c26', CSS: '#563d7c', JSON: '#cbcbcb',
  YAML: '#cb171e', Dockerfile: '#384d54', Makefile: '#427819',
};
const langOf = (p) => {
  const base = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  if (LANG_BY_NAME[base]) return LANG_BY_NAME[base];
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
  return LANG_BY_EXT[ext] ?? 'Other';
};
const VENDORED = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'flake.lock', 'devenv.lock']);
const isVendored = (p) => VENDORED.has(p.slice(p.lastIndexOf('/') + 1).toLowerCase()) || p.includes('node_modules/') || p.startsWith('dist/');
function languagesOf(files) {
  const bytes = {};
  let total = 0;
  for (const f of files) {
    if (isVendored(f.path)) continue;
    const lang = langOf(f.path);
    bytes[lang] = (bytes[lang] ?? 0) + (Number(f.size) || 0);
    total += Number(f.size) || 0;
  }
  const languages = Object.entries(bytes)
    .map(([language, b]) => ({ language, bytes: b, percent: total ? Math.round((b / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
  return { languages, mainLanguage: languages[0]?.language ?? 'Other' };
};

const metaOf = (src, k) => (src.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]+)"`)) || [])[1] ?? '';

function repoJson(name, origin, rev) {
  const dir = dirOf(name);
  let head = 'main';
  try { head = git(dir, ['symbolic-ref', '--short', 'HEAD']).toString('utf8').trim(); } catch {}
  const want = rev && /^[A-Za-z0-9/_.\-]+$/.test(rev) ? rev : head;
  const branches = git(dir, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'])
    .toString('utf8').split('\n').filter(Boolean)
    .map((l) => { const [b, id] = [l.slice(0, l.lastIndexOf(' ')), l.slice(l.lastIndexOf(' ') + 1)]; return { name: b, id }; });
  const { commits, truncated } = commitsOf(dir, want);
  const { files, contents, skipped } = treeOf(dir, want);
  const { languages, mainLanguage } = languagesOf(files);
  const packages = files.filter((f) => /^pkgs\/[^/]+\/default\.nix$/.test(f.path)).map((f) => {
    const src = contents[f.path] ?? '';
    const pkg = f.path.split('/')[1];
    const prefix = `pkgs/${pkg}/`;
    const stats = languagesOf(files.filter((x) => x.path.startsWith(prefix)));
    return {
      name: pkg,
      bin: (src.match(/writeShellScriptBin\s+"([^"]+)"/) || [])[1] ?? pkg,
      description: metaOf(src, 'description'),
      license: (src.match(/licenses\.([\w-]+)/) || [])[1] ?? '',
      flake: `git+${origin}/git/${name}.git#${pkg}`,
      language: stats.mainLanguage,
      languages: stats.languages,
    };
  });
  const authors = {};
  for (const c of commits) authors[`${c.author} <${c.email}>`] = (authors[`${c.author} <${c.email}>`] ?? 0) + 1;
  return { name, head, rev: want, branches, commits, truncatedCommits: truncated, files, contents, skippedFiles: skipped, packages, authors, languages, mainLanguage };
}

// --- git smart HTTP via real git ---
function gitHttp(req, res) {
  const q = req.url.indexOf('?');
  const qs = q < 0 ? '' : req.url.slice(q + 1);
  const pathInfo = decodeURIComponent(q < 0 ? req.url.slice(4) : req.url.slice(4, q));
  const push = /git-receive-pack/.test(pathInfo + qs);
  if (push) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('push disabled: use SSH');
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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.url.startsWith('/git/')) return gitHttp(req, res);
  if (u.pathname === '/api/oauth/token' && req.method === 'POST') {
    try {
      const input = await bodyOf(req);
      const tokenResponse = await fetch(`${(process.env.OAUTH_ORIGIN ?? 'https://fargone.sh').replace(/\/$/, '')}/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...input, client_id: input.client_id ?? process.env.OAUTH_CLIENT_ID ?? '', ...(process.env.OAUTH_CLIENT_SECRET ? { client_secret: process.env.OAUTH_CLIENT_SECRET } : {}) }),
      });
      res.writeHead(tokenResponse.status, { 'content-type': 'application/json' });
      res.end(await tokenResponse.text());
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }
  if (u.pathname === '/api/ssh-keys' && req.method === 'GET') {
    const profile = await oauthUser(req);
    if (!profile) return json(res, 401, { error: 'sign in required' });
    saveUser(profile);
    const owner = profile.id;
    return json(res, 200, readKeys().filter((k) => k.owner === owner).map(({ owner: _owner, ...k }) => k));
  }
  if (u.pathname === '/api/ssh-keys' && req.method === 'POST') {
    const profile = await oauthUser(req), owner = profile?.id;
    if (!owner) return json(res, 401, { error: 'sign in required' });
    saveUser(profile);
    bodyOf(req).then((input) => {
      const match = String(input.key ?? '').trim().match(/^(ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp256)\s+(\S+)(?:\s+(.*))?$/);
      if (!match || !input.label?.trim()) return json(res, 400, { error: 'add a valid public SSH key and name' });
      const keys = readKeys();
      if (keys.some((k) => k.key === match[2])) return json(res, 409, { error: 'key already added' });
      const key = { id: crypto.randomUUID(), owner, label: input.label.trim(), key: match[2], type: match[1], fingerprint: `${match[2].slice(0, 10)}...`, createdAt: new Date().toISOString() };
      keys.push(key); writeKeys(keys); return json(res, 201, key);
    }).catch((e) => json(res, 400, { error: e.message }));
    return;
  }
  const keyDelete = u.pathname.match(/^\/api\/ssh-keys\/([^/]+)$/);
  if (keyDelete && req.method === 'DELETE') {
    const profile = await oauthUser(req), owner = profile?.id, keys = readKeys(), key = keys.find((k) => k.id === keyDelete[1] && k.owner === owner);
    if (!key) return json(res, 404, { error: 'key not found' });
    if (profile) saveUser(profile);
    writeKeys(keys.filter((k) => k !== key)); return json(res, 200, { ok: true });
  }
  if (u.pathname === '/api/users' && req.method === 'GET') {
    const keys = readKeys();
    return json(res, 200, readUsers().map((p) => ({ ...p, keys: keys.filter((k) => k.owner === p.id).length })));
  }
  const userMatch = u.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'GET') {
    const id = decodeURIComponent(userMatch[1]);
    const profile = readUsers().find((p) => p.id === id);
    if (!profile) return json(res, 404, { error: 'user not found' });
    const keys = readKeys().filter((k) => k.owner === id).map(({ owner: _o, ...k }) => k);
    return json(res, 200, { ...profile, keys });
  }
  if (u.pathname === '/api/repos') {
    const repos = fs.readdirSync(REPOS).filter((d) => d.endsWith('.git'))
      .map((d) => d.slice(0, -4)).map((n) => {
        try {
          const r = repoJson(n, originOf(req));
          return { name: n, head: r.head, commits: r.commits.length, files: r.files.length, packages: r.packages.length, mainLanguage: r.mainLanguage, languages: r.languages };
        } catch (e) { console.error('repos api:', n, e.message); return null; }
      }).filter(Boolean);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(repos));
    return;
  }
  const z = u.pathname.match(/^\/api\/repo\/([^/]+)\/zip$/);
  if (z) {
    try {
      const dir = dirOf(z[1]);
      let head = 'main';
      try { head = git(dir, ['symbolic-ref', '--short', 'HEAD']).toString('utf8').trim(); } catch {}
      const qrev = u.searchParams.get('rev');
      const want = qrev && /^[A-Za-z0-9/_.\-]+$/.test(qrev) ? qrev : head;
      const data = git(dir, ['archive', '--format=zip', want], undefined);
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${z[1]}.zip"`,
      });
      res.end(data);
    } catch (e) { console.error('zip api:', e.message); res.writeHead(404).end('no such repo'); }
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
      const body = JSON.stringify(repoJson(m[1], originOf(req), u.searchParams.get('rev')));
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
