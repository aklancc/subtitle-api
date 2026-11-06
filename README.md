# subtitle-api

Cloudflare Workers subtitle API using [Wyzie Subs](https://docs.wyzie.io/subs/intro) for subtitle aggregation and TMDB for title lookup. Upstream credentials stay server-side.

## Version 2 features

- Search subtitles by IMDb or TMDB ID
- Search movies and TV shows by title (requires a free TMDB API key)
- Search a specific TV season and episode
- Search all available Wyzie sources by default
- Prioritize Simplified Chinese, then Traditional Chinese, then other languages
- Keep AI-translated subtitle entries distinguishable via the upstream `ai` field
- Download a subtitle using the URL returned by search
- Expose provider, language, status, and usage information
- Optional Bearer-token protection for this Worker

## Deploy / update

This repository can be connected to Cloudflare Workers Builds. A new commit should trigger a deployment automatically. If automatic deployment is not enabled, deploy the Worker again from the Cloudflare dashboard.

Worker entry point: `src/index.js`.

## Cloudflare secrets

Open **Worker → Settings → Variables and Secrets** and add these as **Secrets**:

| Secret name | Required | Purpose |
| --- | --- | --- |
| `WYZIE_API_KEY` | Yes | Your Wyzie API key |
| `TMDB_API_KEY` | For title search | Free TMDB v3 API key |
| `API_ACCESS_KEY` | Recommended | Private Bearer token to protect your Worker from public use |

TMDB key application: https://www.themoviedb.org/settings/api

Never commit secrets to GitHub or send them in chat. If `API_ACCESS_KEY` is configured, send `Authorization: Bearer YOUR_ACCESS_KEY` with every API request. If it is not configured, the Worker API is public.

After adding or changing secrets, redeploy the Worker.

## Endpoints

All endpoints use GET unless stated otherwise.

| Endpoint | Purpose |
| --- | --- |
| `/health` | Health check and version |
| `/api/title-search?query=肖申克的救赎&type=movie` | Search title candidates |
| `/api/title-search?query=Breaking%20Bad&type=tv` | Search TV show candidates |
| `/api/search?id=tt0111161` | Search by IMDb ID |
| `/api/search?id=286217&season=1&episode=1` | Search a TV episode by TMDB ID |
| `/api/search?title=The%20Shawshank%20Redemption&type=movie&year=1994` | Resolve title and search subtitles |
| `/api/search?title=Breaking%20Bad&type=tv&season=1&episode=1` | Resolve show title and search an episode |
| `/api/search?id=tt0111161&language=zh` | Filter Chinese-language results |
| `/api/download?url=SEARCH_RESULT_URL` | Download a URL returned by search |
| `/api/download?id=tt0111161&language=zh` | Ask upstream for the best matching download |
| `/api/sources`, `/api/languages`, `/api/status`, `/api/usage` | Upstream information |

### Recommended title-search flow

1. Call `/api/title-search?query=movie%20name&type=movie`.
2. Choose the correct result by title and year.
3. Use its `tmdb_id` in `/api/search?id=...`.

For a TV show, use `type=tv` and pass both `season` and `episode` to `/api/search`.

You can also use `/api/search?title=...` as a shortcut. It selects the first TMDB match, so the two-step flow is safer when several titles have similar names.

Example:

```sh
curl "https://YOUR-WORKER.workers.dev/api/search?id=tt0111161&language=zh" \
  -H "Authorization: Bearer YOUR_ACCESS_KEY"
```

Omit the Authorization header if you did not configure `API_ACCESS_KEY`.

## Notes

- Wyzie search requires an IMDb or TMDB ID. Version 2 adds title-to-TMDB resolution through TMDB.
- TV episode searches require both `season` and `episode`.
- Chinese script labels depend on subtitle-provider metadata. Entries explicitly marked Simplified Chinese are sorted first; Traditional Chinese follows.
- AI-translated entries are identified by the upstream `ai: true` field. Availability and pricing depend on Wyzie's current plan and API rules.
- A search costs one Wyzie request; a download costs another. Check `/api/usage` for current balance and usage.
- This version still uses Wyzie as the subtitle provider. TMDB is used only to find the title and its TMDB ID.

## Local development

```sh
npx wrangler secret put WYZIE_API_KEY
npx wrangler secret put TMDB_API_KEY
npx wrangler dev
```
