---
title: Run
order: 1
---

# Run

```sh
devenv up        # git daemon :9418, web+git server :3001, vite dev :5173
# or: node web/server.js            (serves web/dist + /api + /git)
# or: npm --prefix web run dev      (vite only, proxies /api + /git to :3001)
```

New repo: `./scripts/new-repo.sh <name>` — it appears in the UI with zero config.
