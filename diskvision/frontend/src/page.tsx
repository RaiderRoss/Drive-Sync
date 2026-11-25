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
  Result,
  Row,
  Segmented,
  Select,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
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
  DatabaseOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import Canvas, { colorFor, DEFAULT_DEPTH, formatBytes, itemCount } from "./components/Canvas";
import type { FsNode } from "./components/Canvas";
import { api, ApiError, isScanning, toFsNode } from "./api";
import type { DiskInfo, DriveInfo, FsEntry, ScanStatus } from "./api";

const { Title, Text } = Typography;

function findPath(root: FsNode, id: string, path: FsNode[] = []): FsNode[] | undefined {
  const next = [...path, root];
  if (root.id === id) return next;
  for (const child of root.children ?? []) {
    const found = findPath(child, id, next);
    if (found) return found;
  }
  return undefined;
}

function formatPath(path: FsNode[]): string {
  return path.map(node => node.name).join("/").replace(/^\/\/+/, "/");
}

function formatShare(fraction: number): string {
  if (fraction >= 0.995) return "100%";
  if (fraction >= 0.1) return `${Math.round(fraction * 100)}%`;
  if (fraction >= 0.001) return `${(fraction * 100).toFixed(1)}%`;
  return fraction > 0 ? "<0.1%" : "0%";
}

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

function NodeIcon({ node }: { node: FsNode }) {
  const Icon = node.kind === "directory" ? FolderFilled : node.kind === "cluster" ? EllipsisOutlined : FileOutlined;
  return <Icon style={{ color: colorFor(node) }} />;
}

function PathBar({
  path,
  onNavigate,
  onOpenFile,
  onResolve,
}: {
  path: FsNode[];
  onNavigate: (node: FsNode) => void;

  onOpenFile: (path: FsNode[]) => void;

  onResolve: (text: string) => Promise<FsNode[]>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<InputRef>(null);

  const startEditing = useCallback(() => {
    setDraft(formatPath(path));
    setError(null);
    setEditing(true);
  }, [path]);

  useEffect(() => {
    if (editing) inputRef.current?.focus({ cursor: "all" });
  }, [editing]);

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

  const submit = async () => {
    setResolving(true);
    try {
      const found = await onResolve(draft);
      const target = found[found.length - 1];
      if (target.kind === "directory") onNavigate(target);
      else onOpenFile(found);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "No such folder or file" : String((err as Error).message));
    } finally {
      setResolving(false);
    }
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
            suffix={resolving ? <Spin size="small" /> : <span />}
            onChange={event => { setDraft(event.target.value); setError(null); }}
            onPressEnter={submit}
            onKeyDown={onKeyDown}
            onBlur={() => setEditing(false)}
            placeholder={`Type or paste a path, e.g. ${formatPath(path.slice(0, 2))}`}
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
            event.stopPropagation();
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
    const all = folder.children ?? [];
    const list = all.filter(child => child.kind !== "cluster" && child.name.toLowerCase().includes(needle));
    const rest = needle ? [] : all.filter(child => child.kind === "cluster");
    const sorted =
      sort === "size"
        ? list.sort((a, b) => b.size - a.size)
        : list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return [...sorted, ...rest];
  }, [folder, query, sort]);

  const total = itemCount(folder);

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

type PanelView = "map" | "details";

const PANEL_OPTIONS: Array<{ value: PanelView; label: string; icon: ReactNode }> = [
  { value: "map", label: "Map", icon: <AppstoreOutlined /> },
  { value: "details", label: "Details", icon: <InfoCircleOutlined /> },
];

const DRIVE_KEY = "diskvision.drive";

interface DriveChoice {
  path: string;
  name: string;
  disk?: DiskInfo;
  drive?: DriveInfo;
}

function driveChoices(disks: DiskInfo[], drives: DriveInfo[]): DriveChoice[] {
  const byPath = new Map<string, DriveChoice>();
  for (const disk of disks) byPath.set(disk.path, { path: disk.path, name: disk.name, disk });
  for (const drive of drives) {
    const known = byPath.get(drive.path);
    if (known) known.drive = drive;
    else byPath.set(drive.path, { path: drive.path, name: drive.name, drive });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function scanSummary(status: ScanStatus): string {
  const items = `${status.entries.toLocaleString()} items · ${formatBytes(status.bytes)}`;
  return status.phase === "saving" ? `Saving ${items}…` : `Scanning… ${items}`;
}

function DriveBar({
  choices,
  current,
  onPick,
  onScan,
}: {
  choices: DriveChoice[];
  current: DriveChoice | undefined;
  onPick: (path: string) => void;
  onScan: (path: string) => void;
}) {
  const drive = current?.drive;
  const status = drive?.scan;
  const scanning = isScanning(status);
  const scanned = drive?.root_id != null;

  let info: ReactNode = null;
  if (scanning && status) {
    info = <Text type="secondary">{scanSummary(status)}</Text>;
  } else if (scanned && drive) {
    const unreadable = status?.errors ? ` · ${status.errors.toLocaleString()} unreadable` : "";
    info = (
      <Text type="secondary">
        Scanned {drive.scanned_at} UTC · {drive.file_count.toLocaleString()} files, {drive.dir_count.toLocaleString()} folders
        {unreadable}
      </Text>
    );
  } else if (current) {
    info = <Text type="secondary">Not scanned yet</Text>;
  }

  return (
    <div className="dv-drivebar">
      <Select<string>
        className="dv-drivebar__select"
        value={current?.path}
        onChange={onPick}
        placeholder="Choose a drive"
        showSearch={{ optionFilterProp: "search" }}
        popupMatchSelectWidth={false}
        options={choices.map(choice => {
          const disk = choice.disk;
          const used = disk ? `${formatBytes(disk.total_space - disk.free_space)} of ${formatBytes(disk.total_space)} used` : "folder";
          return {
            value: choice.path,
            search: `${choice.name} ${disk?.label ?? ""}`,
            label: (
              <span className="dv-drive-option">
                <DatabaseOutlined />
                <span className="dv-drive-option__name">{choice.name}</span>
                <Text type="secondary" className="dv-drive-option__meta">
                  {disk ? `${disk.file_system} · ${used}` : used}
                </Text>
                {choice.drive?.root_id == null && <Tag>not scanned</Tag>}
              </span>
            ),
          };
        })}
      />
      <Button
        type={scanned ? "default" : "primary"}
        icon={<SyncOutlined spin={scanning} />}
        disabled={!current || scanning}
        onClick={() => current && onScan(current.path)}
      >
        {scanning ? "Scanning" : scanned ? "Rescan" : "Scan"}
      </Button>
      <div className="dv-drivebar__info">{info}</div>
    </div>
  );
}

interface TreeView {
  driveId: number;
  tree: FsNode;
  depth: number;

  path: FsNode[];

  generation: number;
}

interface Selection {
  node: FsNode;

  path: FsNode[];
}

const CONTENTS_LIMIT = 1000;

const toPath = (entries: FsEntry[]) => entries.map(toFsNode);

function Explorer() {
  const [messageApi, messageHolder] = message.useMessage();

  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [drivePath, setDrivePath] = useState<string | null>(() => localStorage.getItem(DRIVE_KEY));

  const [focusId, setFocusId] = useState<string | null>(null);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<TreeView | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [contents, setContents] = useState<FsNode | null>(null);
  const [panelView, setPanelView] = useState<PanelView>("map");

  const choices = useMemo(() => driveChoices(disks, drives), [disks, drives]);

  const current =
    choices.find(choice => choice.path === drivePath) ??
    choices.find(choice => choice.drive?.root_id != null) ??
    choices[0];
  const drive = current?.drive;
  const driveId = drive?.id ?? null;
  const rootId = drive?.root_id ?? null;

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const pendingSelection = useRef<Selection | null>(null);

  const showError = useCallback((err: unknown) => {
    messageApi.error(err instanceof Error ? err.message : String(err));
  }, [messageApi]);

  const refreshDrives = useCallback(async () => {
    try {
      setDrives(await api.drives());
      setBackendError(null);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [diskList, driveList] = await Promise.all([api.disks(), api.drives()]);
      setDisks(diskList);
      setDrives(driveList);
      setBackendError(null);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const anyScanning = drives.some(d => isScanning(d.scan));
  useEffect(() => {
    if (!anyScanning) return;
    const timer = window.setInterval(() => void refreshDrives(), 1000);
    return () => window.clearInterval(timer);
  }, [anyScanning, refreshDrives]);

  const lastPhases = useRef(new Map<number, string>());
  useEffect(() => {
    for (const d of drives) {
      const before = lastPhases.current.get(d.id);
      const now = d.scan?.phase;
      if ((before === "walking" || before === "saving") && now && before !== now) {
        if (now === "done") messageApi.success(`Scanned ${d.name}: ${d.scan!.entries.toLocaleString()} items in ${(d.scan!.elapsed_ms / 1000).toFixed(1)}s`);
        if (now === "failed") messageApi.error(`Scan of ${d.name} failed: ${d.scan!.error ?? "unknown error"}`);
      }
      if (now) lastPhases.current.set(d.id, now);
    }
  }, [drives, messageApi]);

  const pickDrive = useCallback((path: string) => {
    localStorage.setItem(DRIVE_KEY, path);
    setDrivePath(path);
  }, []);

  const startScan = useCallback(async (path: string) => {
    try {
      const started = await api.scan(path);
      setDrives(list => [...list.filter(d => d.id !== started.id), started]);
    } catch (err) {
      showError(err);
    }
  }, [showError]);

  useEffect(() => {
    if (driveId == null || rootId == null) return;
    const shown = viewRef.current;
    if (!shown || shown.driveId !== driveId) {
      setFocusId(String(rootId));
      return;
    }
    if (shown.path[0]?.id === String(rootId)) return;

    let cancelled = false;
    const reopen = async () => {
      let target = String(rootId);
      if (shown.path.length > 1) {
        try {
          const found = await api.resolve(driveId, formatPath(shown.path));
          target = String(found[found.length - 1].id);
        } catch {
        }
      }
      if (cancelled) return;
      setGeneration(g => g + 1);
      setFocusId(target);
    };
    void reopen();
    return () => { cancelled = true; };
  }, [driveId, rootId]);

  useEffect(() => {
    if (!focusId || driveId == null) return;
    const shown = viewRef.current;
    if (shown && shown.tree.id === focusId && shown.depth >= depth && shown.generation === generation) return;

    const controller = new AbortController();
    setLoading(true);
    Promise.all([api.tree(focusId, depth, undefined, controller.signal), api.path(focusId, controller.signal)])
      .then(([entry, pathEntries]) => {
        const tree = toFsNode(entry);
        const path = [...toPath(pathEntries).slice(0, -1), tree];
        setView({ driveId, tree, depth, path, generation });
        if (shown?.tree.id !== focusId || shown.generation !== generation) {
          setSelection(pendingSelection.current ?? { node: tree, path });
          pendingSelection.current = null;
        }
      })
      .catch(err => {
        if (controller.signal.aborted) return;

        if (err instanceof ApiError && err.status === 404 && rootId != null && focusId !== String(rootId)) {
          setFocusId(String(rootId));
        } else {
          showError(err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [focusId, depth, generation, driveId, rootId, showError]);

  const focusTree = view?.tree;
  useEffect(() => {
    if (panelView !== "details" || !focusTree) return;
    if (!focusTree.children?.some(child => child.kind === "cluster")) return;
    const controller = new AbortController();
    api
      .tree(focusTree.id, 1, [CONTENTS_LIMIT], controller.signal)
      .then(entry => setContents(toFsNode(entry)))
      .catch(err => { if (!controller.signal.aborted) showError(err); });
    return () => controller.abort();
  }, [panelView, focusTree, showError]);

  const select = useCallback((node: FsNode) => {
    const shown = viewRef.current;
    if (!shown) return;
    const within = findPath(shown.tree, node.id);
    const path = within ? [...shown.path.slice(0, -1), ...within] : [...shown.path, node];
    setSelection({ node, path });
  }, []);

  const navigateTo = useCallback((node: FsNode) => {
    if (node.kind !== "directory") return;
    setFocusId(node.id);
  }, []);

  const openFile = useCallback((path: FsNode[]) => {
    const file = path[path.length - 1];
    const folder = path[path.length - 2];
    if (!folder) return;
    if (viewRef.current?.tree.id === folder.id) {
      setSelection({ node: file, path });
    } else {
      pendingSelection.current = { node: file, path };
      setFocusId(folder.id);
    }
  }, []);

  const resolve = async (text: string) => {
    if (driveId == null) throw new Error("No drive selected");
    return toPath(await api.resolve(driveId, text));
  };

  const shownView = view && view.driveId === driveId && rootId != null ? view : null;

  const driveBar = <DriveBar choices={choices} current={current} onPick={pickDrive} onScan={path => void startScan(path)} />;

  if (backendError || !shownView) {
    const status = drive?.scan;
    let body: ReactNode;
    if (backendError) {
      body = (
        <Result
          status="warning"
          title="Backend not reachable"
          subTitle={backendError}
          extra={<Button icon={<ReloadOutlined />} onClick={() => void loadAll()}>Try again</Button>}
        />
      );
    } else if (isScanning(status) && status) {
      body = (
        <Result
          icon={<Spin size="large" />}
          title={`Scanning ${current?.name}`}
          subTitle={scanSummary(status)}
        />
      );
    } else if (current && rootId == null) {
      body = (
        <Result
          icon={<DatabaseOutlined />}
          title={`${current.name} hasn't been scanned yet`}
          subTitle={status?.phase === "failed" ? `The last scan failed: ${status.error}` : "Scanning reads every folder once and saves the sizes, so it opens instantly afterwards."}
          extra={<Button type="primary" icon={<SyncOutlined />} onClick={() => void startScan(current.path)}>Scan {current.name}</Button>}
        />
      );
    } else if (loaded && choices.length === 0) {
      body = <Empty description="No drives found" />;
    } else {
      body = <Spin size="large" />;
    }
    return (
      <main className="dv-page">
        {messageHolder}
        {driveBar}
        <div className="dv-placeholder">{body}</div>
      </main>
    );
  }

  const focus = shownView.tree;
  const path = shownView.path;
  const selected = selection?.node ?? focus;
  const selectedPath = selection?.path ?? path;
  const selectedParent = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2] : null;
  const selectedShare = selectedParent && selectedParent.size > 0 ? selected.size / selectedParent.size : null;
  const contentsFolder = contents?.id === focus.id ? contents : focus;

  const goBack = () => {
    if (path.length > 1) navigateTo(path[path.length - 2]);
  };

  const reset = () => {
    if (rootId != null) setFocusId(String(rootId));
  };

  return (
    <main className="dv-page">
      {messageHolder}
      {driveBar}

      <div className="dv-toolbar">
        <PathBar path={path} onNavigate={navigateTo} onOpenFile={openFile} onResolve={resolve} />
        <div className="dv-toolbar__actions">
          <Spin size="small" spinning={loading} delay={150} />
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
          <Card size="small"><Statistic className="dv-stat" title="Direct children" value={itemCount(focus)} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dv-panels">
        <Col xs={24} style={panelView === "map" ? undefined : { display: "none" }}>
          <div className="dv-canvas-panel">
            <Canvas
              focus={focus}
              depth={depth}
              onDepthChange={setDepth}
              layoutDepth={shownView.depth}
              onSelect={select}
              onNavigate={navigateTo}
            />
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
                <Text type="secondary">{selected.kind === "directory" ? "Folder size" : selected.kind === "cluster" ? "Combined size" : "File size"}</Text>

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
                      ? [{ key: "items", label: "Items inside", children: itemCount(selected).toLocaleString() }]
                      : selected.kind === "cluster"
                        ? [{ key: "items", label: "Items", children: (selected.count ?? 0).toLocaleString() }]
                        : [{ key: "ext", label: "Extension", children: selected.extension ? `.${selected.extension}` : "—" }]),
                    ...(selected.kind === "cluster" ? [] : [{ key: "modified", label: "Last modified", children: selected.modified ? `${selected.modified} UTC` : "Unknown" }]),
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
                <ContentsList folder={contentsFolder} selectedId={selected.id} onSelect={select} onOpen={navigateTo} />
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
