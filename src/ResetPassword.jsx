import { useState } from "react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");

    if (password !== confirmPassword) {
      setMessage("Пароли не совпадают");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось изменить пароль");
      }

      setSuccess(true);
      setMessage(data.message);
    } catch (err) {
      setMessage(err?.message || "Произошла ошибка. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
        <h1 className="text-xl font-semibold mb-2">Новый пароль MetricTree</h1>

        {message && (
          <p className="text-sm text-gray-700 mb-4" role="status">
            {message}
          </p>
        )}

        {!token ? (
          <p className="text-sm text-red-700">
            В ссылке отсутствует токен восстановления.
          </p>
        ) : success ? (
          <a href="/" className="text-sm underline">
            Вернуться на главную и войти
          </a>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              Новый пароль
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl p-2"
              />
            </label>

            <label className="block text-sm">
              Повторите пароль
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl p-2"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#ffdd2d] text-black rounded-xl px-4 py-2 font-medium disabled:opacity-50"
            >
              {loading ? "Сохраняем…" : "Установить новый пароль"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}