import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.min.css';

// Clone/push base. Same-origin in prod (server serves UI+git on one port);
// override with VITE_GIT_URL (see web/.env.development for local dev).
const GIT = (import.meta.env.VITE_GIT_URL ?? `${location.origin}/git`).replace(/\/$/, '');
const view = document.getElementById('view');
const cache = {};
const get = (p, json = true) =>
  (cache[p] ??= fetch(p).then((r) => {
    if (!r.ok) throw new Error(p);
    return json ? r.json() : r.text();
  }));
const short = (id) => id.slice(0, 7);
const date = (d) => new Date(d).toLocaleString();

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'onclick') e.onclick = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) e.append(k?.nodeType ? k : document.createTextNode(k ?? ''));
  return e;
}
const link = (href, ...kids) => h('a', { href }, ...kids);
const copy = (text) => h('pre', { title: 'click to copy', onclick: () => navigator.clipboard?.writeText(text) }, text);
const notFound = (what) => view.append(h('p', null, `${what} not found. `, link('#/', 'home')));

addEventListener('hashchange', route);
route();

function route() {
  view.innerHTML = '';
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [page, a, b, ...rest] = parts;
  if (page === 'repos') return reposView().catch(() => notFound('repos'));
  if (page === 'r' && a && !b) return repoView(a).catch(() => notFound(`repo ${a}`));
  if (page === 'r' && b === 'commit') return commitView(a, rest[0]).catch(() => notFound('commit'));
  if (page === 'r' && b === 'blob') return blobView(a, rest.join('/')).catch(() => notFound('file'));
  return pkgsView().catch(() => notFound('packages'));
}

async function pkgsView() {
  const pkgs = await get('/api/packages');
  const q = h('input', { id: 'q', type: 'search', placeholder: 'search packages…', autocomplete: 'off' });
  const count = h('p');
  const list = h('ul');
  view.append(count, q, list);
  const render = () => {
    const f = q.value.trim().toLowerCase();
    const hits = pkgs.filter((p) => !f || `${p.name} ${p.description} ${p.repo}`.toLowerCase().includes(f));
    count.textContent = `${hits.length}/${pkgs.length} packages`;
    list.innerHTML = '';
    for (const p of hits) {
      list.append(h('li', null,
        h('b', null, p.name), ` — ${p.description} `,
        link(`#/r/${p.repo}`, h('small', null, `(${p.repo})`)),
        copy(`nix run ${p.flake}`)));
    }
  };
  q.oninput = render;
  q.focus();
  render();
}

async function reposView() {
  const repos = await get('/api/repos');
  const list = h('ul');
  for (const r of repos) {
    list.append(h('li', null,
      link(`#/r/${r.name}`, h('b', null, r.name)),
      ` — ${r.commits} commits, ${r.files} files, ${r.packages} packages (branch ${r.head})`));
  }
  view.append(h('p', null, `${repos.length} repos`), list);
}

async function repoView(name) {
  const r = await get(`/api/repo/${name}`);
  const gitUrl = `${GIT}/${name}.git`;
  view.append(
    h('h2', null, name),
    h('p', { class: 'dim' }, `branch ${r.head} · ${r.branches.map((b) => b.name).join(', ')}`),
    h('h3', null, 'clone / push'),
    copy(`git clone ${gitUrl}`),
    copy(`nix run git+${gitUrl}#<pkg>`),
    h('h3', null, 'contributors'),
    h('ul', null, ...Object.entries(r.authors).sort((a, b) => b[1] - a[1])
      .map(([a, n]) => h('li', null, `${a} — ${n} commit${n === 1 ? '' : 's'}`))),
    h('h3', null, 'commits'),
    h('ul', null, ...r.commits.map((c) => h('li', null,
      link(`#/r/${name}/commit/${c.id}`, h('code', null, short(c.id))), ' ',
      link(`#/r/${name}/commit/${c.id}`, c.subject), h('br'),
      h('small', { class: 'dim' }, `${c.author} · ${date(c.date)}`)))),
    h('h3', null, `files @ ${short(r.commits[0]?.id ?? r.head)}`),
    h('ul', null, ...r.files.map((f) => h('li', null,
      link(`#/r/${name}/blob/${f.path}`, f.path),
      h('small', { class: 'dim' }, ` (${f.size} B)`)))),
  );
  if (r.truncatedCommits) view.append(h('p', { class: 'dim' }, 'commit list truncated'));
  if (r.skippedFiles.length) view.append(h('p', { class: 'dim' }, `contents skipped (large/binary): ${r.skippedFiles.join(', ')}`));
}

async function commitView(name, id) {
  const r = await get(`/api/repo/${name}`);
  const c = r.commits.find((x) => x.id.startsWith(id));
  if (!c) return notFound('commit');
  view.append(
    link(`#/r/${name}`, `← ${name}`),
    h('h2', null, c.subject),
    h('p', null, h('code', null, c.id)),
    h('p', null, `${c.author} <${c.email}> · ${date(c.date)}`),
    ...(c.parents.length ? [h('p', null, 'parents: ', ...c.parents.flatMap((p) => [link(`#/r/${name}/commit/${p}`, h('code', null, short(p))), ' ']))] : []),
    c.body ? h('pre', null, c.body) : '',
    h('h3', null, 'files'),
    h('ul', null, ...c.stats.map((s) => h('li', null, h('code', null, `${s.add}\t${s.del}`), ' ', s.path))),
  );
}

async function blobView(name, repoPath) {
  const text = await get(`/api/repo/${name}/blob?rev=HEAD&path=${encodeURIComponent(repoPath)}`, false);
  const code = h('code');
  code.innerHTML = hljs.highlightAuto(text).value;
  const crumbs = repoPath.split('/');
  view.append(
    h('p', null, link(`#/r/${name}`, name), ' / ', ...crumbs.flatMap((c, i) => i < crumbs.length - 1 ? [`${c} / `] : [c])),
    h('pre', { class: 'code' }, code),
  );
}
