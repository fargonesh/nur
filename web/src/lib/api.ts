import type { FormEvent } from 'react';

export const GIT =
  (import.meta.env.VITE_GIT_URL ?? `${location.origin}/git`).replace(/\/$/, '');
export const OAUTH =
  (import.meta.env.VITE_OAUTH_ORIGIN ?? 'https://fargone.sh').replace(/\/$/, '');
export const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID ?? '';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  isAdmin?: boolean;
}

export interface Session {
  access_token: string;
  refresh_token?: string;
  user: SessionUser;
}

export interface SshKey {
  id: string;
  label: string;
  key: string;
  type: string;
  fingerprint: string;
  createdAt?: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  isAdmin?: boolean;
  keys: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  isAdmin?: boolean;
  keys: SshKey[];
}

export interface LanguageStat {
  language: string;
  bytes: number;
  percent: number;
}

export interface BuildRef {
  status: string;
  rev?: string;
  finished_at?: number;
  duration_s?: number;
}

export interface BuildJob {
  id: string;
  repo: string;
  branch: string;
  rev: string;
  pushed_at: number;
}

export interface BuildResult {
  repo: string;
  branch: string;
  rev: string;
  status: string;
  error: string;
  packages: Record<string, { status: string; duration_s?: number; paths?: string[]; log_tail?: string }>;
  started_at: number;
  finished_at: number;
}

export interface CacheInfo {
  endpoint: string;
  bucket: string;
  publicKey: string;
}

export interface Pkg {
  name: string;
  description: string;
  repo: string;
  flake: string;
  kind?: 'root' | 'legacy';
  source?: string;
  branch?: string;
  commit?: string;
  version?: string;
  bin?: string;
  longDescription?: string;
  license?: string;
  licenses?: string[];
  homepage?: string;
  changelog?: string;
  downloadPage?: string;
  mainProgram?: string;
  maintainers?: string[];
  platforms?: string[];
  broken?: boolean;
  unfree?: boolean;
  valid?: boolean;
  warnings?: string[];
  build?: BuildRef | null;
  language?: string;
  languages?: LanguageStat[];
}

export interface RepoSummary {
  name: string;
  head: string;
  commits: number;
  files: number;
  packages: number;
  mainLanguage?: string;
  languages?: LanguageStat[];
}

export interface Commit {
  id: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  stats: { add: string; del: string; path: string }[];
}

export interface RepoPkg {
  name: string;
  bin: string;
  description: string;
  license: string;
  flake: string;
  kind?: 'root' | 'legacy';
  source?: string;
  branch?: string;
  commit?: string;
  version?: string;
  longDescription?: string;
  licenses?: string[];
  homepage?: string;
  changelog?: string;
  downloadPage?: string;
  mainProgram?: string;
  maintainers?: string[];
  platforms?: string[];
  broken?: boolean;
  unfree?: boolean;
  valid?: boolean;
  warnings?: string[];
  build?: BuildRef | null;
  language?: string;
  languages?: LanguageStat[];
}

export interface RepoDetail {
  name: string;
  head: string;
  rev: string;
  commit: string;
  branches: { name: string; id: string }[];
  commits: Commit[];
  truncatedCommits: boolean;
  files: { path: string; size: number }[];
  skippedFiles: string[];
  packages: RepoPkg[];
  authors: Record<string, number>;
  languages: LanguageStat[];
  mainLanguage: string;
}

export const LANG_COLORS: Record<string, string> = {
  Nix: '#7e7eff', TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Shell: '#89e051', Markdown: '#083fa1',
  HTML: '#e34c26', CSS: '#563d7c', Dockerfile: '#384d54', Makefile: '#427819',
};
export const langColor = (l: string) => LANG_COLORS[l] ?? '#9ca3af';

export const short = (id: string) => id.slice(0, 7);
export const date = (d: string) => new Date(/^\d+$/.test(d) ? Number(d) : d).toLocaleString();

// Quote a package/repo name for Nix: `foo-bar` must be `pkgs."foo-bar"`.
export const nixAttr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Branch-aware flake base URL for a repo at the rendered rev:
// default branch -> no query, other branches -> ?ref=, SHAs -> ?rev=.
export function repoFlakeBase(repo: { name: string; rev: string; head: string }) {
  const suffix =
    repo.rev && repo.rev !== repo.head
      ? /^[0-9a-f]{4,40}$/i.test(repo.rev)
        ? `?rev=${repo.rev}`
        : `?ref=${encodeURIComponent(repo.rev)}`
      : '';
  return `git+${GIT}/${repo.name}.git${suffix}`;
}

export function getSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem('fargone-session') || 'null');
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  if (!s) localStorage.removeItem('fargone-session');
  else localStorage.setItem('fargone-session', JSON.stringify(s));
}

async function refresh(current: Session): Promise<Session | null> {
  const r = await fetch('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  if (!r.ok) return null;
  const tokens = await r.json();
  const next = { ...current, ...tokens };
  setSession(next);
  return next;
}

export async function api(path: string, options: RequestInit = {}) {
  const doFetch = (token?: string) =>
    fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  let token = getSession()?.access_token;
  let r = await doFetch(token);
  const current = getSession();
  if (r.status === 401 && current?.refresh_token) {
    const next = await refresh(current);
    if (next) {
      token = next.access_token;
      r = await doFetch(token);
    }
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path);
  return r.json() as Promise<T>;
}

export async function getText(path: string): Promise<string> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path);
  return r.text();
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function signIn() {
  if (!CLIENT_ID) throw new Error('VITE_OAUTH_CLIENT_ID is not configured');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const redirect = `${location.origin}/`;
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('oauth-pkce', verifier);
  sessionStorage.setItem('oauth-state', state);
  sessionStorage.setItem('oauth-next', location.hash || '#/settings');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'read:user',
    state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  });
  location.href = `${OAUTH}/oauth/authorize?${params}`;
}

export async function handleOAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  if (params.get('error'))
    throw new Error(params.get('error_description') || params.get('error') || 'OAuth failed');
  const code = params.get('code');
  if (!code) return false;
  if (!params.get('state') || params.get('state') !== sessionStorage.getItem('oauth-state'))
    throw new Error('Invalid OAuth state');
  const verifier = sessionStorage.getItem('oauth-pkce');
  if (!verifier) throw new Error('OAuth session expired; please sign in again');
  // Consume the code immediately so reload/HMR/StrictMode can't replay it
  // (replay shows up as PKCE verification failed on the provider side).
  history.replaceState({}, '', location.pathname);
  const redirect = `${location.origin}/`;
  const tokenResponse = await fetch('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`OAuth token exchange failed: ${await tokenResponse.text()}`);
  const tokens = await tokenResponse.json();
  const profileResponse = await fetch('/api/oauth/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResponse.ok) throw new Error('Could not load OAuth profile');
  const profile = await profileResponse.json();
  setSession({
    ...tokens,
    user: {
      id: profile.id,
      name: profile.name || profile.preferred_username,
      email: profile.email,
      avatar: profile.avatar,
      role: profile.role,
      isAdmin: profile.role === 'ADMIN',
    },
  });
  sessionStorage.removeItem('oauth-pkce');
  sessionStorage.removeItem('oauth-state');
  const next = sessionStorage.getItem('oauth-next') || '#/settings';
  sessionStorage.removeItem('oauth-next');
  location.hash = next;
  return true;
}

export function submit(e: FormEvent) {
  e.preventDefault();
}
