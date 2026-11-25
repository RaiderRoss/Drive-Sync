import type { FsNode } from "./components/Canvas";

/**
 * One file or folder as the backend sends it (JSON). Folders carry their children inline,
 * so a whole scan is a single nested object.
 *
 * ```json
 * { "id": 1, "name": "C:", "is_dir": true, "size": 206139136410, "children": [
 *   { "id": 2, "name": "README.md", "is_dir": false, "size": 4096, "extension": "md" }
 * ] }
 * ```
 */
export interface FsEntry {
  /** Numeric key from the backend (e.g. the database row id); unique within the tree. */
  id: number;
  name: string;
  is_dir: boolean;
  /** Bytes. For a folder, the total of everything inside it. */
  size: number;
  /** Shown as-is in the details panel, e.g. "Today" or an ISO date. */
  modified?: string;
  /** Without the dot. Optional: worked out from `name` when missing. */
  extension?: string;
  /** Folders only. */
  children?: FsEntry[];
}

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
}

/** Converts the backend's JSON into the tree the UI works with (ids become strings there). */
export function toFsNode(entry: FsEntry): FsNode {
  if (entry.is_dir) {
    return {
      id: String(entry.id),
      name: entry.name,
      kind: "directory",
      size: entry.size,
      modified: entry.modified,
      children: (entry.children ?? []).map(toFsNode),
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
