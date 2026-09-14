/*
 * Verdant Voice DSP v1
 * Projeto original do Verdant LAN. Implementação própria inspirada em princípios
 * públicos usados em processadores de voz: estimação adaptativa de piso de ruído,
 * VAD por nível/histerese, high-pass, downward expansion e supressão de transientes.
 * Não contém código copiado de WebRTC, SpeexDSP ou RNNoise.
 */
class VerdantNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.config = {
      noiseSuppression: true,
      suppressorModel: 'standard',
      suppressionLevel: 'medium',
      voiceDetection: true,
      voiceDetectionMode: 'auto',
      manualThresholdDb: -42
    };
    this.noiseFloorDb = -56;
    this.gain = 1;
    this.holdFrames = 0;
    this.prevInput = 0;
    this.prevHighPass = 0;
    this.frameCounter = 0;
    this.lastSpeech = false;
    this.transientHold = 0;
    this.port.onmessage = event => {
      if (event.data?.type === 'config' && event.data.preferences) {
        this.config = { ...this.config, ...event.data.preferences };
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input || input.length === 0) {
      output.fill(0);
      return true;
    }

    const level = this.levelConfig();
    let sum = 0;
    let diffSum = 0;
    let peak = 0;
    const filtered = new Float32Array(input.length);
    const hpAlpha = this.highPassAlpha(level.highPassHz);

    for (let i = 0; i < input.length; i += 1) {
      const x = input[i] || 0;
      const y = hpAlpha * (this.prevHighPass + x - this.prevInput);
      this.prevInput = x;
      this.prevHighPass = y;
      filtered[i] = y;
      sum += y * y;
      const diff = i === 0 ? y : y - filtered[i - 1];
      diffSum += diff * diff;
      const abs = Math.abs(y);
      if (abs > peak) peak = abs;
    }

    const rms = Math.sqrt(sum / Math.max(1, filtered.length) + 1e-12);
    const diffRms = Math.sqrt(diffSum / Math.max(1, filtered.length) + 1e-12);
    const rmsDb = this.toDb(rms);
    const crest = peak / Math.max(rms, 1e-6);
    const hfRatio = diffRms / Math.max(rms, 1e-6);

    const noiseLike = hfRatio > level.noiseLikeRatio && crest < level.noiseLikeCrest;
    this.updateNoiseFloor(rmsDb, noiseLike);
    const thresholdDb = this.config.voiceDetectionMode === 'manual'
      ? this.clamp(Number(this.config.manualThresholdDb), -60, -20)
      : this.clamp(this.noiseFloorDb + level.vadMarginDb, -52, -28);

    const likelyBreath = hfRatio > level.breathRatio && rmsDb < thresholdDb + level.breathHeadroomDb;
    const transient = crest > level.transientCrest
      && hfRatio > level.transientRatio
      && rmsDb > this.noiseFloorDb + 4
      && !this.lastSpeech;
    if (transient) this.transientHold = level.transientHoldFrames;
    else if (this.transientHold > 0) this.transientHold -= 1;

    const voiceNow = rmsDb >= thresholdDb
      && !(likelyBreath && rmsDb < thresholdDb + 5)
      && !(noiseLike && rmsDb < thresholdDb + 16)
      && !(transient && !this.lastSpeech);
    if (voiceNow) this.holdFrames = level.voiceHoldFrames;
    else if (this.holdFrames > 0) this.holdFrames -= 1;
    const gateOpen = !this.config.voiceDetection || voiceNow || this.holdFrames > 0;
    this.lastSpeech = voiceNow;

    let targetGain = 1;
    if (this.config.noiseSuppression) {
      const relative = rmsDb - this.noiseFloorDb;
      const verdant = this.config.suppressorModel === 'verdant';
      const floorGain = verdant ? level.floorGain : Math.sqrt(level.floorGain);
      const knee = verdant ? level.floorKneeDb : Math.max(2, level.floorKneeDb - 2);
      const open = verdant ? level.floorOpenDb : Math.max(7, level.floorOpenDb - 2);
      if (relative <= knee) targetGain *= floorGain;
      else if (relative < open) {
        const t = (relative - knee) / Math.max(1, open - knee);
        targetGain *= floorGain + (1 - floorGain) * t;
      }
      if (verdant && likelyBreath && !voiceNow) targetGain *= level.breathGain;
      if (verdant && this.transientHold > 0 && !voiceNow) targetGain *= level.transientGain;
    }
    if (this.config.voiceDetection && !gateOpen) targetGain *= level.closedGateGain;

    const attack = targetGain > this.gain ? level.attack : level.release;
    this.gain += (targetGain - this.gain) * attack;
    const appliedGain = this.clamp(this.gain, 0, 1);

    for (let i = 0; i < filtered.length; i += 1) {
      const sample = filtered[i] * appliedGain;
      output[i] = this.clamp(sample, -0.985, 0.985);
    }

    this.frameCounter += 1;
    if (this.frameCounter >= 75) {
      this.frameCounter = 0;
      this.port.postMessage({
        inputLevelDb: Math.round(rmsDb * 10) / 10,
        noiseFloorDb: Math.round(this.noiseFloorDb * 10) / 10,
        thresholdDb: Math.round(thresholdDb * 10) / 10,
        gateOpen,
        transient: this.transientHold > 0,
        attenuationDb: Math.round((-20 * Math.log10(Math.max(appliedGain, 1e-4))) * 10) / 10
      });
    }
    return true;
  }

  updateNoiseFloor(rmsDb, noiseLike) {
    const bounded = this.clamp(rmsDb, -90, -18);
    if (bounded < this.noiseFloorDb) {
      this.noiseFloorDb += (bounded - this.noiseFloorDb) * 0.05;
    } else if (noiseLike) {
      this.noiseFloorDb += (bounded - this.noiseFloorDb) * 0.035;
    } else if (!this.lastSpeech) {
      this.noiseFloorDb += (bounded - this.noiseFloorDb) * 0.004;
    } else {
      this.noiseFloorDb += (bounded - this.noiseFloorDb) * 0.00015;
    }
    this.noiseFloorDb = this.clamp(this.noiseFloorDb, -72, -30);
  }

  levelConfig() {
    const presets = {
      low: {
        highPassHz: 65, vadMarginDb: 6, floorKneeDb: 3, floorOpenDb: 9, floorGain: 0.25,
        closedGateGain: 0.06, breathRatio: 1.12, breathHeadroomDb: 7, breathGain: 0.5, noiseLikeRatio: 1.18, noiseLikeCrest: 3.1,
        transientCrest: 5.8, transientRatio: 1.18, transientGain: 0.55, transientHoldFrames: 3,
        voiceHoldFrames: 32, attack: 0.42, release: 0.11
      },
      medium: {
        highPassHz: 75, vadMarginDb: 8, floorKneeDb: 4, floorOpenDb: 11, floorGain: 0.13,
        closedGateGain: 0.025, breathRatio: 1.04, breathHeadroomDb: 8, breathGain: 0.34, noiseLikeRatio: 1.12, noiseLikeCrest: 3.2,
        transientCrest: 5.0, transientRatio: 1.10, transientGain: 0.34, transientHoldFrames: 4,
        voiceHoldFrames: 38, attack: 0.46, release: 0.095
      },
      high: {
        highPassHz: 85, vadMarginDb: 10, floorKneeDb: 5, floorOpenDb: 13, floorGain: 0.06,
        closedGateGain: 0.008, breathRatio: 0.98, breathHeadroomDb: 9, breathGain: 0.2, noiseLikeRatio: 1.06, noiseLikeCrest: 3.3,
        transientCrest: 4.4, transientRatio: 1.03, transientGain: 0.2, transientHoldFrames: 5,
        voiceHoldFrames: 44, attack: 0.5, release: 0.08
      },
      maximum: {
        highPassHz: 95, vadMarginDb: 12, floorKneeDb: 6, floorOpenDb: 15, floorGain: 0.025,
        closedGateGain: 0.002, breathRatio: 0.92, breathHeadroomDb: 10, breathGain: 0.11, noiseLikeRatio: 1.00, noiseLikeCrest: 3.4,
        transientCrest: 3.9, transientRatio: 0.98, transientGain: 0.11, transientHoldFrames: 6,
        voiceHoldFrames: 50, attack: 0.54, release: 0.065
      }
    };
    return presets[this.config.suppressionLevel] || presets.medium;
  }

  highPassAlpha(cutoffHz) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    return rc / (rc + dt);
  }

  toDb(value) { return 20 * Math.log10(Math.max(value, 1e-6)); }
  clamp(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
}

registerProcessor('verdant-noise-processor', VerdantNoiseProcessor);
