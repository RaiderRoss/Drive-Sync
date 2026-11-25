import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  Breadcrumb,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Result,
  Segmented,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from "antd";
import type { ButtonProps, InputRef, ThemeConfig } from "antd";
import {
  AppstoreOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileOutlined,
  FolderFilled,
  FolderOpenOutlined,
  InfoCircleOutlined,
  DatabaseOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import Canvas, { colorFor, DEFAULT_DEPTH, formatBytes, itemCount } from "./components/Canvas";
import type { FsNode } from "./components/Canvas";
import { api, ApiError, isScanning, toFsNode } from "./api";
import type { DiskInfo, DriveInfo, FsEntry, ScanStatus } from "./api";

const { Text } = Typography;

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

type SortKey = "name" | "size" | "modified" | "type";
type SortState = { key: SortKey; desc: boolean };

function typeLabel(node: FsNode): string {
  if (node.kind === "directory") return "File folder";
  if (node.kind === "cluster") return "Smaller items";
  return node.extension ? `${node.extension.toUpperCase()} file` : "File";
}

const COLUMNS: Array<{ key: SortKey; label: string; className: string; firstDesc: boolean }> = [
  { key: "name", label: "Name", className: "dv-col-name", firstDesc: false },
  { key: "size", label: "Size", className: "dv-col-size", firstDesc: true },
  { key: "size", label: "Share", className: "dv-col-share", firstDesc: true },
  { key: "modified", label: "Date modified", className: "dv-col-modified", firstDesc: true },
  { key: "type", label: "Type", className: "dv-col-type", firstDesc: false },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareBy(key: SortKey, a: FsNode, b: FsNode): number {
  switch (key) {
    case "size":
      return a.size - b.size;
    case "modified":
      return (a.modified ?? "").localeCompare(b.modified ?? "");
    case "type":
      return collator.compare(typeLabel(a), typeLabel(b)) || collator.compare(a.name, b.name);
    case "name":
      return collator.compare(a.name, b.name);
  }
}

function FileTable({
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
  const [sort, setSort] = useState<SortState>({ key: "size", desc: true });
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(""), [folder.id]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = folder.children ?? [];
    const list = all.filter(child => child.kind !== "cluster" && child.name.toLowerCase().includes(needle));
    const rest = needle ? [] : all.filter(child => child.kind === "cluster");
    const foldersFirst = sort.key === "name" || sort.key === "type";
    list.sort((a, b) => {
      if (foldersFirst && a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      const order = compareBy(sort.key, a, b);
      return sort.desc ? -order : order;
    });
    return [...list, ...rest];
  }, [folder, query, sort]);

  useEffect(() => {
    rowsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const total = itemCount(folder);
  const selectedItem = items.find(node => node.id === selectedId);

  const toggleSort = (key: SortKey, firstDesc: boolean) =>
    setSort(current => (current.key === key ? { key, desc: !current.desc } : { key, desc: firstDesc }));

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    const index = items.findIndex(node => node.id === selectedId);
    const move = (to: number) => {
      event.preventDefault();
      onSelect(items[Math.max(0, Math.min(items.length - 1, to))]);
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? items.length - 1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Enter" && selectedItem) {
      event.preventDefault();
      onOpen(selectedItem);
    }
  };

  return (
    <section className="dv-files">
      <div className="dv-files__toolbar">
        <span className="dv-files__title">
          <FolderFilled style={{ color: colorFor(folder) }} />
          <Text strong ellipsis>{folder.name}</Text>
        </span>
        <Input
          allowClear
          className="dv-files__filter"
          value={query}
          onChange={event => setQuery(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder={`Filter ${total.toLocaleString()} item${total === 1 ? "" : "s"}`}
        />
      </div>

      <div className="dv-files__table">
        <div className="dv-files__head dv-files__grid" role="row">
          {COLUMNS.map(column => {
            const active = sort.key === column.key && column.className !== "dv-col-share";
            return (
              <button
                key={column.className}
                type="button"
                role="columnheader"
                aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
                className={`dv-files__th ${column.className}${active ? " is-active" : ""}`}
                onClick={() => toggleSort(column.key, column.firstDesc)}
              >
                <span>{column.label}</span>
                {active && (sort.desc ? <CaretDownOutlined /> : <CaretUpOutlined />)}
              </button>
            );
          })}
        </div>

        {items.length === 0 ? (
          <div className="dv-files__empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={total ? "Nothing matches the filter" : "This folder is empty"} />
          </div>
        ) : (
          <div
            ref={rowsRef}
            className="dv-files__rows"
            role="listbox"
            tabIndex={0}
            aria-label={`Contents of ${folder.name}`}
            onKeyDown={onKeyDown}
          >
            {items.map(node => {
              const share = folder.size > 0 ? node.size / folder.size : 0;
              return (
                <div
                  key={node.id}
                  role="option"
                  aria-selected={node.id === selectedId}
                  className={`dv-files__row dv-files__grid${node.kind === "cluster" ? " is-cluster" : ""}`}
                  style={{ "--item": colorFor(node) } as CSSProperties}
                  onClick={() => onSelect(node)}
                  onDoubleClick={() => onOpen(node)}
                  title={node.kind === "directory" ? "Double-click to open" : undefined}
                >
                  <span className="dv-col-name">
                    <NodeIcon node={node} />
                    <span className="dv-files__name">{node.name}</span>
                  </span>
                  <span className="dv-col-size">{formatBytes(node.size)}</span>
                  <span className="dv-col-share">
                    <span className="dv-files__bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(share * 100, 0.8)}%` }} />
                    </span>
                    <span className="dv-files__pct">{formatShare(share)}</span>
                  </span>
                  <span className="dv-col-modified">{node.modified ?? ""}</span>
                  <span className="dv-col-type">{typeLabel(node)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="dv-files__status">
        <span>
          {total.toLocaleString()} item{total === 1 ? "" : "s"}
          <span className="dv-files__dot">·</span>
          {formatBytes(folder.size)}
        </span>
        {selectedItem && (
          <span>
            1 item selected
            <span className="dv-files__dot">·</span>
            {formatBytes(selectedItem.size)}
          </span>
        )}
      </footer>
    </section>
  );
}

function DetailsPane({
  node,
  path,
  parent,
  isFocus,
  onOpen,
}: {
  node: FsNode;
  path: FsNode[];
  parent: FsNode | null;
  isFocus: boolean;
  onOpen: (node: FsNode) => void;
}) {
  const share = parent && parent.size > 0 ? node.size / parent.size : null;
  const location = formatPath(path.slice(0, -1)) || formatPath(path);
  const rows: Array<[string, ReactNode]> = [["Type", typeLabel(node)]];
  if (node.kind === "directory") rows.push(["Contains", `${itemCount(node).toLocaleString()} items`]);
  if (node.kind === "cluster") rows.push(["Contains", `${(node.count ?? 0).toLocaleString()} items`]);
  if (node.kind !== "cluster") rows.push(["Modified", node.modified ? `${node.modified} UTC` : "Unknown"]);
  rows.push([
    "Location",
    <Text key="location" className="dv-pane__path" copyable={{ text: formatPath(path) }}>{location}</Text>,
  ]);

  return (
    <aside className="dv-pane" style={{ "--item": colorFor(node) } as CSSProperties}>
      <div className="dv-pane__hero">
        <span className="dv-pane__icon"><NodeIcon node={node} /></span>
        <div className="dv-pane__name">{node.name}</div>
        <Text type="secondary">{typeLabel(node)}</Text>
      </div>

      <div className="dv-pane__size">
        <div className="dv-pane__bytes">{formatBytes(node.size)}</div>
        {share !== null && parent && (
          <>
            <div className="dv-files__bar dv-pane__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(share * 100, 0.8)}%` }} />
            </div>
            <Text type="secondary" className="dv-pane__share">
              {formatShare(share)} of {parent.name}
            </Text>
          </>
        )}
      </div>

      <dl className="dv-pane__props">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {node.kind === "directory" && !isFocus && (
        <Button block type="primary" icon={<FolderOpenOutlined />} onClick={() => onOpen(node)}>
          Open folder
        </Button>
      )}
    </aside>
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

function DriveSection({
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
    info = scanSummary(status);
  } else if (scanned && drive) {
    const unreadable = status?.errors ? ` · ${status.errors.toLocaleString()} unreadable` : "";
    info = `Scanned ${drive.scanned_at} UTC · ${drive.file_count.toLocaleString()} files, ${drive.dir_count.toLocaleString()} folders${unreadable}`;
  } else if (current) {
    info = "Not scanned yet";
  }

  return (
    <div className="dv-drive">
      <Select<string>
        className="dv-drive__select"
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
        block
        color="primary"
        variant={scanned ? "filled" : "solid"}
        icon={<SyncOutlined spin={scanning} />}
        disabled={!current || scanning}
        onClick={() => current && onScan(current.path)}
      >
        {scanning ? "Scanning" : scanned ? "Rescan" : "Scan"}
      </Button>
      {info && <Text type="secondary" className="dv-drive__info">{info}</Text>}
    </div>
  );
}

const SIDEBAR_KEY = "diskvision.sidebar";

function initialCollapsed(): boolean {
  const saved = localStorage.getItem(SIDEBAR_KEY);
  if (saved !== null) return saved === "collapsed";
  return window.innerWidth < 768;
}

function RailButton({
  title,
  icon,
  onClick,
  disabled,
  active,
  color = "default",
  solid = false,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  color?: ButtonProps["color"];
  solid?: boolean;
}) {
  return (
    <Tooltip title={title} placement="right">
      <Button
        color={active ? "primary" : color}
        variant={active || solid ? "solid" : color === "default" ? "text" : "filled"}
        icon={icon}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  choices,
  current,
  onPick,
  onScan,
  panelView,
  onPanelView,
  focus,
  onReset,
}: {
  collapsed: boolean;
  onToggle: () => void;
  choices: DriveChoice[];
  current: DriveChoice | undefined;
  onPick: (path: string) => void;
  onScan: (path: string) => void;
  panelView: PanelView;
  onPanelView: (view: PanelView) => void;
  focus: FsNode | null;
  onReset: () => void;
}) {
  const drive = current?.drive;
  const scanning = isScanning(drive?.scan);
  const scanned = drive?.root_id != null;

  return (
    <aside className={`dv-sidebar${collapsed ? " dv-sidebar--collapsed" : ""}`} aria-label="Sidebar">
      <div className="dv-sidebar__head">
        {!collapsed && (
          <span className="dv-sidebar__brand">
            <DatabaseOutlined /> DiskVision
          </span>
        )}
        <Tooltip title={collapsed ? "Expand sidebar" : "Collapse sidebar"} placement="right">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
        </Tooltip>
      </div>

      {collapsed ? (
        <div className="dv-sidebar__rail">
          <RailButton title={current ? `Drive: ${current.name}` : "Choose a drive"} icon={<DatabaseOutlined />} onClick={onToggle} />
          <RailButton
            title={scanning ? "Scanning…" : scanned ? "Rescan" : "Scan"}
            icon={<SyncOutlined spin={scanning} />}
            color="primary"
            disabled={!current || scanning}
            onClick={() => current && onScan(current.path)}
          />
          <span className="dv-sidebar__sep" />
          {PANEL_OPTIONS.map(option => (
            <RailButton
              key={option.value}
              title={option.label}
              icon={option.icon}
              active={panelView === option.value}
              disabled={!focus}
              onClick={() => onPanelView(option.value)}
            />
          ))}
          <span className="dv-sidebar__sep" />
          <RailButton title="Reset view" icon={<ReloadOutlined />} color="purple" solid disabled={!focus} onClick={onReset} />
        </div>
      ) : (
        <div className="dv-sidebar__body">
          <section>
            <h4 className="dv-sidebar__label">Drive</h4>
            <DriveSection choices={choices} current={current} onPick={onPick} onScan={onScan} />
          </section>

          <section>
            <h4 className="dv-sidebar__label">View</h4>
            <Segmented<PanelView> block options={PANEL_OPTIONS} value={panelView} onChange={onPanelView} disabled={!focus} />
          </section>

          <section className="dv-sidebar__nav">
            <h4 className="dv-sidebar__label">Navigate</h4>
            <Button block color="purple" variant="solid" icon={<ReloadOutlined />} onClick={onReset} disabled={!focus}>
              Reset view
            </Button>
          </section>

          {focus && (
            <section>
              <h4 className="dv-sidebar__label">
                Current folder
              </h4>
              <dl className="dv-stats">
                <div>
                  <dt>Focal directory</dt>
                  <dd title={focus.name}>{focus.name}</dd>
                </div>
                <div>
                  <dt>Storage consumption</dt>
                  <dd>{formatBytes(focus.size)}</dd>
                </div>
                <div>
                  <dt>Direct children</dt>
                  <dd>{itemCount(focus).toLocaleString()}</dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}
    </aside>
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [contents, setContents] = useState<FsNode | null>(null);
  const [panelView, setPanelView] = useState<PanelView>("map");
  const [collapsed, setCollapsed] = useState(initialCollapsed);

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

  const toggleSidebar = () => {
    setCollapsed(was => {
      localStorage.setItem(SIDEBAR_KEY, was ? "expanded" : "collapsed");
      return !was;
    });
  };

  const focus = shownView?.tree ?? null;
  const path = shownView?.path ?? [];

  const reset = () => {
    if (rootId != null) setFocusId(String(rootId));
  };

  const sidebar = (
    <Sidebar
      collapsed={collapsed}
      onToggle={toggleSidebar}
      choices={choices}
      current={current}
      onPick={pickDrive}
      onScan={drivePath => void startScan(drivePath)}
      panelView={panelView}
      onPanelView={setPanelView}
      focus={focus}
      onReset={reset}
    />
  );

  if (backendError || !shownView || !focus) {
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
      <div className="dv-page">
        {messageHolder}
        {sidebar}
        <main className="dv-main">
          <div className="dv-placeholder">{body}</div>
        </main>
      </div>
    );
  }

  const selected = selection?.node ?? focus;
  const selectedPath = selection?.path ?? path;
  const selectedParent = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2] : null;
  const contentsFolder = contents?.id === focus.id ? contents : focus;

  return (
    <div className="dv-page">
      {messageHolder}
      {sidebar}

      <main className="dv-main">
        <div className="dv-pathbar-overlay">
          <PathBar path={path} onNavigate={navigateTo} onOpenFile={openFile} onResolve={resolve} />
        </div>

        <div className="dv-canvas-panel" style={panelView === "map" ? undefined : { display: "none" }}>
          <Canvas
            focus={focus}
            depth={depth}
            onDepthChange={setDepth}
            layoutDepth={shownView.depth}
            onSelect={select}
            onNavigate={navigateTo}
          />
        </div>

        {panelView === "details" && (
          <div className="dv-details">
            <FileTable folder={contentsFolder} selectedId={selected.id} onSelect={select} onOpen={navigateTo} />
            <DetailsPane
              node={selected}
              path={selectedPath}
              parent={selectedParent}
              isFocus={selected.id === focus.id}
              onOpen={navigateTo}
            />
          </div>
        )}
      </main>
    </div>
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
