export interface ClipboardFileLike {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface ClipboardItemLike<T extends ClipboardFileLike> {
  kind: string;
  getAsFile(): T | null;
}

/**
 * Browsers may expose the same pasted image in both DataTransfer.files and
 * DataTransfer.items. Prefer files when available and only fall back to items,
 * so a single Ctrl+V can never enqueue the same browser clipboard payload twice.
 */
export function collectClipboardFiles<T extends ClipboardFileLike>(
  filesSource: ArrayLike<T> | null | undefined,
  itemsSource: ArrayLike<ClipboardItemLike<T>> | null | undefined
): T[] {
  const direct = Array.from(filesSource ?? []);
  const candidates = direct.length
    ? direct
    : Array.from(itemsSource ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((item): item is T => Boolean(item));

  const seen = new Set<string>();
  const result: T[] = [];
  for (const file of candidates) {
    // lastModified is intentionally excluded: Chromium/Firefox can synthesize
    // a different timestamp for two wrappers that represent the same paste.
    const key = `${file.name}\u001f${file.size}\u001f${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}
