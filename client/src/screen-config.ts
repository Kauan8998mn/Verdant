import type { ScreenFps, ScreenResolutionName } from './types.js';

export const SCREEN_RESOLUTIONS: Record<ScreenResolutionName, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '480p': { width: 854, height: 480 },
  '540p': { width: 960, height: 540 },
  '576p': { width: 1024, height: 576 },
  '720p': { width: 1280, height: 720 },
  '900p': { width: 1600, height: 900 },
  '1080p': { width: 1920, height: 1080 }
};

export const SCREEN_BITRATE_OPTIONS_KBPS = [0, 1200, 2000, 3000, 5000, 8000, 12000] as const;

export function recommendedScreenBitrateKbps(resolution: ScreenResolutionName, fps: ScreenFps): number {
  const base: Record<ScreenResolutionName, number> = {
    '360p': 1200,
    '480p': 1800,
    '540p': 2200,
    '576p': 2500,
    '720p': 3500,
    '900p': 5200,
    '1080p': 7000
  };
  return Math.round(base[resolution] * (fps === 60 ? 1.45 : 1));
}
