import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/openai", async (req, res) => {
  try {
    const { temperature, ...body } = req.body;

    const payload = {
      ...body,
      model: "openai/gpt-5-mini",
    };

    const apiRes = await fetch(
      "https://foundation-models.api.cloud.ru/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CLOUDRU_API_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await apiRes.text();

    if (!apiRes.ok) {
      console.error("Cloud.ru upstream error", {
        status: apiRes.status,
        body: text,
      });
    }

    res.status(apiRes.status);
    res.type("application/json");
    res.send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Proxy error",
      details: String(err),
    });
  }
});

app.listen(3001, "127.0.0.1", () => {
  console.log("MetricTree backend listening on 127.0.0.1:3001");
});
