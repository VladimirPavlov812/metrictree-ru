const crypto = require("crypto");

module.exports = (req, res) => {
  const clientId = process.env.MIRO_CLIENT_ID;
  const redirectUri = process.env.MIRO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Missing MIRO_CLIENT_ID or MIRO_REDIRECT_URI");
  }

  const state = crypto.randomUUID();

  res.setHeader(
    "Set-Cookie",
    `miro_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const scopes = encodeURIComponent("boards:read boards:write");

  const authUrl =
    `https://miro.com/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&state=${encodeURIComponent(state)}`;

  res.statusCode = 302;
  res.setHeader("Location", authUrl);
  res.end();
};
