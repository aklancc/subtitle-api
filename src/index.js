const UPSTREAM = "https://sub.wyzie.io";
const TMDB = "https://api.themoviedb.org/3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function authorized(request, env) {
  if (!env.API_ACCESS_KEY) return true;
  return request.headers.get("Authorization") === `Bearer ${env.API_ACCESS_KEY}`;
}

function subtitleLanguageRank(item) {
  const language = String(item.language || "").toLowerCase();
  const display = String(item.display || "").toLowerCase();
  const combined = `${language} ${display}`;

  if (/zh[-_ ]?(cn|hans)|simplified|简体/.test(combined)) return 0;
  if (/zh[-_ ]?(tw|hk|hant)|traditional|繁体/.test(combined)) return 1;
  if (language === "zh" || combined.includes("chinese") || combined.includes("中文")) return 2;
  return 3;
}

function prioritizeChinese(data) {
  if (Array.isArray(data)) {
    return [...data].sort((a, b) => subtitleLanguageRank(a) - subtitleLanguageRank(b));
  }
  if (data && Array.isArray(data.subtitles)) {
    return {
      ...data,
      subtitles: [...data.subtitles].sort((a, b) => subtitleLanguageRank(a) - subtitleLanguageRank(b)),
    };
  }
  return data;
}

function allowedSearchParams(input) {
  const allowed = [
    "language", "format", "season", "episode", "source", "release",
    "origin", "encoding", "hi", "limit", "page", "sort", "video",
    "hash", "refresh", "best", "file", "filename", "fileName",
  ];
  const out = new URLSearchParams();
  for (const key of allowed) {
    const value = input.get(key);
    if (value !== null && value !== "") out.set(key, value);
  }
  if (!out.has("source")) out.set("source", "all");
  return out;
}

async function tmdbSearch(query, type, year, env) {
  if (!env.TMDB_API_KEY) {
    return { error: "MissingTMDBKey" };
  }

  const endpointType = type === "movie" || type === "tv" ? type : "multi";
  const tmdbUrl = new URL(`${TMDB}/search/${endpointType}`);
  tmdbUrl.searchParams.set("query", query);
  tmdbUrl.searchParams.set("include_adult", "false");
  tmdbUrl.searchParams.set("language", "zh-CN");
  tmdbUrl.searchParams.set("page", "1");
  tmdbUrl.searchParams.set("api_key", env.TMDB_API_KEY);
  if (year && endpointType === "movie") tmdbUrl.searchParams.set("year", year);
  if (year && endpointType === "tv") tmdbUrl.searchParams.set("first_air_date_year", year);

  const response = await fetch(tmdbUrl.toString(), {
    headers: { "Accept": "application/json" },
  });
  const raw = await response.text();
  if (!response.ok) {
    return { error: "TMDBError", status: response.status, detail: raw.slice(0, 500) };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: "InvalidTMDBResponse" };
  }

  const results = (payload.results || [])
    .filter((item) => item.media_type !== "person")
    .filter((item) => endpointType === "multi" || item.media_type === endpointType)
    .map((item) => {
      const mediaType = item.media_type || endpointType;
      const releaseDate = item.release_date || item.first_air_date || "";
      return {
        id: String(item.id),
        tmdb_id: item.id,
        media_type: mediaType,
        title: item.title || item.name || "",
        original_title: item.original_title || item.original_name || "",
        year: releaseDate ? releaseDate.slice(0, 4) : null,
        release_date: releaseDate || null,
        overview: item.overview || "",
        poster_path: item.poster_path || null,
      };
    });

  return { results, page: payload.page || 1, total_results: payload.total_results || results.length };
}

async function wyzieSearch(id, params, env) {
  const upstreamUrl = new URL("/search", UPSTREAM);
  upstreamUrl.searchParams.set("id", id);
  for (const [key, value] of params) upstreamUrl.searchParams.set(key, value);
  upstreamUrl.searchParams.set("key", env.WYZIE_API_KEY);

  const response = await fetch(upstreamUrl.toString(), {
    headers: { "Accept": "application/json" },
  });
  const raw = await response.text();

  if (!response.ok) {
    return {
      response: new Response(raw, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      }),
    };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { response: json({ ok: false, error: "InvalidUpstreamResponse", raw: raw.slice(0, 1000) }, 502) };
  }

  return {
    data: prioritizeChinese(data),
    headers: {
      "Cache-Control": "no-store",
      "X-Wyzie-Cost": response.headers.get("X-Wyzie-Cost") || "unknown",
      "X-Wyzie-Balance": response.headers.get("X-Wyzie-Balance") || "unknown",
      "X-Wyzie-Plan": response.headers.get("X-Wyzie-Plan") || "unknown",
    },
  };
}

function titleMatchesResponse(data) {
  return json({
    ok: true,
    count: data.results.length,
    results: data.results,
    note: "选择一个结果后，把 tmdb_id 作为 /api/search?id=... 使用。",
  }, 200, { "Cache-Control": "public, max-age=300" });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/health") {
      return json({
        ok: true,
        service: "subtitle-api",
        provider: "Wyzie Subs",
        version: "2.0.0",
        features: ["title-search", "movie-subtitles", "tv-episode-subtitles", "chinese-first", "subtitle-download"],
      });
    }

    if (!authorized(request, env)) {
      return json({ ok: false, error: "Unauthorized", message: "请在 Authorization 请求头中提供有效的 Bearer Token。" }, 401);
    }

    if (!env.WYZIE_API_KEY) {
      return json({ ok: false, error: "MissingSecret", message: "请先在 Cloudflare Worker 中设置 WYZIE_API_KEY Secret。" }, 503);
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "MethodNotAllowed" }, 405);
    }

    if (path === "/api/title-search") {
      const query = (url.searchParams.get("query") || url.searchParams.get("title") || "").trim();
      if (!query) return json({ ok: false, error: "MissingParameter", message: "请提供 query，例如 /api/title-search?query=肖申克的救赎" }, 400);

      const type = (url.searchParams.get("type") || "multi").toLowerCase();
      if (!["multi", "movie", "tv"].includes(type)) {
        return json({ ok: false, error: "InvalidType", message: "type 只能是 multi、movie 或 tv。" }, 400);
      }

      const data = await tmdbSearch(query, type, url.searchParams.get("year"), env);
      if (data.error === "MissingTMDBKey") {
        return json({
          ok: false,
          error: "MissingTMDBKey",
          message: "标题搜索需要额外配置免费的 TMDB API Key。请在 Cloudflare Worker Secret 中添加 TMDB_API_KEY；已有的 WYZIE_API_KEY 不受影响。",
          help: "https://www.themoviedb.org/settings/api",
        }, 503);
      }
      if (data.error) return json({ ok: false, ...data }, data.status || 502);
      return titleMatchesResponse(data);
    }

    if (path === "/api/search") {
      const query = (url.searchParams.get("title") || url.searchParams.get("query") || "").trim();
      let id = url.searchParams.get("id") || url.searchParams.get("tmdb_id") || url.searchParams.get("imdb_id");

      let resolved = null;
      if (!id && query) {
        const type = (url.searchParams.get("type") || "multi").toLowerCase();
        if (!["multi", "movie", "tv"].includes(type)) {
          return json({ ok: false, error: "InvalidType", message: "type 只能是 multi、movie 或 tv。" }, 400);
        }
        const found = await tmdbSearch(query, type, url.searchParams.get("year"), env);
        if (found.error === "MissingTMDBKey") {
          return json({
            ok: false,
            error: "MissingTMDBKey",
            message: "标题搜索需要 TMDB_API_KEY。也可以继续用原来的 /api/search?id=tt0111161。",
            help: "https://www.themoviedb.org/settings/api",
          }, 503);
        }
        if (found.error) return json({ ok: false, ...found }, found.status || 502);
        if (!found.results.length) return json({ ok: true, count: 0, resolved: null, subtitles: [] });

        resolved = found.results[0];
        id = String(resolved.tmdb_id);
      }

      if (!id) {
        return json({
          ok: false,
          error: "MissingParameter",
          message: "请提供 id，或提供 title/query。示例：/api/search?title=The%20Shawshank%20Redemption&type=movie&year=1994",
        }, 400);
      }

      const season = url.searchParams.get("season");
      const episode = url.searchParams.get("episode");
      if ((season && !episode) || (!season && episode)) {
        return json({ ok: false, error: "IncompleteEpisode", message: "电视剧搜索必须同时提供 season 和 episode。" }, 400);
      }
      if (resolved?.media_type === "tv" && (!season || !episode)) {
        return json({ ok: false, error: "MissingEpisode", message: "已匹配到电视剧。请同时提供 season 和 episode，例如 &season=1&episode=1。" }, 400);
      }

      const params = allowedSearchParams(url.searchParams);
      const result = await wyzieSearch(id, params, env);
      if (result.response) return result.response;

      return json({
        ok: true,
        resolved,
        id,
        season: season ? Number(season) : null,
        episode: episode ? Number(episode) : null,
        count: Array.isArray(result.data) ? result.data.length : (result.data?.subtitles?.length || 0),
        subtitles: Array.isArray(result.data) ? result.data : (result.data?.subtitles || result.data),
      }, 200, result.headers);
    }

    if (path === "/api/download") {
      const subtitleUrl = url.searchParams.get("url");

      if (subtitleUrl) {
        let parsed;
        try {
          parsed = new URL(subtitleUrl);
        } catch {
          return json({ ok: false, error: "InvalidUrl" }, 400);
        }
        if (parsed.protocol !== "https:" || parsed.hostname !== "sub.wyzie.io") {
          return json({ ok: false, error: "URLNotAllowed", message: "下载地址只允许使用 https://sub.wyzie.io 域名。" }, 400);
        }

        const response = await fetch(parsed.toString());
        const headers = new Headers(corsHeaders);
        headers.set("Cache-Control", "no-store");
        headers.set("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
        headers.set("Content-Disposition", response.headers.get("Content-Disposition") || 'attachment; filename="subtitle"');
        return new Response(response.body, { status: response.status, headers });
      }

      const id = url.searchParams.get("id") || url.searchParams.get("tmdb_id") || url.searchParams.get("imdb_id");
      if (!id) return json({ ok: false, error: "MissingParameter", message: "请提供 id，或传入搜索结果中的 url。" }, 400);

      const params = allowedSearchParams(url.searchParams);
      if (!params.has("language")) params.set("language", "zh");
      const upstreamUrl = new URL("/download", UPSTREAM);
      upstreamUrl.searchParams.set("id", id);
      for (const [key, value] of params) upstreamUrl.searchParams.set(key, value);
      upstreamUrl.searchParams.set("key", env.WYZIE_API_KEY);

      const response = await fetch(upstreamUrl.toString());
      const headers = new Headers(corsHeaders);
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
      headers.set("Content-Disposition", response.headers.get("Content-Disposition") || 'attachment; filename="subtitle"');
      return new Response(response.body, { status: response.status, headers });
    }

    if (["/api/sources", "/api/languages", "/api/status", "/api/usage"].includes(path)) {
      const upstreamUrl = new URL(path.replace("/api", ""), UPSTREAM);
      upstreamUrl.searchParams.set("key", env.WYZIE_API_KEY);
      const response = await fetch(upstreamUrl.toString(), { headers: { "Accept": "application/json" } });
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
          ...corsHeaders,
          "Cache-Control": "no-store",
          "X-Upstream-Status": String(response.status),
        },
      });
    }

    return json({
      ok: false,
      error: "NotFound",
      version: "2.0.0",
      endpoints: [
        "/health",
        "/api/title-search?query=肖申克的救赎&type=movie",
        "/api/search?id=tt0111161",
        "/api/search?title=The%20Shawshank%20Redemption&type=movie&year=1994",
        "/api/search?title=Breaking%20Bad&type=tv&season=1&episode=1",
        "/api/download?url=SEARCH_RESULT_URL",
        "/api/sources",
        "/api/languages",
        "/api/status",
        "/api/usage",
      ],
    }, 404);
  },
};
