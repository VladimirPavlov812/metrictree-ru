// универсальная функция вызова OpenAI API
async function callOpenAI(payload) {
  const key = import.meta.env.VITE_OPENAI_KEY;
  if (!key) throw new Error("Отсутствует VITE_OPENAI_KEY в .env");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`OpenAI error: ${msg}`);
  }
  return data;
}

// ✅ 1. Генерация дерева метрик
export async function generateMetricTree(productDescription) {
  const data = await callOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике.
Построй иерархическое дерево метрик в JSON-формате.
Глубина не менее 4 уровней. Используй типы:
"business", "product", "proxy", "counter", "ops".
Пример структуры:
{
  "id": "m1",
  "name": "Выручка",
  "type": "business",
  "children": [
    { "id": "m2", "name": "Retention", "type": "product", "children": [] }
  ]
}
Верни только JSON без пояснений.
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
    console.error("❌ Парсинг JSON провален:", raw);
    throw new Error("Невалидный JSON от модели");
  }
}

// ✅ 2. Получение AI-инсайта по метрике с контекстом
export async function generateMetricInsight({
  metric,
  productDescription,
  parent,
  children,
}) {
  const data = await callOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `
Ты — AI-аналитик продукта.
На основе контекста продукта и дерева метрик объясни выбранную метрику.
Ответ: 3–5 абзацев живого, осмысленного текста.
Включи:
- Что метрика измеряет в контексте продукта
- Почему важна для бизнес-целей
- Как связана с родителем и дочерними
- Что можно улучшить
- Возможные контр-метрики или риски
        `.trim(),
      },
      {
        role: "user",
        content: `
Описание продукта:
${productDescription}

Метрика:
- Название: ${metric?.data?.label || "—"}
- Тип: ${metric?.type || "—"}

Родительская метрика:
${parent ? parent.data.label : "Нет"}

Дочерние метрики:
${children?.length ? children.map((c) => c.data.label).join(", ") : "Нет"}
        `,
      },
    ],
  });

  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "Инсайт не получен.";
}
