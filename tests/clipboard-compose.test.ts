import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClipboardFiles } from '../client/src/clipboard-files.ts';

interface FakeFile { name: string; size: number; type: string; lastModified: number }

function fake(name: string, size: number, type = 'image/png', lastModified = 1): FakeFile {
  return { name, size, type, lastModified };
}

test('Ctrl+V: quando files e items expõem a mesma imagem, usa uma única fonte', () => {
  const direct = fake('image.png', 1234, 'image/png', 1);
  const wrapped = fake('image.png', 1234, 'image/png', 999);
  const result = collectClipboardFiles([direct], [{ kind: 'file', getAsFile: () => wrapped }]);
  assert.equal(result.length, 1);
  assert.equal(result[0], direct);
});

test('Ctrl+V: fallback de items também elimina wrappers duplicados', () => {
  const a = fake('image.png', 1234, 'image/png', 1);
  const b = fake('image.png', 1234, 'image/png', 999);
  const result = collectClipboardFiles([], [
    { kind: 'file', getAsFile: () => a },
    { kind: 'file', getAsFile: () => b }
  ]);
  assert.equal(result.length, 1);
});

test('Ctrl+V: arquivos diferentes continuam separados', () => {
  const result = collectClipboardFiles([
    fake('a.png', 100),
    fake('b.png', 101)
  ], []);
  assert.equal(result.length, 2);
});
