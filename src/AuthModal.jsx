import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function AuthModal({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const signInWithGoogle = async () => {
  const redirectTo =
    window.location.hostname === "localhost"
      ? "http://localhost:3000"
      : "https://metrictree.vercel.app";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });

  if (error) alert(error.message);
    };

  const signInWithEmail = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      alert("Ссылка для входа отправлена на почту 👌");
    } catch (e) {
      alert(e?.message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] max-w-[92vw] border border-gray-200">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Вход / синхронизация</h3>
            <p className="text-sm text-gray-500">
              Вход нужен только для облачного сохранения. Без входа всё работает как раньше.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-gray-500 hover:text-black text-lg leading-none"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full bg-black text-white rounded-xl px-4 py-2 hover:bg-gray-800 transition font-medium"
        >
          Войти через Google
        </button>

        <div className="my-4 text-center text-xs text-gray-400">или</div>

        <label className="block text-sm text-gray-700 mb-1">Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full border border-gray-300 rounded-xl p-2 mb-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
        />

        <button
          onClick={signInWithEmail}
          disabled={!email || loading}
          className="w-full bg-[#ffdd2d] text-black rounded-xl px-4 py-2 hover:brightness-95 disabled:opacity-50 transition font-medium"
        >
          {loading ? "Отправляю…" : "Войти по ссылке"}
        </button>

        <div className="mt-4 text-xs text-gray-500">
          Magic link придёт на почту. Пароль не нужен.
        </div>
      </div>
    </div>
  );
}
