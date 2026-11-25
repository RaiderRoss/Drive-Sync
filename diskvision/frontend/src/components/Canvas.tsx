import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Slider, Tooltip } from "antd";
import { AimOutlined, ArrowUpOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";

export type NodeKind = "directory" | "file" | "cluster";

export interface FsNode {
  id: string;
  name: string;
  kind: NodeKind;
  size: number;
  modified?: string;
  extension?: string;

  children?: FsNode[];

  childCount?: number;

  count?: number;
}

export function itemCount(node: FsNode): number {
  return node.childCount ?? node.children?.length ?? 0;
}

type Category = "directory" | "archive" | "media" | "document" | "code" | "system" | "cluster";

interface Point {
  x: number;
  y: number;
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

interface PositionedNode {
  node: FsNode;

  parent: number;
  depth: number;

  order: number;

  span: number;

  x: number;
  y: number;

  w: number;

  h: number;

  angle: number;
  category: Category;
  color: string;

  share: number;
}

interface Scene {
  focus: FsNode;
  nodes: PositionedNode[];

  focusW: number;

  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  depthReached: number;

  maxDepth: number;

  radii: number[];
  byId: Map<string, number>;
}

interface HoverInfo {
  node: FsNode;
  color: string;

  share: number | null;
  isFocus: boolean;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 12;
const TAU = Math.PI * 2;

const DEPTH_LIMIT = 12;
export const DEFAULT_DEPTH = 4;

const perDepth = (values: readonly number[]) => (depth: number) => values[Math.min(depth, values.length - 1)];

const childLimit = perDepth([0, 48, 8, 5, 4, 3, 2]);

const tileLengthMin = perDepth([0, 70, 62, 54, 48, 44, 40]);
const tileLengthMax = perDepth([0, 118, 100, 88, 78, 70, 64]);

const tileThickness = perDepth([0, 44, 38, 34, 30, 28, 26]);

const RING_RADII = [0, 156, 284, 404, 514, 618, 716];
const RING_STEP = 98;
const ringRadius = (depth: number) =>
  depth < RING_RADII.length
    ? RING_RADII[depth]
    : RING_RADII[RING_RADII.length - 1] + (depth - (RING_RADII.length - 1)) * RING_STEP;

const FOCUS_H = 54;

const FIT_MARGIN = 40;
const MIN_FIT = 0.05;
const MAX_FIT = 1.8;
const GRID_SIZE = 28;

const KEEP_VISIBLE = 120;

const ENTER_MS = 640;
const ENTER_STAGGER_DEPTH = 130;
const ENTER_STAGGER_SIBLING = 24;
const ENTER_STAGGER_CAP = 220;
const FOCUS_ENTER_MS = 560;
const VIEW_TAU = 105;
const HOVER_TAU = 80;

const DIM_ALPHA = 0.2;
const HOVER_LIFT = 0.07;

const NONE = -1;
const FOCUS = -2;

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;
const TB = KB ** 4;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const clampZoom = (zoom: number) => clamp(zoom, MIN_ZOOM, MAX_ZOOM);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => {
  const c1 = 1.25;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export function formatBytes(bytes: number): string {
  if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}

function formatPercent(fraction: number): string {
  if (fraction >= 0.1) return `${Math.round(fraction * 100)}%`;
  if (fraction >= 0.001) return `${(fraction * 100).toFixed(1)}%`;
  return "<0.1%";
}

const PALETTE: Record<Category, string> = {
  directory: "#f59e0b",
  archive: "#ec4899",
  media: "#3b82f6",
  document: "#14b8a6",
  code: "#22c55e",
  system: "#94a3b8",
  cluster: "#94a3b8",
};

const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "iso", "cab", "pack", "pak", "bundle"]);
const MEDIA_EXTENSIONS = new Set(["mp4", "mkv", "mov", "mp3"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "md", "txt"]);
const CODE_EXTENSIONS = new Set(["rs", "tsx", "ts", "js", "jsx", "json", "sqlite"]);

function categoryOf(node: FsNode): Category {
  if (node.kind === "cluster") return "cluster";
  if (node.kind === "directory") return "directory";
  const ext = (node.extension ?? "").toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (MEDIA_EXTENSIONS.has(ext)) return "media";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "system";
}

export function colorFor(node: FsNode): string {
  return PALETTE[categoryOf(node)];
}

function parseColor(color: string): { r: number; g: number; b: number } | null {
  const text = color.trim();
  const hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgbMatch = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i);
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
  return null;
}

function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${clamp01(alpha)})` : color;
}

function mixColors(a: string, b: string, amount: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const mix = (from: number, to: number) => Math.round(from + (to - from) * amount);
  return `rgb(${mix(ca.r, cb.r)}, ${mix(ca.g, cb.g)}, ${mix(ca.b, cb.b)})`;
}

function describeNode(node: FsNode, isFocus: boolean): string {
  if (node.kind === "cluster") return "Smaller items grouped together";
  if (node.kind === "directory") {
    const count = itemCount(node);
    return `${isFocus ? "Current folder" : "Folder"} · ${count} ${count === 1 ? "item" : "items"}`;
  }
  return node.extension ? `${node.extension.toUpperCase()} file` : "File";
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface CanvasTheme {
  fontFamily: string;
  background: string;
  backgroundCenter: string;
  backgroundEdge: string;
  tileBase: string;
  dot: string;
  ring: string;
  link: string;
  accent: string;
  focusFill: string;
  nodeLabel: string;
  nodeSublabel: string;
}

const TOKEN_FALLBACKS = {
  "--bg-secondary": "#252525",
  "--text-primary": "#ffffff",
  "--text-secondary": "#b3b3b3",
  "--accent-color": "#0078d4",
} as const;

function readTheme(element: HTMLElement): CanvasTheme {
  const style = getComputedStyle(element);
  const token = (name: keyof typeof TOKEN_FALLBACKS) =>
    style.getPropertyValue(name).trim() || TOKEN_FALLBACKS[name];

  const surface = token("--bg-secondary");
  const text = token("--text-secondary");
  const heading = token("--text-primary");
  const accent = token("--accent-color");

  return {
    fontFamily: style.fontFamily || "system-ui, sans-serif",
    background: surface,
    backgroundCenter: mixColors(surface, accent, 0.09),
    backgroundEdge: mixColors(surface, "#000000", 0.32),
    tileBase: mixColors(surface, "#000000", 0.18),
    dot: withAlpha(text, 0.22),
    ring: withAlpha(text, 0.2),
    link: withAlpha(text, 0.26),
    accent,
    focusFill: mixColors(surface, accent, 0.22),
    nodeLabel: heading,
    nodeSublabel: text,
  };
}

const TILE_SLOT = 1.35;

const RING_FILL = 0.9;
const RING_FILL_FIRST = 0.6;

const RING_GROWTH = 1.12;
const SPAN_POWER = 0.85;

function createOrbitalScene(focus: FsNode, maxDepth: number): Scene {
  const nodes: PositionedNode[] = [];
  const slot = (depth: number) => tileThickness(depth) * TILE_SLOT;

  const family = (parent: FsNode, depth: number) => {
    const children = parent.children ?? [];

    const given = children.filter(child => child.kind === "cluster");
    const sorted = children.filter(child => child.kind !== "cluster").sort((a, b) => b.size - a.size);
    const limit = childLimit(depth);
    return { shown: sorted.slice(0, limit), tail: [...sorted.slice(limit), ...given] };
  };

  const withCluster = (parent: FsNode, shown: FsNode[], rest: FsNode[]): FsNode[] => {
    if (rest.length === 0) return shown;
    const count = rest.reduce((sum, item) => sum + (item.kind === "cluster" ? (item.count ?? 1) : 1), 0);
    return [
      ...shown,
      {
        id: `${parent.id}-more`,
        name: `+${count} more`,
        kind: "cluster",
        size: rest.reduce((sum, item) => sum + item.size, 0),
        count,
      },
    ];
  };

  const first = family(focus, 1);
  const firstCount = first.shown.length + (first.tail.length > 0 ? 1 : 0);
  const radii = [0, Math.max(ringRadius(1), (firstCount * slot(1)) / (TAU * RING_FILL_FIRST))];
  for (let depth = 2; depth <= maxDepth + 1; depth++) {
    radii[depth] = radii[depth - 1] + (ringRadius(depth) - ringRadius(depth - 1)) * RING_GROWTH ** (depth - 2);
  }
  const radiusAt = (depth: number) => radii[Math.min(depth, radii.length - 1)];

  const place = (parent: FsNode, parentIndex: number, depth: number, from: number, to: number) => {
    if (depth > maxDepth || parent.kind !== "directory" || !parent.children?.length) return;

    const wedge = to - from;
    const minSpan = slot(depth) / radiusAt(depth);
    const fill = depth === 1 ? RING_FILL_FIRST : RING_FILL;
    const fits = Math.floor((wedge * fill) / minSpan);
    if (fits < 1) return;

    const { shown, tail } = family(parent, depth);
    let entries: FsNode[];
    if (shown.length + (tail.length > 0 ? 1 : 0) <= fits) {
      entries = withCluster(parent, shown, tail);
    } else if (fits === 1) {
      entries = shown[0].size >= parent.size * 0.5 ? [shown[0]] : withCluster(parent, [], [...shown, ...tail]);
    } else {
      entries = withCluster(parent, shown.slice(0, fits - 1), [...shown.slice(fits - 1), ...tail]);
    }

    const weights = entries.map(entry => Math.pow(Math.max(entry.size, 1), SPAN_POWER));
    const maxReal = Math.max(1, ...weights.filter((_, i) => entries[i].kind !== "cluster"));
    const capped = weights.map((w, i) => (entries[i].kind === "cluster" ? Math.min(w, maxReal) : w));
    const weightSum = capped.reduce((sum, w) => sum + w, 0);
    const spare = Math.max(0, wedge - entries.length * minSpan);
    const squeeze = Math.min(1, wedge / (entries.length * minSpan));

    let cursor = from;
    entries.forEach((entry, i) => {
      const span = minSpan * squeeze + (spare * capped[i]) / weightSum;
      const start = cursor;
      cursor += span;

      const angle = start + span / 2;
      const index = nodes.length;
      nodes.push({
        node: entry,
        parent: parentIndex,
        depth,
        order: i,
        span,
        x: Math.cos(angle) * radiusAt(depth),
        y: Math.sin(angle) * radiusAt(depth),
        w: 0,
        h: 0,
        angle,
        category: categoryOf(entry),
        color: colorFor(entry),
        share: parent.size > 0 ? Math.min(1, entry.size / parent.size) : 0,
      });

      place(entry, index, depth + 1, start + span * 0.03, start + span * 0.97);
    });
  };

  place(focus, -1, 1, -Math.PI / 2, Math.PI * 1.5);

  const ringMax = new Array<number>(maxDepth + 1).fill(0);
  let depthReached = 0;
  for (const item of nodes) {
    depthReached = Math.max(depthReached, item.depth);
    if (item.node.kind !== "cluster") ringMax[item.depth] = Math.max(ringMax[item.depth], item.node.size);
  }

  for (const item of nodes) {
    const ratio = ringMax[item.depth] > 0 ? item.node.size / ringMax[item.depth] : 0;
    const fraction = item.node.kind === "cluster" ? 0.5 : Math.sqrt(ratio);

    let w = tileLengthMin(item.depth) + (tileLengthMax(item.depth) - tileLengthMin(item.depth)) * fraction;
    let h = tileThickness(item.depth);

    const ringAngle = Math.atan2(item.y, item.x);
    const turn = item.angle - ringAngle;
    const extent = w * Math.abs(Math.sin(turn)) + h * Math.abs(Math.cos(turn));
    const room = item.span * radiusAt(item.depth) * 0.9;
    if (extent > room) {
      const k = room / extent;
      w *= k;
      h *= k;
    }
    item.w = Math.max(20, w);
    item.h = Math.max(9, h);
  }

  const focusW = Math.min(190, Math.max(130, focus.name.length * 7.6 + 34));
  const bounds = { minX: -focusW / 2, maxX: focusW / 2, minY: -FOCUS_H / 2, maxY: FOCUS_H / 2 };
  for (const item of nodes) {
    const cos = Math.abs(Math.cos(item.angle));
    const sin = Math.abs(Math.sin(item.angle));
    const hw = (item.w * cos + item.h * sin) / 2;
    const hh = (item.w * sin + item.h * cos) / 2;
    bounds.minX = Math.min(bounds.minX, item.x - hw);
    bounds.maxX = Math.max(bounds.maxX, item.x + hw);
    bounds.minY = Math.min(bounds.minY, item.y - hh);
    bounds.maxY = Math.max(bounds.maxY, item.y + hh);
  }

  const byId = new Map<string, number>();
  nodes.forEach((item, index) => {
    byId.set(item.node.id, index);
  });

  return { focus, nodes, focusW, bounds, depthReached, maxDepth, radii, byId };
}

interface RendererHandlers {
  onHover?: (info: HoverInfo | null) => void;
  onZoom?: (zoom: number) => void;
}

interface Ripple {
  x: number;
  y: number;
  color: string;
  size: number;
  start: number;
}

class CanvasRenderer {
  handlers: RendererHandlers = {};

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private theme: CanvasTheme;
  private scene: Scene | null = null;

  private sceneStart = -1e9;
  private ripples: Ripple[] = [];
  private enterEnd = 0;
  private elapsed = 1e9;
  private focusEnter = 1;

  private cur: View = { zoom: 1, x: 0, y: 0 };
  private goal: View = { zoom: 1, x: 0, y: 0 };
  private velocity: Point = { x: 0, y: 0 };
  private fit = 1;
  private dpr = 1;

  private width = 0;
  private height = 0;

  private hover = NONE;
  private selected = NONE;
  private selectedId: string | null = null;
  private pointer: Point | null = null;

  private active: Set<number> | null = null;

  private rx = new Float32Array(0);
  private ry = new Float32Array(0);
  private rs = new Float32Array(0);
  private ra = new Float32Array(0);
  private lift = new Float32Array(0);
  private fade = new Float32Array(0);
  private focusLift = 0;

  private raf = 0;
  private lastNow = 0;
  private lastDraw = 0;
  private lastTheme = 0;
  private dirty = true;
  private visible = true;
  private reduced = false;
  private motionQuery: MediaQueryList | null = null;

  private widthCache = new Map<string, number>();
  private textCache = new Map<string, string>();

  private bgKey = "";
  private bgBase: HTMLCanvasElement | null = null;
  private bgVignette: HTMLCanvasElement | null = null;
  private bgDots: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is unavailable.");
    this.canvas = canvas;
    this.ctx = ctx;
    this.theme = readTheme(canvas);
    if (typeof window.matchMedia === "function") {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reduced = this.motionQuery.matches;
      this.motionQuery.addEventListener("change", this.onMotionChange);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.handlers = {};
  }

  private onMotionChange = () => {
    this.reduced = this.motionQuery?.matches ?? false;
    this.dirty = true;
  };

  setScene(scene: Scene) {
    const replay =
      !this.scene || this.scene.focus.id !== scene.focus.id || this.scene.maxDepth !== scene.maxDepth;
    this.scene = scene;

    const n = scene.nodes.length;
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.rs = new Float32Array(n).fill(1);
    this.ra = new Float32Array(n).fill(1);
    this.lift = new Float32Array(n);
    this.fade = new Float32Array(n).fill(1);
    this.focusLift = 0;

    let end = FOCUS_ENTER_MS;
    for (const item of scene.nodes) end = Math.max(end, this.delayOf(item) + ENTER_MS);
    this.enterEnd = end;

    if (replay) {
      this.sceneStart = performance.now();
      this.ripples = [];
    }

    this.hover = NONE;
    this.active = null;
    this.handlers.onHover?.(null);
    this.setSelected(this.selectedId);
    this.recomputeFit();
    this.clampGoal();
    this.dirty = true;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    const scene = this.scene;
    if (!scene || id === null) this.selected = NONE;
    else if (id === scene.focus.id) this.selected = FOCUS;
    else this.selected = scene.byId.get(id) ?? NONE;
    this.dirty = true;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.dirty = true;
  }

  resize(width: number, height: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
    this.recomputeFit();
    this.clampGoal();
    this.dirty = true;
  }

  nodeById(id: string): FsNode | null {
    const scene = this.scene;
    if (!scene) return null;
    if (id === scene.focus.id) return scene.focus;
    const index = scene.byId.get(id);
    return index === undefined ? null : scene.nodes[index].node;
  }

  getZoom() {
    return this.goal.zoom;
  }

  zoomAt(factor: number, anchor: Point = { x: 0, y: 0 }, instant = false) {
    const next = clampZoom(this.goal.zoom * factor);
    if (next === this.goal.zoom) return;
    const k = next / this.goal.zoom;
    const pan = this.clampPan(next, anchor.x - (anchor.x - this.goal.x) * k, anchor.y - (anchor.y - this.goal.y) * k);
    this.goal = { zoom: next, x: pan.x, y: pan.y };
    this.velocity = { x: 0, y: 0 };
    if (instant) this.cur = { ...this.goal };
    this.handlers.onZoom?.(next);
    this.dirty = true;
  }

  panBy(dx: number, dy: number, instant = true) {
    const pan = this.clampPan(this.goal.zoom, this.goal.x + dx, this.goal.y + dy);
    this.goal.x = pan.x;
    this.goal.y = pan.y;
    this.velocity = { x: 0, y: 0 };
    if (instant) {
      this.cur.x = pan.x;
      this.cur.y = pan.y;
    }
    this.dirty = true;
  }

  resetView(instant = false) {
    this.goal = { zoom: 1, x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    if (instant) this.cur = { ...this.goal };
    this.handlers.onZoom?.(1);
    this.dirty = true;
  }

  fling(vx: number, vy: number) {
    if (this.reduced || Math.hypot(vx, vy) < 0.05) return;
    this.velocity = { x: clamp(vx, -3, 3), y: clamp(vy, -3, 3) };
    this.dirty = true;
  }

  stopFling() {
    this.velocity = { x: 0, y: 0 };
  }

  private recomputeFit() {
    const scene = this.scene;
    if (!scene) {
      this.fit = 1;
      return;
    }
    const { minX, maxX, minY, maxY } = scene.bounds;
    const fit = Math.min(
      (this.width - FIT_MARGIN * 2) / (maxX - minX),
      (this.height - FIT_MARGIN * 2) / (maxY - minY),
    );
    this.fit = clamp(Number.isFinite(fit) ? fit : 1, MIN_FIT, MAX_FIT);

    if (scene.nodes.length === 0) this.fit = Math.min(this.fit, 1.1);
  }

  private clampPan(zoom: number, x: number, y: number): Point {
    const scene = this.scene;
    if (!scene) return { x, y };
    const scale = this.fit * zoom;
    const b = scene.bounds;
    const maxX = Math.max(0, ((b.maxX - b.minX) * scale) / 2 + this.width / 2 - KEEP_VISIBLE);
    const maxY = Math.max(0, ((b.maxY - b.minY) * scale) / 2 + this.height / 2 - KEEP_VISIBLE);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }

  private clampGoal() {
    const pan = this.clampPan(this.goal.zoom, this.goal.x, this.goal.y);
    this.goal.x = pan.x;
    this.goal.y = pan.y;
  }

  private viewScale(): number {
    return this.fit * this.cur.zoom;
  }

  private origin(scale: number): Point {
    const b = this.scene?.bounds;
    const midX = b ? (b.minX + b.maxX) / 2 : 0;
    const midY = b ? (b.minY + b.maxY) / 2 : 0;
    return { x: this.width / 2 + this.cur.x - midX * scale, y: this.height / 2 + this.cur.y - midY * scale };
  }

  private pick(clientX: number, clientY: number): number {
    const scene = this.scene;
    if (!scene) return NONE;
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.viewScale();
    const origin = this.origin(scale);
    const x = (clientX - rect.left - origin.x) / scale;
    const y = (clientY - rect.top - origin.y) / scale;
    const slop = 3 / scale;

    for (let i = scene.nodes.length - 1; i >= 0; i--) {
      const grow = this.rs[i];
      if (grow < 0.3 || this.ra[i] < 0.3) continue;
      const item = scene.nodes[i];

      const dx = x - this.rx[i];
      const dy = y - this.ry[i];
      const cos = Math.cos(item.angle);
      const sin = Math.sin(item.angle);
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) <= (item.w * grow) / 2 + slop && Math.abs(ly) <= (item.h * grow) / 2 + slop) return i;
    }
    const fs = Math.max(0.3, easeOutBack(this.focusEnter));
    if (Math.abs(x) <= (scene.focusW * fs) / 2 + slop && Math.abs(y) <= (FOCUS_H * fs) / 2 + slop) return FOCUS;
    return NONE;
  }

  hitTest(clientX: number, clientY: number): FsNode | null {
    const scene = this.scene;
    if (!scene) return null;
    const index = this.pick(clientX, clientY);
    if (index === FOCUS) return scene.focus;
    return index >= 0 ? scene.nodes[index].node : null;
  }

  activateAt(clientX: number, clientY: number): FsNode | null {
    const scene = this.scene;
    if (!scene) return null;
    const index = this.pick(clientX, clientY);
    if (index === NONE) return null;
    if (index === FOCUS) {
      this.addRipple(0, 0, this.theme.accent, scene.focusW * 0.5);
      return scene.focus;
    }
    const item = scene.nodes[index];
    this.addRipple(this.rx[index], this.ry[index], item.color, Math.max(item.w, item.h) * 0.55);
    return item.node;
  }

  private addRipple(x: number, y: number, color: string, size: number) {
    if (this.reduced) return;
    this.ripples.push({ x, y, color, size, start: performance.now() });
    this.dirty = true;
  }

  hoverAt(clientX: number, clientY: number): boolean {
    this.pointer = { x: clientX, y: clientY };
    this.updateHover();
    return this.hover !== NONE;
  }

  clearHover() {
    this.pointer = null;
    this.setHover(NONE);
  }

  private updateHover() {
    if (this.pointer) this.setHover(this.pick(this.pointer.x, this.pointer.y));
  }

  private setHover(index: number) {
    if (index === this.hover) return;
    this.hover = index;
    this.active = null;
    const scene = this.scene;
    if (scene && index >= 0) {
      const nodes = scene.nodes;
      const set = new Set<number>([index]);
      for (let p = nodes[index].parent; p >= 0; p = nodes[p].parent) set.add(p);
      for (let i = index + 1; i < nodes.length && nodes[i].depth > nodes[index].depth; i++) set.add(i);
      this.active = set;
    }
    this.dirty = true;
    this.handlers.onHover?.(this.infoFor(index));
  }

  private infoFor(index: number): HoverInfo | null {
    const scene = this.scene;
    if (!scene) return null;
    if (index === FOCUS) return { node: scene.focus, color: this.theme.accent, share: null, isFocus: true };
    if (index >= 0) {
      const item = scene.nodes[index];
      return { node: item.node, color: item.color, share: item.share, isFocus: false };
    }
    return null;
  }

  private delayOf(item: PositionedNode) {
    return (item.depth - 1) * ENTER_STAGGER_DEPTH + Math.min(ENTER_STAGGER_CAP, item.order * ENTER_STAGGER_SIBLING);
  }

  private layout(now: number) {
    const scene = this.scene;
    if (!scene) return;
    this.elapsed = this.reduced ? 1e9 : now - this.sceneStart;
    this.focusEnter = clamp01(this.elapsed / FOCUS_ENTER_MS);

    const nodes = scene.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const item = nodes[i];
      const t = clamp01((this.elapsed - this.delayOf(item)) / ENTER_MS);
      const e = easeOutCubic(t);
      const fromX = item.parent >= 0 ? nodes[item.parent].x : 0;
      const fromY = item.parent >= 0 ? nodes[item.parent].y : 0;
      this.rx[i] = fromX + (item.x - fromX) * e;
      this.ry[i] = fromY + (item.y - fromY) * e;
      this.rs[i] = easeOutBack(t);
      this.ra[i] = clamp01(t * 2.4);
    }
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const scene = this.scene;
    if (!scene || !this.visible || this.width === 0) {
      this.lastNow = now;
        return;
    }
    const dt = clamp(now - (this.lastNow || now), 0, 64);
    this.lastNow = now;
    let busy = this.dirty;

    if (now - this.lastTheme > 1200) {
      this.lastTheme = now;
      this.theme = readTheme(this.canvas);
      if (Math.min(window.devicePixelRatio || 1, 2) !== this.dpr) this.resize(this.width, this.height);
      busy = true;
    }

    if (this.velocity.x !== 0 || this.velocity.y !== 0) {
      const next = this.clampPan(this.goal.zoom, this.goal.x + this.velocity.x * dt, this.goal.y + this.velocity.y * dt);
      if (next.x === this.goal.x) this.velocity.x = 0;
      if (next.y === this.goal.y) this.velocity.y = 0;
      this.goal.x = next.x;
      this.goal.y = next.y;
      this.cur.x = next.x;
      this.cur.y = next.y;
      const decay = Math.exp(-dt / 325);
      this.velocity.x *= decay;
      this.velocity.y *= decay;
      if (Math.hypot(this.velocity.x, this.velocity.y) < 0.015) this.velocity = { x: 0, y: 0 };
      busy = true;
    }

    const f = this.reduced ? 1 : 1 - Math.exp(-dt / VIEW_TAU);
    const dz = this.goal.zoom - this.cur.zoom;
    const dx = this.goal.x - this.cur.x;
    const dy = this.goal.y - this.cur.y;
    let viewMoving = false;
    if (dz !== 0 || dx !== 0 || dy !== 0) {
      viewMoving = true;
      busy = true;
      if (Math.abs(dz) < 0.0005 && Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        this.cur = { ...this.goal };
      } else {
        this.cur.zoom += dz * f;
        this.cur.x += dx * f;
        this.cur.y += dy * f;
      }
    }

    this.layout(now);
    const entering = !this.reduced && this.elapsed < this.enterEnd;
    if (entering) busy = true;
    if (this.pointer && (viewMoving || entering)) this.updateHover();

    const kh = this.reduced ? 1 : 1 - Math.exp(-dt / HOVER_TAU);
    const nodes = scene.nodes;
    for (let i = 0; i < nodes.length; i++) {
      let targetAlpha = 1;
      if (this.active && !this.active.has(i)) targetAlpha = DIM_ALPHA;
      if (i === this.hover) targetAlpha = 1;
      const targetLift = i === this.hover ? 1 : 0;
      const dFade = targetAlpha - this.fade[i];
      const dLift = targetLift - this.lift[i];
      if (Math.abs(dFade) > 0.004 || Math.abs(dLift) > 0.004) {
        this.fade[i] += dFade * kh;
        this.lift[i] += dLift * kh;
        busy = true;
      }
    }
    const focusTarget = this.hover === FOCUS ? 1 : 0;
    if (Math.abs(focusTarget - this.focusLift) > 0.004) {
      this.focusLift += (focusTarget - this.focusLift) * kh;
      busy = true;
    }

    if (this.ripples.length > 0) busy = true;

    if (!busy && this.reduced) return;
    if (!busy && now - this.lastDraw < 40) return;
    this.draw(now);
  };

  private draw(now: number) {
    const scene = this.scene;
    if (!scene) return;
    this.dirty = false;
    this.lastDraw = now;
    const { ctx, canvas } = this;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(this.dpr, this.dpr);

    const width = this.width;
    const height = this.height;
    const scale = this.viewScale();
    const { x: cx, y: cy } = this.origin(scale);

    this.drawBackground(width, height, cx, cy);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    const px = 1 / scale;
    this.drawRings(scene, px, now);
    this.drawLinks(scene, px, now);
    this.drawFocus(scene, px, now);
    this.drawTiles(scene, px, scale, now);
    this.drawRipples(px, now);
    ctx.restore();

    this.drawLabels(scene, cx, cy, scale, width, height);
  }

  private ensureBackground() {
    const { theme, width, height, dpr } = this;
    const key = `${width}x${height}@${dpr}|${theme.backgroundCenter}|${theme.backgroundEdge}|${theme.dot}`;
    if (key === this.bgKey) return;
    this.bgKey = key;

    const layer = (paint: (g: CanvasRenderingContext2D, radius: number) => void) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.floor(width * dpr));
      c.height = Math.max(1, Math.floor(height * dpr));
      const g = c.getContext("2d");
      if (g) {
        g.scale(dpr, dpr);
        paint(g, Math.hypot(width, height) * 0.6);
      }
      return c;
    };
    const radial = (g: CanvasRenderingContext2D, radius: number, inner: number, from: string, to: string) => {
      const gradient = g.createRadialGradient(width / 2, height / 2, inner, width / 2, height / 2, radius);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      g.fillStyle = gradient;
      g.fillRect(0, 0, width, height);
    };

    this.bgBase = layer((g, r) => {
      radial(g, r, 0, theme.backgroundCenter, theme.backgroundEdge);

      const noise = document.createElement("canvas");
      noise.width = noise.height = 128;
      const n = noise.getContext("2d");
      if (!n) return;
      const image = n.createImageData(128, 128);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
        image.data[i + 3] = Math.floor(Math.random() * 7);
      }
      n.putImageData(image, 0, 0);
      const pattern = g.createPattern(noise, "repeat");
      if (pattern) {
        g.fillStyle = pattern;
        g.fillRect(0, 0, width, height);
      }
    });

    this.bgVignette = layer((g, r) =>
      radial(g, r, r * 0.25, withAlpha(theme.backgroundEdge, 0), withAlpha(theme.backgroundEdge, 0.94)));

    const tile = document.createElement("canvas");
    tile.width = tile.height = Math.max(1, Math.round(GRID_SIZE * dpr));
    const t = tile.getContext("2d");
    if (t) {
      t.scale(dpr, dpr);
      t.fillStyle = theme.dot;
      t.fillRect(GRID_SIZE / 2 - 0.75, GRID_SIZE / 2 - 0.75, 1.5, 1.5);
    }
    this.bgDots = this.ctx.createPattern(tile, "repeat");
  }

  private drawBackground(width: number, height: number, cx: number, cy: number) {
    const { ctx, dpr } = this;
    this.ensureBackground();
    if (this.bgBase) ctx.drawImage(this.bgBase, 0, 0, width, height);

    if (this.bgDots) {
      this.bgDots.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, (cx - GRID_SIZE / 2) % GRID_SIZE, (cy - GRID_SIZE / 2) % GRID_SIZE]));
      ctx.fillStyle = this.bgDots;
      ctx.fillRect(0, 0, width, height);
    }
    if (this.bgVignette) ctx.drawImage(this.bgVignette, 0, 0, width, height);
  }

  private drawRings(scene: Scene, px: number, now: number) {
    const { ctx, theme } = this;
    ctx.lineWidth = px;
    ctx.strokeStyle = theme.ring;
    ctx.setLineDash([3 * px, 7 * px]);
    for (let depth = 1; depth <= scene.depthReached; depth++) {
      const t = easeOutCubic(clamp01((this.elapsed - (depth - 1) * ENTER_STAGGER_DEPTH) / 620));
      if (t <= 0.01) continue;

      ctx.lineDashOffset = this.reduced ? 0 : (depth % 2 ? -1 : 1) * now * 0.006 * px;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.arc(0, 0, scene.radii[Math.min(depth, scene.radii.length - 1)] * t, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineDashOffset = 0;
    ctx.setLineDash([]);
  }

  private drawLinks(scene: Scene, px: number, now: number) {
    const { ctx, theme } = this;
    const nodes = scene.nodes;

    const line = (i: number) => {
      const p = nodes[i].parent;
      const x0 = p >= 0 ? this.rx[p] : 0;
      const y0 = p >= 0 ? this.ry[p] : 0;
      const x1 = this.rx[i];
      const y1 = this.ry[i];
      const r0 = Math.hypot(x0, y0);
      const r1 = Math.hypot(x1, y1);
      const a1 = Math.atan2(y1, x1);
      const a0 = p >= 0 ? Math.atan2(y0, x0) : a1;
      const mid = (r0 + r1) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(Math.cos(a0) * mid, Math.sin(a0) * mid, Math.cos(a1) * mid, Math.sin(a1) * mid, x1, y1);
      ctx.stroke();
    };

    ctx.lineWidth = px * 1.2;
    ctx.strokeStyle = theme.link;
    for (let i = 0; i < nodes.length; i++) {
      const alpha = this.fade[i] * this.ra[i];
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      line(i);
    }

    if (this.active) {
      ctx.setLineDash([5 * px, 6 * px]);
      ctx.lineDashOffset = this.reduced ? 0 : -now * 0.035 * px;
      ctx.lineWidth = px * 2;
      for (const i of this.active) {
        ctx.globalAlpha = this.ra[i];
        ctx.strokeStyle = withAlpha(nodes[i].color, 0.95);
        line(i);
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawFocus(scene: Scene, px: number, now: number) {
    const { ctx, theme } = this;
    const grow = easeOutBack(this.focusEnter);
    if (grow < 0.02) return;

    const lift = this.focusLift;
    const breathe = this.reduced ? 0.5 : (Math.sin(now / 950) + 1) / 2;
    const s = grow * (1 + 0.045 * lift);
    const u = px / s;
    const hw = scene.focusW / 2;
    const hh = FOCUS_H / 2;
    const alpha = clamp01(this.focusEnter * 2.5);

    ctx.save();
    ctx.globalAlpha = alpha;

    const haloR = scene.focusW * 0.85 + breathe * 10 + lift * 8;
    const halo = ctx.createRadialGradient(0, 0, hh * 0.6, 0, 0, haloR);
    halo.addColorStop(0, withAlpha(theme.accent, 0.3 + 0.12 * lift));
    halo.addColorStop(1, withAlpha(theme.accent, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, TAU);
    ctx.fill();

    ctx.scale(s, s);

    roundedRect(ctx, -hw, -hh, hw * 2, hh * 2, 10 * u);
    const glow = 0.5 + 0.35 * breathe + 0.4 * lift;
    for (const [width, strength] of [[16, 0.06], [10, 0.1], [5, 0.18]] as const) {
      ctx.strokeStyle = withAlpha(theme.accent, strength * glow);
      ctx.lineWidth = width * u;
      ctx.stroke();
    }
    ctx.fillStyle = theme.tileBase;
    ctx.fill();

    const gradient = ctx.createLinearGradient(0, -hh, 0, hh);
    gradient.addColorStop(0, mixColors(theme.background, theme.accent, 0.42 + 0.14 * lift));
    gradient.addColorStop(1, mixColors(theme.background, theme.accent, 0.16 + 0.1 * lift));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = (2 + lift) * u;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-hw + 10 * u, -hh + 1.6 * u);
    ctx.lineTo(hw - 10 * u, -hh + 1.6 * u);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 + 0.14 * lift})`;
    ctx.lineWidth = u;
    ctx.stroke();

    if (this.selected === FOCUS) {
      const pad = 5 * u;
      roundedRect(ctx, -hw - pad, -hh - pad, hw * 2 + pad * 2, hh * 2 + pad * 2, 14 * u);
      ctx.strokeStyle = theme.nodeLabel;
      ctx.lineWidth = 1.6 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.lineDashOffset = this.reduced ? 0 : -now * 0.02 * u;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTiles(scene: Scene, px: number, scale: number, now: number) {
    for (let i = 0; i < scene.nodes.length; i++) {
      if (i !== this.hover) this.drawTile(scene, i, px, scale, now);
    }
    if (this.hover >= 0) this.drawTile(scene, this.hover, px, scale, now);
    this.ctx.globalAlpha = 1;
  }

  private drawTile(scene: Scene, index: number, px: number, scale: number, now: number) {
    const { ctx, theme } = this;
    const item = scene.nodes[index];
    const alpha = this.fade[index] * this.ra[index];
    const grow = this.rs[index];
    if (this.ra[index] < 0.01 || grow < 0.02) return;

    const lift = this.lift[index];
    const s = grow * (1 + HOVER_LIFT * lift);
    const u = px / s;
    const { w, h, color, node } = item;

    const turn = item.angle + (Math.cos(item.angle) < 0 ? Math.PI : 0);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.rx[index], this.ry[index]);
    ctx.rotate(turn);
    ctx.scale(s, s);

    roundedRect(ctx, -w / 2, -h / 2, w, h, 6 * u);

    if (lift > 0.02) {
      for (const [width, strength] of [[16, 0.07], [10, 0.12], [5, 0.2]] as const) {
        ctx.strokeStyle = withAlpha(color, strength * lift * 1.4);
        ctx.lineWidth = width * u;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = this.ra[index];
    ctx.fillStyle = theme.tileBase;
    ctx.fill();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = withAlpha(color, 0.1 + 0.14 * lift);
    ctx.fill();

    if (item.share > 0) {
      const dir = turn !== item.angle ? -1 : 1;
      const filled = Math.max(2.5 * u, w * item.share);
      const x0 = dir > 0 ? -w / 2 : w / 2 - filled;
      ctx.save();
      ctx.clip();
      const gradient = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      gradient.addColorStop(0, withAlpha(color, 0.78 + 0.18 * lift));
      gradient.addColorStop(1, withAlpha(color, 0.58 + 0.2 * lift));
      ctx.fillStyle = gradient;
      ctx.fillRect(x0, -h / 2, filled, h);
      if (filled < w - 2 * u) {
        ctx.fillStyle = withAlpha(color, 1);
        ctx.fillRect(dir > 0 ? x0 + filled - 1.2 * u : x0, -h / 2, 1.2 * u, h);
      }
      ctx.restore();
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = (node.kind === "directory" ? 1.8 : 1.3) * (1 + 0.5 * lift) * u;
    if (node.kind === "cluster") ctx.setLineDash([4 * u, 3 * u]);
    ctx.stroke();
    ctx.setLineDash([]);

    const inset = 3.5 * u;
    if (node.kind === "directory" && Math.min(w, h) > inset * 3) {
      roundedRect(ctx, -w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, 3 * u);
      ctx.strokeStyle = withAlpha(color, 0.26);
      ctx.lineWidth = u;
      ctx.stroke();
    }

    if (h * s * scale >= 14) {
      const edge = Math.min(8 * u, w / 4);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + edge, -h / 2 + 1.5 * u);
      ctx.lineTo(w / 2 - edge, -h / 2 + 1.5 * u);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + 0.14 * lift})`;
      ctx.lineWidth = u;
      ctx.stroke();
    }

    if (index === this.selected) {
      const pad = 4.5 * u;
      roundedRect(ctx, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, 9 * u);
      ctx.strokeStyle = theme.nodeLabel;
      ctx.lineWidth = 1.6 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.lineDashOffset = this.reduced ? 0 : -now * 0.02 * u;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRipples(px: number, now: number) {
    const { ctx } = this;
    this.ripples = this.ripples.filter(ripple => now - ripple.start < 760);
    for (const ripple of this.ripples) {
      const t = clamp01((now - ripple.start) / 760);
      const e = easeOutCubic(t);
      for (const [grow, strength] of [[1, 0.7], [0.62, 0.4]] as const) {
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.size * (0.5 + e * 1.7 * grow), 0, TAU);
        ctx.strokeStyle = withAlpha(ripple.color, strength * (1 - t));
        ctx.lineWidth = px * (1 + 2.5 * (1 - t));
        ctx.stroke();
      }
    }
  }

  private measure(text: string): number {
    const key = `${this.ctx.font}|${text}`;
    let width = this.widthCache.get(key);
    if (width === undefined) {
      width = this.ctx.measureText(text).width;
      if (this.widthCache.size > 4000) this.widthCache.clear();
      this.widthCache.set(key, width);
    }
    return width;
  }

  private fitText(text: string, maxWidth: number): string {
    const limit = Math.floor(maxWidth / 2) * 2;
    const key = `${this.ctx.font}|${limit}|${text}`;
    const cached = this.textCache.get(key);
    if (cached !== undefined) return cached;

    let result = text;
    const full = this.measure(text);
    if (full > limit) {
      const ellipsis = this.measure("…");
      let n = limit <= ellipsis ? 0 : Math.min(text.length - 1, Math.floor((text.length * (limit - ellipsis)) / full));
      while (n > 0 && this.measure(`${text.slice(0, n)}…`) > limit) n--;
      while (n > 0 && n < text.length - 1 && this.measure(`${text.slice(0, n + 1)}…`) <= limit) n++;
      result = n >= 2 ? `${text.slice(0, n).trimEnd()}…` : "";
    }
    if (this.textCache.size > 3000) this.textCache.clear();
    this.textCache.set(key, result);
    return result;
  }

  private drawLabels(scene: Scene, cx: number, cy: number, scale: number, width: number, height: number) {
    const { ctx, theme } = this;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const REF = 20;
    const nameRef = `500 ${REF}px ${theme.fontFamily}`;
    const subRef = `${REF}px ${theme.fontFamily}`;
    const MIN_FONT = 4;
    const halo = withAlpha(theme.tileBase, 0.85);

    const nodes = scene.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const item = nodes[i];
      let alpha = this.fade[i] * clamp01((this.ra[i] - 0.5) / 0.5);
      if (alpha < 0.04) continue;

      const grow = this.rs[i] * (1 + HOVER_LIFT * this.lift[i]);
      const x = cx + this.rx[i] * scale;
      const y = cy + this.ry[i] * scale;
      const length = item.w * scale * grow;
      const thickness = item.h * scale * grow;
      const reach = Math.max(length, thickness) / 2;
      if (x + reach < 0 || x - reach > width || y + reach < 0 || y - reach > height) continue;

      const avail = length * 0.86;
      const sizeText = formatBytes(item.node.size);
      ctx.font = nameRef;
      const nameFit = (REF * avail) / Math.max(1, this.measure(item.node.name));
      ctx.font = subRef;
      const sizeFit = (REF * avail) / Math.max(1, this.measure(sizeText));

      const single = Math.min(nameFit, thickness * 0.6);
      const twoName = Math.min(nameFit, thickness * 0.4, sizeFit / 0.82);
      const twoLines = twoName >= MIN_FONT + 1.5 || twoName >= single * 0.8;
      const nameFont = Math.floor((twoLines ? twoName : single) * 4) / 4;
      if (nameFont < MIN_FONT) continue;
      alpha *= clamp01((nameFont - MIN_FONT) / 2);
      if (alpha < 0.04) continue;
      const subFont = Math.floor(nameFont * 0.82 * 4) / 4;

      let turn = item.angle;
      if (Math.cos(turn) < 0) turn += Math.PI;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(turn);

      ctx.shadowColor = halo;
      ctx.shadowBlur = Math.max(1.5, nameFont * 0.22);
      ctx.font = `500 ${nameFont}px ${theme.fontFamily}`;
      ctx.fillStyle = theme.nodeLabel;
      const gap = nameFont * 0.12;
      ctx.fillText(item.node.name, 0, twoLines ? -(subFont / 2 + gap) : 0);
      if (twoLines) {
        ctx.font = `${subFont}px ${theme.fontFamily}`;
        ctx.fillStyle = theme.nodeSublabel;
        ctx.fillText(sizeText, 0, nameFont / 2 + gap);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    const fs = easeOutBack(this.focusEnter) * (1 + 0.045 * this.focusLift);
    const labelAlpha = clamp01((this.focusEnter - 0.4) / 0.6);
    if (labelAlpha <= 0.02) return;
    const fw = scene.focusW * scale * fs;
    const fh = FOCUS_H * scale * fs;
    ctx.globalAlpha = labelAlpha;
    ctx.font = `600 13px ${theme.fontFamily}`;
    const name = this.fitText(scene.focus.name, fw - 20);
    const roomForSize = fh >= 38;
    ctx.fillStyle = theme.nodeLabel;
    ctx.fillText(name, cx, roomForSize ? cy - 8 : cy);
    if (roomForSize) {
      const items = itemCount(scene.focus);
      ctx.font = `10.5px ${theme.fontFamily}`;
      ctx.fillStyle = theme.nodeSublabel;
      ctx.fillText(`${formatBytes(scene.focus.size)}${items ? ` · ${items} ${items === 1 ? "item" : "items"}` : ""}`, cx, cy + 10);
    }
    ctx.globalAlpha = 1;
  }
}

const STYLES = `
.dv-root {
  --dv-glass: color-mix(in srgb, var(--bg-secondary, #252525) 70%, transparent);
  --dv-line: color-mix(in srgb, var(--text-secondary, #b3b3b3) 24%, transparent);
  --dv-accent: var(--accent-color, #0078d4);
  --dv-text: var(--text-primary, #ffffff);
  --dv-sub: var(--text-secondary, #b3b3b3);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  isolation: isolate;
  background: var(--bg-secondary, #252525);
  color: var(--dv-sub);
  font-size: 12px;
  animation: dv-fade .6s ease both;
}
.dv-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
.dv-canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--dv-accent); }

.dv-glass {
  background: var(--dv-glass);
  border: 1px solid var(--dv-line);
  -webkit-backdrop-filter: blur(14px) saturate(1.35);
  backdrop-filter: blur(14px) saturate(1.35);
  box-shadow: 0 10px 28px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .06);
}

.dv-hint {
  position: absolute; left: 14px; bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px;
  max-width: calc(100% - 200px); pointer-events: none; font-size: 11px;
  transition: opacity .7s ease, transform .7s ease;
}
.dv-hint--hidden { opacity: 0; transform: translateY(6px); }
.dv-hint span {
  padding: 4px 10px; border-radius: 999px; animation: dv-in .5s cubic-bezier(.2, .8, .2, 1) both;
  background: var(--dv-glass); border: 1px solid var(--dv-line);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.dv-hint span:nth-child(1) { animation-delay: .7s; }
.dv-hint span:nth-child(2) { animation-delay: .78s; }
.dv-hint span:nth-child(3) { animation-delay: .86s; }
.dv-hint b { color: var(--dv-text); font-weight: 600; }

.dv-controls {
  position: absolute; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: 12px;
  animation: dv-in .55s cubic-bezier(.2, .8, .2, 1) .25s both;
}
.dv-zoomval { min-width: 46px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dv-sub); user-select: none; }
.dv-sep { width: 1px; height: 16px; margin: 0 3px; background: var(--dv-line); }

.dv-depthbar {
  position: absolute; right: 12px; bottom: 60px; display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 12px;
  animation: dv-in .55s cubic-bezier(.2, .8, .2, 1) .3s both;
}
.dv-depthbar__label { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; opacity: .6; user-select: none; }
.dv-depthbar .ant-slider { width: 110px; margin: 0 4px; }
.dv-depthbar__value { min-width: 12px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dv-text); user-select: none; }

.dv-tip { position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; opacity: 0; transition: opacity .14s ease; will-change: transform; }
.dv-tip--on { opacity: 1; }
.dv-tip__card {
  min-width: 180px; max-width: 300px; padding: 11px 13px 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary, #252525) 55%, #000 45%);
  border: 1px solid var(--dv-line);
  box-shadow: 0 14px 36px rgba(0, 0, 0, .5), inset 0 1px 0 rgba(255, 255, 255, .06);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  transform: translateY(5px) scale(.96); transform-origin: top left;
  transition: transform .2s cubic-bezier(.2, .8, .2, 1);
}
.dv-tip--on .dv-tip__card { transform: none; }
.dv-tip__head { display: flex; align-items: center; gap: 8px; color: var(--dv-text); font-weight: 600; font-size: 12.5px; }
.dv-tip__dot { flex: none; width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
.dv-tip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-tip__meta { margin-top: 3px; font-size: 11px; color: var(--dv-sub); }
.dv-tip__size { margin-top: 8px; font-size: 17px; font-weight: 650; letter-spacing: -.01em; color: var(--dv-text); font-variant-numeric: tabular-nums; }
.dv-tip__share { margin-top: 2px; font-size: 11px; color: var(--dv-sub); }
.dv-tip__bar { margin-top: 7px; height: 5px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--dv-sub) 22%, transparent); }
.dv-tip__bar i { display: block; height: 100%; border-radius: 3px; transition: width .35s cubic-bezier(.2, .8, .2, 1), background .2s; }
.dv-tip__hint { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--dv-line); font-size: 10.5px; color: var(--dv-sub); }
.dv-tip__hint b { color: var(--dv-text); font-weight: 600; }

.dv-empty {
  position: absolute; left: 0; right: 0; top: calc(50% + 74px);
  text-align: center; pointer-events: none; animation: dv-in .6s cubic-bezier(.2, .8, .2, 1) .5s both;
}
.dv-empty strong { display: block; color: var(--dv-text); font-size: 13px; font-weight: 600; }

.dv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.dv-root[data-compact] .dv-hint { display: none; }

@keyframes dv-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dv-in { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .dv-root, .dv-root * { animation: none !important; transition: none !important; }
}
`;

interface CanvasProps {
  focus: FsNode;

  onSelect: (node: FsNode) => void;

  onNavigate: (node: FsNode) => void;

  onNavigateUp?: () => void;

  depth?: number;

  onDepthChange?: (depth: number) => void;

  layoutDepth?: number;

  selectedId?: string | null;
  style?: CSSProperties;
}

interface DragState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  samples: Array<{ x: number; y: number; t: number }>;
}

export default function Canvas({
  focus,
  onSelect,
  onNavigate,
  onNavigateUp,
  depth: depthProp,
  onDepthChange,
  layoutDepth,
  selectedId,
  style,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ dist: number; x: number; y: number } | null>(null);
  const pointerPosRef = useRef<Point>({ x: 0, y: 0 });
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  const lastNavRef = useRef(0);
  const touchTipTimer = useRef<number | undefined>(undefined);

  const [zoomPct, setZoomPct] = useState(100);
  const [panning, setPanning] = useState(false);
  const [compact, setCompact] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [tipInfo, setTipInfo] = useState<HoverInfo | null>(null);
  const [tipVisible, setTipVisible] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [localDepth, setLocalDepth] = useState(DEFAULT_DEPTH);
  const depth = depthProp ?? localDepth;
  const setDepth = useCallback(
    (value: number) => {
      if (depthProp === undefined) setLocalDepth(value);
      onDepthChange?.(value);
    },
    [depthProp, onDepthChange],
  );
  const shownDepth = Math.min(depth, layoutDepth ?? depth);

  const scene = useMemo(() => createOrbitalScene(focus, shownDepth), [focus, shownDepth]);
  const activeSelected = selectedId !== undefined ? selectedId : localSelected;

  const dismissHint = useCallback(() => setHintVisible(false), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;
    renderer.handlers = {
      onHover: info => {
        if (info) setTipInfo(info);
        setTipVisible(info !== null);
      },
      onZoom: zoom => setZoomPct(Math.round(zoom * 100)),
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
      setCompact(rect.width < 560);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    resize();

    const visibility = new IntersectionObserver(entries => {
      for (const entry of entries) renderer.setVisible(entry.isIntersecting);
    });
    visibility.observe(wrap);

    return () => {
      resizeObserver.disconnect();
      visibility.disconnect();
      renderer.destroy();
      rendererRef.current = null;
      window.clearTimeout(touchTipTimer.current);
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    rendererRef.current?.resetView(true);
    setLocalSelected(null);
  }, [focus.id]);

  useEffect(() => {
    rendererRef.current?.resetView(true);
  }, [shownDepth]);

  useEffect(() => {
    rendererRef.current?.setSelected(activeSelected ?? null);
  }, [activeSelected]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), 16000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) return;
      const rect = canvas.getBoundingClientRect();
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= rect.height;
      delta = clamp(delta, -240, 240);
      renderer.zoomAt(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
      setHintVisible(false);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const positionTip = useCallback(() => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const rect = wrap.getBoundingClientRect();
    const px = pointerPosRef.current.x - rect.left;
    const py = pointerPosRef.current.y - rect.top;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = px + 18;
    let y = py + 20;
    if (x + w > rect.width - 8) x = px - 18 - w;
    if (y + h > rect.height - 8) y = py - 18 - h;
    tip.style.transform = `translate3d(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px, 0)`;
  }, []);

  useLayoutEffect(() => {
    positionTip();
  }, [tipInfo, positionTip]);

  const select = (node: FsNode) => {
    if (selectedId === undefined) setLocalSelected(node.id);
    setAnnouncement(`${node.name}, ${formatBytes(node.size)}`);
    onSelect(node);
  };

  const open = (node: FsNode) => {
    if (node.kind !== "directory" || node.id === focus.id) return;
    const now = Date.now();
    if (now - lastNavRef.current < 450) return;
    lastNavRef.current = now;
    onNavigate(node);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    renderer.stopFling();
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }],
      };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      dragRef.current = null;
      renderer.clearHover();
      setPanning(true);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    pointerPosRef.current = { x: event.clientX, y: event.clientY };
    const pointers = pointersRef.current;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const rect = event.currentTarget.getBoundingClientRect();
      renderer.zoomAt(dist / pinch.dist, { x: mx - rect.left - rect.width / 2, y: my - rect.top - rect.height / 2 }, true);
      renderer.panBy(mx - pinch.x, my - pinch.y);
      pinchRef.current = { dist, x: mx, y: my };
      dismissHint();
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) {
        drag.moved = true;
        setPanning(true);
        renderer.clearHover();
        dismissHint();
      }
      if (drag.moved) {
        renderer.panBy(event.clientX - drag.lastX, event.clientY - drag.lastY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        const now = performance.now();
        drag.samples.push({ x: event.clientX, y: event.clientY, t: now });
        while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
        return;
      }
    }
    if (event.pointerType === "mouse") {
      renderer.hoverAt(event.clientX, event.clientY);
      positionTip();
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse") rendererRef.current?.clearHover();
  };

  const endGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    setPanning(false);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    const drag = dragRef.current;
    const wasPinching = pinchRef.current !== null;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    setPanning(false);
    if (!renderer || !drag || wasPinching) return;

    if (drag.moved) {
      const first = drag.samples[0];
      const last = drag.samples[drag.samples.length - 1];
      const span = last.t - first.t;
      if (span > 8 && performance.now() - last.t < 80) renderer.fling((last.x - first.x) / span, (last.y - first.y) / span);
      return;
    }

    const hit = renderer.activateAt(event.clientX, event.clientY);
    if (!hit) return;
    select(hit);

    if (event.pointerType === "touch") {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && last.id === hit.id && now - last.t < 320) {
        lastTapRef.current = null;
        open(hit);
      } else {
        lastTapRef.current = { id: hit.id, t: now };

        pointerPosRef.current = { x: event.clientX, y: event.clientY };
        renderer.hoverAt(event.clientX, event.clientY);
        positionTip();
        window.clearTimeout(touchTipTimer.current);
        touchTipTimer.current = window.setTimeout(() => rendererRef.current?.clearHover(), 2600);
      }
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const hit = rendererRef.current?.hitTest(event.clientX, event.clientY);
    if (hit) open(hit);
    dismissHint();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = 72;
    switch (event.key) {
      case "+":
      case "=":
        renderer.zoomAt(1.3);
        break;
      case "-":
      case "_":
        renderer.zoomAt(1 / 1.3);
        break;
      case "0":
        renderer.resetView();
        break;
      case "ArrowLeft":
        renderer.panBy(step, 0, false);
        break;
      case "ArrowRight":
        renderer.panBy(-step, 0, false);
        break;
      case "ArrowUp":
        renderer.panBy(0, step, false);
        break;
      case "ArrowDown":
        renderer.panBy(0, -step, false);
        break;
      case "Enter": {
        const node = activeSelected ? renderer.nodeById(activeSelected) : null;
        if (node) open(node);
        break;
      }
      case "Backspace":
        if (!onNavigateUp) return;
        onNavigateUp();
        break;
      default:
        return;
    }
    event.preventDefault();
    dismissHint();
  };

  const isEmpty = scene.nodes.length === 0;
  const total = scene.nodes.length;

  return (
    <div ref={wrapRef} className="dv-root" data-compact={compact ? "" : undefined} style={style}>
      <style>{STYLES}</style>

      <canvas
        ref={canvasRef}
        className="dv-canvas"
        tabIndex={0}
        role="application"
        aria-label={`Radial filesystem view of ${focus.name}, ${total} items shown. Plus and minus zoom, arrow keys pan, Enter opens the selected folder.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endGesture}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        style={{ cursor: panning ? "grabbing" : tipVisible ? "pointer" : "grab" }}
      />

      {isEmpty && (
        <div className="dv-empty">
          <strong>This folder is empty</strong>
          <span>Nothing to show here yet</span>
        </div>
      )}

      <div className={`dv-hint${hintVisible ? "" : " dv-hint--hidden"}`} aria-hidden="true">
        <span><b>Drag</b> to pan</span>
        <span><b>Scroll</b> or pinch to zoom</span>
        <span><b>Double-click</b> a folder to open it</span>
      </div>

      {!isEmpty && (
        <div className="dv-depthbar dv-glass" role="group" aria-label="Levels shown">
          <span className="dv-depthbar__label">Depth</span>
          <Slider
            min={1}
            max={DEPTH_LIMIT}
            step={1}
            value={depth}
            onChange={value => { setDepth(value); dismissHint(); }}
            tooltip={{ formatter: null }}
          />
          <span className="dv-depthbar__value">{depth}</span>
        </div>
      )}

      <div className="dv-controls dv-glass">
        {onNavigateUp && (
          <>
            <Tooltip title="Up one level (Backspace)">
              <Button type="text" size="small" aria-label="Up one level" icon={<ArrowUpOutlined />} onClick={onNavigateUp} />
            </Tooltip>
            <span className="dv-sep" />
          </>
        )}
        <Tooltip title="Zoom out (−)">
          <Button type="text" size="small" aria-label="Zoom out" icon={<ZoomOutOutlined />} onClick={() => { rendererRef.current?.zoomAt(1 / 1.3); dismissHint(); }} />
        </Tooltip>
        <span className="dv-zoomval" aria-live="off">{zoomPct}%</span>
        <Tooltip title="Zoom in (+)">
          <Button type="text" size="small" aria-label="Zoom in" icon={<ZoomInOutlined />} onClick={() => { rendererRef.current?.zoomAt(1.3); dismissHint(); }} />
        </Tooltip>
        <span className="dv-sep" />
        <Tooltip title="Fit to view (0)">
          <Button type="text" size="small" aria-label="Reset zoom and pan" icon={<AimOutlined />} onClick={() => rendererRef.current?.resetView()} />
        </Tooltip>
      </div>

      <div ref={tipRef} className={`dv-tip${tipVisible ? " dv-tip--on" : ""}`} aria-hidden="true">
        {tipInfo && (
          <div className="dv-tip__card">
            <div className="dv-tip__head">
              <span className="dv-tip__dot" style={{ background: tipInfo.color, color: tipInfo.color }} />
              <span className="dv-tip__name">{tipInfo.node.name}</span>
            </div>
            <div className="dv-tip__meta">{describeNode(tipInfo.node, tipInfo.isFocus)}</div>
            <div className="dv-tip__size">{formatBytes(tipInfo.node.size)}</div>
            {tipInfo.share !== null && (
              <>
                <div className="dv-tip__share">{formatPercent(tipInfo.share)} of parent</div>
                <div className="dv-tip__bar">
                  <i style={{ width: `${Math.max(2, tipInfo.share * 100)}%`, background: tipInfo.color }} />
                </div>
              </>
            )}
            {tipInfo.node.kind === "directory" && !tipInfo.isFocus && (
              <div className="dv-tip__hint"><b>Double-click</b> to open</div>
            )}
          </div>
        )}
      </div>

      <span className="dv-sr" aria-live="polite">{announcement}</span>
    </div>
  );
}
