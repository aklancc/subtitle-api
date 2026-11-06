# subtitle-api

Cloudflare Workers subtitle API built on [Wyzie Subs](https://docs.wyzie.io/subs/intro). The upstream API key stays server-side.

## Deploy

1. Deploy this repository as a Cloudflare Worker named `subtitle-api` (entry file: `src/index.js`; Wrangler config: `wrangler.toml`).
2. In **Worker → Settings → Variables and Secrets**, add:
   - Secret `WYZIE_API_KEY`: your private Wyzie key.
   - Secret `API_ACCESS_KEY` (recommended): a long random token that protects your Worker from public quota abuse.
3. Redeploy and open `/health`.

Never commit either secret to GitHub. If `API_ACCESS_KEY` is set, send `Authorization: Bearer YOUR_ACCESS_KEY` with every API request. If it is not set, the Worker endpoints are public.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/health` | Health check |
| `/api/search?id=tt0111161` | Search by IMDb/TMDB ID; all available sources by default |
| `/api/search?id=286217&season=1&episode=1` | Search a TV episode |
| `/api/search?id=tt0111161&language=zh` | Search Chinese subtitles |
| `/api/download?url=SEARCH_RESULT_URL` | Download a URL returned by search |
| `/api/download?id=tt0111161&language=zh` | Upstream best-match download |
| `/api/sources`, `/api/languages`, `/api/status`, `/api/usage` | Upstream information |

Example:

```sh
curl "https://YOUR-WORKER.workers.dev/api/search?id=tt0111161&language=zh" \
  -H "Authorization: Bearer YOUR_ACCESS_KEY"
```

Omit the Authorization header if you did not configure `API_ACCESS_KEY`.

## Notes

- Wyzie search requires an IMDb or TMDB ID. Title-only search is not included in this first version.
- Results explicitly marked Simplified Chinese are sorted first, then Traditional Chinese, then other/ambiguous languages. Actual script labels depend on provider metadata.
- A search costs one upstream request. Downloads cost additional requests; direct `/download` can cost two.
- The free Wyzie tier currently has a daily request limit. Use `/api/usage` to inspect usage.
- This version uses Wyzie as its upstream provider. More providers can be added later.

## Local development

```sh
npx wrangler secret put WYZIE_API_KEY
npx wrangler dev
```
