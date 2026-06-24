import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, BarChart3, GitBranch, Network, Layers, Palette } from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";
import Header from "@/components/Header";
import QueryBar, { type QueryResult, formatMarkdown } from "@/components/QueryBar";
import NotePanel from "@/components/NotePanel";

// Vault palette — cool/jewel tones, bright enough for dark bg, colorblind-safe
const VAULT_COLORS = [
  "#7C9BF5", "#5EC4C8", "#B07CE8", "#4ECDC4", "#A8D86E",
  "#F5A0C0", "#6CB4EE", "#C9A0FF", "#7EDAB9", "#E8B86D",
];

// Cluster palette — warm/earth tones, distinct from vaults, colorblind-safe
const COMMUNITY_COLORS = [
  "#F4845F", "#F9C74F", "#90BE6D", "#577590", "#F8961E",
  "#43AA8B", "#F3722C", "#4D908E", "#F9844A", "#277DA1",
  "#BC6C25", "#606C38", "#DDA15E", "#7B2D8E", "#2A9D8F",
  "#E76F51", "#264653", "#E9C46A", "#F4A261", "#84A98C",
];

type ColorMode = "vault" | "community";

export default function Explore() {
  const { data: stats } = useQuery<any>({ queryKey: ["/api/explore/stats"] });
  const { data: rawGraph } = useQuery<any>({ queryKey: ["/api/explore/graph"] });
  const graphRef = useRef<any>(null);

  const [showLinks, setShowLinks] = useState(true);
  const [showBridges, setShowBridges] = useState(true);
  const [activeVaults, setActiveVaults] = useState<Set<string> | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("vault");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [showCypher, setShowCypher] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  const vaultColorMap = useMemo(() => {
    if (!rawGraph) return {};
    const vaultIds = Array.from(new Set(rawGraph.nodes.map((n: any) => n.vaultId))) as string[];
    return Object.fromEntries(vaultIds.map((id, i) => [id, VAULT_COLORS[i % VAULT_COLORS.length]]));
  }, [rawGraph]);

  const vaultNames = useMemo(() => {
    if (!rawGraph) return {};
    const map: Record<string, string> = {};
    rawGraph.nodes.forEach((n: any) => { map[n.vaultId] = n.vaultName; });
    return map;
  }, [rawGraph]);

  const communityColorMap = useMemo(() => {
    if (!rawGraph) return {};
    const communities = Array.from(new Set(
      rawGraph.nodes.map((n: any) => n.community).filter((c: any) => c != null)
    )) as number[];
    // Sort by frequency (largest communities get first colors)
    const counts: Record<number, number> = {};
    rawGraph.nodes.forEach((n: any) => {
      if (n.community != null) counts[n.community] = (counts[n.community] || 0) + 1;
    });
    communities.sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
    return Object.fromEntries(
      communities.map((c, i) => [c, COMMUNITY_COLORS[i % COMMUNITY_COLORS.length]])
    );
  }, [rawGraph]);

  const topCommunities = useMemo(() => {
    if (!rawGraph) return [];
    const counts: Record<number, { count: number; vaults: Set<string> }> = {};
    rawGraph.nodes.forEach((n: any) => {
      if (n.community != null) {
        if (!counts[n.community]) counts[n.community] = { count: 0, vaults: new Set() };
        counts[n.community].count++;
        counts[n.community].vaults.add(n.vaultName);
      }
    });
    const names: Record<string, string> = rawGraph.communityNames || {};
    return Object.entries(counts)
      .map(([id, { count, vaults }]) => ({
        id: Number(id),
        count,
        vaultCount: vaults.size,
        name: names[String(id)] || `Cluster ${id}`,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [rawGraph]);

  const graph = useMemo(() => {
    if (!rawGraph) return null;

    let nodes = rawGraph.nodes;
    if (activeVaults) {
      nodes = nodes.filter((n: any) => activeVaults.has(n.vaultId));
    }
    const nodeIds = new Set(nodes.map((n: any) => n.id));

    const links = rawGraph.links.filter((l: any) => {
      if (l.type === "link" && !showLinks) return false;
      if (l.type === "bridge" && !showBridges) return false;
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    return { nodes, links };
  }, [rawGraph, showLinks, showBridges, activeVaults]);

  function toggleVault(vaultId: string) {
    setActiveVaults((prev) => {
      const allVaultIds = Object.keys(vaultColorMap);
      if (!prev) {
        const next = new Set(allVaultIds);
        next.delete(vaultId);
        return next;
      }
      const next = new Set(prev);
      if (next.has(vaultId)) {
        next.delete(vaultId);
        if (next.size === 0) return null;
      } else {
        next.add(vaultId);
        if (next.size === allVaultIds.length) return null;
      }
      return next;
    });
  }

  function selectNode(nodeId: string) {
    setSelectedNoteId(nodeId);
    setQueryResult(null);
    const node = rawGraph?.nodes?.find((n: any) => n.id === nodeId);
    if (node && graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 500);
      graphRef.current.zoom(3, 500);
    }
  }

  const getNodeColor = useCallback((node: any) => {
    if (colorMode === "community") {
      return node.community != null
        ? (communityColorMap[node.community] || "#555")
        : "#333";
    }
    return vaultColorMap[node.vaultId] || "#888";
  }, [colorMode, communityColorMap, vaultColorMap]);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.title;
      const fontSize = Math.max(10 / globalScale, 2);
      const isSelected = node.id === selectedNoteId;
      const r = isSelected ? Math.max(6, 8 / globalScale) : Math.max(4, 6 / globalScale);
      const color = getNodeColor(node);

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (globalScale > 1.5 || isSelected) {
        ctx.font = `${isSelected ? "bold " : ""}${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.85)";
        ctx.fillText(label, node.x, node.y + r + 2);
      }
    },
    [getNodeColor, selectedNoteId],
  );

  const linkColor = useCallback((link: any) => {
    if (selectedNoteId) {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      if (srcId === selectedNoteId || tgtId === selectedNoteId) {
        return link.type === "bridge" ? "rgba(139, 92, 246, 0.7)" : "rgba(255,255,255,0.4)";
      }
      return "rgba(255,255,255,0.02)";
    }
    return link.type === "bridge" ? "rgba(139, 92, 246, 0.25)" : "rgba(255,255,255,0.08)";
  }, [selectedNoteId]);

  const linkWidth = useCallback((link: any) => {
    if (selectedNoteId) {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      if (srcId === selectedNoteId || tgtId === selectedNoteId) {
        return link.type === "bridge" ? 2.5 : 1.5;
      }
      return 0.1;
    }
    return link.type === "bridge" ? 1 : 0.3;
  }, [selectedNoteId]);

  const showRightPanel = selectedNoteId || queryResult;
  const isMobile = containerWidth > 0 && containerWidth < 768;
  const [userPanelWidth, setUserPanelWidth] = useState<number | null>(null);
  const isDragging = useRef(false);

  const panelWidth = showRightPanel
    ? isMobile
      ? containerWidth
      : (userPanelWidth ?? Math.min(500, Math.floor(containerWidth * 0.4)))
    : 0;

  const graphWidth = useMemo(() => {
    if (!containerWidth) return undefined;
    return containerWidth - panelWidth;
  }, [containerWidth, panelWidth]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - me.clientX;
      const newWidth = Math.max(250, Math.min(containerWidth * 0.7, startWidth + delta));
      setUserPanelWidth(newWidth);
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth, containerWidth]);

  const containerRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const observer = new ResizeObserver((entries) => {
        setContainerWidth(entries[0].contentRect.width);
      });
      observer.observe(el);
      setContainerWidth(el.clientWidth);
    }
  }, []);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-full mx-auto">
        <div className="flex gap-2 px-4 py-3 flex-wrap items-center">
          <button
            onClick={() => setShowLinks(!showLinks)}
            className={`border rounded-lg px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
              showLinks
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground opacity-50"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span className="font-semibold">{stats?.links ?? 0}</span>
            <span className="text-xs">Links</span>
          </button>

          <button
            onClick={() => setShowBridges(!showBridges)}
            className={`border rounded-lg px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
              showBridges
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground opacity-50"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="font-semibold">{stats?.bridges ?? 0}</span>
            <span className="text-xs">Bridges</span>
          </button>

          <div className="border border-border rounded-lg px-3 py-2 flex items-center gap-2 text-sm bg-card">
            <Network className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold">{stats?.notes ?? 0}</span>
            <span className="text-xs text-muted-foreground">Notes</span>
          </div>

          <div className="border-l border-border h-6 mx-1" />

          <button
            onClick={() => setColorMode(colorMode === "vault" ? "community" : "vault")}
            className="border border-border rounded-lg px-3 py-2 flex items-center gap-2 text-sm bg-card hover:border-primary/30 transition-colors"
          >
            {colorMode === "vault" ? (
              <>
                <Palette className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-foreground">By Vault</span>
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-primary">By Cluster</span>
              </>
            )}
          </button>

          {colorMode === "vault" && (
            <div className="flex items-center gap-2 ml-auto">
              {Object.entries(vaultNames).map(([vaultId, name]) => {
                const isActive = !activeVaults || activeVaults.has(vaultId);
                return (
                  <button
                    key={vaultId}
                    onClick={() => toggleVault(vaultId)}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-opacity whitespace-nowrap ${
                      isActive ? "opacity-100" : "opacity-30"
                    }`}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: vaultColorMap[vaultId] }}
                    />
                    <span className="text-muted-foreground">{name as string}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {colorMode === "community" && topCommunities.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {topCommunities.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-card border border-border"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: communityColorMap[c.id] }}
                />
                <span className="text-foreground font-medium">{c.name}</span>
                <span className="text-muted-foreground">({c.count})</span>
              </div>
            ))}
          </div>
        )}

        <QueryBar
          onResult={(r) => { setQueryResult(r); if (r) setSelectedNoteId(null); }}
          loading={queryLoading}
          setLoading={setQueryLoading}
        />

        <div
          ref={containerRefCallback}
          className={isMobile && showRightPanel ? "flex flex-col" : "flex"}
          style={{ height: "calc(100vh - 160px)" }}
        >
          <div
            className="relative"
            style={{
              width: isMobile ? "100%" : (graphWidth || "100%"),
              height: isMobile && showRightPanel ? "50%" : "100%",
            }}
          >
            {graph ? (
              <ForceGraph2D
                ref={graphRef}
                graphData={graph}
                width={isMobile ? containerWidth : graphWidth}
                nodeCanvasObject={nodeCanvasObject}
                nodePointerAreaPaint={(node: any, color, ctx) => {
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI);
                  ctx.fillStyle = color;
                  ctx.fill();
                }}
                linkColor={linkColor}
                linkWidth={linkWidth}
                backgroundColor="#09090b"
                nodeLabel={(node: any) =>
                  `${node.title} (${node.vaultName})${node.community != null ? ` [cluster ${node.community}]` : ""}`
                }
                onNodeClick={(node: any) => selectNode(node.id)}
                onBackgroundClick={() => setSelectedNoteId(null)}
                cooldownTicks={100}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Compass className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Loading graph...</p>
                </div>
              </div>
            )}
          </div>

          {showRightPanel && !isMobile && (
            <div
              onMouseDown={handleDragStart}
              className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 transition-colors relative z-20"
              title="Drag to resize"
            />
          )}

          {showRightPanel && (
            <div
              className={`bg-card overflow-hidden shrink-0 relative z-10 ${
                isMobile ? "border-t border-border" : ""
              }`}
              style={{
                width: isMobile ? "100%" : panelWidth,
                height: isMobile ? "50%" : "100%",
              }}
            >
              {selectedNoteId ? (
                <NotePanel
                  noteId={selectedNoteId}
                  onClose={() => setSelectedNoteId(null)}
                  onSelectNote={selectNode}
                  vaultColorMap={vaultColorMap}
                />
              ) : queryResult ? (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                    <h2 className="font-semibold text-sm text-foreground">Query Results</h2>
                    <button
                      onClick={() => setQueryResult(null)}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div
                      className="prose prose-sm prose-invert max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(queryResult.answer) }}
                    />
                    {queryResult.cypher && (
                      <div className="mt-3 border-t border-border pt-2">
                        <button
                          onClick={() => setShowCypher(!showCypher)}
                          className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
                        >
                          {showCypher ? "Hide" : "Show"} Cypher
                        </button>
                        {showCypher && (
                          <pre className="mt-1 text-xs text-muted-foreground bg-background p-2 rounded overflow-x-auto whitespace-pre-wrap">
                            {queryResult.cypher}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
