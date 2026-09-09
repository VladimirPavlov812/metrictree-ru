// src/quota.js

const STORAGE_KEY = "metrictree_quota_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Уменьшает лимит и возвращает новый статус
 * @param {string} type — "generate_tree" | "insight" | "suggestion"
 * @param {number} limitPerDay
 */
export function checkLocalQuota(type, limitPerDay) {
  if (typeof window === "undefined") {
    return { ok: true, left: limitPerDay };
  }

  const now = Date.now();
  let quota;

  try {
    quota = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    quota = {};
  }

  if (!quota[type]) {
    quota[type] = {
      used: 0,
      resetAt: now + DAY_MS,
    };
  }

  // если период истёк — сбрасываем
  if (quota[type].resetAt < now) {
    quota[type].used = 0;
    quota[type].resetAt = now + DAY_MS;
  }

  // лимит уже закончился
  if (quota[type].used >= limitPerDay) {
    return { ok: false, left: 0, resetAt: quota[type].resetAt };
  }

  // увеличиваем счётчик
  quota[type].used += 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(quota));

  const left = limitPerDay - quota[type].used;
  return { ok: true, left, resetAt: quota[type].resetAt };
}

/**
 * Возвращает текущее состояние лимита (НЕ изменяет его)
 * Нужно, чтобы отображать лимиты в интерфейсе
 */
export function getQuotaInfo(type, limitPerDay) {
  if (typeof window === "undefined") {
    return { used: 0, limit: limitPerDay, left: limitPerDay };
  }

  try {
    const quota = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const entry = quota[type];

    if (!entry) {
      return {
        used: 0,
        limit: limitPerDay,
        left: limitPerDay,
        resetAt: Date.now() + DAY_MS,
      };
    }

    return {
      used: entry.used,
      limit: limitPerDay,
      left: Math.max(0, limitPerDay - entry.used),
      resetAt: entry.resetAt,
    };
  } catch {
    return { used: 0, limit: limitPerDay, left: limitPerDay };
  }
}
