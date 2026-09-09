function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw
    .split("; ")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export default async function handler(req, res) {
  const accessToken = getCookie(req, "miro_access_token");

  if (!accessToken) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Not connected to Miro" }));
  }

  const r = await fetch("https://api.miro.com/v2/boards?limit=50", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const text = await r.text();
  res.statusCode = r.ok ? 200 : r.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(text);
}
