/**
 * Downloads não podem navegar o documento principal: uma navegação top-level
 * pode fechar WebSocket/WebRTC mesmo quando a resposta usa Content-Disposition.
 * O iframe é criado durante o clique do usuário e recebe a URL assinada depois.
 */
export function createBackgroundDownloadFrame(documentRef: Document): HTMLIFrameElement {
  const frame = documentRef.createElement('iframe');
  frame.className = 'verdant-download-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.src = 'about:blank';
  documentRef.body.append(frame);
  return frame;
}

export function navigateBackgroundDownload(frame: HTMLIFrameElement, url: string): void {
  if (!url) throw new Error('URL de download vazia.');
  frame.src = url;
}
