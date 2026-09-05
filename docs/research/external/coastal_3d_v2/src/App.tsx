import { useEffect, useRef, useState } from "react";
import { World, Quality, WorldStats } from "./scene/world";

type Phase = "select" | "loading" | "ready";

const QUALITY_LABEL: Record<Quality, { name: string; desc: string }> = {
  low: { name: "流畅", desc: "5 万草丛 · 2K 阴影 · 适合集显 / 笔记本" },
  medium: { name: "均衡", desc: "13 万草丛 · 4K 阴影 · 草地投影" },
  high: { name: "极致", desc: "23 万草丛 · 4K 阴影 · 全分辨率 · 需要独显" },
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [quality, setQuality] = useState<Quality>("medium");
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("");
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [hudHidden, setHudHidden] = useState(false);

  useEffect(() => {
    if (phase !== "loading" || !canvasRef.current) return;
    const world = new World(canvasRef.current, quality);
    worldRef.current = world;
    let cancelled = false;
    world.onStats = (s) => setStats(s);
    world
      .init((p, l) => {
        if (cancelled) return;
        setProgress(p);
        setLabel(l);
      })
      .then(() => {
        if (cancelled) return;
        world.start();
        setPhase("ready");
      })
      .catch((err) => {
        console.error(err);
        setLabel("初始化失败：" + (err?.message ?? err));
      });
    return () => {
      cancelled = true;
      world.dispose();
      worldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyH") setHudHidden((v) => !v);
      if (e.code === "Digit1") worldRef.current?.teleport("beach");
      if (e.code === "Digit2") worldRef.current?.teleport("hill");
      if (e.code === "Digit3") worldRef.current?.teleport("peak");
      if (e.code === "Digit4") worldRef.current?.teleport("sea");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b1520] text-white select-none">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" style={{ width: "100vw", height: "100vh" }} />

      {/* ---------- quality select ---------- */}
      {phase === "select" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#0a1a2b] via-[#0d2438] to-[#06131d]">
          <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(ellipse_at_70%_20%,rgba(255,200,120,0.35),transparent_45%),radial-gradient(ellipse_at_20%_80%,rgba(40,160,180,0.35),transparent_50%)]" />
          <div className="relative mx-4 w-full max-w-2xl rounded-3xl border border-white/10 bg-black/30 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-1 text-xs tracking-[0.35em] text-cyan-200/70">PROCEDURAL COASTLINE · WEBGL2</div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight">曲折海岸 · 超精细 3D 风光演示</h1>
            <p className="mb-6 text-sm leading-relaxed text-white/70">
              全程序化生成的岛屿海岸：Gerstner 海浪与岸边碎浪、每一根随风摆动的草叶、
              带有土块与鹅卵石微凹凸的地表、层理分明的岩石悬崖、松林与阔叶林、云海与远山。
              摄像机可自由飞行并贴地观察细节。
            </p>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              {(Object.keys(QUALITY_LABEL) as Quality[]).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    quality === q
                      ? "border-cyan-300/80 bg-cyan-400/15 shadow-[0_0_30px_rgba(80,220,255,0.25)]"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <div className="text-lg font-semibold">{QUALITY_LABEL[q].name}</div>
                  <div className="mt-1 text-xs text-white/60">{QUALITY_LABEL[q].desc}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setPhase("loading")}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-sky-500 py-3.5 text-lg font-bold text-[#062033] shadow-lg transition hover:brightness-110 active:scale-[0.99]"
            >
              进入海岸 →
            </button>
            <div className="mt-4 text-center text-[11px] text-white/40">
              地形 1024² 高度场 · 200 万三角面地表 · 全屏 GPU 程序化材质 · 建议使用 Chrome / Edge 桌面版
            </div>
          </div>
        </div>
      )}

      {/* ---------- loading ---------- */}
      {phase === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07141f]">
          <div className="mb-3 text-sm tracking-[0.3em] text-cyan-200/70">LOADING</div>
          <div className="mb-6 text-2xl font-semibold">{label}</div>
          <div className="h-2 w-80 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-3 text-xs text-white/50">{Math.round(progress * 100)}%</div>
        </div>
      )}

      {/* ---------- HUD ---------- */}
      {phase === "ready" && !hudHidden && (
        <>
          <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-md">
              <div className="text-[10px] tracking-[0.3em] text-cyan-200/70">PROCEDURAL COAST</div>
              <div className="text-xl font-bold">曲折海岸</div>
            </div>
            {stats && (
              <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 font-mono text-[11px] leading-5 text-white/80 backdrop-blur-md">
                <div>
                  FPS <span className={stats.fps < 30 ? "text-amber-300" : "text-emerald-300"}>{stats.fps.toFixed(0)}</span>
                  <span className="ml-3 text-white/50">TRI {(stats.triangles / 1e6).toFixed(2)}M</span>
                </div>
                <div>
                  POS {stats.pos.x.toFixed(0)}, {stats.pos.y.toFixed(1)}, {stats.pos.z.toFixed(0)}
                </div>
                <div>
                  离地 {stats.alt.toFixed(1)}m · 速度 {stats.speed.toFixed(0)}m/s · 视角 {stats.fov.toFixed(0)}°
                </div>
                <div className="text-white/50">
                  草丛 {(stats.counts.grass / 1000).toFixed(0)}k · 松 {stats.counts.pines} · 阔叶 {stats.counts.broadleaf} · 灌木 {stats.counts.bushes} · 岩石 {stats.counts.rocks}
                </div>
              </div>
            )}
          </div>

          <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
            <div className="flex gap-2">
              {[
                ["1", "沙滩", "beach"],
                ["2", "山丘", "hill"],
                ["3", "山顶", "peak"],
                ["4", "海上", "sea"],
              ].map(([k, name, kind]) => (
                <button
                  key={kind}
                  onClick={() => worldRef.current?.teleport(kind as "beach" | "hill" | "peak" | "sea")}
                  className="rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-xs backdrop-blur-md transition hover:bg-white/15"
                >
                  <span className="mr-1 rounded bg-white/15 px-1 font-mono">{k}</span>
                  {name}
                </button>
              ))}
              <button
                onClick={() => setShowHelp((v) => !v)}
                className="rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-xs backdrop-blur-md transition hover:bg-white/15"
              >
                {showHelp ? "隐藏说明" : "操作说明"}
              </button>
            </div>
            {showHelp && (
              <div className="w-72 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-xs leading-6 text-white/80 backdrop-blur-md">
                <Row k="↑ ↓ ← →  / WASD" v="前后左右移动" />
                <Row k="鼠标拖动" v="环视" />
                <Row k="Q / E" v="左右转向" />
                <Row k="空格 / C" v="上升 / 下降" />
                <Row k="Shift · Alt" v="加速 ×4 · 减速 ×0.2" />
                <Row k="滚轮" v="缩放视角（望远观察细节）" />
                <Row k="Shift + 滚轮" v="调整飞行速度" />
                <Row k="1 2 3 4" v="传送到沙滩 / 山丘 / 山顶 / 海上" />
                <Row k="H" v="隐藏界面" />
                <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/55">
                  提示：贴近地面（离地 0.5m）观察草叶、土块与沙滩鹅卵石；滚轮拉近可看远处海浪泡沫。
                </div>
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/35 px-4 py-1.5 text-[11px] text-white/60 backdrop-blur-md">
            方向键移动 · 拖动鼠标环视 · 滚轮缩放 · Shift 加速 · H 隐藏界面
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-cyan-200/90">{k}</span>
      <span className="text-white/70">{v}</span>
    </div>
  );
}
