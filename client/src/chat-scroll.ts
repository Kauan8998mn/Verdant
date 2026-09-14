export interface MessageScrollSnapshot {
  channelId?: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  pinned: boolean;
}

export function isMessageScrollPinned(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 90
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Calcula onde a lista de mensagens deve ficar depois de um rerender.
 *
 * - canal novo/sem snapshot: começa no fim;
 * - usuário estava no fim: continua no fim, inclusive após mensagem nova;
 * - usuário estava lendo acima: preserva o scrollTop e não o joga ao topo/fim.
 */
export function nextMessageScrollTop(
  snapshot: MessageScrollSnapshot | undefined,
  channelId: string,
  nextScrollHeight: number,
  nextClientHeight: number
): number {
  const bottom = Math.max(0, nextScrollHeight - nextClientHeight);
  if (!snapshot || snapshot.channelId !== channelId || snapshot.pinned) return bottom;
  return Math.min(Math.max(0, snapshot.scrollTop), bottom);
}
