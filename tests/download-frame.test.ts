import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundDownloadFrame, navigateBackgroundDownload } from '../client/src/download.ts';

test('download de anexo usa iframe oculto e não navegação top-level', () => {
  const appended: any[] = [];
  const frame: any = {
    className: '',
    tabIndex: 0,
    src: '',
    attrs: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  };
  const documentFake: any = {
    createElement(tag: string) {
      assert.equal(tag, 'iframe');
      return frame;
    },
    body: { append(node: any) { appended.push(node); } }
  };

  const created = createBackgroundDownloadFrame(documentFake);
  assert.equal(created, frame);
  assert.equal(frame.className, 'verdant-download-frame');
  assert.equal(frame.src, 'about:blank');
  assert.equal(frame.attrs.get('aria-hidden'), 'true');
  assert.equal(appended.length, 1);

  navigateBackgroundDownload(frame, '/api/files/abc/download?key=xyz');
  assert.equal(frame.src, '/api/files/abc/download?key=xyz');
});

test('download rejeita URL vazia em vez de navegar de forma inesperada', () => {
  assert.throws(() => navigateBackgroundDownload({} as HTMLIFrameElement, ''), /URL de download vazia/);
});
