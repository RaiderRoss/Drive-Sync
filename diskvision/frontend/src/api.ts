import type { FsNode } from "./components/Canvas";

const BASE = `${import.meta.env.BASE_URL}api`;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the DiskVision backend. Is it running? (cd backend && cargo run --release)");
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error ?? `${response.status} ${response.statusText}`);
  return body as T;
}

export interface DiskInfo {
  path: string;
  name: string;

  label: string;
  file_system: string;
  total_space: number;
  free_space: number;
  removable: boolean;

  drive_id: number | null;
}

export type ScanPhase = "walking" | "saving" | "done" | "failed";

export interface ScanStatus {
  phase: ScanPhase;
  entries: number;
  bytes: number;
  errors: number;
  elapsed_ms: number;
  error: string | null;
}

export interface DriveInfo {
  id: number;
  path: string;
  name: string;

  root_id: number | null;
  size: number | null;
  total_space: number | null;
  free_space: number | null;
  file_count: number;
  dir_count: number;
  scanned_at: string | null;

  scan: ScanStatus | null;
}

export const isScanning = (status: ScanStatus | null | undefined) =>
  status?.phase === "walking" || status?.phase === "saving";

export const api = {
  disks: () => request<DiskInfo[]>("/disks"),
  drives: () => request<DriveInfo[]>("/drives"),

  scan: (path: string) =>
    request<DriveInfo>("/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  status: (driveId: number) => request<ScanStatus>(`/drives/${driveId}/status`),
  removeDrive: (driveId: number) => request<void>(`/drives/${driveId}`, { method: "DELETE" }),

  tree: (nodeId: string | number, depth: number, limits?: number[], signal?: AbortSignal) => {
    const query = new URLSearchParams({ depth: String(depth) });
    if (limits) query.set("limits", limits.join(","));
    return request<FsEntry>(`/nodes/${nodeId}/tree?${query}`, { signal });
  },

  path: (nodeId: string | number, signal?: AbortSignal) => request<FsEntry[]>(`/nodes/${nodeId}/path`, { signal }),

  resolve: (driveId: number, path: string) =>
    request<FsEntry[]>(`/drives/${driveId}/resolve?${new URLSearchParams({ path })}`),
};

export interface FsEntry {
  id: number;
  name: string;
  is_dir: boolean;

  size: number;

  modified?: string;

  extension?: string;

  child_count?: number;

  children?: FsEntry[];

  more_count?: number;
  more_size?: number;
}

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
}

export function toFsNode(entry: FsEntry): FsNode {
  if (entry.is_dir) {
    const children = (entry.children ?? []).map(toFsNode);
    if (entry.more_count) {
      children.push({
        id: `${entry.id}-rest`,
        name: `+${entry.more_count} more`,
        kind: "cluster",
        size: entry.more_size ?? 0,
        count: entry.more_count,
      });
    }
    return {
      id: String(entry.id),
      name: entry.name,
      kind: "directory",
      size: entry.size,
      modified: entry.modified,
      childCount: entry.child_count,
      children,
    };
  }
  return {
    id: String(entry.id),
    name: entry.name,
    kind: "file",
    size: entry.size,
    modified: entry.modified,
    extension: entry.extension ?? extensionOf(entry.name),
  };
}
