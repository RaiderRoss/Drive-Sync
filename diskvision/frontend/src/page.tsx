import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  Breadcrumb,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { InputRef, ThemeConfig } from "antd";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileOutlined,
  FolderFilled,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Canvas, { colorFor, formatBytes } from "./components/Canvas";
import type { FsNode } from "./components/Canvas";
import { toFsNode } from "./filesystem";
import type { FsEntry } from "./filesystem";
import demoFilesystem from "./data/filesystem.json";

const { Title, Text } = Typography;

/* ───────────────────────────── Demo data ───────────────────────────── */

// Same shape the backend API will send (see FsEntry); swap this import for a fetch when it's ready.
const FILESYSTEM: FsNode = toFsNode(demoFilesystem as FsEntry);

/** The "Users" folder in the demo data. */
const INITIAL_SELECTED_ID = "185";

/* ───────────────────────────── Tree helpers ───────────────────────────── */

function findNode(root: FsNode, id: string): FsNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Root → … → node, or undefined if `id` is not in the tree. */
function findPath(root: FsNode, id: string, path: FsNode[] = []): FsNode[] | undefined {
  const next = [...path, root];
  if (root.id === id) return next;
  for (const child of root.children ?? []) {
    const found = findPath(child, id, next);
    if (found) return found;
  }
  return undefined;
}

/** "C:/System Archives/Linux" for a root → … → node path. */
function formatPath(path: FsNode[]): string {
  return path.map(node => node.name).join("/");
}

/**
 * Finds the node a typed or pasted path points to. Accepts "/" or "\" separators, extra or trailing
 * slashes, any letter case, and paths with or without the drive (root) at the front.
 */
function resolvePath(root: FsNode, text: string): FsNode[] | undefined {
  const parts = text.trim().replace(/^["']|["']$/g, "").split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return [root];
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

  const walk = (start: FsNode[], rest: string[]) => {
    const path = [...start];
    for (const part of rest) {
      const next = path[path.length - 1].children?.find(child => same(child.name, part));
      if (!next) return undefined;
      path.push(next);
    }
    return path;
  };
  return same(parts[0], root.name) ? walk([root], parts.slice(1)) : walk([root], parts);
}

function formatShare(fraction: number): string {
  if (fraction >= 0.995) return "100%";
  if (fraction >= 0.1) return `${Math.round(fraction * 100)}%`;
  if (fraction >= 0.001) return `${(fraction * 100).toFixed(1)}%`;
  return fraction > 0 ? "<0.1%" : "0%";
}

/* ───────────────────── antd theme driven by index.css tokens ───────────────────── */

/** Resolves the CSS tokens in index.css to concrete colours (antd's algorithms can't take var()). */
function buildAntdTheme(): ThemeConfig {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;

  return {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: token("--accent-color", "#0078d4"),
      colorBgBase: token("--bg-primary", "#1c1c1c"),
      colorBgContainer: token("--bg-secondary", "#252525"),
      colorBgElevated: token("--bg-hover", "#2d2d2d"),
      colorTextBase: token("--text-primary", "#ffffff"),
      colorTextSecondary: token("--text-secondary", "#b3b3b3"),
      colorBorder: token("--border-color", "#2d2d2d"),
      colorBorderSecondary: token("--border-color", "#2d2d2d"),
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 14,
      borderRadius: 4,
      borderRadiusLG: 8,
    },
  };
}

/* ───────────────────────────── Small pieces ───────────────────────────── */

function NodeIcon({ node }: { node: FsNode }) {
  const Icon = node.kind === "directory" ? FolderFilled : node.kind === "cluster" ? EllipsisOutlined : FileOutlined;
  return <Icon style={{ color: colorFor(node) }} />;
}

/**
 * Breadcrumb that turns into a text field (click it, the pencil, or Ctrl+L) so a path can be typed
 * or pasted. Enter goes there; a file opens its folder with the file selected. Escape cancels.
 */
function PathBar({
  root,
  path,
  onNavigate,
  onOpenFile,
}: {
  root: FsNode;
  path: FsNode[];
  onNavigate: (node: FsNode) => void;
  onOpenFile: (file: FsNode, folder: FsNode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<InputRef>(null);

  const startEditing = useCallback(() => {
    setDraft(formatPath(path));
    setError(null);
    setEditing(true);
  }, [path]);

  // Select everything on open, so a paste replaces the old path.
  useEffect(() => {
    if (editing) inputRef.current?.focus({ cursor: "all" });
  }, [editing]);

  // Ctrl+L / ⌘L, like a browser's address bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        startEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startEditing]);

  const submit = () => {
    const found = resolvePath(root, draft);
    if (!found) {
      setError("No such folder or file");
      return;
    }
    const target = found[found.length - 1];
    if (target.kind === "directory") onNavigate(target);
    else onOpenFile(target, found[found.length - 2] ?? root);
    setEditing(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <div className="dv-pathbar dv-pathbar--editing">
        <Tooltip open={!!error} title={error} placement="bottomLeft" color="red">
          <Input
            ref={inputRef}
            size="middle"
            value={draft}
            status={error ? "error" : undefined}
            onChange={event => { setDraft(event.target.value); setError(null); }}
            onPressEnter={submit}
            onKeyDown={onKeyDown}
            onBlur={() => setEditing(false)}
            placeholder="Type or paste a path, e.g. C:/System Archives/Linux"
            aria-label="Path"
            spellCheck={false}
          />
        </Tooltip>
      </div>
    );
  }

  const items = path.map((node, index) => ({
    key: node.id,
    title:
      index === path.length - 1 ? (
        node.name
      ) : (
        <a
          href="#"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation(); // a crumb navigates; the empty space around them edits
            onNavigate(node);
          }}
        >
          {node.name}
        </a>
      ),
  }));

  return (
    <div className="dv-pathbar" onClick={startEditing} title="Click to type or paste a path (Ctrl+L)">
      <Breadcrumb items={items} />
      <Button
        type="text"
        size="small"
        className="dv-pathbar__edit"
        icon={<EditOutlined />}
        aria-label="Edit path"
        onClick={event => { event.stopPropagation(); startEditing(); }}
      />
    </div>
  );
}

type SortKey = "size" | "name";

/** Everything directly inside the folder, biggest first, each with its share of the folder as a bar. */
function ContentsList({
  folder,
  selectedId,
  onSelect,
  onOpen,
}: {
  folder: FsNode;
  selectedId: string;
  onSelect: (node: FsNode) => void;
  onOpen: (node: FsNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("size");
  useEffect(() => setQuery(""), [folder.id]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (folder.children ?? []).filter(child => child.name.toLowerCase().includes(needle));
    return sort === "size"
      ? list.sort((a, b) => b.size - a.size)
      : list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [folder, query, sort]);

  const total = folder.children?.length ?? 0;

  return (
    <div className="dv-list">
      <div className="dv-list__tools">
        <Input
          allowClear
          value={query}
          onChange={event => setQuery(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder={`Filter ${total} item${total === 1 ? "" : "s"}…`}
        />
        <Segmented<SortKey>
          value={sort}
          onChange={setSort}
          options={[
            { value: "size", label: "Size" },
            { value: "name", label: "Name" },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={total ? "Nothing matches the filter" : "This folder is empty"} />
      ) : (
        <div className="dv-list__rows" role="listbox" aria-label={`Contents of ${folder.name}`}>
          {items.map(node => {
            const share = folder.size > 0 ? node.size / folder.size : 0;
            return (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={node.id === selectedId}
                className="dv-item"
                style={{ "--item": colorFor(node) } as CSSProperties}
                onClick={() => onSelect(node)}
                onDoubleClick={() => onOpen(node)}
                title={node.kind === "directory" ? "Double-click to open" : undefined}
              >
                <span className="dv-item__icon"><NodeIcon node={node} /></span>
                <span className="dv-item__name">{node.name}</span>
                <span className="dv-item__size">{formatBytes(node.size)}</span>
                <span className="dv-item__share">{formatShare(share)}</span>
                <span className="dv-item__bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(share * 100, 0.6)}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The two panels share one slot; this picks which one is showing. */
type PanelView = "map" | "details";

const PANEL_OPTIONS: Array<{ value: PanelView; label: string; icon: ReactNode }> = [
  { value: "map", label: "Map", icon: <AppstoreOutlined /> },
  { value: "details", label: "Details", icon: <InfoCircleOutlined /> },
];

/* ───────────────────────────── Page ───────────────────────────── */

function Explorer() {
  const [focusId, setFocusId] = useState(FILESYSTEM.id);
  const [selectedId, setSelectedId] = useState(INITIAL_SELECTED_ID);
  const [panelView, setPanelView] = useState<PanelView>("map");

  const focus = useMemo(() => findNode(FILESYSTEM, focusId) ?? FILESYSTEM, [focusId]);
  const selected = useMemo(() => findNode(FILESYSTEM, selectedId) ?? focus, [selectedId, focus]);
  const path = useMemo(() => findPath(FILESYSTEM, focusId) ?? [FILESYSTEM], [focusId]);

  const children = useMemo(() => focus.children ?? [], [focus]);
  const selectedPath = useMemo(() => findPath(FILESYSTEM, selected.id) ?? [FILESYSTEM], [selected]);
  const selectedParent = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2] : null;
  const selectedShare = selectedParent && selectedParent.size > 0 ? selected.size / selectedParent.size : null;

  const select = useCallback((node: FsNode) => setSelectedId(node.id), []);

  const navigateTo = useCallback((node: FsNode) => {
    if (node.kind !== "directory") return;
    setFocusId(node.id);
    setSelectedId(node.id);
  }, []);

  const openFile = useCallback((file: FsNode, folder: FsNode) => {
    setFocusId(folder.id);
    setSelectedId(file.id);
  }, []);

  const goBack = () => {
    if (path.length > 1) navigateTo(path[path.length - 2]);
  };

  const reset = () => {
    setFocusId(FILESYSTEM.id);
    setSelectedId(FILESYSTEM.id);
  };

  return (
    <main className="dv-page">

      <div className="dv-toolbar">
        <PathBar root={FILESYSTEM} path={path} onNavigate={navigateTo} onOpenFile={openFile} />
        <div className="dv-toolbar__actions">
          <Segmented<PanelView>
            options={PANEL_OPTIONS}
            value={panelView}
            onChange={setPanelView}
          />
          <Button icon={<ArrowLeftOutlined />} onClick={goBack} disabled={path.length <= 1}>
            Parent directory
          </Button>
          <Button icon={<ReloadOutlined />} onClick={reset}>Reset view</Button>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic className="dv-stat" title="Focal directory" value={focus.name} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic className="dv-stat" title="Storage consumption" value={formatBytes(focus.size)} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small"><Statistic className="dv-stat" title="Direct children" value={children.length} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dv-panels">
        <Col xs={24} style={panelView === "map" ? undefined : { display: "none" }}>
          <div className="dv-canvas-panel">
            <Canvas focus={focus} onSelect={select} onNavigate={navigateTo} />
          </div>
        </Col>

        {panelView === "details" && (
          <>
            <Col xs={24} lg={9}>
              <Card
                className="dv-inspector"
                title={
                  <span className="dv-entry">
                    <NodeIcon node={selected} />
                    <Text strong ellipsis>{selected.name}</Text>
                  </span>
                }
              >
                <Title level={2} className="dv-size">{formatBytes(selected.size)}</Title>
                <Text type="secondary">{selected.kind === "directory" ? "Folder size" : "File size"}</Text>

                {selectedParent && selectedShare !== null && (
                  <div className="dv-share">
                    <div className="dv-share__row">
                      <Text type="secondary">Share of {selectedParent.name}</Text>
                      <Text strong>{formatShare(selectedShare)}</Text>
                    </div>
                    <Progress
                      percent={Math.min(100, selectedShare * 100)}
                      showInfo={false}
                      size="small"
                      strokeColor={colorFor(selected)}
                    />
                  </div>
                )}

                <Divider />
                <Descriptions
                  className="dv-descriptions"
                  size="small"
                  colon={false}
                  column={1}
                  items={[
                    { key: "type", label: "Type", children: <Tag>{selected.kind === "directory" ? "folder" : selected.kind}</Tag> },
                    ...(selected.kind === "directory"
                      ? [{ key: "items", label: "Items inside", children: selected.children?.length ?? 0 }]
                      : [{ key: "ext", label: "Extension", children: selected.extension ? `.${selected.extension}` : "—" }]),
                    { key: "modified", label: "Last modified", children: selected.modified ?? "Unknown" },
                    {
                      key: "path",
                      label: "Path",
                      children: <Text className="dv-path" copyable={{ text: formatPath(selectedPath) }}>{formatPath(selectedPath)}</Text>,
                    },
                  ]}
                />
                {selected.kind === "directory" && selected.id !== focus.id && (
                  <Button block className="dv-open" icon={<FolderFilled />} onClick={() => navigateTo(selected)}>
                    Open folder
                  </Button>
                )}
              </Card>
            </Col>

            <Col xs={24} lg={15}>
              <Card
                className="dv-inspector"
                title={
                  <span className="dv-entry">
                    <FolderFilled style={{ color: colorFor(focus) }} />
                    <Text strong ellipsis>Contents of {focus.name}</Text>
                  </span>
                }
                extra={<Text type="secondary">{formatBytes(focus.size)}</Text>}
              >
                <ContentsList folder={focus} selectedId={selected.id} onSelect={select} onOpen={navigateTo} />
              </Card>
            </Col>
          </>
        )}
      </Row>
    </main>
  );
}

export default function Page() {
  const antdTheme = useMemo(buildAntdTheme, []);
  return (
    <ConfigProvider theme={antdTheme}>
      <Explorer />
    </ConfigProvider>
  );
}