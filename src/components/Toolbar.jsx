import { useState } from "react";

export default function Toolbar({ onAddMetric }) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim()) {
      onAddMetric(prompt);
      setPrompt("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Опиши продукт..."
        className="border rounded-lg p-2"
      />
      <button
        type="submit"
        className="bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700"
      >
        Сгенерировать метрики
      </button>
    </form>
  );
}
