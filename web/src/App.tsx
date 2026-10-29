import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Barcode,
  BrutalCard,
  Button,
  GridLineVertical,
  Input,
  Modal,
  SectionHeader,
  Table,
  Tabs,
  Textarea,
} from 'botanical-ui';
import hljs from 'highlight.js/lib/common';
import {
  ArrowRight,
  Boxes,
  Copy,
  FolderGit2,
  GitCommitHorizontal,
  KeyRound,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react';
import {
  CLIENT_ID,
  GIT,
  api,
  date,
  get,
  getSession,
  getText,
  handleOAuthCallback,
  nixAttr,
  repoFlakeBase,
  setSession,
  short,
  signIn,
  submit,
  type Commit,
  langColor,
  type BuildJob,
  type BuildResult,
  type CacheInfo,
  type LanguageStat,
  type Pkg,
  type RepoDetail,
  type RepoPkg,
  type RepoSummary,
  type SessionUser,
  type SshKey,
  type UserProfile,
  type UserSummary,
} from './lib/api';
import { getDoc, listDocs } from './lib/docs';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(location.hash || '#/');
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  const [path, queryString] = hash.replace(/^#\/?/, '').split('?');
  return {
    parts: path.split('/').map(decodeURIComponent),
    query: new URLSearchParams(queryString || ''),
  };
}

function useUser() {
  const [user, setUser] = useState<SessionUser | null>(() => getSession()?.user ?? null);
  useEffect(() => {
    const onStorage = () => setUser(getSession()?.user ?? null);
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);
  const signOut = useCallback(() => {
    setSession(null);
    setUser(null);
    location.hash = '#/';
  }, []);
  return { user, setUser, signOut };
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="font-mono text-[10px] uppercase opacity-60 hover:opacity-100 hover:text-bio-red flex items-center gap-1"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Copy size={12} /> {done ? 'copied' : 'copy'}
    </button>
  );
}

function LanguageBar({ languages, compact }: { languages?: LanguageStat[]; compact?: boolean }) {
  const top = (languages ?? []).slice(0, compact ? 3 : 8);
  if (!top.length) return null;
  return (
    <div>
      <div className="flex h-2 border border-bio-black overflow-hidden">
        {top.map((l) => (
          <span key={l.language} title={`${l.language} ${l.percent}%`} style={{ width: `${l.percent}%`, background: langColor(l.language) }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 font-mono text-[10px] opacity-70">
        {top.map((l) => (
          <span key={l.language} className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 border border-bio-black" style={{ background: langColor(l.language) }} />
            {l.language} {l.percent}%
          </span>
        ))}
      </div>
    </div>
  );
}

function buildColor(status?: string) {
  if (status === 'ok') return '#1a7f37';
  if (status === 'failed' || status === 'timeout' || status === 'push-failed') return '#cf222e';
  if (status === 'skipped') return '#9a6700';
  return '#8c959f';
}

function BuildDot({ build, showLabel }: { build?: { status: string; finished_at?: number } | null; showLabel?: boolean }) {
  const title = build
    ? `build ${build.status}${build.finished_at ? ` · ${date(String(build.finished_at * 1000))}` : ''}`
    : 'not built yet — installs compile from source';
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] opacity-80" title={title}>
      <span className="inline-block w-2 h-2 rounded-full border border-bio-black" style={{ background: buildColor(build?.status) }} />
      {showLabel && <span>{build?.status ?? 'source'}</span>}
    </span>
  );
}

function PkgOptions({ p }: { p: Pkg | RepoPkg }) {
  const rows: Array<[string, string]> = [];
  if (p.version) rows.push(['version', p.version]);
  const licenses = p.licenses?.length ? p.licenses.join(', ') : p.license;
  if (licenses) rows.push(['license', licenses]);
  if (p.mainProgram) rows.push(['program', p.mainProgram]);
  else if (p.bin) rows.push(['program', p.bin]);
  if (p.homepage) rows.push(['homepage', p.homepage]);
  if (p.changelog) rows.push(['changelog', p.changelog]);
  if (p.maintainers?.length) rows.push(['maintainers', p.maintainers.join(', ')]);
  if (p.platforms?.length) rows.push(['platforms', p.platforms.join(', ')]);
  if (p.source) rows.push(['source', p.source]);
  if (p.branch) rows.push(['branch', `${p.branch}${p.commit ? ` @ ${short(p.commit)}` : ''}`]);
  if (p.broken) rows.push(['broken', 'true']);
  if (p.unfree) rows.push(['unfree', 'true']);
  if (!rows.length && !p.longDescription) return null;
  return (
    <div className="font-mono text-[11px] mt-2">
      {p.longDescription && <p className="opacity-70 mb-2 whitespace-pre-wrap">{p.longDescription}</p>}
      {rows.length > 0 && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 py-0.5 border-b border-bio-black/10 last:border-0">
              <dt className="opacity-50 shrink-0 w-24">{k}</dt>
              <dd className="opacity-80 break-all">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function BuildsCard({ repo }: { repo: RepoDetail }) {
  const [data, setData] = useState<{ queue: BuildJob[]; recent: BuildResult[] } | null>(null);
  useEffect(() => {
    get<{ queue: BuildJob[]; recent: BuildResult[] }>(`/api/builds/${repo.name}`)
      .then(setData)
      .catch(() => setData({ queue: [], recent: [] }));
  }, [repo.name]);
  if (!data) return <BrutalCard title="Builds"><p className="font-mono text-xs opacity-60">loading…</p></BrutalCard>;
  const queued = data.queue.filter((j) => j.branch === repo.rev || !repo.rev);
  return (
    <BrutalCard title={`Builds${data.queue.length ? ` · ${data.queue.length} queued` : ''}`}>
      {data.recent.length === 0 && data.queue.length === 0 ? (
        <p className="font-mono text-xs opacity-60">No builds yet — push to a branch to queue one.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {queued.length > 0 && (
            <p className="font-mono text-[11px] opacity-70">
              queued: {queued.map((j) => `${j.branch}@${short(j.rev)}`).join(', ')}
            </p>
          )}
          {data.recent.slice(0, 5).map((b) => (
            <div key={`${b.branch}-${b.finished_at}`} className="border-t border-bio-black/20 first:border-0 pt-2 first:pt-0">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="truncate">{b.branch} @ {short(b.rev)}</span>
                <BuildDot build={b} showLabel />
              </div>
              <p className="font-mono text-[10px] opacity-60">{date(String(b.finished_at * 1000))}</p>
              {b.error && <p className="font-mono text-[11px] opacity-80 mt-1">error: {b.error}</p>}
              {Object.entries(b.packages).map(([n, p]) => (
                <details key={n} className="font-mono text-[11px] mt-1">
                  <summary className="cursor-pointer opacity-80">
                    <span style={{ color: buildColor(p.status) }}>●</span> {n} · {p.status}
                    {p.duration_s != null ? ` · ${p.duration_s}s` : ''}
                  </summary>
                  {p.log_tail && (
                    <pre className="border border-bio-black/20 bg-bio-gray/40 p-2 mt-1 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">{p.log_tail}</pre>
                  )}
                </details>
              ))}
            </div>
          ))}
        </div>
      )}
    </BrutalCard>
  );
}

function PackageRow({ p }: { p: RepoPkg }) {
  return (
    <div className="border-b border-bio-black/20 last:border-0 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-serif text-lg">{p.name}</span>
        <span className="flex gap-1 shrink-0 items-center">
          <BuildDot build={p.build} />
          {p.version && <Badge>{p.version}</Badge>}
          <Badge variant="outline">{p.kind ?? 'legacy'}</Badge>
          {p.valid === false && <Badge variant="success">invalid</Badge>}
        </span>
      </div>
      <p className="font-mono text-xs opacity-70">{p.description || 'No description yet.'}</p>
      <PkgOptions p={p} />
      {p.warnings?.length ? (
        <p className="font-mono text-[11px] mt-1 opacity-70">warning: {p.warnings.join(' · ')}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2 mt-2">
        <code className="font-mono text-[11px] opacity-70 break-all">nix run {p.flake}</code>
        <CopyButton text={`nix run ${p.flake}`} />
      </div>
    </div>
  );
}

function InstallModal({
  repo,
  onClose,
}: {
  repo: RepoDetail;
  onClose: () => void;
}) {
  const base = repoFlakeBase(repo);
  const input = `inputs.${nixAttr(repo.name)}`;
  const [cache, setCache] = useState<CacheInfo | null>(null);
  useEffect(() => {
    get<CacheInfo>('/api/cache').then(setCache).catch(() => setCache(null));
  }, []);
  const cacheUrl = cache?.endpoint && cache?.bucket ? `${cache.endpoint}/${cache.bucket}` : '';
  const cachedRun =
    cache?.publicKey && cacheUrl && repo.packages.length > 0
      ? `nix run --extra-substituters ${cacheUrl} --extra-trusted-public-keys ${cache.publicKey} ${repo.packages[0].flake}`
      : null;
  return (
    <Modal isOpen onClose={onClose} title={`Install from ${repo.name}`}>
      <div className="flex flex-col gap-4 font-mono text-xs">
        <div>
          <p className="uppercase text-[10px] opacity-60 mb-1">1 · Add the overlay</p>
          <pre className="border border-bio-black bg-bio-gray/40 p-2 overflow-x-auto whitespace-pre-wrap">{`# flake.nix
{
  ${input}.url = "${base}";
  nixpkgs.overlays = [ ${input}.overlays.default ];
}`}</pre>
        </div>
        <div>
          <p className="uppercase text-[10px] opacity-60 mb-1">2 · Add the package</p>
          {repo.packages.length === 0 ? (
            <p className="opacity-60">No packages in this repo yet.</p>
          ) : (
            <pre className="border border-bio-black bg-bio-gray/40 p-2 overflow-x-auto whitespace-pre-wrap">{`# configuration.nix
environment.systemPackages = with pkgs; [
${repo.packages.map((p) => `  pkgs.${nixAttr(p.name)},`).join('\n')}
];`}</pre>
          )}
        </div>
        {repo.packages.length > 0 && (
          <p className="opacity-60">…or try one now: `nix run {repo.packages[0].flake}`</p>
        )}
        <div>
          <p className="uppercase text-[10px] opacity-60 mb-1">3 · Binary cache (skip the compile)</p>
          {cachedRun ? (
            <pre className="border border-bio-black bg-bio-gray/40 p-2 overflow-x-auto whitespace-pre-wrap">{cachedRun}</pre>
          ) : (
            <p className="opacity-60">Cache warming up — builders push here after the next push.</p>
          )}
          <p className="opacity-60 mt-1">
            Persist it in `~/.config/nix/nix.conf`: `extra-substituters = {cacheUrl || '…'}`
            + `extra-trusted-public-keys = {cache?.publicKey ?? '…'}`.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function CloneCard({ repo }: { repo: RepoDetail }) {
  const https = `${GIT}/${repo.name}.git`;
  const clone = `git clone ${https}`;
  const [installOpen, setInstallOpen] = useState(false);
  const [ran, setRan] = useState(false);
  const first = repo.packages[0];
  const run = () => {
    if (!first) return;
    navigator.clipboard?.writeText(`nix run ${first.flake}`);
    setRan(true);
    setTimeout(() => setRan(false), 1200);
  };
  return (
    <BrutalCard title="Clone">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] uppercase opacity-60">HTTPS</span>
        <CopyButton text={clone} />
      </div>
      <pre
        className="border border-bio-black bg-bio-gray/40 p-2 font-mono text-xs overflow-x-auto cursor-pointer mb-3"
        onClick={() => navigator.clipboard?.writeText(clone)}
      >
        {clone}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={!first}>
          {ran ? 'Copied run cmd' : first ? `Run ${first.name}` : 'Run'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setInstallOpen(true)}>
          Install
        </Button>
        <Button size="sm" variant="outline">
          <a href={`/api/repo/${repo.name}/zip`} download>
            Download ZIP
          </a>
        </Button>
      </div>
      {installOpen && <InstallModal repo={repo} onClose={() => setInstallOpen(false)} />}
    </BrutalCard>
  );
}

function Packages() {
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  useEffect(() => {
    get<Pkg[]>('/api/packages').then(setPkgs).catch(() => setPkgs([]));
  }, []);
  const langs = useMemo(
    () => [...new Set((pkgs ?? []).map((p) => p.language).filter(Boolean))].sort() as string[],
    [pkgs],
  );
  const hits = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (pkgs ?? []).filter(
      (p) =>
        (!f ||
          `${p.name} ${p.description} ${p.repo} ${p.version ?? ''} ${(p.maintainers ?? []).join(' ')} ${p.homepage ?? ''}`
            .toLowerCase()
            .includes(f)) &&
        (!lang || p.language === lang),
    );
  }, [pkgs, q, lang]);
  return (
    <div>
      <header className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-16 items-end">
        <div className="col-span-1 md:col-span-8">
          <div className="mb-4 flex items-center gap-4">
            <Barcode />
            <span className="font-mono text-xs bg-bio-red text-white px-1">NIX PKG REGISTRY</span>
          </div>
          <h1 className="font-serif text-6xl md:text-8xl leading-[0.85] tracking-tighter">
            SMALL
            <br />
            <span className="font-sans font-light italic text-4xl md:text-6xl ml-10">
              packages.
            </span>
          </h1>
        </div>
        <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
          <p className="font-mono text-xs md:text-sm leading-relaxed border-l border-bio-black pl-4 text-justify">
            An open host for Nix user packages.
          </p>
          <Button className="w-full">
            <a href="#/repos" className="flex items-center gap-2">
              Browse repositories <ArrowRight size={16} />
            </a>
          </Button>
        </div>
      </header>

      <SectionHeader title="Packages" subtitle="search the registry" index="001" />
      <div className="mt-2 mb-4 flex flex-col md:flex-row gap-2">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder="search packages…"
          />
        </div>
        <select
          value={lang}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLang(e.target.value)}
          className="border border-bio-black bg-bio-white font-mono text-xs px-2 py-2"
          title="filter by main language"
        >
          <option value="">all languages</option>
          {langs.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
      <p className="font-mono text-xs opacity-60 mb-4">
        {pkgs === null ? 'loading…' : `${hits.length}/${pkgs.length} packages`}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(hits ?? []).map((p) => (
          <a
            key={`${p.repo}/${p.name}`}
            href={`#/r/${p.repo}`}
            className="border border-bio-black p-6 hover:bg-bio-black hover:text-white transition-colors group cursor-pointer"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-serif text-2xl">{p.name}</h3>
              <span className="flex gap-1 items-center">
                <BuildDot build={p.build} />
                {p.version && <Badge>{p.version}</Badge>}
                {p.language && <Badge>{p.language}</Badge>}
                <Badge variant="success">{p.repo}</Badge>
                {p.valid === false && <Badge variant="outline">invalid</Badge>}
              </span>
            </div>
            <p className="font-mono text-xs opacity-70">{p.description || 'No description yet.'}</p>
            {p.warnings?.length ? (
              <p className="font-mono text-[11px] opacity-70 mt-1">warning: {p.warnings[0]}</p>
            ) : null}
            {(p.licenses?.length || p.homepage || p.maintainers?.length) && (
              <p className="font-mono text-[11px] opacity-60 mt-1">
                {[p.licenses?.join(', '), p.homepage, p.maintainers?.join(', ')].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="mt-3"><LanguageBar languages={p.languages} compact /></div>
            <p className="font-mono text-xs opacity-70 mt-3">nix run {p.flake}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function PublishRepo() {
  const { user } = useUser();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; clone: string; push: string; flake: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const create = async () => {
    setError('');
    setCreated(null);
    const n = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(n)) {
      setError('name must match [A-Za-z0-9][A-Za-z0-9_-]{0,63} (dashes ok, no dots)');
      return;
    }
    setBusy(true);
    try {
      const r = (await api('/api/repos', {
        method: 'POST',
        body: JSON.stringify({ name: n }),
      })) as { name: string; clone: string; push: string; flake: string };
      setCreated(r);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-bio-black p-4 mb-4">
      <p className="font-mono text-[10px] uppercase opacity-60 mb-2">Publish a repository</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="package-name" />
        </div>
        <Button size="sm" onClick={create} disabled={busy}>{busy ? '…' : 'Create'}</Button>
      </div>
      {error && <p className="font-mono text-xs mt-2 opacity-70">error: {error}</p>}
      {created && (
        <div className="font-mono text-xs mt-2 flex flex-col gap-1">
          <p className="opacity-70">created — push to it to queue the first build:</p>
          <p className="break-all">git remote add origin {created.clone}</p>
          <p className="break-all">git remote set-url --push origin {created.push}</p>
          <p><a className="underline" href={`#/r/${created.name}`}>open {created.name} →</a></p>
        </div>
      )}
    </div>
  );
}

function Repos() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  useEffect(() => {
    get<RepoSummary[]>('/api/repos').then(setRepos).catch(() => setRepos([]));
  }, []);
  return (
    <div>
      <div className="mb-8">
        <SectionHeader title="Repositories" subtitle="source code" index="002" />
      </div>
      <p className="font-mono text-xs opacity-60 mb-4">
        {repos === null ? 'loading…' : `${repos.length} repositories`}
      </p>
      <PublishRepo />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(repos ?? []).map((r) => (
          <a
            key={r.name}
            href={`#/r/${r.name}`}
            className="border border-bio-black p-6 hover:bg-bio-black hover:text-white transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3 mb-2">
              <FolderGit2 size={20} />
              <h3 className="font-serif text-2xl">{r.name}</h3>
            </div>
            <p className="font-mono text-xs opacity-70">
              {r.commits} commits · {r.files} files · {r.packages} packages · {r.head}
              {r.mainLanguage && ` · ${r.mainLanguage}`}
            </p>
            <div className="mt-3"><LanguageBar languages={r.languages} compact /></div>
          </a>
        ))}
      </div>
    </div>
  );
}

function CommitRow({ repo, c, rev }: { repo: string; c: Commit; rev?: string | null }) {
  return (
    <a
      href={`#/r/${repo}/commit/${c.id}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`}
      className="flex items-center gap-3 py-3 border-b border-bio-black/20 last:border-0 hover:bg-bio-black hover:text-white px-2 transition-colors"
    >
      <GitCommitHorizontal size={14} className="shrink-0 opacity-60" />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm">{c.subject}</span>
        <span className="font-mono text-[10px] opacity-60">
          {c.author} · {date(c.date)}
        </span>
      </span>
      <code className="font-mono text-[10px] opacity-60">{short(c.id)}</code>
    </a>
  );
}

function Repo({ name, rev }: { name: string; rev?: string | null }) {
  const [repo, setRepo] = useState<RepoDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setRepo(null);
    setFailed(false);
    get<RepoDetail>(`/api/repo/${name}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`)
      .then(setRepo)
      .catch(() => setFailed(true));
  }, [name, rev]);
  const revSuffix = rev ? `?rev=${encodeURIComponent(rev)}` : '';
  if (failed)
    return (
      <p className="font-mono text-sm">
        repo {name} not found. <a href="#/" className="underline">home</a>
      </p>
    );
  if (!repo) return <p className="font-mono text-xs">loading…</p>;
  const latest = repo.commits[0];
  const topAuthors = Object.entries(repo.authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return (
    <div>
      <a href="#/repos" className="font-mono text-[10px] uppercase opacity-60 hover:underline">
        ← repositories
      </a>
      <div className="flex flex-wrap items-end justify-between gap-4 mt-2 mb-6">
        <div>
          <div className="font-mono text-[10px] uppercase opacity-50 mb-1">fargone-nur / repos</div>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tighter">{repo.name}</h1>
          <p className="font-mono text-xs opacity-60 mt-1">
            on {repo.rev} · {repo.branches.length} branch{repo.branches.length === 1 ? '' : 'es'}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>{repo.commits.length} commits</Badge>
          <Badge variant="outline">{repo.files.length} files</Badge>
        </div>
      </div>

      <Tabs
        tabs={[
          {
            label: 'Code',
            content: (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  {latest && (
                    <a
                      href={`#/r/${repo.name}/commit/${latest.id}${revSuffix}`}
                      className="flex items-center gap-3 border border-bio-black bg-bio-white p-3 mb-4 hover:bg-bio-black hover:text-white transition-colors"
                    >
                      <span className="font-mono text-[10px] opacity-60">{short(latest.id)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm">{latest.subject}</span>
                        <span className="font-mono text-[10px] opacity-60">
                          {latest.author} · {date(latest.date)}
                        </span>
                      </span>
                    </a>
                  )}
                  <div className="border border-bio-black">
                    <div className="flex justify-between px-3 py-2 border-b-2 border-bio-black font-mono text-[10px] uppercase opacity-60">
                      <span>Files</span>
                      <span>{repo.rev}</span>
                    </div>
                    {repo.files.map((f) => (
                      <a
                        key={f.path}
                        href={`#/r/${repo.name}/blob/${f.path}${revSuffix}`}
                        className="flex items-center gap-2 px-3 py-2 border-b border-bio-black/20 last:border-0 font-mono text-xs hover:bg-bio-black hover:text-white transition-colors"
                      >
                        <span className="flex-1 truncate">{f.path}</span>
                        <span className="opacity-60">{f.size} B</span>
                      </a>
                    ))}
                  </div>
                  {repo.skippedFiles.length > 0 && (
                    <p className="font-mono text-[10px] opacity-60 mt-2">
                      skipped (large/binary): {repo.skippedFiles.join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  <CloneCard repo={repo} />
                  <BuildsCard repo={repo} />
                  <BrutalCard
                    title={`Packages · ${repo.packages.filter((p) => p.valid).length}/${repo.packages.length}`}
                  >
                    {repo.packages.length === 0 ? (
                      <p className="font-mono text-xs opacity-60">
                        No packages in this repo yet. A repo becomes a package when its root
                        declares it: root <code>default.nix</code> with a matching{' '}
                        <code>pname</code>, or a <code>flake.nix</code> with a matching package
                        output.
                      </p>
                    ) : (
                      repo.packages.map((p) => <PackageRow key={p.name} p={p} />)
                    )}
                  </BrutalCard>
                  <BrutalCard title={`Languages · ${repo.mainLanguage}`}>
                    <LanguageBar languages={repo.languages} />
                  </BrutalCard>
                  <BrutalCard title="Branches">
                    <div className="flex flex-wrap gap-2">
                      {repo.branches.map((b) => {
                        const active = b.name === repo.rev;
                        const href = b.name === repo.head ? `#/r/${repo.name}` : `#/r/${repo.name}?rev=${encodeURIComponent(b.name)}`;
                        return active ? (
                          <Badge key={b.name} variant="success">
                            {b.name}
                          </Badge>
                        ) : (
                          <a key={b.name} href={href}>
                            <Badge variant="outline">{b.name}</Badge>
                          </a>
                        );
                      })}
                    </div>
                  </BrutalCard>
                  <BrutalCard title="Contributors">
                    {topAuthors.map(([a, n]) => (
                      <div
                        key={a}
                        className="flex justify-between font-mono text-[11px] py-1 border-b border-bio-black/20 last:border-0"
                      >
                        <span className="truncate">{a.split(' <')[0]}</span>
                        <span className="opacity-60 shrink-0">
                          {n} commit{n === 1 ? '' : 's'}
                        </span>
                      </div>
                    ))}
                  </BrutalCard>
                </div>
              </div>
            ),
          },
          {
            label: `Commits (${repo.commits.length})`,
            content: (
              <div className="border border-bio-black px-2">
                {repo.commits.map((c) => (
                  <CommitRow key={c.id} repo={repo.name} c={c} rev={rev} />
                ))}
              </div>
            ),
          },
        ]}
      />
      {repo.truncatedCommits && (
        <p className="font-mono text-[10px] opacity-60 mt-2">commit list truncated</p>
      )}
    </div>
  );
}

function CommitView({ repo, id, rev }: { repo: string; id: string; rev?: string | null }) {
  const [commit, setCommit] = useState<Commit | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    get<RepoDetail>(`/api/repo/${repo}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`)
      .then((r) => {
        const c = r.commits.find((x) => x.id.startsWith(id));
        if (!c) setFailed(true);
        else setCommit(c);
      })
      .catch(() => setFailed(true));
  }, [repo, id, rev]);
  const back = `#/r/${repo}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`;
  if (failed)
    return (
      <p className="font-mono text-sm">
        commit not found. <a href={back} className="underline">← {repo}</a>
      </p>
    );
  if (!commit) return <p className="font-mono text-xs">loading…</p>;
  return (
    <div>
      <a href={back} className="font-mono text-[10px] uppercase opacity-60 hover:underline">
        ← {repo}
      </a>
      <h1 className="font-serif text-3xl md:text-4xl tracking-tighter mt-2">{commit.subject}</h1>
      <p className="font-mono text-xs opacity-60 mt-1">
        {commit.id} · {commit.author} &lt;{commit.email}&gt; · {date(commit.date)}
      </p>
      {commit.body && (
        <pre className="border border-bio-black bg-bio-white p-3 font-mono text-xs mt-4 whitespace-pre-wrap">
          {commit.body}
        </pre>
      )}
      <div className="mt-6">
        <SectionHeader title="Files" subtitle={`${commit.stats.length} changed`} index="C-01" />
        <div className="mt-2 border border-bio-black">
          {commit.stats.map((s) => (
            <a
              key={s.path}
              href={`#/r/${repo}/blob/${s.path}?rev=${commit.id}`}
              className="grid grid-cols-[3rem_3rem_1fr] gap-2 px-3 py-2 border-b border-bio-black/20 last:border-0 font-mono text-xs hover:bg-bio-black hover:text-white transition-colors"
            >
              <span className="text-green-700">+{s.add}</span>
              <span className="text-bio-red">-{s.del}</span>
              <span className="truncate">{s.path}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlobView({ repo, repoPath, rev }: { repo: string; repoPath: string; rev?: string | null }) {
  const [html, setHtml] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoDetail['files'] | null>(null);
  const at = rev || 'HEAD';
  useEffect(() => {
    setHtml(null);
    getText(`/api/repo/${repo}/blob?rev=${encodeURIComponent(at)}&path=${encodeURIComponent(repoPath)}`)
      .then((t) => setHtml(hljs.highlightAuto(t).value))
      .catch(() => setHtml(null));
  }, [repo, repoPath, at]);
  useEffect(() => {
    get<RepoDetail>(`/api/repo/${repo}?rev=${encodeURIComponent(at)}`)
      .then((r) => setFiles(r.files))
      .catch(() => setFiles([]));
  }, [repo, at]);
  const crumbs = repoPath.split('/');
  return (
    <div>
      <p className="font-mono text-xs mb-4">
        <a href={`#/r/${repo}${rev ? `?rev=${encodeURIComponent(rev)}` : ''}`} className="hover:underline">
          {repo}
        </a>{' '}
        / {crumbs.join(' / ')}{' '}
        <span className="opacity-60">@{at}</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-bio-black h-fit">
          <div className="px-3 py-2 border-b-2 border-bio-black font-mono text-[10px] uppercase opacity-60">
            Files
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {files === null ? (
              <p className="font-mono text-xs opacity-60 px-3 py-2">loading…</p>
            ) : (
              files.map((f) => (
                <a
                  key={f.path}
                  href={`#/r/${repo}/blob/${f.path}?rev=${encodeURIComponent(at)}`}
                  className={`flex items-center gap-2 px-3 py-2 border-b border-bio-black/20 last:border-0 font-mono text-xs transition-colors ${
                    f.path === repoPath
                      ? 'bg-bio-black text-white'
                      : 'hover:bg-bio-black hover:text-white'
                  }`}
                >
                  <span className="flex-1 truncate">{f.path}</span>
                </a>
              ))
            )}
          </div>
        </div>
        <pre className="md:col-span-2 border border-bio-black bg-[#1a1a1a] text-bio-gray p-4 overflow-x-auto font-mono text-xs leading-relaxed h-fit">
        {html === null ? (
          'loading…'
        ) : (
          <code dangerouslySetInnerHTML={{ __html: html }} />
        )}
        </pre>
      </div>
    </div>
  );
}

function DocsIndex() {
  const docs = listDocs();
  return (
    <div>
      <div className="mb-8">
        <SectionHeader title="Docs" subtitle="run · push · use" index="003" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        {docs.map((d) => (
          <a
            key={d.slug}
            href={`#/docs/${d.slug}`}
            className="border border-bio-black p-6 hover:bg-bio-black hover:text-white transition-colors group cursor-pointer"
          >
            <div className="font-mono text-[10px] uppercase opacity-50 mb-2">0{d.order}</div>
            <h2 className="font-serif text-2xl">{d.title}</h2>
          </a>
        ))}
      </div>
    </div>
  );
}

function DocPage({ slug }: { slug: string }) {
  const all = listDocs();
  const doc = getDoc(slug);
  if (!doc)
    return (
      <p className="font-mono text-sm">
        doc not found. <a href="#/docs" className="underline">← docs</a>
      </p>
    );
  return (
    <div>
      <a href="#/docs" className="font-mono text-[10px] uppercase opacity-60 hover:underline">
        ← docs
      </a>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mt-2">
        <aside className="hidden md:block md:col-span-3">
          <div className="font-mono text-[10px] uppercase opacity-50 mb-3">Guides</div>
          <div className="space-y-1 font-mono text-xs">
            {all.map((d) => (
              <a
                key={d.slug}
                href={`#/docs/${d.slug}`}
                className={`block py-1 hover:underline ${d.slug === slug ? 'underline font-bold' : 'opacity-60'}`}
              >
                {d.title}
              </a>
            ))}
          </div>
        </aside>
        <article className="md:col-span-9">
          <div className="font-mono text-[10px] uppercase opacity-50 mb-2">
            fargone-nur / docs / {slug}
          </div>
          <div className="doc-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </article>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role?: string }) {
  if (role === 'ADMIN')
    return (
      <Badge>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={12} /> team
        </span>
      </Badge>
    );
  if (role === 'OPERATOR')
    return (
      <Badge variant="success">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={12} /> trusted
        </span>
      </Badge>
    );
  return null;
}

function Users() {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  useEffect(() => {
    get<UserSummary[]>('/api/users').then(setUsers).catch(() => setUsers([]));
  }, []);
  return (
    <div>
      <div className="mb-8">
        <SectionHeader title="Users" subtitle="profiles & keys" index="004" />
      </div>
      <p className="font-mono text-xs opacity-60 mb-4">
        {users === null ? 'loading…' : `${users.length} users`}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(users ?? []).map((u) => (
          <a
            key={u.id}
            href={`#/u/${encodeURIComponent(u.id)}`}
            className="border border-bio-black p-6 hover:bg-bio-black hover:text-white transition-colors group cursor-pointer flex items-center gap-4"
          >
            {u.avatar ? (
              <img src={u.avatar} alt="" className="w-10 h-10 border border-bio-black" />
            ) : (
              <span className="text-xl">{'(*• ˕ •˶マ'}</span>
            )}
            <span>
              <span className="block font-serif text-2xl">
                {u.name} <RoleBadge role={u.role} />
              </span>
              <span className="font-mono text-xs opacity-70">
                {u.keys} key{u.keys === 1 ? '' : 's'}
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Profile({ id }: { id: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    get<UserProfile>(`/api/users/${encodeURIComponent(id)}`)
      .then(setProfile)
      .catch(() => setFailed(true));
  }, [id]);
  if (failed)
    return (
      <p className="font-mono text-sm">
        user not found. <a href="#/users" className="underline">← users</a>
      </p>
    );
  if (!profile) return <p className="font-mono text-xs">loading…</p>;
  return (
    <div>
      <a href="#/users" className="font-mono text-[10px] uppercase opacity-60 hover:underline">
        ← users
      </a>
      <div className="flex items-center gap-4 mt-2 mb-6">
        {profile.avatar && <img src={profile.avatar} alt="" className="w-12 h-12 border border-bio-black" />}
        <div>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tighter">
            {profile.name} <RoleBadge role={profile.role} />
          </h1>
          <p className="font-mono text-xs opacity-60 mt-1">
            {profile.keys.length} SSH key{profile.keys.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <SectionHeader title="SSH keys" subtitle="added dates shown for security" index="U-01" />
      <div className="mt-2 border border-bio-black px-3">
        {profile.keys.length === 0 ? (
          <p className="font-mono text-xs opacity-60 py-3">No SSH keys yet.</p>
        ) : (
          profile.keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 py-3 border-b border-bio-black/20 last:border-0"
            >
              <KeyRound size={14} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{k.label}</div>
                <div className="font-mono text-[10px] opacity-60">
                  {k.type} · {k.fingerprint} · added {k.createdAt ? date(k.createdAt) : 'unknown'}
                </div>
                <div className="font-mono text-[10px] opacity-60 truncate mt-1">
                  {k.type} {k.key}
                </div>
              </div>
              <CopyButton text={`${k.type} ${k.key}`} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Login({ setUser }: { setUser: (u: SessionUser | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (getSession()?.user) location.hash = '#/settings';
  }, []);
  return (
    <div className="max-w-md mx-auto">
      <SectionHeader title="Sign in" subtitle="collective platform access" index="AUTH" />
      <BrutalCard className="mt-2">
        <p className="font-mono text-xs opacity-70 mb-4">
          You will be redirected to Fargone to approve access to your profile.
        </p>
        {!CLIENT_ID && (
          <p className="font-mono text-xs text-bio-red mb-4">
            VITE_OAUTH_CLIENT_ID is not configured.
          </p>
        )}
        {error && <p className="font-mono text-xs text-bio-red mb-4">{error}</p>}
        <Button
          className="w-full"
          onClick={() =>
            signIn()
              .then(() => setUser(getSession()?.user ?? null))
              .catch((e: Error) => setError(e.message))
          }
        >
          Continue with Fargone
        </Button>
      </BrutalCard>
    </div>
  );
}

function Settings({ user }: { user: SessionUser | null }) {
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user) {
      location.hash = '#/login';
      return;
    }
    api('/api/ssh-keys')
      .then(setKeys)
      .catch((e: Error) => setError(e.message));
  }, [user]);
  if (!user) return null;
  const add = async () => {
    setError(null);
    try {
      const added = await api('/api/ssh-keys', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), key: key.trim() }),
      });
      setKeys((k) => [added, ...(k ?? [])]);
      setLabel('');
      setKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'add failed');
    }
  };
  const remove = async (id: string) => {
    await api(`/api/ssh-keys/${id}`, { method: 'DELETE' });
    setKeys((k) => (k ?? []).filter((x) => x.id !== id));
  };
  return (
    <div>
      <SectionHeader title="Your workspace" subtitle="keys for this account" index="ACC" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <BrutalCard title="SSH keys">
          {error && <p className="font-mono text-xs text-bio-red mb-3">{error}</p>}
          {keys === null ? (
            <p className="font-mono text-xs">loading…</p>
          ) : keys.length === 0 ? (
            <p className="font-mono text-xs opacity-60">
              No SSH keys yet. Add one below to enable pushes.
            </p>
          ) : (
            keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 py-2 border-b border-bio-black/20 last:border-0"
              >
                <KeyRound size={14} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{k.label}</div>
                  <div className="font-mono text-[10px] opacity-60">
                    {k.type} · {k.fingerprint} · added {k.createdAt ? date(k.createdAt) : 'unknown'}
                  </div>
                </div>
                <button
                  className="font-mono text-[10px] uppercase text-bio-red hover:underline"
                  onClick={() => remove(k.id)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </BrutalCard>
        <BrutalCard title="Add key">
          <form
            onSubmit={(e) => {
              submit(e);
              add();
            }}
            className="flex flex-col gap-3"
          >
            <label className="font-mono text-[10px] uppercase opacity-60">
              Key name
              <Input
                value={label}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
                placeholder="Work laptop"
              />
            </label>
            <label className="font-mono text-[10px] uppercase opacity-60">
              Public key
              <Textarea
                value={key}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA... laptop"
              />
            </label>
            <Button type="submit">Add SSH key</Button>
          </form>
        </BrutalCard>
      </div>
    </div>
  );
}

export default function App() {
  const { user, setUser, signOut } = useUser();
  const { parts, query } = useHashRoute();
  const [page, a, b, ...rest] = parts;
  const rev = query.get('rev');
  const [authError, setAuthError] = useState<string | null>(null);
  const authRan = useRef(false);

  useEffect(() => {
    if (authRan.current) return;
    authRan.current = true;
    handleOAuthCallback()
      .then((done) => {
        if (done) setUser(getSession()?.user ?? null);
      })
      .catch((e: Error) => {
        history.replaceState({}, '', location.pathname);
        setAuthError(e.message);
      });
  }, [setUser]);

  return (
    <div className="w-full min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grid grid-cols-6 pointer-events-none">
        <GridLineVertical /> <GridLineVertical /> <GridLineVertical />
        <GridLineVertical /> <GridLineVertical /> <GridLineVertical />
      </div>
      <main className="relative z-10 max-w-7xl mx-auto px-4 pt-8 md:pt-12 pb-12 flex flex-col min-h-screen">
        <div className="flex justify-between items-center mb-12">
          <a href="#/" className="flex items-center gap-3">
            <span className="text-xl">{'(*• ˕ •˶マ'}</span>
          </a>
          <nav className="font-mono text-[10px] md:text-xs uppercase flex gap-4 md:gap-6 items-center">
            <a href="#/" className="hover:underline hover:text-bio-red">
              Packages
            </a>
            <a href="#/repos" className="hover:underline hover:text-bio-red">
              Repositories
            </a>
            <a href="#/docs" className="hover:underline hover:text-bio-red">
              Docs
            </a>
            <a href="#/users" className="hover:underline hover:text-bio-red">
              Users
            </a>
            <a href="#/settings" className="hover:underline hover:text-bio-red">
              <span className="inline-flex items-center gap-1">
                <SettingsIcon size={12} /> Settings
              </span>
            </a>
            {user ? (
              <button onClick={signOut} className="hover:underline hover:text-bio-red uppercase">
                {user.name} · out
              </button>
            ) : (
              <a href="#/login" className="hover:underline hover:text-bio-red">
                Sign in
              </a>
            )}
          </nav>
        </div>

        <div className="flex-1">
          {authError ? (
            <BrutalCard title="Could not sign in">
              <p className="font-mono text-xs mb-4">{authError}</p>
              <Button
                onClick={() => {
                  setAuthError(null);
                  location.hash = '#/login';
                }}
              >
                Try again
              </Button>
            </BrutalCard>
          ) : page === 'repos' ? (
            <Repos />
          ) : page === 'r' && a && !b ? (
            <Repo name={a} rev={rev} />
          ) : page === 'r' && b === 'commit' ? (
            <CommitView repo={a} id={rest[0]} rev={rev} />
          ) : page === 'r' && b === 'blob' ? (
            <BlobView repo={a} repoPath={rest.join('/')} rev={rev} />
          ) : page === 'docs' && a ? (
            <DocPage slug={a} />
          ) : page === 'docs' ? (
            <DocsIndex />
          ) : page === 'users' ? (
            <Users />
          ) : page === 'u' && a ? (
            <Profile id={a} />
          ) : page === 'login' ? (
            <Login setUser={setUser} />
          ) : page === 'settings' ? (
            <Settings user={user} />
          ) : (
            <Packages />
          )}
        </div>

        <footer className="mt-16 pt-6 flex flex-col md:flex-row justify-between items-center gap-4 border-t border-bio-black">
          <div className="font-serif text-2xl">{'(*• ˕ •˶マ'}</div>
          <div className="font-mono text-[10px] uppercase flex gap-4">
            <a className="hover:underline" href="#/">
              Packages
            </a>
            <span>/</span>
            <a className="hover:underline" href="#/repos">
              Repos
            </a>
            <span>/</span>
            <a className="hover:underline" href="#/docs">
              Docs
            </a>
          </div>
          <div className="font-mono text-[10px] flex items-center gap-2">
            <Boxes size={12} /> THINGS_ARE: <span className="text-green-600">OKAY</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
