import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCREEN_RESOLUTIONS,
  isScreenFps,
  isScreenResolution,
  isScreenSourcePreference,
  recommendedScreenBitrateKbps
} from '../shared/src/screen.ts';
import {
  SCREEN_RESOLUTIONS as CLIENT_SCREEN_RESOLUTIONS,
  recommendedScreenBitrateKbps as clientRecommendedScreenBitrateKbps
} from '../client/src/screen-config.ts';

const REQUIRED_PRESETS = {
  '360p': { width: 640, height: 360 },
  '480p': { width: 854, height: 480 },
  '540p': { width: 960, height: 540 },
  '576p': { width: 1024, height: 576 },
  '720p': { width: 1280, height: 720 },
  '900p': { width: 1600, height: 900 },
  '1080p': { width: 1920, height: 1080 }
};

test('Fase 5: presets de resolução exigidos pelo SPEC permanecem exatos no servidor e cliente', () => {
  assert.deepEqual(SCREEN_RESOLUTIONS, REQUIRED_PRESETS);
  assert.deepEqual(CLIENT_SCREEN_RESOLUTIONS, REQUIRED_PRESETS);
});

test('Fase 5: cliente e servidor não divergem no bitrate automático', () => {
  for (const resolution of Object.keys(REQUIRED_PRESETS) as Array<keyof typeof REQUIRED_PRESETS>) {
    for (const fps of [30, 60] as const) {
      assert.equal(clientRecommendedScreenBitrateKbps(resolution, fps), recommendedScreenBitrateKbps(resolution, fps));
    }
  }
});

test('Fase 5: valida resolução, FPS e preferência de fonte', () => {
  assert.equal(isScreenResolution('720p'), true);
  assert.equal(isScreenResolution('1440p'), false);
  assert.equal(isScreenFps(30), true);
  assert.equal(isScreenFps(60), true);
  assert.equal(isScreenFps(45), false);
  assert.equal(isScreenSourcePreference('monitor'), true);
  assert.equal(isScreenSourcePreference('window'), true);
  assert.equal(isScreenSourcePreference('browser'), true);
  assert.equal(isScreenSourcePreference('desktop'), false);
});

test('Fase 5: bitrate automático cresce com resolução/FPS', () => {
  assert.ok(recommendedScreenBitrateKbps('1080p', 60) > recommendedScreenBitrateKbps('720p', 30));
  assert.ok(recommendedScreenBitrateKbps('720p', 60) > recommendedScreenBitrateKbps('720p', 30));
});
