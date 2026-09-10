import express from "express";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

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

app.listen(3001, "127.0.0.1", () => {
  console.log("MetricTree backend listening on 127.0.0.1:3001");
});