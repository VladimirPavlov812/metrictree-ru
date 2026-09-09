// api/openai.js

console.log("🧩 openai.js загружен (node runtime), ключ:", !!process.env.OPENAI_API_KEY);

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let payload;
  try {
    payload = req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  try {
    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    // ---------------------
    // Лимиты OpenAI
    // ---------------------
    const limitTotal =
      apiRes.headers.get("x-ratelimit-limit-requests") ||
      apiRes.headers.get("x-ratelimit-limit-tokens") ||
      null;

    const limitRemaining =
      apiRes.headers.get("x-ratelimit-remaining-requests") ||
      apiRes.headers.get("x-ratelimit-remaining-tokens") ||
      null;

    const limitReset =
      apiRes.headers.get("x-ratelimit-reset-requests") ||
      apiRes.headers.get("x-ratelimit-reset-tokens") ||
      null;

    // ---------------------
    // Читаем тело OpenAI
    // ---------------------
    const text = await apiRes.text();

    if (!apiRes.ok) {
    console.error("OpenAI upstream error", {
    status: apiRes.status,
    model: payload?.model,
    errorBody: text,
    requestId: apiRes.headers.get("x-request-id"),
    });
    }

    const requestId = apiRes.headers.get("x-request-id");

    if (requestId) {
    res.setHeader("x-openai-request-id", requestId);
    }


    // ---------------------
    // Отдаём клиенту
    // ---------------------
    res.setHeader("Content-Type", "application/json");
    if (limitTotal) res.setHeader("x-limit-total", limitTotal);
    if (limitRemaining) res.setHeader("x-limit-remaining", limitRemaining);
    if (limitReset) res.setHeader("x-limit-reset", limitReset);

    return res.status(apiRes.status).send(text);
  } catch (err) {
    return res.status(500).json({
      error: "Proxy error",
      details: String(err),
    });
  }
}
