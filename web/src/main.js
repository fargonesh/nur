const list = document.getElementById('list');
const q = document.getElementById('q');
const count = document.getElementById('count');
let pkgs = [];
fetch('./packages.json').then((r) => r.json()).then((p) => { pkgs = p; render(q.value); }).catch(() => {});

function render(filter = '') {
  const f = filter.trim().toLowerCase();
  const hits = pkgs.filter((p) => !f || (p.name + ' ' + p.description).toLowerCase().includes(f));
  count.textContent = `${hits.length}/${pkgs.length} packages`;
  list.innerHTML = '';
  for (const p of hits) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = p.name;
    const span = document.createElement('span');
    span.textContent = p.description ? ` — ${p.description}` : '';
    const pre = document.createElement('pre');
    pre.textContent = `nix run ${p.flake}`;
    pre.title = 'click to copy';
    pre.onclick = () => navigator.clipboard?.writeText(`nix run ${p.flake}`);
    li.append(b, span, pre);
    list.append(li);
  }
}
q.oninput = () => render(q.value);
render(new URLSearchParams(location.search).get('q') ?? '');
