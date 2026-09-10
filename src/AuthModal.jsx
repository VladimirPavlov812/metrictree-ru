import { useState } from "react";

export default function AuthModal({ open, onClose, onAuth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login");

  if (!open) return null;

  const submit = async () => {
    try {
      setLoading(true);

      const endpoint =
        mode === "login"
          ? "/api/auth/login"
          : "/api/auth/register";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Ошибка авторизации");
      }

      onAuth?.(data.user);
      onClose();
    } catch (e) {
      alert(e?.message || "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] max-w-[92vw] border border-gray-200">

        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {mode === "login" ? "Вход" : "Регистрация"}
            </h3>

            <p className="text-sm text-gray-500">
              Вход нужен для сохранения и синхронизации проектов.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-gray-500 hover:text-black text-lg"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <label className="block text-sm text-gray-700 mb-1">
          Email
        </label>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full border border-gray-300 rounded-xl p-2 mb-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
        />

        <label className="block text-sm text-gray-700 mb-1">
          Пароль
        </label>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Минимум 8 символов"
          className="w-full border border-gray-300 rounded-xl p-2 mb-4 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
        />

        <button
          onClick={submit}
          disabled={!email || password.length < 8 || loading}
          className="w-full bg-[#ffdd2d] text-black rounded-xl px-4 py-2 hover:brightness-95 disabled:opacity-50 transition font-medium"
        >
          {loading
            ? "Подождите…"
            : mode === "login"
              ? "Войти"
              : "Создать аккаунт"}
        </button>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"}{" "}
          <button
            onClick={() =>
              setMode(mode === "login" ? "register" : "login")
            }
            className="text-black font-medium underline"
          >
            {mode === "login" ? "Зарегистрироваться" : "Войти"}
          </button>
        </div>

      </div>
    </div>
  );
}