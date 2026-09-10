import express from "express";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";

const { Pool } = pg;

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const COOKIE_NAME = "metrictree_session";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function authRequired(req, res, next) {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}

// -----------------------
// AUTH: REGISTER
// -----------------------

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Введите корректный email" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Пароль должен содержать минимум 8 символов",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id, email, created_at
      `,
      [email, passwordHash]
    );

    const user = result.rows[0];
    const token = createToken(user);

    setSessionCookie(res, token);

    return res.status(201).json({ user });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "Пользователь с таким email уже существует",
      });
    }

    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// AUTH: LOGIN
// -----------------------

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    const result = await pool.query(
      `
      SELECT id, email, password_hash, created_at
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user?.password_hash) {
      return res.status(401).json({
        error: "Неверный email или пароль",
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({
        error: "Неверный email или пароль",
      });
    }

    const token = createToken(user);
    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// AUTH: LOGOUT
// -----------------------

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return res.json({ ok: true });
});

// -----------------------
// AUTH: CURRENT USER
// -----------------------

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, email, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.json({ user });
  } catch (err) {
    console.error("Auth me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// PROJECTS
// -----------------------

app.get("/api/projects", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, created_at, updated_at
      FROM projects
      WHERE user_id = $1
      ORDER BY updated_at DESC
      `,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Projects list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/projects/:id", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, data
      FROM projects
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [req.params.id, req.user.userId]
    );

    const project = result.rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(project);
  } catch (err) {
    console.error("Project load error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/projects", authRequired, async (req, res) => {
  try {
    const { name, data } = req.body || {};

    if (!name || !data) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO projects (user_id, name, data)
      VALUES ($1, $2, $3)
      RETURNING id, name, created_at, updated_at
      `,
      [req.user.userId, name, data]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Project create error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/projects/:id", authRequired, async (req, res) => {
  try {
    const { data } = req.body || {};

    const result = await pool.query(
      `
      UPDATE projects
      SET data = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, name, created_at, updated_at
      `,
      [data, req.params.id, req.user.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Project update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/projects/:id", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM projects
      WHERE id = $1 AND user_id = $2
      RETURNING id
      `,
      [req.params.id, req.user.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Project delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// FEEDBACK
// -----------------------

app.post("/api/feedback", async (req, res) => {
  try {
    const { source, answers, createdAt } = req.body || {};

    if (!source || !answers?.task || !answers?.nextStep) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await pool.query(
      `
      INSERT INTO feedback
        (source, task, next_step, reuse_score, contact, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      `,
      [
        source,
        answers.task,
        answers.nextStep,
        answers.reuseScore ? Number(answers.reuseScore) : null,
        answers.contact || null,
        createdAt || new Date().toISOString(),
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




// -----------------------
// CLOUD.RU / GPT
// -----------------------

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
    console.error("Cloud.ru proxy error:", err);

    res.status(500).json({
      error: "Proxy error",
      details: String(err),
    });
  }
});

// -----------------------
// MIRO OAUTH START
// -----------------------

app.get("/api/miro/oauth/start", (req, res) => {
  const clientId = process.env.MIRO_CLIENT_ID;
  const redirectUri = process.env.MIRO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Missing MIRO_CLIENT_ID or MIRO_REDIRECT_URI");
  }

  const state = crypto.randomUUID();

  res.cookie("miro_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const scopes = encodeURIComponent("boards:read boards:write");

  const authUrl =
    `https://miro.com/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
});

// -----------------------
// MIRO OAUTH CALLBACK
// -----------------------

app.get("/api/miro/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const cookieState = req.cookies.miro_oauth_state;

    if (!code) {
      return res.status(400).send("Missing code");
    }

    if (!state || !cookieState || state !== cookieState) {
      return res.status(400).send("Bad OAuth state");
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const text = await tokenRes.text();

    if (!tokenRes.ok) {
      console.error("Miro token error:", text);
      return res.status(500).send(text);
    }

    const tokens = JSON.parse(text);
    const accessToken = tokens.access_token;

    if (!accessToken) {
      return res.status(500).send("No access_token in response");
    }

    res.clearCookie("miro_oauth_state", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    res.cookie("miro_access_token", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.redirect(`${process.env.APP_URL || "https://metrictree.ru"}/?miro=connected`);
  } catch (err) {
    console.error("Miro callback error:", err);
    res.status(500).send("Callback error");
  }
});

// -----------------------
// MIRO BOARDS
// -----------------------

app.get("/api/miro/boards", async (req, res) => {
  const accessToken = req.cookies.miro_access_token;

  if (!accessToken) {
    return res.status(401).json({ error: "Not connected to Miro" });
  }

  const r = await fetch("https://api.miro.com/v2/boards?limit=50", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await r.text();

  res.status(r.status);
  res.type("application/json");
  res.send(text);
});

// -----------------------
// MIRO EXPORT
// -----------------------

app.post("/api/miro/export", async (req, res) => {
  try {
    const token = req.cookies.miro_access_token;

    if (!token) {
      return res.status(401).json({
        error: "Not connected to Miro",
        action: "redirect",
        redirectUrl: "/api/miro/oauth/start",
      });
    }

    const { boardId, nodes, edges, options } = req.body || {};

    if (!boardId) {
      return res.status(400).json({ error: "Missing boardId" });
    }

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({
        error: "nodes and edges must be arrays",
      });
    }

    const nodeWidth = options?.nodeWidth ?? 220;
    const nodeHeight = options?.nodeHeight ?? 110;
    const padding = options?.padding ?? 300;

    const visibleNodes = nodes.filter((n) => !n.hidden);

    let minX = Infinity;
    let minY = Infinity;

    for (const n of visibleNodes) {
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }

    if (!isFinite(minX)) {
      return res.status(400).json({ error: "No nodes to export" });
    }

    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    const colorByType = (type) => {
      if (type === "business") return "#e8f2ff";
      if (type === "product") return "#e8ffe8";
      if (type === "proxy") return "#f2f2f2";
      if (type === "counter") return "#ffe8e8";
      if (type === "ops") return "#fff7e5";
      return "#ffffff";
    };

    const idMap = new Map();

    for (const n of visibleNodes) {
      const label =
        n.data?.label ??
        n.data?.name ??
        n.name ??
        n.id;

      const cx =
        (n.position?.x ?? 0) +
        nodeWidth / 2 +
        offsetX;

      const cy =
        (n.position?.y ?? 0) +
        nodeHeight / 2 +
        offsetY;

      const shapeBody = {
        data: {
          content: String(label).slice(0, 500),
          shape: "round_rectangle",
        },
        style: {
          fillColor: colorByType(n.type),
          borderColor: "#d1d5db",
          borderOpacity: "1.0",
          borderWidth: "1.0",
          color: "#111827",
          fontFamily: "arial",
          fontSize: "14",
          textAlign: "center",
          textAlignVertical: "middle",
        },
        position: {
          origin: "center",
          x: cx,
          y: cy,
        },
        geometry: {
          width: nodeWidth,
          height: nodeHeight,
        },
      };

      const r = await fetch(
        `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/shapes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(shapeBody),
        }
      );

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(r.status).json({
          error: "Miro create shape failed",
          miro: data,
        });
      }

      idMap.set(n.id, data.id);
    }

    for (const e of edges) {
      const source = idMap.get(e.source);
      const target = idMap.get(e.target);

      if (!source || !target) continue;

      const connectorBody = {
        startItem: { id: source, snapTo: "auto" },
        endItem: { id: target, snapTo: "auto" },
        shape: "curved",
        style: {
          strokeColor: "#9ca3af",
          strokeWidth: "1.0",
        },
      };

      const r = await fetch(
        `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/connectors`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(connectorBody),
        }
      );

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        return res.status(r.status).json({
          error: "Miro create connector failed",
          miro: data,
        });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Miro export error:", err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});


app.listen(3001, "127.0.0.1", () => {
  console.log("MetricTree backend listening on 127.0.0.1:3001");
});