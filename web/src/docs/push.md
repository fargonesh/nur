---
title: Push and see it
order: 2
---

# Push and see it

Sign in at https://nur.fargone.sh, add your public key under Settings, then:

```sh
git clone https://nur.fargone.sh/git/fargone-nur.git
cd fargone-nur
# edit pkgs/<name>/...
git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/fargone-nur.git
git push origin main
```

Browse the result at https://nur.fargone.sh/#/repos — commits, authors and files
are read from the bare repo on each request.

Pushes are SSH only. Anonymous fetch stays available over https
(`https://nur.fargone.sh/git/fargone-nur.git`) and `git://nur.fargone.sh/fargone-nur`.
Registered keys are materialised into the `nur` user's `authorized_keys` within a
second of saving them; removing a key revokes it just as fast.
