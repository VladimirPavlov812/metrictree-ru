import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { source, answers, createdAt } = req.body || {};

    if (!source || !answers?.task || !answers?.nextStep) {
    return res.status(400).json({ error: "Missing required fields" });
    }

    const { error } = await supabase.from("feedback").insert([
      {
        source,
        task: answers.task,
        next_step: answers.nextStep,
        reuse_score: answers.reuseScore ? Number(answers.reuseScore) : null,
        contact: answers.contact || null,
        created_at: createdAt || new Date().toISOString(),
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Feedback API error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
}