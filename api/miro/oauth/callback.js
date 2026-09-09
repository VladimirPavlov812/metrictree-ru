function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw
    .split("; ")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export default async function handler(req, res) {
  try {
    // ВАЖНО: для localhost нужно http, иначе URL() может ломать callback-URL
    const isLocalhost = (req.headers.host || "").includes("localhost");
    const base = isLocalhost ? `http://${req.headers.host}` : `https://${req.headers.host}`;

    const url = new URL(req.url, base);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    const cookieState = getCookie(req, "miro_oauth_state");

    if (!code) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("Missing code");
    }
    if (!state || !cookieState || state !== cookieState) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("Bad OAuth state");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.MIRO_CLIENT_ID,
      client_secret: process.env.MIRO_CLIENT_SECRET,
      redirect_uri: process.env.MIRO_REDIRECT_URI,
      code,
    });

    const tokenRes = await fetch("https://api.miro.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const text = await tokenRes.text();
    if (!tokenRes.ok) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(text);
    }

    const tokens = JSON.parse(text);
    const accessToken = tokens.access_token;

    if (!accessToken) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("No access_token in response");
    }

    // ✅ Secure только на https (prod). На localhost (http) Secure-cookie не сохраняются браузером.
    const securePart = isLocalhost ? "" : " Secure;";

    const cookies = [
      // state очищаем
      `miro_oauth_state=; Path=/; HttpOnly;${securePart} SameSite=Lax; Max-Age=0`,
      // access token кладём в HttpOnly cookie
      `miro_access_token=${encodeURIComponent(accessToken)}; Path=/; HttpOnly;${securePart} SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
    ];

    res.setHeader("Set-Cookie", cookies);

    // редирект обратно в приложение (локально на http, в проде на https)
    const appUrl = process.env.APP_URL || base;
    res.statusCode = 302;
    res.setHeader("Location", `${appUrl}/?miro=connected`);
    res.end();
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Callback error");
  }
}
