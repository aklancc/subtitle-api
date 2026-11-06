const UPSTREAM = "https://sub.wyzie.io";

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

  // Wyzie's API uses ISO language codes. When provider metadata identifies
  // the script, prefer Simplified Chinese, then Traditional Chinese.
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
      subtitles: [...data.subtitles].sort(
        (a, b) => subtitleLanguageRank(a) - subtitleLanguageRank(b)
      ),
    };
  }
  return data;
}

async function upstreamJson(path, params, env) {
  const url = new URL(path, UPSTREAM);
  for (const [key, value] of params) {
    if (key !== "key") url.searchParams.set(key, value);
  }
  url.searchParams.set("key", env.WYZIE_API_KEY);

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });
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
        version: "1.0.0",
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

    if (path === "/api/search") {
      if (!url.searchParams.get("id")) {
        return json({
          ok: false,
          error: "MissingParameter",
          message: "请提供 IMDb 或 TMDB ID，例如 /api/search?id=tt0111161",
        }, 400);
      }

      const params = new URLSearchParams(url.searchParams);
      params.delete("key");
      if (!params.has("source")) params.set("source", "all");

      const upstreamUrl = new URL("/search", UPSTREAM);
      for (const [key, value] of params) upstreamUrl.searchParams.set(key, value);
      upstreamUrl.searchParams.set("key", env.WYZIE_API_KEY);

      const response = await fetch(upstreamUrl.toString(), {
        headers: { "Accept": "application/json" },
      });
      const raw = await response.text();

      if (!response.ok) {
        return new Response(raw, {
          status: response.status,
          headers: {
            "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
            ...corsHeaders,
            "Cache-Control": "no-store",
          },
        });
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return json({ ok: false, error: "InvalidUpstreamResponse", raw }, 502);
      }

      return json(prioritizeChinese(data), 200, {
        "Cache-Control": "no-store",
        "X-Wyzie-Cost": response.headers.get("X-Wyzie-Cost") || "unknown",
        "X-Wyzie-Balance": response.headers.get("X-Wyzie-Balance") || "unknown",
        "X-Wyzie-Plan": response.headers.get("X-Wyzie-Plan") || "unknown",
      });
    }

    if (path === "/api/download") {
      const subtitleUrl = url.searchParams.get("url");

      // Search-result URLs contain short-lived download tokens. Only allow
      // URLs hosted by Wyzie; never turn this endpoint into an open proxy.
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

      if (!url.searchParams.get("id")) {
        return json({ ok: false, error: "MissingParameter", message: "请提供 id，或传入搜索结果中的 url。" }, 400);
      }

      const params = new URLSearchParams(url.searchParams);
      params.delete("url");
      params.delete("key");
      if (!params.has("language")) params.set("language", "zh");
      const upstreamUrl = new URL("/download", UPSTREAM);
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
      const endpoint = path.replace("/api", "");
      return upstreamJson(endpoint, new URLSearchParams(), env);
    }

    return json({
      ok: false,
      error: "NotFound",
      endpoints: ["/health", "/api/search?id=tt0111161", "/api/download?id=tt0111161&language=zh", "/api/sources", "/api/languages", "/api/status", "/api/usage"],
    }, 404);
  },
};
