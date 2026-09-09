import { useState, useCallback, useEffect } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { generateMetricTree, generateMetricInsight } from "./api/gpt";

export default function App() {
  // состояния
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [error, setError] = useState("");
  const [highlightedNodes, setHighlightedNodes] = useState([]);

  // рекурсивное построение графа
  const buildGraph = useCallback((tree, x = 0, y = 0) => {
    if (!tree) return { nodes: [], edges: [] };

    const nodeColor =
      tree.type === "business"
        ? "#fde68a"
        : tree.type === "product"
        ? "#bfdbfe"
        : tree.type === "proxy"
        ? "#bbf7d0"
        : tree.type === "counter"
        ? "#fecaca"
        : "#f3f4f6";

    const nodes = [
      {
        id: tree.id,
        data: { label: tree.name },
        position: { x, y },
        type: tree.type,
        style: {
          background: nodeColor,
          borderRadius: 10,
          padding: 8,
          fontSize: 13,
          border: "1px solid #e5e7eb",
          cursor: "pointer",
          minWidth: 100,
          textAlign: "center",
          boxShadow: "0 0 2px rgba(0,0,0,0.1)",
          transition: "all 0.3s ease",
        },
      },
    ];

    const edges = [];
    const childY = y + 150;
    let childX = x - ((tree.children?.length || 0) * 180) / 2;

    tree.children?.forEach((child) => {
      edges.push({
        id: `${tree.id}-${child.id}`,
        source: tree.id,
        target: child.id,
      });
      const { nodes: cNodes, edges: cEdges } = buildGraph(child, childX, childY);
      nodes.push(...cNodes);
      edges.push(...cEdges);
      childX += 180;
    });

    return { nodes, edges };
  }, []);

  // генерация дерева
  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;

    setLoading(true);
    setNodes([]);
    setEdges([]);
    setSelectedMetric(null);
    setInsight("");
    setError("");

    try {
      const treeJson = await generateMetricTree(description);
      if (!treeJson?.id || !treeJson?.name) {
        throw new Error("Ответ модели не содержит корневую метрику.");
      }
      const { nodes, edges } = buildGraph(treeJson, 0, 0);
      setNodes(nodes);
      setEdges(edges);
    } catch (err) {
      console.error(err);
      setError(err.message || "Ошибка при генерации дерева");
    } finally {
      setLoading(false);
    }
  };

  // выбор узла
  const handleNodeClick = (_, node) => {
    setSelectedMetric(node);
    setInsight("");
  };

  // AI инсайт + подсветка контекста
  const handleGetInsight = async () => {
    if (!selectedMetric) return;
    setInsightLoading(true);
    setInsight("");

    try {
      // родитель
      const parentEdge = edges.find((e) => e.target === selectedMetric.id);
      const parent = parentEdge
        ? nodes.find((n) => n.id === parentEdge.source)
        : null;

      // дочерние
      const childrenEdges = edges.filter((e) => e.source === selectedMetric.id);
      const children = nodes.filter((n) =>
        childrenEdges.some((e) => e.target === n.id)
      );

      // подсветка
      const idsToHighlight = [
        parent?.id,
        selectedMetric.id,
        ...children.map((c) => c.id),
      ].filter(Boolean);
      setHighlightedNodes(idsToHighlight);

      // запрос к GPT
      const result = await generateMetricInsight({
        metric: selectedMetric,
        productDescription: description,
        parent,
        children,
      });
      setInsight(result);
    } catch (err) {
      console.error(err);
      setInsight("Ошибка при получении инсайта 😢");
    } finally {
      setInsightLoading(false);
      // снять подсветку через 3 секунды
      setTimeout(() => setHighlightedNodes([]), 3000);
    }
  };

  // 🔄 обновляем стили подсвеченных узлов при изменении highlightedNodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const isHighlighted = highlightedNodes.includes(node.id);
        const isSelected = node.id === selectedMetric?.id;

        let bg = node.style.background;
        if (isHighlighted) {
          bg = isSelected ? "#93c5fd" : "#bbf7d0";
        }

        return {
          ...node,
          style: {
            ...node.style,
            background: bg,
            boxShadow: isHighlighted
              ? "0 0 20px rgba(34,197,94,0.6)"
              : "0 0 2px rgba(0,0,0,0.1)",
            animation: isHighlighted ? "pulseGlow 1.5s infinite" : "none",
          },
        };
      })
    );
  }, [highlightedNodes, selectedMetric]);

  return (
    <>
      {/* 🌟 CSS-анимация подсветки */}
      <style>
        {`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0px rgba(34,197,94,0.3); }
          50% { box-shadow: 0 0 20px rgba(34,197,94,0.6); }
          100% { box-shadow: 0 0 0px rgba(34,197,94,0.3); }
        }
      `}
      </style>

      <div className="h-screen flex">
        {/* Левая часть — ввод и дерево */}
        <div className="flex-1 flex flex-col">
          <header className="bg-white shadow-sm p-4 flex gap-2 items-center">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Опиши продукт..."
              className="flex-1 border rounded-lg p-2 h-20 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition h-fit"
            >
              {loading ? "Генерация..." : "Сгенерировать"}
            </button>
          </header>

          {error && (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <main className="flex-1 bg-gray-50">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              onNodeClick={handleNodeClick}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </main>
        </div>

        {/* Правая панель */}
        <aside className="w-80 border-l bg-white p-4 flex flex-col">
          {selectedMetric ? (
            <>
              <h2 className="text-xl font-semibold mb-2">
                {selectedMetric.data.label}
              </h2>
              <p className="text-gray-500 mb-4 text-sm">
                Тип метрики:{" "}
                <span className="font-medium text-gray-800">
                  {selectedMetric?.type || "не указан"}
                </span>
              </p>

              <button
                onClick={handleGetInsight}
                disabled={insightLoading}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition mb-4"
              >
                {insightLoading ? "Получаю инсайт..." : "💡 Получить AI инсайт"}
              </button>

              {insight && (
                <div className="bg-emerald-50 border rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap overflow-y-auto max-h-[60vh]">
                  {insight}
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-400 text-sm mt-10 text-center">
              👈 Выберите метрику в дереве
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
