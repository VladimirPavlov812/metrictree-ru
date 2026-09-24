import express from "express";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

const { Pool } = pg;

const app = express();

const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const COOKIE_NAME = "metrictree_session";
const ROBOKASSA_MERCHANT_LOGIN = process.env.ROBOKASSA_MERCHANT_LOGIN;
const ROBOKASSA_TEST_MODE = process.env.ROBOKASSA_TEST_MODE === "true";

const ROBOKASSA_PASSWORD_1 = ROBOKASSA_TEST_MODE
  ? process.env.ROBOKASSA_TEST_PASSWORD_1
  : process.env.ROBOKASSA_PROD_PASSWORD_1;

const ROBOKASSA_PASSWORD_2 = ROBOKASSA_TEST_MODE
  ? process.env.ROBOKASSA_TEST_PASSWORD_2
  : process.env.ROBOKASSA_PROD_PASSWORD_2;


function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

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
// AUTH: FORGOT PASSWORD
// -----------------------

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const genericResponse = {
    message: "Если такой email зарегистрирован, мы отправим ссылку для восстановления пароля.",
  };

  if (!email || email.length > 254) {
    return res.status(400).json({ error: "Укажите корректный email" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email FROM users WHERE email = $1 LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.json(genericResponse);
    }

    const user = rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const resetUrl = new URL("/reset-password", "https://metrictree.ru");
    resetUrl.searchParams.set("token", token);

    await mailTransport.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: "Восстановление пароля MetricTree",
      text: `Для установки нового пароля перейдите по ссылке:\n\n${resetUrl.toString()}\n\nСсылка действует 30 минут. Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.`,
    });

    return res.json(genericResponse);
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Не удалось обработать запрос. Попробуйте позже." });
  }
});


// -----------------------
// AUTH: RESET PASSWORD
// -----------------------

app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body?.token || "");
  const password = req.body?.password;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: "Недействительная ссылка восстановления" });
  }

  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Пароль должен содержать от 8 до 72 символов" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING user_id`,
      [hashResetToken(token)]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Ссылка недействительна или срок её действия истёк",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [passwordHash, rows[0].user_id]
    );

    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [rows[0].user_id]
    );

    await client.query("COMMIT");
    res.clearCookie(COOKIE_NAME, { path: "/" });

    return res.json({ message: "Пароль успешно изменён. Войдите с новым паролем." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Не удалось изменить пароль. Попробуйте позже." });
  } finally {
    client.release();
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
      SELECT id, email, created_at, plan, pro_until
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
// QUOTAS
// -----------------------

const PRO_PRICE_RUB = 490;

const FREE_INITIAL_OPERATIONS = 2;
const PAID_PACKAGE_OPERATIONS = 20;

const OPERATION_TYPES = [
  "generate",
  "insight",
  "suggestion",
  "prioritization",
  "experiment",
];

async function ensureOperationBalances(userId, client = pool) {
  await client.query(
    `
    INSERT INTO operation_balances (user_id, quota_type)
    SELECT $1, unnest($2::text[])
    ON CONFLICT (user_id, quota_type) DO NOTHING
    `,
    [userId, OPERATION_TYPES]
  );
}


async function consumeOperationBalance(userId, type) {
  if (!OPERATION_TYPES.includes(type)) {
    throw new Error("Invalid quota type");
  }

  await ensureOperationBalances(userId);

  const result = await pool.query(
    `
    UPDATE operation_balances
    SET
      free_left = CASE
        WHEN free_left > 0 THEN free_left - 1
        ELSE free_left
      END,
      paid_left = CASE
        WHEN free_left = 0 AND paid_left > 0 THEN paid_left - 1
        ELSE paid_left
      END
    WHERE user_id = $1
      AND quota_type = $2
      AND (free_left > 0 OR paid_left > 0)
    RETURNING free_left, paid_left
    `,
    [userId, type]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      type,
      left: 0,
    };
  }

  const { free_left, paid_left } = result.rows[0];

  return {
    ok: true,
    type,
    left: free_left + paid_left,
  };
}

app.get("/api/quota", authRequired, async (req, res) => {
  try {
    const userId = req.user.userId;

    await ensureOperationBalances(userId);

    const result = await pool.query(
      `
      SELECT quota_type, free_left, paid_left
      FROM operation_balances
      WHERE user_id = $1
      `,
      [userId]
    );

    const balances = Object.fromEntries(
      result.rows.map((row) => [row.quota_type, row])
    );

    const quota = {};

    for (const type of OPERATION_TYPES) {
      const balance = balances[type];
      const freeLeft = balance?.free_left ?? 0;
      const paidLeft = balance?.paid_left ?? 0;

      quota[type] = {
        freeLeft,
        paidLeft,
        left: freeLeft + paidLeft,
      };
    }

    return res.json({
      quota,
    });
  } catch (err) {
    console.error("Quota get error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function consumeUserQuota(userId, type) {
  const result = await consumeOperationBalance(userId, type);

  return {
    ok: result.ok,
    type: result.type,
    left: result.left,
  };
}

async function createGenerateOperation(userId) {
  const result = await pool.query(
    `
    INSERT INTO ai_operations (
      user_id,
      operation,
      calls_used,
      max_calls,
      expires_at
    )
    VALUES ($1, 'generate', 0, 3, now() + interval '30 minutes')
    RETURNING id, operation, calls_used, max_calls, expires_at
    `,
    [userId]
  );

  return result.rows[0];
}

app.post("/api/generate/start", authRequired, async (req, res) => {
  try {
    const quota = await consumeUserQuota(req.user.userId, "generate");

    if (!quota.ok) {
      return res.status(429).json({
        error: "Quota exceeded",
        type: "generate",
        left: 0,
      });
    }

    const operation = await createGenerateOperation(req.user.userId);

    return res.json({
      generationId: operation.id,
      expiresAt: operation.expires_at,
      quota: {
      left: quota.left,
      },
    });
  } catch (err) {
    console.error("Generate start error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


app.post("/api/quota/consume", authRequired, async (req, res) => {
  try {
        const { type } = req.body || {};

    if (!OPERATION_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid quota type" });
    }

    const quota = await consumeUserQuota(req.user.userId, type);

    if (!quota.ok) {
      return res.status(429).json({
        error: "Quota exceeded",
        type: quota.type,
        left: 0,
      });
    }

    return res.json(quota);


    } catch (err) {
    console.error("Quota consume error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// PAYMENTS / ROBOKASSA
// -----------------------
function robokassaMd5(value) {
  return crypto
    .createHash("md5")
    .update(value, "utf8")
    .digest("hex");
}
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || "").toLowerCase(), "utf8");
  const right = Buffer.from(String(b || "").toLowerCase(), "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

app.post("/api/payments/pro", authRequired, async (req, res) => {
  try {
    if (!ROBOKASSA_MERCHANT_LOGIN || !ROBOKASSA_PASSWORD_1) {
      return res.status(503).json({ error: "Payments are not configured" });
    }

    const amount = PRO_PRICE_RUB.toFixed(2);

    const result = await pool.query(
    `
    INSERT INTO payments (
    user_id,
    amount,
    currency,
    status,
    plan,
    duration_days
    )
    VALUES ($1, $2, 'RUB', 'pending', 'operations', 0)
    RETURNING id
    `,
    [req.user.userId, amount]
    );

    const invId = result.rows[0].id;

    const signature = robokassaMd5(
      `${ROBOKASSA_MERCHANT_LOGIN}:${amount}:${invId}:${ROBOKASSA_PASSWORD_1}`
    );

    const params = new URLSearchParams({
      MerchantLogin: ROBOKASSA_MERCHANT_LOGIN,
      OutSum: amount,
      InvId: String(invId),
      Description: "MetricTree: пакет из 20 операций каждого типа",
      SignatureValue: signature,
      Culture: "ru",
      Encoding: "utf-8",
    });

    if (ROBOKASSA_TEST_MODE) {
      params.set("IsTest", "1");
    }

    return res.json({
      paymentId: invId,
      paymentUrl: `https://auth.robokassa.ru/Merchant/Index.aspx?${params.toString()}`,
    });
  } catch (err) {
    console.error("Create Pro payment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/api/payments/:id/status", authRequired, async (req, res) => {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const result = await pool.query(
      `
      SELECT id, status
      FROM payments
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [paymentId, req.user.userId]
    );

    const payment = result.rows[0];

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.json({
      paymentId: payment.id,
      status: payment.status,
    });
  } catch (err) {
    console.error("Payment status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


app.all("/api/payments/robokassa/result", async (req, res) => {
  const data = req.method === "GET" ? req.query : req.body;

  const outSum = String(data?.OutSum || "");
  const invId = String(data?.InvId || "");
  const signatureValue = String(data?.SignatureValue || "");

  if (!outSum || !invId || !signatureValue || !ROBOKASSA_PASSWORD_2) {
    return res.status(400).send("Bad request");
  }

  const expectedSignature = robokassaMd5(
    `${outSum}:${invId}:${ROBOKASSA_PASSWORD_2}`
  );

  if (!safeEqualHex(signatureValue, expectedSignature)) {
    return res.status(403).send("Invalid signature");
  }

    let client;

    try {
    client = await pool.connect();
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
      SELECT id, user_id, amount, status, plan, duration_days
      FROM payments
      WHERE id = $1
      FOR UPDATE
      `,
      [invId]
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      await client.query("ROLLBACK");
      return res.status(404).send("Payment not found");
    }

    if (Number(payment.amount).toFixed(2) !== Number(outSum).toFixed(2)) {
      await client.query("ROLLBACK");
      return res.status(400).send("Invalid amount");
    }

    if (payment.status === "paid") {
      await client.query("COMMIT");
      return res.send(`OK${invId}`);
    }

    if (payment.plan !== "operations" && payment.plan !== "pro") {
      await client.query("ROLLBACK");
      return res.status(400).send("Invalid plan");
    }

    await client.query(
      `
      UPDATE payments
      SET status = 'paid',
          paid_at = now()
      WHERE id = $1
      `,
      [payment.id]
    );

    await ensureOperationBalances(payment.user_id, client);

    const creditResult = await client.query(
    `
    UPDATE operation_balances
    SET paid_left = paid_left + $2
    WHERE user_id = $1
    AND quota_type = ANY($3::text[])
    `,
    [payment.user_id, PAID_PACKAGE_OPERATIONS, OPERATION_TYPES]
    );

    if (creditResult.rowCount !== OPERATION_TYPES.length) {
    throw new Error("Не удалось начислить все пять типов операций");
    }

    await client.query("COMMIT");

    return res.send(`OK${invId}`);
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Robokassa ResultURL error:", err);
    return res.status(500).send("Internal server error");
    } finally {
    client?.release();
    }
});

app.get("/api/payments/robokassa/success", (req, res) => {
  return res.redirect("https://metrictree.ru/?payment=success");
});

app.get("/api/payments/robokassa/fail", (req, res) => {
  return res.redirect("https://metrictree.ru/?payment=fail");
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

const CLOUDRU_MODELS = {
  "gpt-4.1": "openai/gpt-4.1",
  "gpt-5.5": "openai/gpt-5.5",
  "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
  "gigachat-3.5": "ai-sage/GigaChat3.5-432B-A28B",
  "deepseek-v4-pro": "deepseek-ai/DeepSeek-V4-Pro",
};

app.post("/api/openai", async (req, res) => {
  try {

        const operation = req.get("X-MetricTree-Operation");

    const allowedOperations = new Set([
      "generate",
      "insight",
      "suggestion",
      "experiment",
      "prioritization",
    ]);

    if (!operation || !allowedOperations.has(operation)) {
      return res.status(400).json({
        error: "Invalid or missing AI operation",
      });
    }

        const token = req.cookies[COOKIE_NAME];

    if (operation !== "generate") {
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ error: "Invalid session" });
      }
    }

    if (operation === "generate" && token) {
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }

  const generationId = req.get("X-MetricTree-Generation-Id");

  if (!generationId) {
    return res.status(400).json({
      error: "Missing generation ID",
    });
  }

  const result = await pool.query(
    `
    UPDATE ai_operations
    SET calls_used = calls_used + 1
    WHERE id = $1
      AND user_id = $2
      AND operation = 'generate'
      AND expires_at > now()
      AND calls_used < max_calls
    RETURNING id, calls_used, max_calls
    `,
    [generationId, req.user.userId]
  );

  if (result.rows.length === 0) {
    return res.status(403).json({
      error: "Invalid or expired generation",
    });
  }
}


        if (operation !== "generate") {
      const quota = await consumeUserQuota(req.user.userId, operation);

      if (!quota.ok) {
        return res.status(429).json({
          error: "Quota exceeded",
          type: quota.type,
          left: 0,
        });
      }
    }


    const { temperature, model, ...body } = req.body;

    // GPT-4.1 is the default model for the RU version.
    const requestedModel = model || "gpt-4.1";
    const cloudModel = CLOUDRU_MODELS[requestedModel];

    if (!cloudModel) {
      return res.status(400).json({
        error: "Unsupported model",
        model: requestedModel,
      });
    }

    const payload = {
    ...body,
    model: cloudModel,
    };

    // Claude в Cloud.ru не поддерживает response_format: json_object.
    // JSON-формат уже явно задан в system prompt.
    if (cloudModel.startsWith("anthropic/")) {
      delete payload.response_format;
    }

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
        model: cloudModel,
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