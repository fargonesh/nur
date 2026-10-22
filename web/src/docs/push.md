---
title: Push and see it
order: 2
---

# Push and see it

```sh
git clone http://<host>:3001/git/fargone-nur.git
cd fargone-nur && <edit pkgs/...> && git push origin main
# browse: http://<host>:3001/#/repos — commits, authors, files update instantly
```

Pushes go over SSH only. Anonymous fetch stays available over git:// and https://.
