// src/components/PropertiesPanel.jsx
export default function PropertiesPanel({ node }) {
  if (!node) return null;

  return (
    <div className="p-3 border rounded-lg bg-white shadow-sm">
      <h2 className="font-semibold text-lg mb-2">Метрика</h2>
      <p className="text-gray-700">{node.data.label}</p>
    </div>
  );
}
