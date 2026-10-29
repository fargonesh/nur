#!/usr/bin/env node
// Live git browser backend: serves web/dist, builds repo JSON at request time
// from bare repos ($REPOS_DIR), and handles clone+push via `git http-backend`.
// Node stdlib only. Env: PORT=3001 REPOS_DIR=./repos
//   SITE_ORIGIN=https://nur.fargone.sh (flake refs; default: request host)
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
const QUEUE_DIR = path.resolve(process.env.BUILD_QUEUE_DIR ?? path.join(DATA, '..', 'builds', 'queue'));
const RESULTS_DIR = path.resolve(process.env.BUILD_RESULTS_DIR ?? path.join(DATA, '..', 'builds', 'results'));
const HOOK_RUNNER = process.env.HOOK_RUNNER ?? '';
const CACHE_ENDPOINT = (process.env.CACHE_ENDPOINT ?? '').replace(/\/$/, '');
const CACHE_BUCKET = process.env.CACHE_BUCKET ?? 'packages';
const CACHE_PUBKEY_FILE = process.env.CACHE_PUBLIC_KEY_FILE ?? '';
const PKG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
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

// --- packages are derived from repos -------------------------------------
// One repo is one package: a repo named `floras-package` is the package
// `floras-package`, installed as `git+<origin>/git/floras-package.git#floras-package`
// (plus `?ref=<branch>` when a non-default branch is rendered).
// Names must be flake-fragment safe and unique across the registry.
const PACKAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Skip a double-quoted Nix string starting at i (the opening `"`).
// Handles `\` escapes and `${...}` interpolation (with its own nesting).
function skipDquote(src, i) {
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '$' && src[i + 1] === '{') { i = skipBalanced(src, i + 1); continue; }
    if (c === '"') return i + 1;
    i += 1;
  }
  return i;
}

// Skip an indented Nix string starting at i (the opening `''`); `'''` is an
// escaped `''` inside.
function skipSquote(src, i) {
  i += 2;
  while (i < src.length) {
    if (src.startsWith("'''", i)) { i += 3; continue; }
    if (src.startsWith("''", i)) {
      // `${...}` interpolation can follow the closing quotes; the quotes still close.
      return i + 2;
    }
    if (src[i] === '$' && src[i + 1] === '{') { i = skipBalanced(src, i + 1); continue; }
    i += 1;
  }
  return i;
}

// Return the index just past the `}` balancing the `{` at openIdx,
// ignoring braces inside strings/comments.
function skipBalanced(src, openIdx) {
  let depth = 0, i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === '"') { i = skipDquote(src, i); continue; }
    if (c === "'" && src[i + 1] === "'") { i = skipSquote(src, i); continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i + 1; }
    i += 1;
  }
  return i;
}

// Extract the `meta = { ... };` block text (without outer braces), or ''.
function extractMetaBlock(src) {
  const m = src.match(/\bmeta\s*=\s*\{/);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  return src.slice(open + 1, skipBalanced(src, open) - 1);
}

const nixStrField = (src, key) =>
  (src.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`)) || [])[1] ??
  (src.match(new RegExp(`\\b${key}\\s*=\\s*''([\\s\\S]*?)''\\s*;`)) || [])[1]?.trim() ?? '';

const nixBoolField = (src, key) => {
  const m = src.match(new RegExp(`\\b${key}\\s*=\\s*(true|false)\\s*;`));
  return m ? m[1] === 'true' : undefined;
};

// Tokenise a `[...] ` list: quoted strings stay whole, bare `a.b.c` tokens kept.
function nixListField(src, key) {
  const m = src.match(new RegExp(`\\b${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return undefined;
  const body = m[1].replace(/#[^\n]*/g, ' ');
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|([A-Za-z0-9_][\w.-]*)/g;
  let t;
  while ((t = re.exec(body))) out.push(t[1] ?? t[2] ?? t[3]);
  return [...new Set(out.filter((x) => x && x !== 'with' && x !== 'maintainers'))];
}

function nixDottedField(src, key) {
  const m = src.match(new RegExp(`\\b${key}\\s*=\\s*((?:lib\\.)?(?:platforms|maintainers)\\.[\\w.-]+)\\s*;`));
  return m ? m[1] : '';
}

// Parse every package option we understand out of a default.nix/flake.nix
// source. Textual heuristics only — the server never evaluates Nix.
function parsePackageSource(src) {
  const meta = extractMetaBlock(src);
  const scope = meta || src;
  const licenses = [...new Set([
    ...(src.match(/\blicenses\.([A-Za-z0-9_-]+)/g) ?? []).map((s) => s.slice('licenses.'.length)),
    ...(nixListField(meta || src, 'license') ?? []).filter((l) => !l.includes('.')),
    ...(nixStrField(scope, 'license') ? [nixStrField(scope, 'license')] : []),
  ])];
  const maintainers = nixListField(scope, 'maintainers') ?? [];
  const platformsList = nixListField(scope, 'platforms');
  const platforms = platformsList ?? (nixDottedField(scope, 'platforms') ? [nixDottedField(scope, 'platforms')] : []);
  return {
    pname: nixStrField(src, 'pname'),
    nameAttr: nixStrField(src, 'name'),
    version: nixStrField(src, 'version'),
    description: nixStrField(scope, 'description'),
    longDescription: nixStrField(scope, 'longDescription'),
    homepage: nixStrField(scope, 'homepage'),
    changelog: nixStrField(scope, 'changelog'),
    downloadPage: nixStrField(scope, 'downloadPage'),
    mainProgram: nixStrField(scope, 'mainProgram'),
    licenses,
    maintainers,
    platforms,
    broken: nixBoolField(scope, 'broken'),
    unfree: nixBoolField(scope, 'unfree') ?? nixBoolField(scope, 'unfreeRedistributable'),
  };
}

// Does this flake.nix declare a package output literally named `name`?
// Looks for `name =` (or quoted) once `packages` appears in the file.
function declaresFlakePackage(flakeSrc, name) {
  if (!flakeSrc || !/\bpackages\b/.test(flakeSrc)) return false;
  const esc = escapeRegExp(name);
  const rx = new RegExp(`(^|[\\s{,;(.])("${esc}"|'${esc}'|${esc})\\s*=`, 'm');
  return rx.test(flakeSrc);
}

// A root default.nix that just re-exports ./pkgs (like this repo's own) is a
// wrapper, not a package definition.
const isWrapperDefault = (src) => /import\s+\.\/pkgs\b/.test(src);

// Branch-aware install target: pin to `?ref=` for branches, `?rev=` for SHAs.
function flakeRefFor(origin, repo, pkg, { branch, head, commit }) {
  const base = `git+${origin}/git/${repo}.git`;
  let suffix = '';
  if (branch && branch !== head) {
    if (/^[0-9a-f]{4,40}$/i.test(branch) && commit && commit.toLowerCase().startsWith(branch.toLowerCase())) suffix = `?rev=${branch}`;
    else suffix = `?ref=${encodeURIComponent(branch)}`;
  }
  return `${base}${suffix}#${pkg}`;
}

function commitOf(dir, rev) {
  try { return git(dir, ['rev-parse', '--verify', rev]).toString('utf8').trim(); } catch { return ''; }
}

// Latest builder result for a repo+branch, trimmed for the API.
function latestBuild(repo, branch) {
  try {
    let best = null;
    for (const f of fs.readdirSync(RESULTS_DIR)) {
      if (!f.endsWith('.json') || f.startsWith('latest-') || f.startsWith('.')) continue;
      let r;
      try { r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')); } catch { continue; }
      if (r.repo !== repo || r.branch !== branch) continue;
      if (!best || (r.finished_at ?? 0) > (best.finished_at ?? 0)) best = r;
    }
    if (!best) return null;
    const pkgs = {};
    for (const [n, p] of Object.entries(best.packages ?? {})) {
      pkgs[n] = { status: p.status, duration_s: p.duration_s };
    }
    return { status: best.status, rev: best.rev, finished_at: best.finished_at, packages: pkgs };
  } catch { return null; }
}

function packageEntry({ name, repo, kind, sourceFile, src, origin, branch, head, commit, stats, builds }) {
  const parsed = parsePackageSource(src ?? '');
  const declared = parsed.pname || '';
  const warnings = [];
  if (!PACKAGE_NAME_RE.test(name)) warnings.push(`invalid package name ${JSON.stringify(name)}: use [A-Za-z0-9_-], max 64 chars`);
  if (kind === 'root' && declared && declared !== name) warnings.push(`pname ${JSON.stringify(declared)} does not match repo name ${JSON.stringify(name)}`);
  if (kind === 'root' && !declared && !parsed.description) warnings.push('no pname/version/meta found in root default.nix or flake.nix');
  const version = parsed.version || '';
  return {
    name,
    repo,
    kind,
    source: sourceFile,
    branch,
    commit,
    version,
    bin: parsed.mainProgram || (src?.match(/writeShellScriptBin\s+"([^"]+)"/) || [])[1] || declared || name,
    description: parsed.description || '',
    longDescription: parsed.longDescription || '',
    license: parsed.licenses[0] ?? '',
    licenses: parsed.licenses,
    homepage: parsed.homepage,
    changelog: parsed.changelog,
    downloadPage: parsed.downloadPage,
    mainProgram: parsed.mainProgram || '',
    maintainers: parsed.maintainers,
    platforms: parsed.platforms,
    broken: parsed.broken,
    unfree: parsed.unfree,
    flake: flakeRefFor(origin, repo, name, { branch, head, commit }),
    build: builds[name] ?? null,
    language: stats.mainLanguage,
    languages: stats.languages,
    valid: warnings.length === 0,
    warnings,
  };
}

// A repo is a package when its root declares it: root default.nix/package.nix
// defining the repo-named derivation, or a flake.nix with a matching output.
function rootPackageFor(repoName, files, contents, ctx) {
  if (!PACKAGE_NAME_RE.test(repoName)) return null;
  const has = (p) => files.some((f) => f.path === p);
  const defaultSrc = has('default.nix') ? (contents['default.nix'] ?? '') : (has('package.nix') ? (contents['package.nix'] ?? '') : '');
  const flakeSrc = has('flake.nix') ? (contents['flake.nix'] ?? '') : '';
  const sourceFile = defaultSrc && !isWrapperDefault(defaultSrc) ? (has('default.nix') ? 'default.nix' : 'package.nix')
    : (flakeSrc && declaresFlakePackage(flakeSrc, repoName) ? 'flake.nix' : '');
  if (!sourceFile) return null;
  const src = sourceFile === 'flake.nix' ? flakeSrc : defaultSrc;
  const stats = ctx.statsFor('');
  return packageEntry({ name: repoName, repo: repoName, kind: 'root', sourceFile, src, stats, ...ctx });
}

function legacyPackagesFor(repoName, files, contents, ctx) {
  return files.filter((f) => /^pkgs\/[^/]+\/default\.nix$/.test(f.path)).map((f) => {
    const pkg = f.path.split('/')[1];
    const stats = ctx.statsFor(`pkgs/${pkg}/`);
    return packageEntry({ name: pkg, repo: repoName, kind: 'legacy', sourceFile: f.path, src: contents[f.path] ?? '', stats, ...ctx });
  });
}

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
  const commit = commitOf(dir, want);
  const builds = latestBuild(name, want)?.packages ?? {};
  const statsFor = (prefix) => languagesOf(files.filter((x) => (prefix ? x.path.startsWith(prefix) : true)));
  const ctx = { origin, branch: want, head, commit, statsFor, builds };
  const root = rootPackageFor(name, files, contents, ctx);
  const packages = [...(root ? [root] : []), ...legacyPackagesFor(name, files, contents, ctx)];
  const authors = {};
  for (const c of commits) authors[`${c.author} <${c.email}>`] = (authors[`${c.author} <${c.email}>`] ?? 0) + 1;
  return { name, head, rev: want, commit, branches, commits, truncatedCommits: truncated, files, contents, skippedFiles: skipped, packages, authors, languages, mainLanguage };
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
  // The provider's userinfo endpoint sends no CORS headers, so the browser
  // can't call it directly from another origin. Proxy it like the token
  // exchange above.
  if (u.pathname === '/api/oauth/userinfo' && req.method === 'GET') {
    try {
      const upstream = await fetch(`${(process.env.OAUTH_ORIGIN ?? 'https://fargone.sh').replace(/\/$/, '')}/oauth/userinfo`, {
        headers: req.headers.authorization ? { authorization: req.headers.authorization } : {},
      });
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(await upstream.text());
    } catch (e) { json(res, 502, { error: e.message }); }
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
          const publishable = r.packages.filter((p) => p.valid);
          return { name: n, head: r.head, commits: r.commits.length, files: r.files.length, packages: publishable.length, mainLanguage: r.mainLanguage, languages: r.languages };
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
    const seen = new Map();
    const all = [];
    for (const d of fs.readdirSync(REPOS).filter((x) => x.endsWith('.git')).sort()) {
      const repo = d.slice(0, -4);
      try {
        for (const p of repoJson(repo, origin).packages) {
          if (!p.valid) { all.push({ repo, ...p }); continue; }
          if (seen.has(p.name)) {
            all.push({ repo, ...p, valid: false, warnings: [...p.warnings, `name taken by ${seen.get(p.name)}`] });
            continue;
          }
          seen.set(p.name, repo);
          all.push({ repo, ...p });
        }
      } catch {}
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(all));
    return;
  }
  if (u.pathname === '/api/repos' && req.method === 'POST') {
    const profile = await oauthUser(req);
    if (!profile) return json(res, 401, { error: 'sign in required' });
    saveUser(profile);
    let input;
    try { input = await bodyOf(req); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    const name = String(input.name ?? '').trim();
    if (!PKG_NAME_RE.test(name)) {
      return json(res, 400, { error: 'name must match [A-Za-z0-9][A-Za-z0-9_-]{0,63} (dashes ok, no dots)' });
    }
    const dir = dirOf(name);
    if (fs.existsSync(dir)) return json(res, 409, { error: 'repo exists' });
    try {
      const init = spawnSync('git', ['init', '--bare', '--quiet', '-b', 'main', dir]);
      if (init.status !== 0) throw new Error('git init failed');
      spawnSync('git', ['-C', dir, 'config', 'http.receivepack', 'false']);
      if (HOOK_RUNNER) {
        fs.writeFileSync(path.join(dir, 'hooks', 'post-receive'), `#!/bin/sh\nexec ${HOOK_RUNNER} '${name}'\n`);
        fs.chmodSync(path.join(dir, 'hooks', 'post-receive'), 0o755);
      }
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      return json(res, 500, { error: `create failed: ${e.message}` });
    }
    const origin = originOf(req);
    let host = 'nur.fargone.sh';
    try { host = new URL(origin).hostname; } catch {}
    return json(res, 201, {
      name,
      clone: `${origin}/git/${name}.git`,
      push: `ssh://nur@${host}${dir}`,
      flake: `git+${origin}/git/${name}.git#${name}`,
    });
  }
  const buildsMatch = u.pathname.match(/^\/api\/builds\/([^/]+)$/);
  if ((u.pathname === '/api/builds' || buildsMatch) && req.method === 'GET') {
    const onlyRepo = buildsMatch ? decodeURIComponent(buildsMatch[1]) : '';
    let queue = [];
    try {
      queue = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => { try { return { id: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8')) }; } catch { return null; } })
        .filter((j) => j && (!onlyRepo || j.repo === onlyRepo))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    } catch {}
    let recent = [];
    try {
      recent = fs.readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith('.json') && !f.startsWith('latest-') && !f.startsWith('.'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')); } catch { return null; } })
        .filter((r) => r && (!onlyRepo || r.repo === onlyRepo))
        .sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))
        .slice(0, 20)
        .map(({ packages, ...rest }) => ({
          ...rest,
          packages: Object.fromEntries(Object.entries(packages ?? {}).map(([n, p]) => [n, {
            status: p.status,
            duration_s: p.duration_s,
            paths: Array.isArray(p.paths) ? p.paths.slice(0, 8) : [],
            log_tail: typeof p.log_tail === 'string' ? p.log_tail.slice(-8000) : '',
          }])),
        }));
    } catch {}
    return json(res, 200, { queue, recent });
  }
  if (u.pathname === '/api/cache' && req.method === 'GET') {
    let publicKey = '';
    try { publicKey = fs.readFileSync(CACHE_PUBKEY_FILE, 'utf8').trim(); } catch {}
    return json(res, 200, { endpoint: CACHE_ENDPOINT, bucket: CACHE_BUCKET, publicKey });
  }
  let file = path.normalize(path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname.slice(1)));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

fs.mkdirSync(REPOS, { recursive: true });
server.listen(PORT, () => console.log(`fargone-nur web+git on :${PORT} (repos: ${REPOS})`));
