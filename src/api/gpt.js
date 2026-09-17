// === api/gpt.js ===

// Универсальный вызов OpenAI через ваш backend API
// === api/gpt.js ===

const MODELS_WITH_DEFAULT_TEMPERATURE_ONLY = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

// Универсальный вызов OpenAI через ваш backend API
export async function callOpenAI(payload, options = {}) {
  const requestPayload = { ...payload };

  // Эти модели поддерживают только temperature по умолчанию.
  // Поэтому параметр вообще не отправляем.
  if (MODELS_WITH_DEFAULT_TEMPERATURE_ONLY.has(requestPayload.model)) {
    delete requestPayload.temperature;
  }

  const res = await fetch("/api/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
    signal: options.signal,
  });

  const limitInfo = {
    total: res.headers.get("x-limit-total"),
    remaining: res.headers.get("x-limit-remaining"),
    reset: res.headers.get("x-limit-reset"),
  };

  // Лимит от OpenAI
  if (res.status === 429) {
    throw new Error("OpenAI ограничил количество запросов. Попробуйте позже.");
  }

  // Прочие ошибки
  if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error("OpenAI proxy error:", res.status, text);

  // попробуем вытащить message из JSON если это JSON
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message || j?.message || text;
  } catch {}

  throw new Error(`Ошибка OpenAI API (${res.status}): ${msg || "no details"}`);
  }


  const data = await res.json();
  return { data, limitInfo };
}


function parseModelJson(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}


// === Наводящие вопросы / мини-опросник ===
export async function generateClarifyingQuestions(productDescription, model = "gpt-4o-mini", options = {}) {
  const response = await callOpenAI({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — продакт-аналитик.
Сгенерируй 6–10 уточняющих вопросов, чтобы построить качественное дерево метрик.

Верни ответ ТОЛЬКО в JSON (json_object). Никакого текста вне JSON.

Формат JSON:
{
  "questions": [
    { "id": "q1", "field": "goal", "question": "..." }
  ]
}
        `.trim(),
      },
      {
        role: "user",
        content: `Описание продукта (ответь в JSON): ${productDescription}`,
      },
    ],
  }, options);

  const raw = response.data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели (questions)");

  return { questions: parseModelJson(raw), limitInfo: response.limitInfo };
}


// === Нормализация описания в структурированный Product Brief ===
export async function normalizeProductBrief(
  { productDescription, answers = {} },
  model = "gpt-4o-mini",
  options = {}
) {
  const response = await callOpenAI({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике.
Собери структурированный Product Brief.

Верни ответ ТОЛЬКО в JSON (json_object). Никакого текста вне JSON.

Схема JSON:
{
  "productType": null,
  "targetUser": null,
  "jobToBeDone": null,
  "unitOfValue": null,
  "keyAction": null,
  "activationDefinition": null,
  "retentionLoop": null,
  "frequency": null,
  "monetization": null,
  "pricing": null,
  "primaryChannel": null,
  "salesCycle": null,
  "geography": null,
  "constraints": null,
  "northStarPreference": null,
  "goal": null,
  "notes": []
}
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify(
          { productDescription, answers, format: "JSON" }, // <- можно и так
          null,
          2
        ),
      },
    ],
  }, options);

  const raw = response.data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели (brief)");

  return { brief: parseModelJson(raw), limitInfo: response.limitInfo };
}


// === Генерация дерева метрик ===
export async function generateMetricTree(productDescription, model = "gpt-4o-mini", options = {}) {
  // ✅ поддержка строки И объекта (brief)
  const descriptionText =
    typeof productDescription === "string"
      ? productDescription
      : JSON.stringify(productDescription, null, 2);

  const response = await callOpenAI({
    model,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике и метрикам.
Построй иерархическое дерево метрик продукта (в JSON-формате).
Глубина минимум 4 уровня.

Правила:
- Главная метрика верхнего уровня должна отражать основную цель продукта.
  • Если цель продукта — зарабатывать, выбери бизнес-метрику (например, Выручка, Прибыль, GMV).
  • Если продукт направлен на рост, выбери метрику вовлечённости или Retention.
  • Если это сервис без монетизации, выбери ключевую метрику ценности для пользователя.
- Не используй "Выручка" по умолчанию.
- Добавь уровни метрик, связывающие стратегию и операции.

Типы: business, product, proxy, counter, ops.
Обязательно включи ARPU и NPS, если релевантно.

1. Продуктовая метрика (product)

Что это:
Метрика, отражающая поведение пользователя внутри продукта и качество пользовательского опыта.

О чём говорит:
Насколько продукт решает задачу пользователя и приносит ценность.

Примеры:
Retention D7 / D30
Activation Rate
Conversion to key action
DAU/WAU/MAU
Time to Value
Engagement (сессии, глубина просмотра)

2. Бизнес-метрика (business)

Что это:
Метрика, отражающая финансовые и стратегические результаты компании, а не поведение пользователя.

О чём говорит:
Растёт ли бизнес и насколько он эффективен.

Примеры:
Revenue / GMV
EBITDA / Operating Profit
LTV (в финансовом смысле)
CAC
NRR / GRR
ARPU / ARPPU / ARPA
Margin

3. Прокси-метрика (proxy)

Что это:
Метрика-заменитель, косвенно отражающая прогресс по цели, особенно если целевую метрику сложно измерить прямо или она меняется медленно.

О чём говорит:
Что продукт движется в правильном направлении, но НЕ является конечным результатом.

Примеры:
Визиты на страницу оплаты (прокси для конверсии в оплату)
Доля просмотревших 80% онбординга (прокси для активации)
Количество добавлений в корзину (прокси заказов)
Время в продукте (прокси вовлечённости)

4. Контр-метрика (counter)

Что это:
Метрика, которая показывает негативные последствия улучшений, чтобы команда случайно не “сломала” продукт, оптимизируя основную метрику.

О чём говорит:
Не ухудшилось ли что-то важное параллельно.

Примеры:
Оптимизируем пуши → контр: отключение уведомлений
Растим время в продукте → контр: жалобы, NPS
Увеличиваем рекламные показы → контр: скрытия рекламы, churn
Увеличиваем конверсию → контр: возвраты, отмены, фрод

5. Операционная метрика (ops)

Что это:
Метрика, которая описывает эффективность внутренних процессов, а не поведение пользователя и не финансы.

О чём говорит:
Насколько хорошо работает система/операции/логистика/инфраструктура.

Примеры:
Delivery Time (среднее время доставки)
Order Success Rate
Server uptime
Time to Resolve in Support
Количество багов / Crash Rate
Speed of content moderation
SLA соблюдение

Операционные метрики часто влияют на продуктовые, но сами по себе не отражают “ценность” продукта, а отражают производительность процессов.

Формат JSON:
{
  "id": "m1",
  "name": "Главная метрика",
  "type": "business",
  "children": [...]
}

Только JSON.
        `.trim(),
      },
      {
        role: "user",
        // ✅ важно: тут всегда будет нормальный текст/JSON, а не "[object Object]"
        content: `Описание продукта (текст или JSON):\n${descriptionText}`,
      },
    ],
  }, options);

  const data = response.data;
  const limitInfo = response.limitInfo;

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели");

  try {
    return {
      tree: parseModelJson(raw),
      limitInfo,
    };
  } catch (e) {
    console.error("❌ Ошибка парсинга JSON:", raw);
    throw new Error("Невалидный JSON от модели");
  }
}

// === Генерация AI-инсайта ===
export async function generateMetricInsight(
  { metric, productDescription, parent, children },
  model = "gpt-4o-mini"
) {
  const response = await callOpenAI({
    model,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
Ты — AI-аналитик продукта.
Объясни метрику: 3–5 абзацев.
Включи:
- Что метрика измеряет
- Почему важна
- Связь с родителем и детьми
- Как улучшить
- Возможные риски и контр-метрики
        `.trim(),
      },
      {
        role: "user",
        content: `
Продукт: ${productDescription}

Метрика: ${metric?.name}

Родитель: ${parent?.name ?? "нет"}

Дочерние метрики: ${
          children && children.length > 0
            ? children.map((c) => c.name).join(", ")
            : "нет"
        }
        `,
      },
    ],
  });

  const data = response.data;
  const limitInfo = response.limitInfo;

  return {
    insight: data?.choices?.[0]?.message?.content?.trim() || "Инсайт не найден.",
    limitInfo,
  };
}




// === Подсказки метрик ===
export async function suggestMetricNames(
  { productDescription, parentMetric },
  model = "gpt-4o-mini"
) {
  // 🔧 исправление destructuring
  const response = await callOpenAI({
    model,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике.
Предложи 3 названия новых метрик.
Формат: список через запятую, без пояснений.
        `.trim(),
      },
      {
        role: "user",
        content: `
Описание продукта: ${productDescription}
Родительская метрика: ${parentMetric}
        `.trim(),
      },
    ],
  });

  const data = response.data;
  const limitInfo = response.limitInfo;

  const raw = data?.choices?.[0]?.message?.content || "";

  // Универсальный парсер 3 вариантов подсказок без нумерации
  const cleaned = raw
  .replace(/\r/g, "")                         // убрать спецсимволы CR
  .split(/\n|,/g)                             // делим по строкам или запятым
  .map(s => s
    .trim()
    .replace(/^\d+[\)\.]\s*/, "")             // убрать "1)" "2." "3)"
    .replace(/^[-•*]\s*/, "")                 // убрать "-", "•", "*"
    .trim()
  )
  .filter(Boolean)
  .slice(0, 3);                               // максимум 3 варианта

  return {
  suggestions: cleaned,
  limitInfo,
  };
}

export async function generateExperiment(payload, model = "gpt-4o-mini") {
  const response = await callOpenAI({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — старший продакт-менеджер в финтехе.
Сгенерируй A/B эксперимент для улучшения указанной метрики.

Верни ТОЛЬКО валидный JSON (json_object), без markdown и без текста вокруг.

Схема:
{
  "hypothesis": "если ..., то ... потому что ...",
  "variant": "что меняем в продукте (A vs B)",
  "successMetrics": ["..."],
  "guardrails": ["..."],
  "segment": "кто участвует (сегмент/гео/канал/новые/старые)",
  "duration": "оценка длительности/выборки (например 2 недели)",
  "risks": "риски/побочные эффекты/что может пойти не так"
}

Язык: русский. Пиши конкретно и практично.
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify(payload, null, 2),
      },
    ],
  });

  const raw = response.data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели (experiment)");

  return { experiment: parseModelJson(raw), limitInfo: response.limitInfo };
}





// === AI-приоритизация метрик ===
export async function prioritizeMetrics(
  { productDescription, stage, goal, metricsTree },
  model = "gpt-4o-mini"
) {
  const response = await callOpenAI({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Ты — эксперт по продуктовой аналитике и growth.
Твоя задача: приоритизировать метрики из дерева и выбрать, что важно "сейчас" с учетом стадии продукта и цели.

Вход:
- productDescription (описание продукта)
- stage: "MVP" | "Growth" | "Scale"
- goal: "activation" | "retention" | "revenue"
- metricsTree: дерево метрик в формате {id,name,type,children}

Правила:
1) Выбери ТОП-5 метрик (topMetrics) для ближайших 2–4 недель.
2) Выбери 3 метрики (avoidMetrics), которые НЕ стоит приоритизировать сейчас (дорого/рано/нет данных/слабая связь с целью).
3) Метрики должны существовать в дереве. Возвращай их по id из metricsTree.
4) Обязательно учти типы:
   - business: итоговая цель
   - product/proxy: управляемые рычаги
   - counter: защита от побочных эффектов
   - ops: операционные ограничения
5) В topMetrics хотя бы 1 должна быть:
   - product или proxy (управляемая),
   - и, если релевантно, 1 counter (защитная),
   - и 1 business (если дерево про деньги/эффективность).
6) Не выдумывай новые метрики, не меняй id.

Формат ответа — ТОЛЬКО JSON:
{
  "topMetrics": [{"id":"...", "reason":"..."}],
  "avoidMetrics": [{"id":"...", "reason":"..."}],
  "summary": "2-4 предложения: как использовать фокус и что делать дальше"
}
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            productDescription,
            stage,
            goal,
            metricsTree,
          },
          null,
          2
        ),
      },
    ],
  });

  const data = response.data;
  const limitInfo = response.limitInfo;

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ от модели");

  try {
    return {
      prioritization: parseModelJson(raw),
      limitInfo,
    };
  } catch (e) {
    console.error("❌ Ошибка парсинга JSON:", raw);
    throw new Error("Невалидный JSON от модели (prioritization)");
  }
}

