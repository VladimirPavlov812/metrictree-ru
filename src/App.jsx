import { useRef } from "react";
import { memo } from "react";
import { Handle, Position } from "reactflow";
import AuthModal from "./AuthModal";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { toSvg } from "html-to-image";
import { getNodesBounds, getViewportForBounds } from "reactflow";
import { useState, useCallback, useEffect, useMemo } from "react";
import { nanoid } from "nanoid";
import dagre from "dagre";
import {
  generateMetricTree,
  generateMetricInsight,
  suggestMetricNames,
  prioritizeMetrics,
  generateClarifyingQuestions,
  normalizeProductBrief,
  generateExperiment,
} from "./api/gpt";
import { checkLocalQuota, getQuotaInfo } from "./quota";


// === Яндекс.Метрика: отправка событий ===
function ymEvent(name) {
  try {
    if (window?.ym) {
      window.ym(105378247, "reachGoal", name);
    }
  } catch (e) {
    console.warn("YM event error:", e);
  }
}

// 🔹 Анимация подсветки
const pulseStyle = document.createElement("style");
pulseStyle.textContent = `
@keyframes pulseHighlight {
  0% { box-shadow: 0 0 0 rgba(52,211,153,0); opacity: 1; }
  25% { box-shadow: 0 0 10px rgba(52,211,153,0.4); }
  50% { box-shadow: 0 0 20px rgba(52,211,153,0.6); }
  75% { box-shadow: 0 0 10px rgba(52,211,153,0.4); }
  100% { box-shadow: 0 0 0 rgba(52,211,153,0); opacity: 0.9; }
}
`;
document.head.appendChild(pulseStyle);

const tabPulseStyle = document.createElement("style");
tabPulseStyle.textContent = `
@keyframes pulseTab {
  0% { transform: scale(1); }
  50% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
`;
document.head.appendChild(tabPulseStyle);

// Маленький компонент для строки лимита
function QuotaLine({ label, info }) {
  const left = info?.left ?? 0;

  let color = "text-green-700";
  if (left <= 2) color = "text-yellow-700";
  if (left <= 0) color = "text-red-700";

  return (
    <div className="flex justify-between text-sm mb-1">
      <span className="text-gray-600">{label}:</span>
      <span className={color}>
        Осталось: {left}
      </span>
    </div>
  );
}

const feedbackSourceMeta = {
  generate_tree: {
    title: "Спасибо! Можно 30 секунд обратной связи?",
    subtitle: "Вы только что сгенерировали дерево метрик.",
  },
  insight: {
    title: "Спасибо! Можно 30 секунд обратной связи?",
    subtitle: "Вы только что получили разбор метрики и идеи, как её улучшить.",
  },
  experiment: {
    title: "Спасибо! Можно 30 секунд обратной связи?",
    subtitle: "Вы только что сгенерировали эксперимент по метрике.",
  },
  export_miro: {
    title: "Спасибо! Можно 30 секунд обратной связи?",
    subtitle: "Вы только что выгрузили дерево в Miro.",
  },
};



const MetricNode = memo(function MetricNode({ id, data }) {
  const hasChildren = !!data?.hasChildren;
  const isCollapsed = !!data?.isCollapsed;
  return (
    <div className="relative w-full h-full">
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data?.onToggle?.(id);
          }}
          className="
            nodrag absolute left-1 top-1
            w-5 h-5 flex items-center justify-center
            text-[10px] rounded-md
            bg-white/80 hover:bg-white
            border border-gray-200
            text-gray-600
          "
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
      )}

      <div className="w-full h-full flex items-center justify-center text-center">
        <div className="leading-snug break-words">
          {data?.label}
        </div>
      </div>

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});


export default function App() {
  
  // === определение мобильной версии ===
  const [isMobile, setIsMobile] = useState(false);
  const nodeTypes = useMemo(() => ({
  business: MetricNode,
  product: MetricNode,
  proxy: MetricNode,
  counter: MetricNode,
  ops: MetricNode,
  }), []);

  // === переключение вкладки при входе в мобильную версию ===
  useEffect(() => {
  if (isMobile) {
    setActiveTab("mobile");
  }
  }, [isMobile]);

  useEffect(() => {
  const update = () => {
    const ua = navigator.userAgent || "";

    const isAndroidPhone =
      /Android/i.test(ua) && /Mobile/i.test(ua);

    const isIPhone =
      /iPhone|iPod/i.test(ua);

    const isIPad =
      /iPad/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    setIsMobile(
      (!isIPad && (isAndroidPhone || isIPhone)) ||
      window.innerWidth < 768
    );
  };

  update();

  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);

  return () => {
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
  };
}, []);

    // === Яндекс.Метрика ===
  useEffect(() => {
    const METRIKA_ID = 105378247;

    // Подключение скрипта
    (function(m,e,t,r,i,k,a){
      m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      k=e.createElement(t),a=e.getElementsByTagName(t)[0];
      k.async=1;k.src=r;a.parentNode.insertBefore(k,a)
    })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

    // Инициализация счётчика
    window.ym(METRIKA_ID, "init", {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true
    });

  }, []);

  const handleOpenPrioritization = () => {
  if (!treeData) return;
  setShowPriorModal(true);
};

const handleCancelGeneration = () => {
  if (generateAbortRef.current) {
    generateAbortRef.current.abort(); // 💥 прерываем запрос
  }

  setLoading(false);
  setShowQuestionsModal(false);
};

const handleRunPrioritization = async () => {
  if (!treeData) return;

  if (!session?.user?.id) {
  setAuthModalReason("default");
  setAuthModalOpen(true);
  return;
  }

  try {
  const hasQuota = await checkServerQuota("prioritization");

  if (!hasQuota) {
    alert("Лимит приоритизаций исчерпан.");
    return;
  }
  } catch (err) {
  console.error("Prioritization quota check error:", err);
  alert("Не удалось проверить лимит приоритизаций.");
  return;
  }

  setPriorLoading(true);
  setPriorResult(null);
  setPriorTopIds([]);
  setPriorAvoidIds([]);

  try {
    const res = await prioritizeMetrics(
      {
        productDescription: JSON.stringify(brief || { raw: description }, null, 2),
        stage: priorStage,
        goal: priorGoal,
        metricsTree: treeData,
      },
      model
    );

    const p = res.prioritization || {};
    const top = Array.isArray(p.topMetrics) ? p.topMetrics : [];
    const avoid = Array.isArray(p.avoidMetrics) ? p.avoidMetrics : [];
    const topIds = top.map(x => x.id).filter(Boolean);
    const avoidIds = avoid.map(x => x.id).filter(Boolean);
    setPriorResult(p);
    setPriorTopIds(topIds);
    setPriorAvoidIds(avoidIds);
    // подсветка: top + avoid + (опционально) ближайшие связи
    setHighlightedNodes([...new Set([...topIds, ...avoidIds])]);
    ymEvent("prioritization");
  } catch (e) {
    console.error(e);
    setPriorResult({ summary: "Ошибка при приоритизации 😢" });
  } finally {
    setPriorLoading(false);
    setTimeout(() => setHighlightedNodes([]), 3000);
  }
};


const openFeedbackModal = (source) => {
  setFeedbackSource(source);
  setFeedbackSubmitting(false);
  setFeedbackSubmitted(false);
  setFeedbackForm({
    task: "",
    nextStep: "",
    reuseScore: "",
    contact: "",
  });
  setShowFeedbackModal(true);
};

const openNextStepsModal = (source) => {
  setNextStepsSource(source);
  setShowNextStepsModal(true);
};


const tryOpenFeedbackModal = (source) => {
  if (feedbackShownThisSession) return;

  setFeedbackShownThisSession(true);
  openFeedbackModal(source);
};

const handleSubmitFeedback = async () => {
  if (!feedbackForm.task.trim()) {
    alert("Пожалуйста, ответьте на первый вопрос");
    return;
  }

  if (!feedbackForm.nextStep.trim()) {
    alert("Пожалуйста, ответьте на второй вопрос");
    return;
  }


  try {
    setFeedbackSubmitting(true);

    const payload = {
      source: feedbackSource,
      answers: {
        task: feedbackForm.task,
        nextStep: feedbackForm.nextStep,
        reuseScore: feedbackForm.reuseScore || null,
        contact: feedbackForm.contact || null,
      },
      createdAt: new Date().toISOString(),
    };

    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data?.error || "Не удалось отправить feedback");
    }

    setFeedbackSubmitted(true);
    ymEvent("feedback_submit");
  } catch (e) {
    console.error(e);
    alert(e?.message || "Ошибка отправки формы");
  } finally {
    setFeedbackSubmitting(false);
  }
};


const updateFeedbackField = (field, value) => {
  setFeedbackForm((prev) => ({
    ...prev,
    [field]: value,
  }));
};

const handleGenerateExperiment = async () => {
  if (!selectedMetric) return;
  if (!session?.user?.id) {
  setAuthModalReason("default");
  setAuthModalOpen(true);
  return;
  }


  // UI: сразу откроем модалку и покажем загрузку
  setShowExperimentModal(true);
  setExperimentLoading(true);
  setExperiment(null);
  try {
    // найдем parent + children
    const parentEdge = edges.find((e) => e.target === selectedMetric.id);
    const parent = parentEdge ? nodes.find((n) => n.id === parentEdge.source) : null;

    const childEdges = edges.filter((e) => e.source === selectedMetric.id);
    const children = childEdges
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter(Boolean);
    // payload
    const payload = {
      productDescription: brief ? brief : { raw: description },
      metric: normalizeNode(selectedMetric),
      parent: normalizeNode(parent),
      children: children.map(normalizeNode),
    };

    // Проверяем серверную квоту до запроса к AI
    const hasQuota = await checkServerQuota("experiment");

    if (!hasQuota) {
    throw new Error("Лимит A/B экспериментов исчерпан.");
    }

    // запрос к AI
    const res = await generateExperiment(payload, model);
    const exp = res.experiment;

    // кладем данные в стейт
    setExperiment({
      hypothesis: exp.hypothesis ?? "",
      variant: exp.variant ?? "",
      successMetrics: Array.isArray(exp.successMetrics) ? exp.successMetrics : [],
      guardrails: Array.isArray(exp.guardrails) ? exp.guardrails : [],
      segment: exp.segment ?? "",
      duration: exp.duration ?? "",
      risks: exp.risks ?? "",
      raw: exp, // удобно для дебага
    });

    ymEvent("experiment");
    setPendingFeedbackSource("experiment");
  } catch (e) {
    console.error(e);
    setExperiment({
      error: e?.message || "Ошибка генерации эксперимента",
      raw: e,
    });
  } finally {
    setExperimentLoading(false);
  }
  };

  const findNodeInTree = (node, id) => {
  if (!node) return null;
  if (node.id === id) return node;
  for (const ch of node.children || []) {
    const found = findNodeInTree(ch, id);
    if (found) return found;
  }
  return null;
  };
  const generateAbortRef = useRef(null);
  const generationIdRef = useRef(null);
  const metricNameById = (id) => findNodeInTree(treeData, id)?.name || id;
  // === Product Brief / Questions flow ===
  const [brief, setBrief] = useState(null);              // нормализованный контекст
  const [briefMeta, setBriefMeta] = useState({           // то, что показывать пользователю
  missingInfo: [],
  assumptions: [],
  });
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);
  const [feedbackShownThisSession, setFeedbackShownThisSession] = useState(false);

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackSource, setFeedbackSource] = useState(""); // "generate_tree" | "export_miro"
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const [feedbackForm, setFeedbackForm] = useState({
  task: "",
  nextStep: "",
  reuseScore: "",
  contact: "",
  });

  const currentFeedbackMeta =
  feedbackSourceMeta[feedbackSource] || feedbackSourceMeta.generate_tree;

  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudProjects, setCloudProjects] = useState([]);
  const [cloudError, setCloudError] = useState("");
  const [pulseInsightTab, setPulseInsightTab] = useState(true);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsList, setQuestionsList] = useState([]); // массив {id, field, question}
  const [answers, setAnswers] = useState({});             // field -> answer string
  const [questionsError, setQuestionsError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [session, setSession] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState("default");
  const [activeProjectId, setActiveProjectId] = useState(null); // если открыт проект из облака
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const setAnswer = (field, value) => {
  setAnswers((prev) => ({ ...prev, [field]: value }));
  };
  const [description, setDescription] = useState("");
  const [treeData, setTreeData] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [mobileMenuOpenId, setMobileMenuOpenId] = useState(null);
  const [insight, setInsight] = useState("");
  const [experiment, setExperiment] = useState(null);
  const [experimentLoading, setExperimentLoading] = useState(false);
  const [showExperimentModal, setShowExperimentModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rightTab, setRightTab] = useState("metric"); // "metric" | "quota"
  const [insightLoading, setInsightLoading] = useState(false);
  const [error, setError] = useState("");
  const [highlightedNodes, setHighlightedNodes] = useState([]);
  const [activeTab, setActiveTab] = useState("visual");
  const [mobileMenuFor, setMobileMenuFor] = useState(null);
  // === Модалка: Преимущества ===
  const [showBenefitsModal, setShowBenefitsModal] = useState(false);
  const [miroExporting, setMiroExporting] = useState(false);
  const [showNextStepsModal, setShowNextStepsModal] = useState(false);
  const [nextStepsSource, setNextStepsSource] = useState("");

  const [miroExportStatus, setMiroExportStatus] = useState("");
  const [miroExportProgress, setMiroExportProgress] = useState(0); // 0..100

  // === Авто-показ онбординга "Преимущества" ===
  useEffect(() => {
  const seen = localStorage.getItem("seen_benefits");

  if (!seen && !isMobile) {
    const timer = setTimeout(() => {
      setShowBenefitsModal(true);
      localStorage.setItem("seen_benefits", "1");
      ymEvent("benefits_auto_open");
    }, 1500);

    return () => clearTimeout(timer);
  }
  }, [isMobile]);



  // === Инсайт модалка ===
  const [showInsightModal, setShowInsightModal] = useState(false);
  const [modalInsight, setModalInsight] = useState("");
  const [insightPending, setInsightPending] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState({});
  const toggleCollapse = useCallback((id) => {
  setCollapsedNodes((prev) => ({
    ...prev,
    [id]: !prev[id],
  }));
  }, []);

  const fetchCloudProjects = async () => {
  if (!session?.user?.id) {
    setCloudProjects([]);
    return;
  }

  try {
    setCloudLoading(true);
    setCloudError("");

    const res = await fetch("/api/projects");

    if (!res.ok) {
      throw new Error("Не удалось загрузить проекты");
    }

    const data = await res.json();
    setCloudProjects(data || []);
  } catch (e) {
    console.error(e);
    setCloudError(e?.message || "Не удалось загрузить проекты");
  } finally {
    setCloudLoading(false);
  }
  };

  // === Переключатель модели ===
  const [model, setModel] = useState("gpt-4.1");
  // === Приоритизация метрик ===
  const [priorLoading, setPriorLoading] = useState(false);
  const [showPriorModal, setShowPriorModal] = useState(false);
  const [priorStage, setPriorStage] = useState("MVP"); // MVP | Growth | Scale
  const [priorGoal, setPriorGoal] = useState("activation"); // activation | retention | revenue
  const [priorResult, setPriorResult] = useState(null); // json result
  const [priorTopIds, setPriorTopIds] = useState([]);
  const [priorAvoidIds, setPriorAvoidIds] = useState([]);
  // === Модалки добавления/редактирования ===
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMetricName, setNewMetricName] = useState("");
  const [newMetricType, setNewMetricType] = useState("proxy");
  const [metricSuggestions, setMetricSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editMetricName, setEditMetricName] = useState("");
  const [pendingFeedbackSource, setPendingFeedbackSource] = useState(null);
  const [editMetricType, setEditMetricType] = useState("proxy");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const childrenByParent = useMemo(() => {
  const m = new Map();
  for (const e of edges) {
    if (!m.has(e.source)) m.set(e.source, []);
    m.get(e.source).push(e.target);
  }
  return m;
  }, [edges]);
  const hiddenSet = useMemo(() => {
  const hidden = new Set();
  const hideSubtree = (rootId) => {
    const stack = [...(childrenByParent.get(rootId) || [])];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      hidden.add(cur);

      const kids = childrenByParent.get(cur) || [];
      for (const k of kids) stack.push(k);
    }
  };

  for (const [id, isCollapsed] of Object.entries(collapsedNodes)) {
    if (isCollapsed) hideSubtree(id);
  }

  return hidden;
  }, [childrenByParent, collapsedNodes]);

  const visibleEdges = useMemo(() => {
  return edges.filter(
    (e) => !hiddenSet.has(e.source) && !hiddenSet.has(e.target)
  );
  }, [edges, hiddenSet]);

  const hasChildrenSet = useMemo(() => {
  const s = new Set();
  for (const e of edges) s.add(e.source);
  return s;
  }, [edges]);

  const visibleNodes = useMemo(() => {
  return nodes
    .map((n) => {
      const isTop = priorTopIds.includes(n.id);
      const isAvoid = priorAvoidIds.includes(n.id);
      const isHL = highlightedNodes.includes(n.id);

      const baseStyle = n.style || {};
      const style = { ...baseStyle };

      // defaults
      style.animation = "none";
      style.boxShadow = "0 0 2px rgba(0,0,0,0.05)";
      style.border = "1px solid #ccc";
      style.opacity = 1;

      if (isAvoid) {
        style.opacity = 0.45;
        style.border = "1px dashed #9ca3af";
      }

      if (isTop) {
        style.opacity = 1;
        style.border = "3px solid #34d399";
        style.animation = "pulseHighlight 1.5s ease-in-out infinite";
        style.boxShadow = "0 0 10px rgba(52,211,153,0.55)";
      } else if (isHL && !isAvoid) {
        style.border = "2px solid #34d399";
        style.animation = "pulseHighlight 1.5s ease-in-out infinite";
        style.boxShadow = "0 0 8px rgba(52,211,153,0.5)";
      }

      return {
        ...n,
        style,
        data: {
          ...n.data,
          hasChildren: hasChildrenSet.has(n.id),
          isCollapsed: !!collapsedNodes[n.id],
          onToggle: toggleCollapse,
        },
      };
    })
    .filter((n) => !hiddenSet.has(n.id));
  }, [
  nodes,
  hasChildrenSet,
  collapsedNodes,
  hiddenSet,
  toggleCollapse,
  priorTopIds,
  priorAvoidIds,
  highlightedNodes,
  ]);

  // === Лимиты (для отображения) ===
  const [quotaView, setQuotaView] = useState({
    generate: { used: 0, limit: 2, left: 2 },
    insight: { used: 0, limit: 2, left: 2 },
    suggestion: { used: 0, limit: 2, left: 2 },
    prioritization: { used: 0, limit: 2, left: 2 },
    experiment: { used: 0, limit: 2 }
  });

  const STORAGE_KEY = "metrictree_data_v1";
  const nodeWidth = 230;
  const nodeHeight = 120;
  const reactFlowWrapperRef = useRef(null);
  const getLayoutedElements = (nodes, edges, direction = "TB") => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: direction, ranksep: 90, nodesep: 35 });

    nodes.forEach((node) =>
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
    );
    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
      const { x, y } = dagreGraph.node(node.id);
      node.position = { x: x - nodeWidth / 2, y: y - nodeHeight / 2 };
      return node;
    });
    return { nodes: layoutedNodes, edges };
  };

  const refreshQuotaView = () => {
  // Для авторизованного пользователя квоты берём только с сервера.
  if (session?.user?.id) {
    fetchServerQuota();
    return;
  }

  // Для гостя используется локальный лимит.
  setQuotaView({
    generate: getQuotaInfo("generate_tree", 1),
    insight: getQuotaInfo("insight", 5),
    suggestion: getQuotaInfo("suggestion", 5),
    prioritization: getQuotaInfo("prioritization", 5),
    experiment: getQuotaInfo("experiment", 5),
  });
  };

  const fetchServerQuota = async () => {
  if (!session?.user?.id) return;

  try {
    const res = await fetch("/api/quota");

    if (!res.ok) {
      throw new Error("Не удалось загрузить лимиты");
    }

    const data = await res.json();

    setQuotaView(data.quota);
    return data.quota;

  } catch (err) {
    console.error("Quota load error:", err);
    return null;
  }
  };

  const handleBuyPro = async () => {
  try {
    const res = await fetch("/api/payments/pro", {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || "Не удалось создать платёж");
    }

    if (!data.paymentUrl) {
      throw new Error("Не получена ссылка на оплату");
    }

    
    if (!data.paymentId) {
    throw new Error("Не получен номер платежа");
    }

    sessionStorage.setItem("metrictree_pending_payment_id", String(data.paymentId));
    window.location.href = data.paymentUrl;


  } catch (err) {
    console.error("Pro payment error:", err);
    alert("Не удалось перейти к оплате. Попробуйте ещё раз.");
  }
  };



  const checkServerQuota = async (type) => {
  const res = await fetch("/api/quota");

  if (!res.ok) {
    throw new Error("Не удалось проверить лимит");
  }

  const data = await res.json();
  const quota = data?.quota?.[type];

  if (!quota || quota.left <= 0) {
    return false;
  }

  return true;
  };

  const consumeServerQuota = async (type) => {
  const res = await fetch("/api/quota/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });

  const data = await res.json();

  if (res.status === 429) {
    throw new Error("Лимит исчерпан");
  }

  if (!res.ok) {
    throw new Error(data?.error || "Не удалось обновить лимит");
  }

  await fetchServerQuota();

  return data;
  };


  const handleSaveToCloud = async ({ forceNew = false } = {}) => {
  if (!session?.user?.id) {
    setAuthModalOpen(true);
    return;
  }

  if (!treeData && (!nodes?.length || !edges?.length)) {
    alert("Сначала сгенерируйте дерево 🙂");
    return;
  }

  try {
    setSaveStatus("saving");

    const payload = {
      description,
      nodes,
      edges,
      treeData,
      brief: brief || null,
      model,
      savedAt: new Date().toISOString(),
    };

    // Если уже открыт проект и не просим "как новый" — делаем UPDATE
    if (activeProjectId && !forceNew) {
      const res = await fetch(`/api/projects/${activeProjectId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: payload,
        }),
      });

      if (!res.ok) {
        throw new Error("Не удалось сохранить проект");
      }

      setSaveStatus("saved");
      await fetchCloudProjects(); // чтобы updated_at/сортировка обновились
      return;
    }

    // Иначе — создаём новый (INSERT) с именем
    const input = prompt(
      "Название проекта (можно оставить пустым):",
      "MetricTree проект"
    );

    if (input === null) {
      setSaveStatus("idle");
      return; // ✅ Cancel — не сохраняем
    }

    const name = input.trim() || "MetricTree проект";
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        data: payload,
      }),
    });

    if (!res.ok) {
      throw new Error("Не удалось создать проект");
    }

    const created = await res.json();

    // сделаем новый проект активным (чтобы дальше сохранять поверх)
    setActiveProjectId(created?.id || null);

    setSaveStatus("saved");
    await fetchCloudProjects();
  } catch (e) {
    console.error(e);
    setSaveStatus("error");
    alert("❌ Ошибка сохранения: " + (e?.message || "unknown"));
  }
  };

  useEffect(() => {
  const loadSession = async () => {
    try {
      const res = await fetch("/api/auth/me");

      if (!res.ok) {
        setSession(null);
        return;
      }

      const data = await res.json();

      setSession({
        user: data.user,
      });
    } catch (e) {
      console.error("Session load error:", e);
      setSession(null);
    }
  };

  loadSession();
  }, []);

    useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");

    if (payment !== "success" && payment !== "fail") return;
    if (!session?.user?.id) return;

    params.delete("payment");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash
    );

    const paymentId = sessionStorage.getItem("metrictree_pending_payment_id");

    if (payment === "fail") {
      sessionStorage.removeItem("metrictree_pending_payment_id");
      alert("Оплата не завершена. Операции не начислены.");
      return;
    }

    if (!paymentId || !/^\d+$/.test(paymentId)) {
      alert("Не удалось определить номер платежа. Если оплата прошла, обновите страницу и проверьте остаток операций или обратитесь в поддержку.");
      return;
    }

    let cancelled = false;
    let timer;
    let attempts = 0;

    const checkPayment = async () => {
      if (cancelled) return;

      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/status`);
        if (!res.ok) throw new Error(`Payment status HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.status === "paid") {
          sessionStorage.removeItem("metrictree_pending_payment_id");
          await fetchServerQuota();
          if (!cancelled) alert("Оплата подтверждена! По 20 операций каждого типа начислены на ваш баланс.");
          return;
        }

        if (data.status === "failed") {
          sessionStorage.removeItem("metrictree_pending_payment_id");
          alert("Платёж не прошёл. Операции не начислены.");
          return;
        }
      } catch (err) {
        console.error("Payment status check error:", err);
      }

      attempts += 1;
      if (attempts < 10) {
        timer = window.setTimeout(checkPayment, 3000);
      } else if (!cancelled) {
        alert("Подтверждение платежа пока не получено. Проверьте остаток операций позднее. Если деньги списаны, обратитесь в поддержку, указав номер платежа: " + paymentId);
      }
    };

    timer = window.setTimeout(checkPayment, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session?.user?.id]);

  useEffect(() => {
  if (isFullscreen) {
    setActiveTab("visual");
  }
  }, [isFullscreen]);

  useEffect(() => {
  const timer = setTimeout(() => {
    setPulseInsightTab(false);
  }, 10000); // 10 секунд

  return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
  if (session?.user?.id) {
    fetchCloudProjects();
    fetchServerQuota();
  } else {
    setCloudProjects([]);
    refreshQuotaView();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // === восстановление дерева ===
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.nodes && parsed.edges) {
          setDescription(parsed.description || "");
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
          setTreeData(parsed.treeData || null);
        }
      } catch (e) {
        console.warn("Ошибка при чтении localStorage:", e);
      }
    }
    // одновременно подтянем состояние квот
    refreshQuotaView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === автосохранение ===
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ description, nodes, edges, treeData })
      );
    }
  }, [nodes, edges, description, treeData]);

  // === экспорт ===
  const handleExport = () => {
    try {
      const data = JSON.stringify({ description, nodes, edges, treeData }, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "metrictree.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Ошибка при экспорте:", err);
      alert("Ошибка при экспорте файла 😢");
    }
  };

  const openCloudProject = async (projectId) => {
  try {
    setCloudLoading(true);
    setCloudError("");

    const res = await fetch(`/api/projects/${projectId}`);

    if (!res.ok) {
      throw new Error("Не удалось открыть проект");
    }

    const data = await res.json();

    const payload = data?.data || {};
    const {
      description: d = "",
      nodes: n = [],
      edges: e = [],
      treeData: t = null,
      brief: b = null,
    } = payload;

    setDescription(d);
    setNodes(n);
    setEdges(e);
    setTreeData(t);
    setBrief(b);

    setSelectedMetric(null);
    setInsight("");

    // (необязательно) обновить localStorage, чтобы не терять оффлайн-копию
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ description: d, nodes: n, edges: e, treeData: t })
    );

    alert("✅ Проект открыт");
    setActiveProjectId(data.id);
    setSaveStatus("saved");


  } catch (err) {
    console.error(err);
    alert("❌ Не удалось открыть проект: " + (err?.message || "unknown"));
  } finally {
    setCloudLoading(false);
  }
  };

  const deleteCloudProject = async (projectId) => {
  if (!confirm("Удалить проект из облака?")) return;

  try {
    setCloudLoading(true);
    setCloudError("");

    const res = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw new Error("Не удалось удалить проект");
    }

    setCloudProjects((prev) => prev.filter((p) => p.id !== projectId));
  } catch (e) {
    console.error(e);
    alert("❌ Ошибка удаления: " + (e?.message || "unknown"));
  } finally {
    setCloudLoading(false);
  }
  };

  const handleDownloadCsv = () => {
  try {
    if (!nodes?.length) throw new Error("Нет узлов для экспорта");
    const exportNodes = nodes.filter((n) => !n.hidden);
    // childId -> parentId (берем первое входящее ребро)
    const parentByChild = new Map();
    edges.forEach((e) => {
      if (!parentByChild.has(e.target)) parentByChild.set(e.target, e.source);
    });

    const nodeById = new Map(exportNodes.map((n) => [n.id, n]));
    const getName = (id) => nodeById.get(id)?.data?.label || id;

    // level + path (вверх по parent)
    const getPathInfo = (id) => {
      const seen = new Set();
      const parts = [];
      let cur = id;
      let level = 0;

      while (cur && !seen.has(cur)) {
        seen.add(cur);
        parts.push(getName(cur));
        cur = parentByChild.get(cur);
        level += 1;
      }

      // parts: child->...->root, разворачиваем
      const path = parts.reverse().join(" > ");
      // level: количество шагов, но удобнее уровень "root=0"
      const depth = Math.max(0, parts.length - 1);

      return { depth, path };
    };

    const typeLabel = (t) =>
      t === "business"
        ? "Business"
        : t === "product"
        ? "Product"
        : t === "proxy"
        ? "Proxy"
        : t === "counter"
        ? "Counter"
        : t === "ops"
        ? "Ops"
        : "Unknown";

    // CSV escaping
    const csvCell = (v) => {
      const s = v == null ? "" : String(v);
      // если есть запятая/кавычка/перенос строки — экранируем
      if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };

    // Заголовки под импорт "как карточки" + служебные поля
    const header = [
      "title",        // главное: Miro обычно использует это как заголовок карточки
      "type",
      "id",
      "parentId",
      "parentTitle",
      "level",
      "path",
      "x",
      "y",
    ];

    const rows = exportNodes.map((n) => {
      const title = n.data?.label || n.id;
      const parentId = parentByChild.get(n.id) || "";
      const parentTitle = parentId ? getName(parentId) : "";
      const { depth, path } = getPathInfo(n.id);

      // координаты (на будущее; Miro при CSV может их игнорить, но полезно хранить)
      const x = Math.round((n.position?.x ?? 0) + nodeWidth / 2);
      const y = Math.round((n.position?.y ?? 0) + nodeHeight / 2);

      return [
        title,
        typeLabel(n.type),
        n.id,
        parentId,
        parentTitle,
        depth,
        path,
        x,
        y,
      ].map(csvCell).join(",");
    });

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "metrictree_miro.csv";
    a.click();

    URL.revokeObjectURL(url);

    ymEvent("export_csv");
    openNextStepsModal("export_csv");
  } catch (e) {
    console.error(e);
    alert(e?.message || "Не удалось скачать CSV 😢");
  }
  };

  // === импорт ===
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.nodes || !data.edges) throw new Error("Некорректный формат файла");
      setDescription(data.description || "");
      setNodes(data.nodes);
      setEdges(data.edges);
      setTreeData(data.treeData || null);
      localStorage.setItem(STORAGE_KEY, text);
      alert("✅ Данные успешно импортированы!");
      setActiveProjectId(null);
      setSaveStatus("idle");
    } catch (err) {
      console.error("Ошибка при импорте:", err);
      alert("❌ Не удалось импортировать JSON");
    } finally {
      e.target.value = "";
    }
  };

  const handleSave = () => {
    const data = { description, nodes, edges, treeData };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    alert("✅ Дерево метрик сохранено!");
  };

  const handleClear = () => {
    if (confirm("Очистить текущее дерево?")) {
      localStorage.removeItem(STORAGE_KEY);
      setDescription("");
      setNodes([]);
      setEdges([]);
      setTreeData(null);
      setSelectedMetric(null);
      setInsight("");
      setActiveProjectId(null);
      setSaveStatus("idle");
    }
  };

  // === текстовое дерево ===
  const renderTreeText = (node, level = 0) => {
    if (!node) return "";
    const indent = " ".repeat(level * 2);

    const typeLabel =
      node.type === "business"
        ? "Business"
        : node.type === "product"
        ? "Product"
        : node.type === "proxy"
        ? "Proxy"
        : node.type === "counter"
        ? "Counter"
        : node.type === "ops"
        ? "Ops"
        : "Unknown";

    let text = `${indent}${typeLabel}: ${node.name}\n`;

    node.children?.forEach((child) => {
      text += renderTreeText(child, level + 1);
    });

    return text;
  };

  // === вспомогательная функция: обновить узел в JSON-дереве ===
  const updateNodeInTree = (tree, idToUpdate, newName, newType) => {
  if (!tree) return null;

  // если это нужный узел — возвращаем обновлённый
  if (tree.id === idToUpdate) {
    return {
      ...tree,
      name: newName,
      type: newType,
    };
  }

  // иначе идём вглубь
  return {
    ...tree,
    children:
      tree.children?.map((child) =>
        updateNodeInTree(child, idToUpdate, newName, newType)
      ) || [],
  };
  };

  // === вспомогательная функция: добавить узел в JSON-дерево ===
  const addNodeToTree = (tree, parentId, newNode) => {
    if (!tree) return tree;

    // если это тот самый родитель
    if (tree.id === parentId) {
      return {
        ...tree,
        children: [...(tree.children || []), newNode],
      };
    }

    // иначе рекурсивно обходим детей
    return {
      ...tree,
      children:
        tree.children?.map((child) =>
          addNodeToTree(child, parentId, newNode)
        ) || [],
    };
  };

  // === вспомогательная функция: удалить узел из JSON-дерева ===
  const removeNodeFromTree = (tree, idToRemove) => {
  if (!tree) return null;
  // если это сам удаляемый узел — возвращаем null,
  // родитель потом отфильтрует
  if (tree.id === idToRemove) {
    return null;
  }

  const newChildren =
    tree.children
      ?.map((child) => removeNodeFromTree(child, idToRemove))
      .filter(Boolean) || [];

  return {
    ...tree,
    children: newChildren,
  };
  };

  // === построение графа ===
  const buildGraph = useCallback((tree) => {
    if (!tree) return { nodes: [], edges: [] };
    const color =
      tree.type === "business"
        ? "#4da3ff"
        : tree.type === "product"
        ? "#22c55e"
        : tree.type === "proxy"
        ? "#9ca3af"
        : tree.type === "counter"
        ? "#f87171"
        : "#fbbf24";

    const nodes = [
      {
        id: tree.id,
        data: { label: tree.name },
        position: { x: 0, y: 0 },
        type: tree.type,
        draggable: true,
        style: {
          background: color,
          borderRadius: 14,
          padding: 12,
          fontSize: 17,
          fontWeight: 500,
          color: "#1c1c1e",
          border: "1px solid #ccc",
          cursor: "grab",
          textAlign: "center",
          boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
          transition: "all 0.25s ease",

          // ✅ добавь это
          width: nodeWidth,
          height: nodeHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "normal",
          wordBreak: "break-word",
          lineHeight: 1.2,  
        },
      },
    ];

    const edges = [];
    tree.children?.forEach((child) => {
      edges.push({ id: `${tree.id}-${child.id}`, source: tree.id, target: child.id });
      const { nodes: cNodes, edges: cEdges } = buildGraph(child);
      nodes.push(...cNodes);
      edges.push(...cEdges);
    });
    return { nodes, edges };
  }, []);

  // === генерация дерева ===
  const handleGenerate = async (e) => {
  e.preventDefault();
  if (!description.trim()) return;

  let generationId = null;

if (session?.user?.id) {
  try {
    const res = await fetch("/api/generate/start", {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 429) {
        setError("Лимит генераций исчерпан.");
      } else {
        setError("Не удалось начать генерацию.");
      }
      return;
    }

    generationId = data.generationId;
    generationIdRef.current = generationId;
    await fetchServerQuota();
  } catch (err) {
    console.error("Generate start error:", err);
    setError("Не удалось начать генерацию.");
    return;
  }
}


  // Для гостя — 1 бесплатная генерация дерева.
  // Для авторизованного пользователя гостевой лимит не применяется.
  if (!session?.user?.id) {
  const quota = checkLocalQuota("generate_tree", 1);

  if (!quota.ok) {
  setAuthModalReason("generation_limit");
  setAuthModalOpen(true);
  return;
  }

  refreshQuotaView();
  } 


  setLoading(true);
  setSelectedMetric(null);
  setActiveProjectId(null);
  setSaveStatus("idle");
  setInsight("");
  setError("");
  setQuestionsError("");
  try {

        // ✅ НОВОЕ: GPT-4.1 — сразу генерим, без уточняющих вопросов
    if (model === "gpt-4.1") {
      const briefRes = await normalizeProductBrief(
      { productDescription: description, answers: {} },
      model,
      { generationId }
      );
      const b = briefRes.brief;
      setBrief(b);

      const treeRes = await generateMetricTree(
      b,
      model,
      { generationId }
      );

      ymEvent("generate_tree");

      const treeJson = treeRes.tree;

      setBriefMeta({
        missingInfo: treeRes.meta?.missingInfo || [],
        assumptions: treeRes.meta?.assumptions || [],
      });

      const { nodes, edges } = buildGraph(treeJson);
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(nodes, edges, "TB");

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setTreeData(treeJson);
      
      return; // важно
    }

    // 1) Сначала попросим GPT сгенерировать уточняющие вопросы
    setQuestionsLoading(true);
    const qRes = await generateClarifyingQuestions(
    description,
    model,
    { generationId }
    );
    const q = qRes?.questions?.questions || qRes?.questions || [];
    const list = Array.isArray(q) ? q : [];
    setQuestionsList(list);

    // Если вопросов нет — идём сразу в генерацию (значит описания достаточно)
    if (list.length === 0) {
      const briefRes = await normalizeProductBrief({
        productDescription: description,
        answers: {},
      }, model);

      const b = briefRes.brief;
      setBrief(b);

      const treeRes = await generateMetricTree(
      b,
      model,
      { generationId }
      );

      ymEvent("generate_tree");
      const treeJson = treeRes.tree;

      setBriefMeta({
        missingInfo: treeRes.meta?.missingInfo || [],
        assumptions: treeRes.meta?.assumptions || [],
      });

      const { nodes, edges } = buildGraph(treeJson);
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(nodes, edges, "TB");

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setTreeData(treeJson);
      
      return;
    }
    // 2) Есть вопросы → откроем модалку и остановимся.
    // Ответы соберём в модалке, а финальная генерация будет по кнопке "Продолжить"
    setAnswers({});
    setShowQuestionsModal(true);
    ymEvent("questions_open");
  } catch (err) {
    console.error(err);
    setError(err.message || "Ошибка при подготовке вопросов/генерации");
  } finally {
    setQuestionsLoading(false);
    setLoading(false);
  }
  };

  const handleConfirmQuestions = async () => {
  // ✅ старт новой “сессии” генерации, которую можно отменить
  const controller = new AbortController();
  generateAbortRef.current = controller;
  setActiveProjectId(null);
  setSaveStatus("idle");
  setLoading(true);
  setError("");
  setQuestionsError("");

  try {
    // 1) Нормализуем brief из текста + ответов
    // ВАЖНО: normalizeProductBrief должен уметь прокидывать signal в fetch
    console.log("GPT step 1: normalizeProductBrief", {
  model,
  descriptionLength: description.length,
  answers,
});

let briefRes;

try {
  briefRes = await normalizeProductBrief(
    { productDescription: description, answers },
    model,
    {
    signal: controller.signal,
    generationId: generationIdRef.current,
    }
  );
} catch (err) {
  console.error("Ошибка на шаге normalizeProductBrief:", err);

  throw new Error(
    `Ошибка нормализации Product Brief: ${
      err?.message || String(err)
    }`
  );
}

const b = briefRes.brief;
setBrief(b);

console.log("GPT step 2: generateMetricTree", {
  model,
  brief: b,
});

let treeRes;

try {
  treeRes = await generateMetricTree(
  b,
  model,
  {
    signal: controller.signal,
    generationId: generationIdRef.current,
  }
);
} catch (err) {
  console.error("Ошибка на шаге generateMetricTree:", err);

  throw new Error(
    `Ошибка генерации дерева: ${
      err?.message || String(err)
    }`
  );
}

    // если отменили — просто выходим (на всякий случай)
    if (controller.signal.aborted) return;

    ymEvent("generate_tree");

    const treeJson = treeRes.tree;

    console.log("RAW TREE JSON:", JSON.stringify(treeJson, null, 2));

    setBriefMeta({
      missingInfo: treeRes.meta?.missingInfo || [],
      assumptions: treeRes.meta?.assumptions || [],
    });

    // 3) Строим граф + лейаут
    const { nodes, edges } = buildGraph(treeJson);
    const { nodes: layoutedNodes, edges: layoutedEdges } =
      getLayoutedElements(nodes, edges, "TB");

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setTreeData(treeJson);
    
    // 4) закрываем модалку
    setShowQuestionsModal(false);
  } catch (err) {
    // ✅ корректно обрабатываем отмену
    if (err?.name === "AbortError") return;

    console.error(err);
    setQuestionsError(err?.message || "Ошибка при генерации после уточнения 😢");
  } finally {
    // чистим ref, чтобы не было “старой” отмены
    if (generateAbortRef.current === controller) {
      generateAbortRef.current = null;
    }
    setLoading(false);
  }
  };

  const handleNodeClick = (_, node) => {
    setSelectedMetric(node);
    setInsight("");
  };

  // === добавление метрики ===
  const handleAddMetric = async () => {
    if (!selectedMetric) return;

    if (!session?.user?.id) {
    setAuthModalReason("default");
    setAuthModalOpen(true);
    return;
    }

    try {
    const hasQuota = await checkServerQuota("suggestion");

    if (!hasQuota) {
    alert("Лимит подсказок метрик исчерпан.");
    return;
    }
    } catch (err) {
    console.error("Suggestion quota check error:", err);
    alert("Не удалось проверить лимит подсказок.");
    return;
    }

    setShowAddModal(true);
    setMetricSuggestions([]);
    setLoadingSuggestions(true);

    try {
      const result = await suggestMetricNames(
        {
          productDescription: JSON.stringify(brief || { raw: description }, null, 2),
          parentMetric: selectedMetric.data.label,
        },
        model
      );

      setMetricSuggestions(result.suggestions);

      // === событие метрики ===
      ymEvent("suggestion");



    } catch (err) {
      console.warn("Не удалось получить подсказки:", err);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleDownloadSvg = async () => {
  try {
    if (!nodes?.length) throw new Error("Нет узлов для экспорта");

    const exportNodes = nodes.filter((n) => !n.hidden);

    const pad = 120;

    // bounds по нодам
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    exportNodes.forEach((n) => {
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + nodeWidth);
      maxY = Math.max(maxY, y + nodeHeight);
    });

    if (!isFinite(minX)) throw new Error("Не удалось посчитать bounds");

    const width = Math.ceil(maxX - minX + pad * 2);
    const height = Math.ceil(maxY - minY + pad * 2);
    const offsetX = -minX + pad;
    const offsetY = -minY + pad;
    const nodeById = new Map(exportNodes.map((n) => [n.id, n]));
    // Цвета карточек как в MetricTree
    const fillByType = (t) =>
      t === "business"
        ? "#e8f2ff"
        : t === "product"
        ? "#e8ffe8"
        : t === "proxy"
        ? "#f2f2f2"
        : t === "counter"
        ? "#ffe8e8"
        : t === "ops"
        ? "#fff7e5"
        : "#ffffff";

    const escapeXml = (s) =>
      String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");

    const wrapText = (text, maxChars = 22, maxLines = 4) => {
      const words = String(text || "").split(/\s+/).filter(Boolean);
      const lines = [];
      let line = "";

      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (next.length <= maxChars) {
          line = next;
        } else {
          if (line) lines.push(line);
          line = w;
          if (lines.length >= maxLines) break;
        }
      }
      if (lines.length < maxLines && line) lines.push(line);

      if (lines.length === maxLines && words.length) {
        const last = lines[lines.length - 1];
        if (last.length >= maxChars) {
          lines[lines.length - 1] = last.slice(0, maxChars - 1) + "…";
        }
      }
      return lines;
    };

    // линии как в ReactFlow (тонкие серые)
    const edgeSvg = edges
      .map((e) => {
        const src = nodeById.get(e.source);
        const tgt = nodeById.get(e.target);
        if (!src || !tgt) return "";

        const x1 = (src.position?.x ?? 0) + nodeWidth / 2 + offsetX;
        const y1 = (src.position?.y ?? 0) + nodeHeight / 2 + offsetY;
        const x2 = (tgt.position?.x ?? 0) + nodeWidth / 2 + offsetX;
        const y2 = (tgt.position?.y ?? 0) + nodeHeight / 2 + offsetY;

        const dx = Math.abs(x2 - x1);
        const bend = Math.max(40, dx * 0.15);

        return `<path d="M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${
          y2 - bend
        }, ${x2} ${y2}" />`;
      })
      .join("\n");

    const nodeSvg = exportNodes
      .map((n) => {
        const x = (n.position?.x ?? 0) + offsetX;
        const y = (n.position?.y ?? 0) + offsetY;

        const fill = fillByType(n.type);
        const label = n.data?.label ?? n.data?.name ?? n.id;

        const lines = wrapText(label, 22, 4);
        const lineHeight = 16;
        const startY =
          y + nodeHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

        const text = lines
          .map(
            (ln, i) =>
              `<text x="${x + nodeWidth / 2}" y="${
                startY + i * lineHeight
              }" text-anchor="middle" dominant-baseline="middle" fill="#000">
                ${escapeXml(ln)}
              </text>`
          )
          .join("\n");

        return `
  <g>
    <rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="14" ry="14"
      fill="${fill}" stroke="#ddd" stroke-width="1" />
    ${text}
  </g>`;
      })
      .join("\n");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
${edgeSvg}
  </g>
  <g font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="14">
${nodeSvg}
  </g>
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "metrictree.svg";
    a.click();
    URL.revokeObjectURL(url);

    ymEvent("export_svg");
    openNextStepsModal("export_svg");
  } catch (e) {
    console.error(e);
    alert(e?.message || "Не удалось скачать SVG 😢");
  }
};

const handleExportToMiro = async () => {
  try {
    if (!treeData || !nodes?.length) {
      alert("Сначала сгенерируйте дерево");
      return;
    }

    // UI: включаем оверлей
    setMiroExporting(true);
    setMiroExportStatus("Подготовка выгрузки…");
    setMiroExportProgress(10);

    const boardId = prompt(
      "Вставь Miro boardId (значение из URL доски между двумя знаками '/' в конце), "
    );
    if (!boardId) {
      // пользователь отменил — аккуратно закрываем
      setMiroExporting(false);
      setMiroExportStatus("");
      setMiroExportProgress(0);
      return;
    }

    setMiroExportStatus("Отправляю данные в Miro…");
    setMiroExportProgress(35);

    const r = await fetch("/api/miro/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boardId,
        nodes,
        edges,
        options: { nodeWidth, nodeHeight, padding: 300 },
      }),
    });

    const data = await r.json().catch(() => ({}));

    // ✅ НОВОЕ: если не подключены — уводим на OAuth
    if (r.status === 401 && data?.action === "redirect" && data?.redirectUrl) {
      setMiroExportStatus("Нужно подключить Miro — перенаправляю…");
      setMiroExportProgress(20);
      window.location.href = data.redirectUrl; // /api/miro/oauth/start
      return; // важно: дальше не продолжаем
    }

    // теперь можно обновлять статус "создаю элементы"
    setMiroExportStatus("Создаю элементы на доске…");
    setMiroExportProgress(70);

    if (!r.ok) {
      console.error("Miro export error:", data);
      alert("Ошибка экспорта в Miro: " + (data?.error || "unknown"));
      return;
    }

    setMiroExportStatus("Готово! Завершаю…");
    setMiroExportProgress(95);

    ymEvent("export_miro");
    openNextStepsModal("export_miro");

  } catch (e) {
    console.error(e);
    alert("Не удалось экспортировать в Miro 😢");
  } finally {
    // UI: выключаем оверлей
    setMiroExportProgress(100);
    setTimeout(() => {
      setMiroExporting(false);
      setMiroExportStatus("");
      setMiroExportProgress(0);
    }, 250);
  }
};

  const handleConfirmAddMetric = () => {
    if (!selectedMetric || !newMetricName.trim()) return;
    const newId = nanoid(6);
    const color =
      newMetricType === "business"
        ? "#4da3ff"
        : newMetricType === "product"
        ? "#22c55e"
        : newMetricType === "proxy"
        ? "#9ca3af"
        : newMetricType === "counter"
        ? "#f87171"
        : "#fbbf24";

    const newNode = {
      id: newId,
      data: { label: newMetricName },
      position: {
        x: selectedMetric.position.x + Math.random() * 150 - 75,
        y: selectedMetric.position.y + 150,
      },
      type: newMetricType,
      draggable: true,
      style: {
        background: color,
        borderRadius: 12,
        padding: 10,
        border: "1px solid #ccc",
        textAlign: "center",
        cursor: "grab",
        fontSize: 17,
        fontWeight: 500,
        color: "#1c1c1e",

        // ✅ добавь это
        width: nodeWidth,
        height: nodeHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "normal",
        wordBreak: "break-word",
        lineHeight: 1.2,  
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => [
      ...eds,
      { id: `${selectedMetric.id}-${newId}`, source: selectedMetric.id, target: newId },
    ]);

    // 🔹 обновляем JSON-дерево, чтобы текстовое + мобильное дерево тоже видели новую метрику
    if (treeData) {
      const updatedTree = addNodeToTree(treeData, selectedMetric.id, {
        id: newId,
        name: newMetricName,
        type: newMetricType,
        children: [],
      });
      setTreeData(updatedTree);
    }

    // === событие Яндекса ===
    ymEvent("add_metric");
    setShowAddModal(false);
    setNewMetricName("");
    setNewMetricType("proxy");
  };

  // === редактирование ===
  const handleConfirmEditMetric = () => {
  if (!selectedMetric || !editMetricName.trim()) return;

  // === 1. Обновляем ReactFlow (десктоп)
  setNodes((nds) =>
    nds.map((n) =>
      n.id === selectedMetric.id
        ? {
            ...n,
            data: { ...n.data, label: editMetricName },
            type: editMetricType,
            style: {
              ...n.style,
              background:
                editMetricType === "business"
                  ? "#4da3ff"
                  : editMetricType === "product"
                  ? "#22c55e"
                  : editMetricType === "proxy"
                  ? "#9ca3af"
                  : editMetricType === "counter"
                  ? "#f87171"
                  : "#fbbf24",
            },
          }
        : n
    )
  );

  // === 2. Обновляем правую панель
  setSelectedMetric((prev) =>
    prev ? { ...prev, data: { label: editMetricName }, type: editMetricType } : prev
  );

  // === 3. ОБНОВЛЯЕМ JSON-дерево (мобильная версия)
  if (treeData) {
    const updatedTree = updateNodeInTree(
      treeData,
      selectedMetric.id,
      editMetricName,
      editMetricType
    );
    setTreeData(updatedTree);
  }

  setShowEditModal(false);
  };

  const handleDeleteMetric = (metricId) => {
  const id = metricId || (selectedMetric && selectedMetric.id);
  if (!id) return;

  setNodes((nds) => nds.filter((n) => n.id !== id));
  setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  setSelectedMetric((prev) => (prev && prev.id === id ? null : prev));

  // обновляем JSON-дерево, чтобы текстовое и мобильное дерево тоже обновились
  if (treeData) {
    const updatedTree = removeNodeFromTree(treeData, id);
    setTreeData(updatedTree);
  }
  };


// === Приведение узлов к единому формату для AI ===
function normalizeNode(n) {
  if (!n) return null;
  return {
    id: n.id,
    name: n.data?.label || n.name,
    type: n.type || "proxy",
  };
}


// === Нормализация ответа GPT (эксперименты, инсайты и т.д.) ===
function extractJsonObject(any) {
  // 1) если уже объект
  if (any && typeof any === "object") {
    if (any.hypothesis || any.variant) return any;
    if (any.experiment && typeof any.experiment === "object") return any.experiment;
    if (any.result && typeof any.result === "object") return any.result;
    if (any.data && typeof any.data === "object") return any.data;
    if (any.output && typeof any.output === "object") return any.output;
    if (typeof any.content === "string") return extractJsonObject(any.content);
    return any;
  }

  // 2) если строка
  if (typeof any === "string") {
    const text = any.trim();

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return extractJsonObject(parsed);
    } catch (e) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          const slice = cleaned.slice(start, end + 1);
          const parsed = JSON.parse(slice);
          return extractJsonObject(parsed);
        } catch (e2) {
          return { error: "Не удалось распарсить JSON", raw: any };
        }
      }
      return { error: "Ответ не JSON", raw: any };
    }
  }

  return { error: "Пустой ответ", raw: any };
}


const pickMetricForInsight = () => {
  if (selectedMetric) return selectedMetric;

  const productMetric = nodes.find((n) => n.type === "product");
  if (productMetric) return productMetric;

  const businessMetric = nodes.find((n) => n.type === "business");
  if (businessMetric) return businessMetric;

  return nodes[0] || null;
};


 // === AI инсайт ===
const handleGetInsight = async (metricArg) => {
  // нормализуем вход
  const rfMetric = metricArg
    ? nodes.find(n => n.id === metricArg.id)
    : selectedMetric;
  if (!rfMetric) return;

  if (!session?.user?.id) {
  setAuthModalReason("default");
  setAuthModalOpen(true);
  return;
  }

  const metric = rfMetric; 
  setSelectedMetric(metric);

  try {
  const hasQuota = await checkServerQuota("insight");

  if (!hasQuota) {
    alert("Лимит разборов метрик исчерпан.");
    return;
  }
  } catch (err) {
  console.error("Insight quota check error:", err);
  alert("Не удалось проверить лимит разборов метрик.");
  return;
  }

  if (isMobile) {
    setInsightPending(true);
    setModalInsight("Анализирую метрики…");
    setShowInsightModal(true);
  }

  setInsightLoading(true);

  try {
    const parentEdge = edges.find(e => e.target === metric.id);
    const parent = parentEdge
      ? nodes.find(n => n.id === parentEdge.source)
      : null;

    const childrenEdges = edges.filter(e => e.source === metric.id);
    const children = nodes.filter(n =>
      childrenEdges.some(e => e.target === n.id)
    );

    // подсветка
    const idsToHighlight = [
      parent?.id,
      metric.id,
      ...children.map(c => c.id),
    ].filter(Boolean);

    setHighlightedNodes(idsToHighlight);

    const result = await generateMetricInsight(
      {
        productDescription: JSON.stringify(brief || { raw: description }, null, 2),
        metric: normalizeNode(metric),
        parent: normalizeNode(parent),
        children: children.map(normalizeNode),
      },
      model
    );

    if (!isMobile) setShowInsightModal(true);

    setModalInsight(result.insight);
    setInsightPending(false);

    ymEvent("insight");
    // запоминаем, что после инсайта нужно показать форму
    setPendingFeedbackSource("insight");

  } catch (err) {
    setModalInsight("Ошибка 😢\n" + (err?.message || String(err)));
    console.error(err);
    if (!isMobile) setShowInsightModal(true);
    setModalInsight("Ошибка при получении инсайта 😢");
    setInsightPending(false);
  } finally {
    setInsightLoading(false);
    setTimeout(() => setHighlightedNodes([]), 3000);
  }
};

// === Мобильное дерево (с кнопкой сворачивания слева) ===
const renderMobileTree = (node, level = 0) => {
  if (!node) return null;

  const indent = Math.min(20 * Math.log(level + 1), 52);

  const typeLabel =
    node.type === "business"
      ? "Business"
      : node.type === "product"
      ? "Product"
      : node.type === "proxy"
      ? "Proxy"
      : node.type === "counter"
      ? "Counter"
      : node.type === "ops"
      ? "Ops"
      : "Unknown";

  const isCollapsed = collapsedNodes[node.id];
  const hasChildren = Array.isArray(node.children) && node.children.length > 0; // ✅ добавили
  const isTop = priorTopIds.includes(node.id);
  const isAvoid = priorAvoidIds.includes(node.id);
  const isHL = highlightedNodes.includes(node.id);

  return (
    <div
      key={node.id}
      className="relative mb-2"
      style={{ marginLeft: indent }}
      onClick={() => {
        const m = nodes.find((n) => n.id === node.id);
        setSelectedMetric(m);
      }}
    >

      {/* Карточка */}
      <div
  className="border rounded-xl p-3 shadow-sm flex justify-between items-start"
  style={{
    background:
      node.type === "business"
        ? "#e8f2ff"
        : node.type === "product"
        ? "#e8ffe8"
        : node.type === "proxy"
        ? "#f2f2f2"
        : node.type === "counter"
        ? "#ffe8e8"
        : node.type === "ops"
        ? "#fff7e5"
        : "white",

    borderColor: isTop || isHL ? "#34d399" : isAvoid ? "#9ca3af" : "#ddd",
    borderWidth: isTop ? 3 : isHL ? 2 : 1,
    borderStyle: isAvoid ? "dashed" : "solid",
    opacity: isAvoid ? 0.55 : 1,
    boxShadow: isTop
      ? "0 0 10px rgba(52,211,153,0.35)"
      : isHL
      ? "0 0 8px rgba(52,211,153,0.25)"
      : "0 1px 2px rgba(0,0,0,0.06)",
  }}
>

        <div className="flex-1">

          {/* Тип + кнопка слева */}
          <div className="flex items-center gap-2 mb-1">

            {/* ▼/▶ — только если есть дети */}
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(node.id);
                }}
                className="text-gray-600 text-xs px-1 py-0.5 rounded hover:bg-gray-200"
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            )}

            {/* Type */}
            <p
              className="text-xs font-medium"
              style={{
                color:
                  node.type === "business"
                    ? "#1e3a8a"
                    : node.type === "product"
                    ? "#166534"
                    : node.type === "proxy"
                    ? "#374151"
                    : node.type === "counter"
                    ? "#b91c1c"
                    : node.type === "ops"
                    ? "#b45309"
                    : "#555",
              }}
            >
              {typeLabel}
            </p>
          </div>

          {/* Название */}
          <p className="font-semibold leading-snug pr-4">{node.name}</p>
        </div>

        {/* Кнопка ⋮ */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMobileMenuFor((prev) => (prev === node.id ? null : node.id));
          }}
          className="text-gray-500 px-2 py-1 text-lg leading-none"
        >
          ⋮
        </button>
      </div>

      {/* Меню */}
      {mobileMenuFor === node.id && (
        <div className="absolute top-12 right-2 bg-white border shadow-lg rounded-xl p-2 z-50 w-44">

          <button
            onClick={(e) => {
              e.stopPropagation();
              const m = nodes.find((n) => n.id === node.id);
              setSelectedMetric(m);
              setMobileMenuFor(null);
              handleAddMetric();
            }}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-lg"
          >
            ➕ Добавить метрику
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              const rfNode = nodes.find((n) => n.id === node.id);
              setSelectedMetric(rfNode);
              setMobileMenuFor(null);
              handleGetInsight(rfNode);
            }}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-lg"
          >
            💡 Как улучшить
          </button>

           <button
            onClick={handleGenerateExperiment}
            disabled={!selectedMetric || experimentLoading}
            className="bg-blue-50 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100 transition"
            >
            🧪 Эксперимент
            </button> 
  
          <button
            onClick={(e) => {
              e.stopPropagation();
              const m = nodes.find((n) => n.id === node.id);
              setEditMetricName(m.data.label);
              setEditMetricType(m.type);
              setSelectedMetric(m);
              setShowEditModal(true);
              setMobileMenuFor(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-lg"
          >
            ✏️ Редактировать
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteMetric(node.id);
              setMobileMenuFor(null);
            }}
            className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-100 rounded-lg"
          >
            🗑 Удалить
          </button>

        </div>
      )}

      {/* Дети — показываются только если не свернуто */}
      {!isCollapsed &&
        node.children?.map((child) => renderMobileTree(child, level + 1))}
    </div>
  );
};

  // === UI ===

  const nextStepsCopy = {
  export_svg: {
    title: "✅ SVG готов",
    subtitle:
      "Дерево скачано как SVG. Его можно вставить в Figma, Miro, презентацию или документацию.",
  },
  export_csv: {
    title: "✅ CSV готов",
    subtitle:
      "CSV скачан. Его можно использовать для таблиц, импорта или дальнейшей обработки дерева.",
  },
  export_miro: {
    title: "✅ Дерево выгружено в Miro",
    subtitle:
      "Дерево уже на доске. Теперь можно перейти от схемы к анализу и действиям.",
  },
};

const currentNextStepsCopy =
  nextStepsCopy[nextStepsSource] || {
    title: "✅ Дерево готово",
    subtitle:
      "Экспорт выполнен. Теперь можно извлечь из дерева больше пользы.",
  };

  return (
    <div className="h-screen flex font-sans bg-[#f5f6fa] text-[#1c1c1e]">
      <div className="flex-1 flex flex-col">
        {/* === Шапка === */}
          <header
          className={`bg-white shadow-sm p-4 flex gap-6 items-start border-b border-gray-100 ${
          (isMobile || isFullscreen) ? "hidden" : ""
          }`}
          >
          <div className="flex flex-col justify-center min-w-[180px]">
          <div className="flex flex-col items-start justify-center min-w-[180px]">
          <img
          src="/metrictree-logo.png"
          alt="MetricTree"
          className="h-12 object-contain mb-1"
          />

          <p className="text-sm text-gray-500">
          Автор: Владимир Павлов
          </p>
          </div>

          <div className="mt-1">
  {/* Социальные ссылки */}
  <div className="flex items-center gap-2">
    <a
      href="https://www.linkedin.com/in/vladimir-pavlov-36995369/"
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-blue-600 hover:underline"
    >
      LinkedIn
    </a>

          <span className="text-sm text-gray-400">·</span>

          <a
          href="https://t.me/v_v_pavloff"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline"
          >
          Telegram
          </a>
          </div>

          {/* SEO-страница */}
          <div className="mt-1">
          <a
          href="/derevo-metrik/"
          className="text-sm text-blue-600 hover:underline"
          >
          Как построить дерево метрик
          </a>
          </div>
          </div>
          </div>

          <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900 mb-2">
          AI-генератор дерева метрик продукта
          </h1>

          <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Опиши продукт..."
          className="w-full border border-gray-200 rounded-xl p-3 h-24 focus:ring-2 focus:ring-[#ffdd2d] outline-none resize-none text-base"
          />
          </div>

          {error && (
          <div className="mt-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
          </div>
          )}
  

          <div className="flex flex-col gap-2 self-start">
          <select
          value={model}
           onChange={(e) => {
          setModel(e.target.value);
           ymEvent("model_change");
           }}
            className="border border-gray-200 rounded-xl p-2 text-sm bg-white focus:ring-2 focus:ring-[#ffdd2d] outline-none"
            >
            
            <option value="gpt-4.1">GPT-4.1 (стандартная)</option>
            <option value="gpt-5.5">GPT-5.5 (экспертная)</option>
            <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
            <option value="gigachat-3.5">GigaChat 3.5 (российская)</option>
            <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>

            </select>

            <button
             onClick={handleGenerate}
             disabled={loading}
             className="bg-[#ffdd2d] text-black px-5 py-2 rounded-xl hover:brightness-95 disabled:opacity-50 font-medium transition whitespace-nowrap"
            >
           {loading ? "Генерация..." : "Сгенерировать"}
           </button>
          </div>

        </header>

        {/* === Мобильная панель ввода === */}
        {isMobile && (
        <div className="bg-white p-4 border-b border-gray-200 shadow-sm sticky top-0 z-40">

        <div className="text-base font-semibold text-gray-900 mb-2">
        AI-генератор дерева метрик продукта
        </div>    

        <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs text-gray-600 truncate">
        {session?.user?.email || "Гостевой режим"}
        </span>

        {session?.user?.id ? (
        <button
        type="button"
        onClick={async () => {
        try {
        const res = await fetch("/api/auth/logout", {
          method: "POST",
        });

        if (!res.ok) {
          throw new Error("Не удалось выйти из аккаунта");
        }

        setSession(null);
        } catch (e) {
        console.error("Logout error:", e);
        alert("Не удалось выйти из аккаунта. Попробуйте ещё раз.");
        }
        }}
        className="shrink-0 bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm"
        >
        Выйти
        </button>
        ) : (
        <button
        type="button"
        onClick={() => setAuthModalOpen(true)}
        className="shrink-0 bg-[#ffdd2d] text-black px-3 py-2 rounded-lg text-sm font-medium"
        >
        Войти / Регистрация
        </button>
        )}

        </div>    
        {session?.user?.id && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="text-sm font-semibold text-gray-900 mb-2">
        Осталось операций
        </div>

        <div className="space-y-1">
        <QuotaLine label="Генерация дерева" info={quotaView.generate} />
        <QuotaLine label="Инсайты" info={quotaView.insight} />
        <QuotaLine label="Подсказки названий" info={quotaView.suggestion} />
        <QuotaLine label="Приоритизация" info={quotaView.prioritization} />
        <QuotaLine label="A/B-эксперименты" info={quotaView.experiment} />
        </div>
        </div>
        )}  

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Опиши продукт..."
          className="w-full border border-gray-200 rounded-xl p-3 h-24 mb-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none resize-none text-base"
        />

          <select
  value={model}
  onChange={(e) => {
    setModel(e.target.value);
    ymEvent("model_change");
  }}
  className="w-full border border-gray-200 rounded-xl p-2 mb-3 text-sm bg-white focus:ring-2 focus:ring-[#ffdd2d]"
>
<option value="gpt-4.1">GPT-4.1 (стандартная)</option>
<option value="gpt-5.5">GPT-5.5 (экспертная)</option>
<option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
<option value="gigachat-3.5">GigaChat 3.5 (российская)</option>
<option value="deepseek-v4-pro">DeepSeek V4 Pro</option>

</select>

<div className="flex flex-col gap-2">
  {/* 1-я строка — главное действие */}
  <button
    onClick={handleGenerate}
    disabled={loading}
    className="w-full bg-[#ffdd2d] text-black px-5 py-3 rounded-xl hover:brightness-95 disabled:opacity-50 font-medium transition text-base"
  >
    {loading ? "Генерация..." : "Сгенерировать дерево"}
  </button>

  {/* 2-я строка — вторичные действия */}
  <div className="flex gap-2">
    <button
      onClick={() => {
        setShowBenefitsModal(true);
        ymEvent("benefits_open");
      }}
      className="bg-blue-50 text-blue-700 px-3 py-3 rounded-xl hover:bg-blue-100 font-medium transition text-sm"
    >
      Как это работает
    </button>

    <button
      onClick={handleOpenPrioritization}
      disabled={!treeData || priorLoading}
      className="w-1/2 bg-green-50 text-green-700 px-3 py-3 rounded-xl hover:bg-green-100 disabled:opacity-50 font-medium transition text-sm"
    >
      {priorLoading ? "..." : "Приоритизировать"}
    </button>
  </div>
</div>
        </div>
        )}

        {/* === Мобильные лимиты === */}
        {isMobile && !session?.user?.id && (
        <div className="px-4 py-2 bg-[#fafafa] border-b border-gray-200 text-xs text-gray-600">
        Бесплатная генерация:{" "}
        {getQuotaInfo("generate_tree", 1).left}/1
        </div>
        )}

        {/* === вкладки === */}
        <div className={`flex flex-col flex-1 bg-[#f5f6fa] ${isMobile ? "pt-0" : ""}`}>
          {!isMobile  && !isFullscreen && (
          <div className="flex border-b border-gray-200 bg-white">
        
              {!isMobile && (
              <button
               onClick={() => setActiveTab("text")}
               className={`px-4 py-2 font-medium ${
               activeTab === "text"
                ? "border-b-2 border-[#ffdd2d] text-black"
               : "text-gray-500 hover:text-black"
                }`}
               >
              Текстовое дерево
            </button>
              )}

            {!isMobile && (
              <button
                  onClick={() => setActiveTab("visual")}
                  className={`px-4 py-2 font-medium ${
                  activeTab === "visual"
                  ? "border-b-2 border-[#ffdd2d] text-black"
                  : "text-gray-500 hover:text-black"
              }`}
              >
              Визуализация
            </button>
            )}

            {!isMobile && (
            <button
            onClick={() => setActiveTab("insight")}
            className={`
            px-4 py-2 font-medium flex items-center gap-2 relative
            ${
            activeTab === "insight"
            ? "border-b-2 border-[#ffdd2d] text-black"
            : "text-yellow-700 hover:text-black"
            }
            ${
            pulseInsightTab && activeTab !== "insight"
            ? "animate-[pulseTab_2s_ease-in-out_infinite]"
            : ""
            }
            `}
            >     
            <span className="text-lg">💡</span>
            Разбор метрики

            <span className="
            ml-1 text-[10px] px-2 py-[2px] rounded-full
            bg-[#ffdd2d] text-black font-semibold
            ">
            AI
            </span>
            </button>
            )}

            {isMobile && (
            <button
             onClick={() => setActiveTab("mobile")}
             className={`px-4 py-2 font-medium ${
              activeTab === "mobile"
                ? "border-b-2 border-[#ffdd2d] text-black"
               : "text-gray-500 hover:text-black"
               }`}
              >
                Мобильное дерево
            </button>
              )}
          </div>
          )}

          {activeTab === "text" && treeData && (
          isMobile ? (
          <div className="m-2 p-3 bg-white rounded-xl border border-gray-200 shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
          {renderTreeText(treeData)}
          </div>
          ) : (
          <div className="m-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm font-mono text-base whitespace-pre overflow-auto flex-1">
          {renderTreeText(treeData)}
          </div>
          )
          )}


          {activeTab === "visual" && !isMobile && (
          <main
          className={`bg-white ${isFullscreen ? "fixed inset-0 z-[9999]" : "flex-1"}`}
          >
          <div ref={reactFlowWrapperRef} className="w-full h-full relative">
          {/* сюда пойдёт кнопка */}
          {isFullscreen && (
          <button
          onClick={() => setIsFullscreen(false)}
          className="
          absolute top-4 right-4 z-[10000]
          bg-black text-white px-4 py-2 rounded-xl
          shadow-lg hover:bg-gray-800
          "
          >
          ✕ Выйти
          </button>
          )}
          
          
          <ReactFlow
          nodes={visibleNodes}
          nodeTypes={nodeTypes}
          edges={visibleEdges}
          onNodeClick={handleNodeClick}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(params) => setEdges((eds) => addEdge(params, eds))}
          fitView
          >
          <MiniMap />
          <Background />
          <Controls />
          </ReactFlow>
          </div>
          </main>
          )}

          {activeTab === "insight" && !isMobile && (
          <div className="m-4 p-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-auto flex-1">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
          💡 Как улучшать метрики
          </h2>

          <p className="text-gray-700 mb-4">
          Быстрый разбор метрики: что она означает, как влияет на цель,
          какие есть точки роста и какие риски важно контролировать.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">Как пользоваться</div>
          <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1">
          <li>Сгенерируй дерево метрик.</li>
          <li>Кликни на метрику в графе.</li>
          <li>Нажми кнопку <b>«Как улучшить эту метрику?»</b>.</li>
          <li>Выбери идеи и переходи к экспериментам.</li>
          </ol>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">Что ты получишь</div>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>понятное определение метрики</li>
          <li>почему она важна для продукта</li>
          <li>связь с родителем и детьми (причины → эффекты)</li>
          <li>идеи улучшений и гипотез</li>
          <li>риски и контр-метрики</li>
          </ul>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">Когда особенно полезно</div>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>в начале — чтобы быстро структурировать метрики</li>
          <li>перед планированием — чтобы найти точки роста</li>
          <li>при обсуждении в команде — чтобы синхронизировать понимание</li>
          <li>для подготовки экспериментов</li>
          </ul>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">Как читать разбор</div>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li><b>Родитель</b> — зачем эта метрика нужна</li>
          <li><b>Дети</b> — за счёт чего можно на неё влиять</li>
          <li><b>Риски</b> — что может ухудшиться при оптимизации</li>
          </ul>
          </div>
          </div>

          <div className="mt-5 p-4 rounded-xl border border-gray-200 bg-white">
          <div className="font-semibold mb-2">Совет</div>
          <p className="text-sm text-gray-700">
          Лучший результат получается, когда у метрики есть родитель и 2–5 дочерних метрик —
          тогда разбор даёт конкретные точки роста и идеи для экспериментов.
          </p>
          </div>
          </div>
          )}
  
          {activeTab === "mobile" && treeData && (
          <div className="p-4 overflow-y-auto flex-1 bg-white">
            {renderMobileTree(treeData)}
          </div>
          )}

        </div>
      </div>

      {/* === Правая панель === */}
{!isMobile && !isFullscreen && (
  <aside className="w-80 border-l border-gray-200 bg-white p-5 flex flex-col shadow-sm">

    {/* Tabs: Метрика / Лимиты */}
    <div className="flex gap-2 mb-4">
      <button
        onClick={() => setRightTab("metric")}
        className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${
          rightTab === "metric"
            ? "bg-[#ffdd2d] border-[#ffdd2d] text-black"
            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
        }`}
      >
        Метрика
      </button>

      <button
        onClick={() => {
          refreshQuotaView();
          setRightTab("quota");
        }}
        className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${
          rightTab === "quota"
            ? "bg-[#ffdd2d] border-[#ffdd2d] text-black"
            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
        }`}
      >
        Лимиты
      </button>

      <button
    onClick={() => {
    setRightTab("cloud");
    fetchCloudProjects();
    }}
    className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${
    rightTab === "cloud"
      ? "bg-[#ffdd2d] border-[#ffdd2d] text-black"
      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
    }`}
    >
    Облако
    </button>
    </div>

    <div className="mb-4 p-3 rounded-xl border border-gray-200 bg-gray-50">
    {session ? (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-gray-500">✅ Вход выполнен</div>
        <div className="text-sm font-medium text-gray-900 truncate">
          {session.user?.email}
        </div>
      </div>

      <button
        onClick={async () => {
        try {
        await fetch("/api/auth/logout", {
        method: "POST",
        });

        setSession(null);
        } catch (e) {
        console.error("Logout error:", e);
        }
        }}
        className="text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 transition"
      >
        Выйти
      </button>
    </div>
    ) : (
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="text-xs text-gray-500">🔒 Гостевой режим</div>
        <div className="text-sm text-gray-700">Синхронизация в облако</div>
      </div>

      <button
        onClick={() => setAuthModalOpen(true)}
        className="text-sm px-3 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 transition font-medium"
      >
        Войти
      </button>
    </div>
    )}
    </div>
      
    {/* Верхние действия */}
    <div className="grid grid-cols-2 gap-2 mb-3">
      <button
        onClick={() => setIsFullscreen(true)}
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap bg-black text-white px-3 py-2 rounded-xl hover:bg-gray-800 font-medium transition text-sm"
      >
        ⛶ На весь экран
      </button>

      <button
        onClick={() => {
          setShowBenefitsModal(true);
          ymEvent("benefits_open");
        }}
        className="bg-blue-50 text-blue-700 px-3 py-3 rounded-xl hover:bg-blue-100 font-medium transition text-sm"
        title="Как это работает"
      >
        Как это работает
      </button>

      <button
        onClick={handleOpenPrioritization}
        disabled={!treeData || priorLoading}
        className="col-span-2 bg-green-50 text-green-700 px-3 py-2 rounded-xl hover:bg-green-100 disabled:opacity-50 font-medium transition text-sm"
        title="Приоритизировать метрики"
      >
        Приоритизировать метрики
      </button>
    </div>

    {/* Экспорт/импорт */}
    <div className="flex flex-wrap gap-2 mb-5">
      
      <button
      onClick={handleSaveToCloud}
      disabled={!treeData && (!nodes?.length || !edges?.length)}
      className="w-full mb-4 bg-black text-white px-4 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition text-sm font-medium"
      title={!session ? "Войдите, чтобы сохранять в облако" : "Сохранить проект"}
      >
      💾 Сохранить в облако
      </button>

      <button
      onClick={() => handleSaveToCloud({ forceNew: true })}
      disabled={!treeData && (!nodes?.length || !edges?.length)}
      className="px-3 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition text-sm font-medium"
      title="Сохранить как новый проект"
      >
      ➕
      </button>
           
      <button
        onClick={handleExport}
        className="bg-green-50 text-green-700 px-3 py-2 rounded-xl hover:bg-green-100 font-medium transition text-sm"
      >
        Экспорт
      </button>

      <label className="bg-blue-50 text-blue-700 px-3 py-2 rounded-xl hover:bg-blue-100 font-medium transition cursor-pointer text-sm">
        Импорт
        <input type="file" accept=".json" className="hidden" onChange={handleImport} />
      </label>

      <button
        onClick={handleDownloadSvg}
        disabled={!treeData}
        className="bg-purple-50 text-purple-700 px-3 py-2 rounded-xl hover:bg-purple-100 disabled:opacity-50 font-medium transition text-sm"
      >
        Скачать SVG
      </button>

      <button
        onClick={handleExportToMiro}
        disabled={!treeData}
        className="bg-yellow-50 text-yellow-800 px-3 py-2 rounded-xl hover:bg-yellow-100 disabled:opacity-50 font-medium transition text-sm"
      >
        Экспорт в Miro
      </button>

      <button
        onClick={handleDownloadCsv}
        disabled={!treeData}
        className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-xl hover:bg-indigo-100 disabled:opacity-50 font-medium transition text-sm"
      >
        Скачать CSV
      </button>

      <button
        onClick={handleClear}
        className="bg-red-50 text-red-700 px-3 py-2 rounded-xl hover:bg-red-100 font-medium transition text-sm"
      >
        Очистить
      </button>
    </div>

    {/* === TAB: МЕТРИКА === */}
    {rightTab === "metric" && (
      <>
        {selectedMetric ? (
          <>
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              {selectedMetric.data.label}
            </h2>

            {selectedMetric.type && (
            <div className="flex items-center gap-2 mb-4">
            <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
            selectedMetric.type === "business"
            ? "bg-blue-100 text-blue-700"
            : selectedMetric.type === "product"
            ? "bg-green-100 text-green-700"
            : selectedMetric.type === "proxy"
            ? "bg-gray-100 text-gray-700"
            : selectedMetric.type === "counter"
            ? "bg-red-100 text-red-700"
            : selectedMetric.type === "ops"
            ? "bg-yellow-100 text-yellow-700"
            : "bg-gray-100 text-gray-700"
            }`}
            >
            {selectedMetric.type}
            </span>

            <span className="text-xs text-gray-400">
            • ID: {selectedMetric.id}
            </span>
            </div>
            )}

            
            <button
              onClick={() => handleGetInsight()} // важно: без MouseEvent
              disabled={insightLoading}
              className="bg-[#ffdd2d] text-black px-4 py-2 rounded-lg hover:brightness-95 disabled:opacity-50 transition font-medium"
              title="Разбор метрики: что измеряет, почему важна, как улучшить, риски и контр-метрики"
            >
              {insightLoading ? "Анализирую метрику..." : "💡 Как улучшить метрику"}
            </button>

            <button
              onClick={handleGenerateExperiment}
              disabled={experimentLoading}
              className="mt-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition font-medium"
            >
              {experimentLoading ? "Генерация…" : "Эксперимент"}
            </button>  

            <div className="flex flex-col gap-2 mb-5 mt-4" >
              <button
                onClick={handleAddMetric}
                className="bg-[#fff9db] text-[#1c1c1e] rounded-lg px-3 py-2 text-sm hover:bg-[#ffed93] transition"
              >
                Добавить метрику
              </button>

              <button
                onClick={() => {
                  setEditMetricName(selectedMetric.data.label);
                  setEditMetricType(selectedMetric.type || "proxy");
                  setShowEditModal(true);
                }}
                className="bg-blue-50 text-blue-700 rounded-lg px-3 py-2 text-sm hover:bg-blue-100 transition"
              >
                Редактировать
              </button>

              <button
                onClick={() => handleDeleteMetric()}
                className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm hover:bg-red-100 transition"
              >
                Удалить метрику
              </button>
            </div>
     
          </>
        ) : (
          <div>
          <div className="text-sm text-gray-500">
          Выбери метрику в дереве — здесь появятся действия.
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-400">
          <a
          href="/payment-terms"
          className="text-blue-600 hover:underline"
          >
          Оплата и условия
          </a>
          <span className="mx-2">·</span>
          <span>© 2026 MetricTree</span>
          </div>
          </div>
          )}
          </>
          )}

    {/* === TAB: ЛИМИТЫ === */}
    {rightTab === "quota" && (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
    {!session?.user?.id ? (
      
      <>
      <h3 className="text-sm font-semibold mb-2 text-gray-700">
      Гостевой режим
      </h3>

      <QuotaLine
      label="Бесплатная генерация"
      info={getQuotaInfo("generate_tree", 1)}
      />

    <div className="mt-2 space-y-2 text-sm">
    <div className="flex justify-between gap-3">
      <span className="text-gray-600">Разбор метрик</span>
      <span className="text-gray-500">После входа</span>
    </div>

    <div className="flex justify-between gap-3">
      <span className="text-gray-600">Подсказки метрик</span>
      <span className="text-gray-500">После входа</span>
    </div>

    <div className="flex justify-between gap-3">
      <span className="text-gray-600">Приоритизация</span>
      <span className="text-gray-500">После входа</span>
    </div>

    <div className="flex justify-between gap-3">
      <span className="text-gray-600">A/B эксперименты</span>
      <span className="text-gray-500">После входа</span>
    </div>
    </div>

    <p className="mt-3 text-xs text-gray-500">
    Зарегистрируйтесь или войдите, чтобы продолжить работу с MetricTree.
    </p>
    </>

    ) : (
      <>
        <h3 className="text-sm font-semibold mb-2 text-gray-700">
          Лимиты аккаунта
        </h3>

        <div className="mb-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Пакет операций MetricTree
              </div>
              <div className="text-xs text-gray-500 mt-1">
                +20 операций каждого типа без ограничения срока действия
              </div>
            </div>
            <div className="text-sm font-semibold whitespace-nowrap">
              490 ₽
            </div>
          </div>
          <button
            type="button"
            onClick={handleBuyPro}
            className="mt-3 w-full bg-[#ffdd2d] text-black px-3 py-2 rounded-lg hover:brightness-95 transition font-medium text-sm"
          >
            Купить 20 операций каждого типа — 490 ₽
          </button>
        </div>

        <QuotaLine label="Генерация дерева" info={quotaView.generate} />
        <QuotaLine label="Разбор метрик" info={quotaView.insight} />
        <QuotaLine label="Подсказки метрик" info={quotaView.suggestion} />
        <QuotaLine label="Приоритизация" info={quotaView.prioritization} />
        <QuotaLine label="A/B эксперименты" info={quotaView.experiment} />
      </>
    )}
    </div>
    )}

    {rightTab === "cloud" && (
    <div className="flex flex-col gap-3">
    {!session ? (
      <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
        <div className="text-sm text-gray-700 mb-2">
          Войдите, чтобы видеть проекты в облаке.
        </div>
        <button
          onClick={() => setAuthModalOpen(true)}
          className="w-full bg-[#ffdd2d] text-black px-3 py-2 rounded-lg hover:brightness-95 transition font-medium text-sm"
        >
          Войти
        </button>
      </div>
    ) : (
      <>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Мои проекты</div>
          <button
            onClick={fetchCloudProjects}
            className="text-xs px-2 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 transition"
          >
            Обновить
          </button>
        </div>

        {cloudError ? (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {cloudError}
          </div>
        ) : null}

        {cloudLoading ? (
          <div className="text-sm text-gray-500">Загрузка…</div>
        ) : cloudProjects.length === 0 ? (
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-600">
            Пока нет сохранённых проектов. Нажмите “Сохранить в облако”.
          </div>
        ) : (
          <div className="space-y-2">
            {cloudProjects.map((p) => (
              <div
                key={p.id}
                className="p-3 bg-white rounded-xl border border-gray-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      Обновлён: {new Date(p.updated_at || p.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openCloudProject(p.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 transition font-medium"
                    >
                      Открыть
                    </button>
                    <button
                      onClick={() => deleteCloudProject(p.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    )}
  </div>
  )}

  </aside>
  )}

      {/* === Модалка: Добавить === */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-[400px] transition-all">
            <h3 className="text-lg font-semibold mb-4">Добавить метрику</h3>

            <label className="block text-sm text-gray-700 mb-1">Название</label>
            <input
              type="text"
              value={newMetricName}
              onChange={(e) => setNewMetricName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
              placeholder="Например, Конверсия в оплату"
            />

            {loadingSuggestions ? (
              <p className="text-gray-400 text-sm mb-2 animate-pulse">
                Генерация подсказок...
              </p>
            ) : metricSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {metricSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setNewMetricName(s)}
                    className="px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            <label className="block text-sm text-gray-700 mb-1">Тип метрики</label>
            <select
              value={newMetricType}
              onChange={(e) => setNewMetricType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-5 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
            >
              <option value="business">Business</option>
              <option value="product">Product</option>
              <option value="proxy">Proxy</option>
              <option value="counter">Counter</option>
              <option value="ops">Ops</option>
            </select>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmAddMetric}
                className="px-4 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 font-medium"
              >
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}

{showFeedbackModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[10000] backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-7 w-[720px] max-w-[92vw] max-h-[85vh] overflow-y-auto">
      {!feedbackSubmitted ? (
        <>
          <h3 className="text-xl font-semibold mb-2 text-gray-900">
          {currentFeedbackMeta.title}
          </h3>

          <p className="text-sm text-gray-600 mb-5">
          {currentFeedbackMeta.subtitle}
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                1. Для какой задачи ты использовал MetricTree? <span className="text-red-500">*</span>
              </label>
              <textarea
                value={feedbackForm.task}
                onChange={(e) => updateFeedbackField("task", e.target.value)}
                placeholder="Свободный ответ"
                className="w-full border border-gray-300 rounded-xl p-3 min-h-[96px] focus:ring-2 focus:ring-[#ffdd2d] outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                2. Что ты будешь делать с этим деревом дальше? <span className="text-red-500">*</span>
              </label>
              <textarea
                value={feedbackForm.nextStep}
                onChange={(e) => updateFeedbackField("nextStep", e.target.value)}
                placeholder="Например: обсужу с командой, загружу в Miro, соберу dashboard..."
                className="w-full border border-gray-300 rounded-xl p-3 min-h-[96px] focus:ring-2 focus:ring-[#ffdd2d] outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                3. Насколько вероятно, что ты снова воспользуешься этим инструментом?
                <span className="text-gray-400 text-xs ml-2">(опционально)</span>
              </label>

              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => updateFeedbackField("reuseScore", String(n))}
                    className={`w-11 h-11 rounded-xl border text-sm font-medium transition ${
                      feedbackForm.reuseScore === String(n)
                        ? "bg-[#ffdd2d] border-[#ffdd2d] text-black"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                4. Можно ли связаться с тобой, чтобы задать пару вопросов? <span className="text-gray-400 text-xs ml-2">(опционально)</span>
              </label>
              <input
                type="text"
                value={feedbackForm.contact}
                onChange={(e) => updateFeedbackField("contact", e.target.value)}
                placeholder="Email или Telegram"
                className="w-full border border-gray-300 rounded-xl p-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => setShowFeedbackModal(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Закрыть
            </button>

            <button
            onClick={handleSubmitFeedback}
            disabled={feedbackSubmitting}
            className="px-5 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 font-medium disabled:opacity-50"
            >
            {feedbackSubmitting ? "Отправляю..." : "Отправить"}
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-6">
          <div className="text-2xl mb-3">🙏</div>
          <h3 className="text-xl font-semibold mb-2 text-gray-900">
            Спасибо за ответы
          </h3>
          <p className="text-sm text-gray-600 mb-5">
            Это очень помогает улучшать MetricTree.
          </p>

          <button
            onClick={() => setShowFeedbackModal(false)}
            className="px-5 py-2 bg-[#ffdd2d] text-black rounded-lg hover:brightness-95 font-medium"
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  </div>
)}



      {/* === Модалка: Приоритизация метрик === */}
{showPriorModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-7 w-[720px] max-w-[92vw] max-h-[85vh] overflow-y-auto relative">

      <h3 className="text-xl font-semibold mb-4 text-gray-900">
        🔝 Приоритизация метрик
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Стадия продукта</label>
          <select
            value={priorStage}
            onChange={(e) => setPriorStage(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
          >
            <option value="MVP">MVP</option>
            <option value="Growth">Growth</option>
            <option value="Scale">Scale</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Основная цель</label>
          <select
            value={priorGoal}
            onChange={(e) => setPriorGoal(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
          >
            <option value="activation">Активация</option>
            <option value="retention">Удержание</option>
            <option value="revenue">Выручка</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 justify-end mb-4">
        <button
          onClick={() => setShowPriorModal(false)}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
        >
          Отмена
        </button>
        <button
          onClick={handleRunPrioritization}
          disabled={priorLoading}
          className="px-4 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 font-medium disabled:opacity-50"
        >
          {priorLoading ? "Думаю..." : "Запустить"}
        </button>
      </div>

      {priorResult && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
            <div className="font-semibold mb-2">ТОП-метрики (подсвечены)</div>
            <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
              {(priorResult.topMetrics || []).map((m, idx) => (
                <li key={idx}>
                  <span className="font-medium">{metricNameById(m.id)}</span>

                  {m.reason ? ` — ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
            <div className="font-semibold mb-2">Не приоритизировать сейчас (приглушены)</div>
            <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
              {(priorResult.avoidMetrics || []).map((m, idx) => (
                <li key={idx}>
                  <span className="font-medium">{metricNameById(m.id)}</span>

                  {m.reason ? ` — ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>

          {priorResult.summary && (
            <div className="p-4 rounded-xl border border-gray-200 bg-white">
              <div className="font-semibold mb-2">Резюме</div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">
                {priorResult.summary}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Подсказка: зелёная рамка = фокус на 2–4 недели, серые = не тратить время сейчас.
          </p>
        </div>
      )}
    </div>
  </div>
)}


{/* === Модалка: Что дальше после экспорта === */}
{showNextStepsModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[10000] backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-7 w-[520px] max-w-[92vw] max-h-[85vh] overflow-y-auto">
      <h3 className="text-xl font-semibold mb-2 text-gray-900">
      {currentNextStepsCopy.title}
      </h3>

      <p className="text-sm text-gray-600 mb-5">
      {currentNextStepsCopy.subtitle}
      </p>

      <div className="space-y-3">
      <button
      onClick={() => {
      setShowNextStepsModal(false);

      if (selectedMetric) {
        handleGetInsight(selectedMetric);
      } else {
        if (isMobile) {
          alert("Выберите любую метрику в дереве — и я подскажу, как её улучшить");
        } else {
          setActiveTab("visual");
          alert("Выберите метрику в дереве — и я подскажу, как её улучшить");
        }
      }

      ymEvent("next_steps_insight");
      }}
      className="w-full text-left p-4 rounded-xl border border-[#ffdd2d] bg-[#ffdd2d] hover:brightness-95 transition shadow-sm"
      >
      <div className="font-semibold text-gray-900 mb-1">
      💡 Найти точку роста
      </div>
      <div className="text-sm text-gray-800">
      Разобрать выбранную метрику и понять, как её улучшить.
      </div>
      </button>

      <button
      onClick={() => {
      setShowNextStepsModal(false);

      const metric = pickMetricForInsight();

      if (metric) {
      setSelectedMetric(metric);
      handleGetInsight(metric);
      } else {
      alert("Сначала сгенерируйте дерево метрик 🙂");
      }

      ymEvent("next_steps_insight");
      }}


      disabled={!treeData || priorLoading}
      className="w-full text-left p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 transition"
      >
      <div className="font-semibold text-gray-900 mb-1">
      🔝 Выбрать 2–3 метрики для фокуса
      </div>
      <div className="text-sm text-gray-700">
      Понять, на каких метриках стоит сфокусироваться в ближайшие недели.
      </div>
      </button>

      <button
      
      onClick={() => {
      setShowNextStepsModal(false);

      if (selectedMetric) {
      handleGenerateExperiment();
      } else {
      if (isMobile) {
      alert("Выберите метрику в дереве, затем откройте меню ⋮ и нажмите «Эксперимент»");
      } else {
      setActiveTab("visual");
      alert("Сначала выберите метрику в дереве, затем нажмите «Эксперимент»");
      }
      }

      ymEvent("next_steps_experiment");
      }}


      className="w-full text-left p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition"
      >
      <div className="font-semibold text-gray-900 mb-1">
      🧪 Превратить метрику в эксперимент
      </div>
      <div className="text-sm text-gray-700">
      Получить гипотезу, вариант, метрики успеха и guardrails.
      </div>
      </button>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button
          onClick={() => setShowNextStepsModal(false)}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
        >
          Закрыть
        </button>
      </div>
    </div>
  </div>
)}


{/* === Модалка: Преимущества MetricTree === */}
{showBenefitsModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-7 w-[650px] max-w-[92vw] max-h-[85vh] overflow-y-auto relative">

      <h3 className="text-xl font-semibold mb-4 text-gray-900">
        Почему MetricTree полезен
      </h3>

      <div className="space-y-3 text-gray-800 leading-relaxed">
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">1) Быстро наводит порядок в метриках</div>
          <div className="text-sm text-gray-700">
            Генерирует структуру метрик от Business → Product → Proxy/Counter/Ops, чтобы команда говорила на одном языке.
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
        <div className="font-semibold mb-1">
          2) Находите точки роста в метриках
        </div>

       <div className="text-sm text-gray-700 space-y-2">
        <p>
        Можно кликнуть на любую метрику и получить разбор,
        который покажет, как её реально улучшить.
        </p>

        <ul className="list-disc pl-5 space-y-1">
        <li>что именно измеряет метрика</li>
        <li>почему она важна для продукта</li>
        <li>как она связана с другими метриками</li>
        <li>какие действия могут её улучшить</li>
        <li>какие есть риски и контр-метрики</li>
        </ul>

        <p className="text-gray-600">
        Выбери метрику в дереве → нажми <b>“Как улучшить эту метрику?”</b>.
        </p>
        </div>
        </div>


        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="font-semibold mb-1">3) Ускоряет работу: добавление, редактирование, подсказки</div>
          <div className="text-sm text-gray-700">
            Подсказки метрик + быстрые правки в дереве экономят время на фасилитации, документации и согласованиях.
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
        <div className="font-semibold mb-1">
         4) Помогает сфокусироваться, а не утонуть в метриках
         </div>
        <div className="text-sm text-gray-700">
        AI-приоритизация выделяет ключевые метрики для текущей стадии продукта
        (MVP, Growth, Scale), показывает, на чём стоит сфокусироваться в ближайшие
        2–4 недели, и какие метрики пока не стоит трогать.
        </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
        <div className="font-semibold mb-1">
         5) Выгрузка дерева метрик в SVG
         </div>
        <div className="text-sm text-gray-700">
        Десктоп версия позволяет выгружать дерево в векторном формате для дальнейшей работы в других приложениях.
        </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
        <div className="font-semibold mb-1">
         6) Автоматическая генерация A/B-экспериментов по метрикам
         </div>
        <div className="text-sm text-gray-700">
        MetricTree умеет превращать любую метрику в конкретный A/B-тест.
        </div>
        </div>

         <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
        <div className="font-semibold mb-1">
         7) Выгрузка в MIRO
         </div>
        <div className="text-sm text-gray-700">
        MetricTree позволяет автоматически выгрузить дерево в MIRO.
        </div>
        </div>


      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={() => setShowBenefitsModal(false)}
          className="px-5 py-2 bg-[#ffdd2d] text-black rounded-lg hover:brightness-95 transition font-medium"
        >
          Понятно
        </button>
      </div>
    </div>
  </div>
)}
  
{/* === Модалка: Уточняющие вопросы === */}
{showQuestionsModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-7 w-[720px] max-w-[92vw] max-h-[85vh] overflow-y-auto relative">
      <h3 className="text-xl font-semibold mb-2 text-gray-900">
        Уточним продукт (1 минута)
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Чтобы дерево метрик было точнее, ответьте на несколько вопросов.
      </p>

      {questionsError ? (
        <div className="p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {questionsError}
        </div>
      ) : null}

      <div className="space-y-4">
        {questionsList.map((q) => (
          <div key={q.id || q.field} className="p-4 rounded-xl border border-gray-200 bg-gray-50">
            <div className="text-sm font-medium text-gray-900 mb-2">
              {q.question}
            </div>
            <input
              value={answers[q.field] || ""}
              onChange={(e) => setAnswer(q.field, e.target.value)}
              placeholder="Ваш ответ..."
              className="w-full border border-gray-300 rounded-lg p-2 bg-white focus:ring-2 focus:ring-[#ffdd2d] outline-none"
            />
            <div className="text-xs text-gray-500 mt-1">
              Поле: <span className="font-mono">{q.field}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end mt-5">
        {/*<button
          onClick={() => setShowQuestionsModal(false)}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
        >
          Пропустить
        </button>*/}

        <button
        onClick={handleCancelGeneration}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
        >
        Отмена
        </button>  

        <button
          onClick={handleConfirmQuestions}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 font-medium disabled:opacity-50"
        >
          {loading ? "Генерирую..." : "Продолжить"}
        </button>
      </div>
    </div>
  </div>
)}

      {/* === Модалка: Редактировать === */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-[400px] transition-all">
            <h3 className="text-lg font-semibold mb-4">Редактировать метрику</h3>

            <label className="block text-sm text-gray-700 mb-1">Название</label>
            <input
              type="text"
              value={editMetricName}
              onChange={(e) => setEditMetricName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-3 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
            />

            <label className="block text-sm text-gray-700 mb-1">Тип метрики</label>
            <select
              value={editMetricType}
              onChange={(e) => setEditMetricType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-5 focus:ring-2 focus:ring-[#ffdd2d] outline-none"
            >
              <option value="business">Business</option>
              <option value="product">Product</option>
              <option value="proxy">Proxy</option>
              <option value="counter">Counter</option>
              <option value="ops">Ops</option>
            </select>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmEditMetric}
                className="px-4 py-2 rounded-lg bg-[#ffdd2d] text-black hover:brightness-95 font-medium"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}


      {showExperimentModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl shadow-2xl p-8 w-[700px] max-h-[85vh] overflow-y-auto">

      <h3 className="text-xl font-semibold mb-4">
        🧪 Эксперимент по метрике
      </h3>

      {experimentLoading ? (
        <p>Генерирую эксперимент…</p>
        ) : experiment ? (
  experiment.error ? (
    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
      <div className="font-semibold mb-2">Ошибка</div>
      <div>{experiment.error}</div>

      {experiment.raw ? (
        <pre className="mt-3 text-xs whitespace-pre-wrap text-gray-800">
          {typeof experiment.raw === "string"
            ? experiment.raw.slice(0, 4000)
            : JSON.stringify(experiment.raw, null, 2).slice(0, 4000)}
        </pre>
      ) : null}
    </div>
  ) : (
    <div className="space-y-3 text-sm text-gray-800">
      <div><b>Гипотеза:</b> {experiment.hypothesis || "—"}</div>
      <div><b>Изменение (Variant):</b> {experiment.variant || "—"}</div>

      <div>
        <b>Метрики успеха:</b>
        {experiment.successMetrics?.length ? (
          <ul className="list-disc pl-5">
            {experiment.successMetrics.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        ) : (
          <div>—</div>
        )}
      </div>

      <div>
        <b>Guardrails:</b>
        {experiment.guardrails?.length ? (
          <ul className="list-disc pl-5">
            {experiment.guardrails.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        ) : (
          <div>—</div>
        )}
      </div>

      <div><b>Сегмент:</b> {experiment.segment || "—"}</div>
      <div><b>Длительность:</b> {experiment.duration || "—"}</div>
      <div><b>Риски:</b> {experiment.risks || "—"}</div>
    </div>
  )
) : null}


      <div className="flex justify-end mt-6">
        <button
        onClick={() => {
        setShowExperimentModal(false);

        if (pendingFeedbackSource) {
        tryOpenFeedbackModal(pendingFeedbackSource);
        setPendingFeedbackSource(null);
        }
        }}
  className="px-5 py-2 bg-[#ffdd2d] rounded-lg"
>
  Закрыть
</button>
      </div>

    </div>
  </div>
)}

      {/* === Модалка: AI инсайт === */}
      {showInsightModal && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-8 w-[700px] max-h-[85vh] overflow-y-auto animate-fadeIn relative">

      <h3 className="text-xl font-semibold mb-4 text-gray-900 flex items-center gap-2">
        Как улучшить эту метрику
      </h3>

      {insightPending ? (
        <div className="flex items-center gap-3 text-gray-700 text-base">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-transparent"></div>
          Анализирую метрику и ищу точки роста……
        </div>
      ) : (
        <p className="text-gray-800 whitespace-pre-wrap leading-relaxed text-base">
          {modalInsight || "Инсайт не найден."}
        </p>
      )}

      <div className="flex justify-end mt-6">
        <button
        onClick={() => {
        setShowInsightModal(false);

        if (pendingFeedbackSource) {
        tryOpenFeedbackModal(pendingFeedbackSource);
        setPendingFeedbackSource(null);
        }
        }}
          className="px-5 py-2 bg-[#ffdd2d] text-black rounded-lg hover:brightness-95 transition font-medium"
        >
          Закрыть
        </button>
      </div>
    </div>
   </div>
)}

{/* === Оверлей: Генерация AI-инсайта === */}
{insightLoading && !isMobile && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] max-w-[90vw] flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-transparent" />
      <p className="text-gray-900 font-medium text-base">
        Анализирую метрику и ищу точки роста…
      </p>
      <p className="text-xs text-gray-500 text-center">
        Анализирую выбранную метрику, связи и возможные рычаги роста
      </p>
    </div>
  </div>
)}

{/* === Модалка: Генерация дерева === */}
{loading && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[320px] max-w-[90vw] flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-transparent" />
      <p className="text-gray-900 font-medium text-base">
        Генерация дерева… (Может занять до 2х минут)
      </p>
      <p className="text-xs text-gray-500 text-center">
        Подбираю структуру метрик под ваш продукт
      </p>
    </div>
  </div>
)}

{/* === Оверлей: Экспорт в Miro === */}
{miroExporting && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] max-w-[92vw] flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-transparent" />
        <div>
          <p className="text-gray-900 font-medium text-base">
            Выгружаю в Miro…
          </p>
          <p className="text-xs text-gray-500">
            {miroExportStatus || "Пожалуйста, подождите"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 bg-[#ffdd2d] rounded-full transition-all"
          style={{ width: `${Math.max(5, Math.min(100, miroExportProgress))}%` }}
        />
      </div>

      <div className="flex justify-between text-[11px] text-gray-500">
        <span>Не закрывайте вкладку</span>
        <span>{Math.round(miroExportProgress)}%</span>
      </div>
    </div>
  </div>
)}

<AuthModal
  open={authModalOpen}
  reason={authModalReason}
  onClose={() => {
    setAuthModalOpen(false);
    setAuthModalReason("default");
  }}
  onAuth={(user) => {
    setSession({ user });
    setAuthModalOpen(false);
    setAuthModalReason("default");
  }}
/>

{/* Автор (фиксированно снизу на мобильной версии) */}
    {isMobile && (
      <div className="fixed bottom-0 left-0 w-full text-center text-[11px] text-gray-500 py-2 bg-white border-t border-gray-200 z-[9999]">
      MetricTree. Создано Владимиром Павловым •{" "}
        <a
          href="https://t.me/v_v_pavloff"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
        Telegram
      </a>
      </div>
    )}
    </div>
  );
}
