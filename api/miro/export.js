// /api/miro/export.js

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function colorByType(type) {
  // мягкие фоны (примерно как у тебя)
  if (type === "business") return "#e8f2ff";
  if (type === "product") return "#e8ffe8";
  if (type === "proxy") return "#f2f2f2";
  if (type === "counter") return "#ffe8e8";
  if (type === "ops") return "#fff7e5";
  return "#ffffff";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

 const token = getCookie(req, "miro_access_token");
if (!token) {
  return json(res, 401, {
    error: "Not connected to Miro (missing token cookie)",
    action: "redirect",
    redirectUrl: "/api/miro/oauth/start",
  });
}

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { error: "Invalid JSON" });
    }

    const { boardId, nodes, edges, options } = payload || {};
    if (!boardId) return json(res, 400, { error: "Missing boardId" });
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return json(res, 400, { error: "nodes and edges must be arrays" });
    }

    // ---- 1) нормализуем координаты, чтобы дерево не улетало далеко
    // ReactFlow: позиция = левый верх. Miro обычно центр origin=center.
    const nodeWidth = options?.nodeWidth ?? 220;
    const nodeHeight = options?.nodeHeight ?? 110;
    const padding = options?.padding ?? 300;

    const visibleNodes = nodes.filter((n) => !n.hidden);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      const x = n.position?.x ?? 0;
      const y = n.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + nodeWidth);
      maxY = Math.max(maxY, y + nodeHeight);
    }
    if (!isFinite(minX)) return json(res, 400, { error: "No nodes to export" });

    // сдвиг так, чтобы всё оказалось рядом с (0,0) в Miro
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    // ---- 2) создаём shapes по одному (надёжнее, чем bulk: проще маппить ids)
    const idMap = new Map(); // rfNodeId -> miroItemId
    const createdShapes = [];

    for (const n of visibleNodes) {
      const rfId = n.id;
      const label = n.data?.label ?? n.data?.name ?? n.name ?? rfId;

      // центр в Miro
      const cx = (n.position?.x ?? 0) + nodeWidth / 2 + offsetX;
      const cy = (n.position?.y ?? 0) + nodeHeight / 2 + offsetY;

      const shapeBody = {
        data: {
          // content у shapes — это текст внутри
          content: String(label).slice(0, 500),
          // форма: можно поменять на "round_rectangle" / "rectangle" / "circle"
          shape: "round_rectangle",
        },
        style: {
          fillColor: colorByType(n.type),
          borderColor: "#d1d5db",
          borderOpacity: "1.0",
          borderWidth: "1.0",
          color: "#111827",
          fontFamily: "arial",
          fontSize: "14",
          textAlign: "center",
          textAlignVertical: "middle",
        },
        position: {
          origin: "center",
          x: cx,
          y: cy,
        },
        geometry: {
          width: nodeWidth,
          height: nodeHeight,
        },
      };

      const r = await fetch(`https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/shapes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(shapeBody),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return json(res, r.status, {
          error: "Miro create shape failed",
          miro: data,
          hint: "Проверь scope boards:write и что boardId доступен этому пользователю",
        });
      }

      idMap.set(rfId, data.id);
      createdShapes.push({ rfId, miroId: data.id });
    }

    // ---- 3) создаём connectors
    const createdConnectors = [];

    // чуть ограничим количество коннекторов за раз, чтобы не упереться в rate limit
    for (const e of edges) {
      const s = idMap.get(e.source);
      const t = idMap.get(e.target);
      if (!s || !t) continue;

      const connectorBody = {
        startItem: { id: s, snapTo: "auto" },
        endItem: { id: t, snapTo: "auto" },
        shape: "curved", // или "straight"
        style: {
          strokeColor: "#9ca3af",
          strokeWidth: "1.0",
        },
      };

      const r = await fetch(`https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/connectors`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(connectorBody),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return json(res, r.status, {
          error: "Miro create connector failed",
          miro: data,
        });
      }

      createdConnectors.push({ miroId: data.id, source: e.source, target: e.target });
    }

    return json(res, 200, {
      ok: true,
      created: {
        shapes: createdShapes,
        connectors: createdConnectors,
      },
    });
  });
}
