<img src="../../assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# 👤 Profile app (demo fixture)

[← Demo walkthrough](../../docs/DEMO.md)

A tiny local app with a **deliberately seeded bug**, used by the [demo](../../docs/DEMO.md) and the browser tests. All data is synthetic.

## 📜 Contract

- Saving a valid `displayName` persists the trimmed name across reloads.
- A name shorter than 2 or longer than 50 characters is rejected with **422**.
- An update without the session cookie is rejected with **403**.
- A rejected update never changes the saved name.
- The UI says "Saved" only after a successful response, and otherwise shows the server's error.

## 🐛 The two clients

| File | Behavior |
| --- | --- |
| [`save.ts`](save.ts) | ✅ Working client |
| [`save-broken.ts`](save-broken.ts) | ❌ Sends `display_name` instead of `displayName` and ignores the response status, so it always says "Saved" |

> [!WARNING]
> The broken client is intentional. Don't fix it, and don't weaken the contract to make it pass.

## ▶️ Run

```sh
npm run demo -- --broken   # seeded bug
npm run demo               # working version
```

Both serve `http://127.0.0.1:5173`. Set `PORT` for another port. Set `TRACE_DEMO_DATA` for another data file (default: `../.trace-demo/profile.json`, outside the repo).

[`profile.spec.ts`](profile.spec.ts) checks this contract with plain Playwright and no TRACE code. It covers this fixture, not real-world identity or session security.
