---
title: Sign in
order: 5
---

# Sign in

Sign in with your Fargone account to publish repos and manage SSH keys under
Settings.

The browser flow is PKCE against `https://fargone.sh/oauth/authorize` with the
public client id baked in at build time; the authorization code is exchanged
server-side at `/api/oauth/token` (the client secret never reaches the browser),
and the profile comes back through `/api/oauth/userinfo` because the provider
sends no CORS headers.

The registered redirect URI is the app root — `https://nur.fargone.sh/` — with no
hash or query string. For local Vite use `http://localhost:5173/`.

SSH access uses a forced command: keys only ever run validated
`git-upload-pack` / `git-receive-pack` against `repos/*.git`. Everything else
over SSH is denied.
