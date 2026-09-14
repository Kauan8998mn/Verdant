export interface PanelScrollSnapshot {
  key: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  pinnedToBottom: boolean;
}

export function isPanelNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 96
): boolean {
  if (scrollHeight <= clientHeight) return false;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * Preserva a posição de um painel que precisou ser recriado.
 * Se o usuário estava perto do fim, mantém o fim ancorado mesmo quando
 * conteúdo novo é inserido acima (por exemplo, o preview da transmissão).
 */
export function nextPanelScrollTop(
  snapshot: PanelScrollSnapshot | undefined,
  key: string,
  newScrollHeight: number,
  newClientHeight: number
): number {
  const bottom = Math.max(0, newScrollHeight - newClientHeight);
  if (!snapshot || snapshot.key !== key) return 0;
  if (snapshot.pinnedToBottom) return bottom;
  return Math.min(Math.max(0, snapshot.scrollTop), bottom);
}
