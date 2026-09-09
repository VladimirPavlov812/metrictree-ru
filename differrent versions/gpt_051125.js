export async function callOpenAI(payload) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Ошибка OpenAI API");
  return await res.json();
}

// ✅ Генерация дерева метрик
export async function generateMetricTree(productDescription) {
  const data = await callOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике и метрикам.
Построй иерархическое дерево метрик продукта (в JSON-формате).
Глубина минимум 4 уровня.

Используй типы:
- "business" — бизнес-метрики (деньги, выручка)
- "product" — ключевые продуктовые метрики (MAU, Retention, Conversion)
- "proxy" — промежуточные, объясняющие изменения
- "counter" — контр-метрики (риск и качество)
- "ops" — операционные (технические, SLA, стабильность)

⚙️ Обязательно добавляй, если релевантно продукту:
- 💰 ARPU (Average Revenue Per User)
- 💬 NPS (Net Promoter Score)

Формат JSON:
{
  "id": "m1",
  "name": "Выручка",
  "type": "business",
  "children": [...]
}
Без пояснений, только JSON.
        `.trim(),
      },
      { role: "user", content: `Описание продукта: ${productDescription}` },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели");
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("❌ Ошибка парсинга JSON:", raw);
    throw new Error("Невалидный JSON от модели");
  }
}

// ✅ Генерация AI инсайта
export async function generateMetricInsight({ metric, productDescription, parent, children }) {
  const data = await callOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
Ты — аналитик продукта. Объясни значение выбранной метрики
в контексте дерева метрик, без общих фраз.
Опиши, что она показывает, почему важна, и как связана с соседними метриками.
Кратко, но содержательно.
        `.trim(),
      },
      {
        role: "user",
        content: `
Продукт: ${productDescription}
Метрика: ${metric.data.label}
Родитель: ${parent ? parent.data.label : "нет"}
Дочерние метрики: ${children.map((c) => c.data.label).join(", ")}
        `,
      },
    ],
  });

  return data?.choices?.[0]?.message?.content?.trim() || "Инсайт не найден.";
}

// ✅ Подсказки названия метрик при добавлении
export async function suggestMetricNames({ productDescription, parentMetric }) {
  const data = await callOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике.
На основе описания продукта и родительской метрики предложи 3 возможных названия новых метрик.
Формат ответа: просто список через запятую, без пояснений.
Пример: ARPU, Retention 30d, Конверсия в оплату
      `,
      },
      {
        role: "user",
        content: `Описание продукта: ${productDescription}\nРодительская метрика: ${parentMetric}`,
      },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}
