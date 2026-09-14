import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScreenSimulcastEncodings, clampSpatialLayer, priorityForMode, screenVideoMode, spatialLayerForMode } from '../client/src/screen-multistream.ts';

test('Fase 7: grade com múltiplas telas pausa vídeo remoto sob demanda', () => {
  assert.equal(screenVideoMode({ shareId: 'a', remoteVideoCount: 1, totalVideoCount: 1 }), 'high');
  assert.equal(screenVideoMode({ shareId: 'a', remoteVideoCount: 2, totalVideoCount: 2 }), 'paused');
  assert.equal(screenVideoMode({ shareId: 'a', remoteVideoCount: 1, totalVideoCount: 2 }), 'paused');
  assert.equal(spatialLayerForMode('high'), 2);
  assert.equal(spatialLayerForMode('low'), 0);
});

test('Fase 6: foco pausa streams remotas não focadas', () => {
  assert.equal(screenVideoMode({ shareId: 'a', focusedShareId: 'a', remoteVideoCount: 3 }), 'high');
  assert.equal(screenVideoMode({ shareId: 'b', focusedShareId: 'a', remoteVideoCount: 3 }), 'paused');
  assert.equal(screenVideoMode({ shareId: 'b', focusedShareId: 'local-share', remoteVideoCount: 3 }), 'paused');
  assert.equal(priorityForMode('high') > priorityForMode('low'), true);
});

test('Fase 6: camada espacial é limitada a 0..2', () => {
  assert.equal(clampSpatialLayer(-9), 0);
  assert.equal(clampSpatialLayer(1), 1);
  assert.equal(clampSpatialLayer(99), 2);
});


test('Fase 6: compartilhamento Chromium prepara três camadas simulcast ordenadas', () => {
  const layers = buildScreenSimulcastEncodings(4000, 60);
  assert.equal(layers.length, 3);
  assert.equal(layers[0].scaleResolutionDownBy, 4);
  assert.equal(layers[2].scaleResolutionDownBy, 1);
  assert.ok(Number(layers[0].maxBitrate) < Number(layers[1].maxBitrate));
  assert.ok(Number(layers[1].maxBitrate) < Number(layers[2].maxBitrate));
  assert.equal(layers[2].maxFramerate, 60);
});
