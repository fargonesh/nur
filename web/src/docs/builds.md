---
title: How builds work
order: 6
---

# How builds work

```
push ──► post-receive hook ──► queue ──► 5 docker builders ──► Attic ──► registry
```

1. **Push.** Every push to a branch runs the repo's `post-receive` hook, which
   writes one job file per updated branch head into the build queue. Tag
   pushes, deletions and the internal `registry` repo are ignored.
2. **Queue.** Jobs are plain JSON files. If a newer job for the same
   repo+branch is already waiting, the older one is marked superseded and
   skipped — rapid pushes don't pile up redundant builds.
3. **Builders.** Five Docker containers poll the queue (atomic claim, so no
   job runs twice) and build every `packages.<system>` output of the pushed
   rev: clone, `nix flake show`, `nix build` per output with a per-package
   timeout, then `attic push`. Stale claims (>2h, e.g. after a crash) are
   reaped and re-queued. Each container is capped (memory, CPUs, PID limit);
   builds run with the Nix sandbox off — the container *is* the sandbox.
4. **Cache.** Successful outputs land in the local Attic bucket `packages`,
   served at `https://nur.fargone.sh/attic`. Anything already cached is a
   download for everyone; anything missing falls back to a source build.
5. **Registry.** Every finished build triggers a rebuild of the aggregate
   `registry.git` flake, which pins each repo at its built head.

Repos without a `flake.nix`, or flakes with no outputs for the builder
platform (`x86_64-linux`), are recorded as `skipped` — still browsable and
installable from source, just never cached. Other platforms (aarch64, Darwin)
are not built here and always compile from source.

Build status, durations and the last 20 KB of log per package are visible on
each repo's Builds panel. Failures stay queued as results, never retried
automatically — push a fix to build again.
