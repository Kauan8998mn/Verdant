import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromiumCandidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter((value): value is string => Boolean(value));

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('porta indisponível'));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitHealth(base: string, child: ChildProcess): Promise<void> {
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  child.stderr?.on('data', chunk => { output += chunk.toString(); });
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`Servidor de mídia encerrou:\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timeout no healthcheck:\n${output}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function clickText(page: any, selector: string, text: string): Promise<void> {
  await page.waitForFunction((sel: string, wanted: string) => [...document.querySelectorAll(sel)].some(node => node.textContent?.includes(wanted)), {}, selector, text);
  const clicked = await page.evaluate((sel: string, wanted: string) => {
    const node = [...document.querySelectorAll<HTMLElement>(sel)].find(item => item.textContent?.includes(wanted));
    node?.click();
    return Boolean(node);
  }, selector, text);
  assert.equal(clicked, true, `botão não encontrado: ${text}`);
}

test('SFU real: voz, tela/áudio, rota ICE e recuperação entre servidores', { timeout: 240_000 }, async t => {
  const chromium = chromiumCandidates.find(candidate => fs.existsSync(candidate));
  const required = [
    'node_modules/mediasoup/package.json',
    'node_modules/mediasoup-client/package.json',
    'node_modules/puppeteer-core/package.json',
    'client/dist/index.html'
  ].every(item => fs.existsSync(path.join(root, item)));
  if (!chromium || !required) {
    const reason = 'Teste E2E requer npm install, npm run build e Chromium/Chrome local.';
    if (process.env.REQUIRE_MEDIA_E2E === '1') assert.fail(reason);
    t.skip(reason);
    return;
  }

  const puppeteer = await import('puppeteer-core');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-media-e2e-'));
  const port = await freePort();
  let mediaPort = await freePort();
  while (mediaPort === port) mediaPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const turnMode = process.env.TEST_TURN_TRANSPORT;
  const turnEnv: NodeJS.ProcessEnv = {};
  let turnServer: ChildProcess | undefined;
  if (turnMode) {
    assert.ok(['udp', 'tcp'].includes(turnMode), 'TEST_TURN_TRANSPORT deve ser udp ou tcp');
    const turnPort = await freePort(), secret = randomBytes(32).toString('hex');
    const values: Record<string, string> = { TURN_PORT: String(turnPort), TURN_TLS_PORT: String(await freePort()),
      TURN_LISTEN_IP: '127.0.0.1', PUBLIC_IP: '127.0.0.1', RELAY_MIN: '45000', RELAY_MAX: '45100',
      TURN_REALM: 'verdant.test', TURN_HOST: 'localhost', TURN_SECRET: secret, TLS_SETTINGS: 'no-tls' };
    const config = fs.readFileSync(path.join(root, 'deploy/turnserver.conf.example'), 'utf8')
      .replace(/@@([A-Z_]+)@@/g, (_, key) => values[key]);
    const file = path.join(temp, 'turn.conf');
    fs.writeFileSync(file, `${config}\nallow-loopback-peers\nrelay-threads=1\npidfile=${temp}/turn.pid\n`, { mode: 0o600 });
    turnServer = spawn('turnserver', ['-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    turnServer.stdout!.on('data', b => { output += b; });
    turnServer.stderr!.on('data', b => { output += b; });
    for (let i = 0; i < 100 && !output.includes('Relay ports initialization done'); i++) {
      if (turnServer.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    Object.assign(turnEnv, { TURN_ENABLED: 'true', TURN_SECRET: secret, TURN_HOST: 'localhost', TURN_REALM: 'verdant.test',
      TURN_PORT: String(turnPort), TURN_TLS_ENABLED: 'false', TURN_TTL_SECONDS: '120', VERDANT_DEBUG_WEBRTC: 'true',
      VERDANT_ICE_POLICY: 'relay', VERDANT_TURN_TRANSPORT: turnMode });
  }
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      ...turnEnv,
      PORT: String(port), HOST: '127.0.0.1', MEDIA_PORT: String(mediaPort), MEDIA_LISTEN_IPS: '127.0.0.1',
      DATA_DIR: path.join(temp, 'data'), LOG_DIR: path.join(temp, 'logs'), UPLOAD_DIR: path.join(temp, 'uploads')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let browser: any;
  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Voz E2E', ownerName: 'Uriel' })
    })).json();
    const voiceChannel = created.channels.find((channel: any) => channel.type === 'voice');
    assert.ok(voiceChannel?.id);
    const joinedResponse = await fetch(`${base}/api/servers/${created.server.id}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alice' })
    });
    assert.equal(joinedResponse.status, 200);
    const alice: any = await joinedResponse.json();
    const other: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Outro E2E', ownerName: 'Observer' })
    })).json();

    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      timeout: 60_000,
      args: [
        '--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'
      ]
    });
    const ownerPage = await (await browser.createBrowserContext()).newPage();
    const alicePage = await (await browser.createBrowserContext()).newPage();

    for (const [page, session] of [[ownerPage, created.session], [alicePage, alice.session]] as const) {
      await page.evaluateOnNewDocument((serverId: string, value: any) => {
        localStorage.setItem(`verdant.session.${serverId}`, JSON.stringify({ token: value.token, displayName: value.displayName }));
        const scope = window as any;
        scope.__qaPeerConnections = [];
        scope.__qaVoiceSockets = [];
        scope.__qaIceExpiries = [];
        scope.__qaIceRestarts = 0;
        window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, { construct(target, args) {
          const pc = Reflect.construct(target, args);
          scope.__qaPeerConnections.push(pc);
          return pc;
        } });
        window.WebSocket = new Proxy(window.WebSocket, { construct(target, args) {
          const socket = Reflect.construct(target, args);
          if (String(args[0]).includes('purpose=voice')) {
            scope.__qaVoiceSockets.push(socket);
            const actions = new Map<string, string>(), send = socket.send.bind(socket);
            socket.send = (raw: string) => {
              const message = JSON.parse(raw);
              if (message.type === 'media.request') {
                actions.set(message.requestId, message.action);
                if (message.action === 'transport.restartIce') scope.__qaIceRestarts++;
              }
              send(raw);
            };
            socket.addEventListener('message', (event: MessageEvent) => {
              const message = JSON.parse(event.data);
              if (message.type === 'media.response' && actions.get(message.requestId) === 'ice.config' && message.ok) {
                scope.__qaIceExpiries.push(message.data.expiresAt);
              }
              if (message.type === 'media.response') actions.delete(message.requestId);
            });
          }
          return socket;
        } });
      }, created.server.id, session);
      if (page === ownerPage) await page.evaluateOnNewDocument((serverId: string, session: any) => {
        localStorage.setItem(`verdant.session.${serverId}`, JSON.stringify(session));
      }, other.server.id, other.session);
      page.on('pageerror', (error: Error) => t.diagnostic(error.message));
      await page.goto(base, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.querySelectorAll('.channel-row').length >= 2);
      await clickText(page, '.channel-row', voiceChannel.name);
      await clickText(page, 'button', 'Entrar na chamada');
      await page.waitForFunction(() => document.body.textContent?.includes('Chamada conectada'));
    }

    await ownerPage.waitForFunction(() => document.querySelectorAll('#verdant-remote-audio audio').length >= 1);
    await alicePage.waitForFunction(() => document.querySelectorAll('#verdant-remote-audio audio').length >= 1);
    assert.equal(await ownerPage.evaluate(() => document.querySelectorAll('#verdant-remote-audio audio').length), 1);
    assert.equal(await alicePage.evaluate(() => document.querySelectorAll('#verdant-remote-audio audio').length), 1);
    await ownerPage.waitForFunction(() => {
      const audio = document.querySelector<HTMLAudioElement>('#verdant-remote-audio audio');
      const track = (audio?.srcObject as MediaStream | null)?.getAudioTracks?.()[0];
      return Boolean(audio && track?.readyState === 'live' && audio.currentTime > 0.05);
    }, { timeout: 8000 });
    await alicePage.waitForFunction(() => {
      const audio = document.querySelector<HTMLAudioElement>('#verdant-remote-audio audio');
      const track = (audio?.srcObject as MediaStream | null)?.getAudioTracks?.()[0];
      return Boolean(audio && track?.readyState === 'live' && audio.currentTime > 0.05);
    }, { timeout: 8000 });

    // Require growing RTP counters; a live MediaStream alone does not prove packets.
    const assertAudioPackets = async (page: any) => {
      const sample = async () => await page.evaluate(async () => {
        let bytes = 0;
        for (const pc of (window as any).__qaPeerConnections as RTCPeerConnection[]) {
          if (pc.connectionState !== 'connected') continue;
          (await pc.getStats()).forEach(stat => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytes += stat.bytesReceived ?? 0;
          });
        }
        return bytes;
      });
      const before = await sample();
      await page.waitForFunction(async (initial: number) => {
        let bytes = 0;
        for (const pc of (window as any).__qaPeerConnections as RTCPeerConnection[]) {
          if (pc.connectionState !== 'connected') continue;
          (await pc.getStats()).forEach(stat => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytes += stat.bytesReceived ?? 0;
          });
        }
        return bytes > initial;
      }, { timeout: 10_000 }, before);
    };
    for (const page of [ownerPage, alicePage]) {
      await assertAudioPackets(page);
      if (turnMode) await page.waitForFunction(async (mode: string) => {
        const active = (window as any).__qaPeerConnections.filter((pc: RTCPeerConnection) => pc.connectionState === 'connected');
        if (active.length !== 2) return false;
        for (const pc of active) {
          const report = await pc.getStats();
          let candidate: any;
          report.forEach((stat: any) => {
            if (stat.type === 'transport' && stat.selectedCandidatePairId) {
              candidate = report.get(report.get(stat.selectedCandidatePairId).localCandidateId);
            }
          });
          if (candidate?.candidateType !== 'relay' || candidate.relayProtocol !== mode) return false;
        }
        return true;
      }, { timeout: 10_000 }, turnMode);
    }
    if (turnMode) t.diagnostic(`Both clients: send/recv relayProtocol=${turnMode}, increasing inbound audio RTP bytes`);

    await clickText(alicePage, '.voice-action', 'Microfone ligado');
    await ownerPage.waitForFunction(() => [...document.querySelectorAll('.voice-member-card')].some(card => card.textContent?.includes('Alice') && card.textContent?.includes('Mutado')));

    await clickText(alicePage, '.voice-action', 'Áudio ativo');
    await ownerPage.waitForFunction(() => [...document.querySelectorAll('.voice-member-card')].some(card => card.textContent?.includes('Alice') && card.textContent?.includes('Ensurdecido')));

    // Volta a ouvir antes de validar o áudio da transmissão.
    await clickText(alicePage, '.voice-action', 'Ensurdecido');

    // getDisplayMedia exige interação/chooser real; no E2E headless substituímos somente a fonte
    // por um MediaStream real do Chromium. Todo o restante (Producer/Consumer/SFU/render) é real.
    await ownerPage.evaluate(() => {
      const media = navigator.mediaDevices as any;
      media.getDisplayMedia = async (options: any) => {
        (window as any).__verdantDisplayConstraints = options;
        return await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: true
        });
      };
    });

    await clickText(ownerPage, '.screen-controls button', 'Compartilhar tela');
    await ownerPage.waitForFunction(() => document.body.textContent?.includes('Transmitindo'));
    const constraints = await ownerPage.evaluate(() => (window as any).__verdantDisplayConstraints);
    assert.equal(constraints.video.width.ideal, 1280);
    assert.equal(constraints.video.height.ideal, 720);
    assert.equal(constraints.video.frameRate.ideal, 30);
    assert.ok(constraints.audio);

    await alicePage.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('.screen-stage video');
      const track = (video?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
      return Boolean(video && track?.readyState === 'live' && video.currentTime > 0.05);
    }, { timeout: 10_000 });
    await alicePage.waitForFunction(() => {
      const audio = document.querySelector<HTMLAudioElement>('#verdant-remote-audio audio[data-source="screen-audio"]');
      const track = (audio?.srcObject as MediaStream | null)?.getAudioTracks?.()[0];
      return Boolean(audio && track?.readyState === 'live');
    }, { timeout: 10_000 });
    await alicePage.waitForFunction(async () => {
      const video = document.querySelector<HTMLVideoElement>('.screen-stage video');
      const audio = document.querySelector<HTMLAudioElement>('#verdant-remote-audio audio[data-source="screen-audio"]');
      const videoId = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.id;
      const audioId = (audio?.srcObject as MediaStream | null)?.getAudioTracks()[0]?.id;
      let videoPackets = false, audioPackets = false;
      for (const pc of (window as any).__qaPeerConnections as RTCPeerConnection[]) {
        (await pc.getStats()).forEach(stat => {
          if (stat.type !== 'inbound-rtp' || !(stat.bytesReceived > 0)) return;
          if (stat.trackIdentifier === videoId && stat.framesDecoded > 0) videoPackets = true;
          if (stat.trackIdentifier === audioId) audioPackets = true;
        });
      }
      return videoPackets && audioPackets;
    }, { timeout: 10_000 });

    await clickText(ownerPage, '.screen-stage button, .screen-controls button', 'Parar transmissão');
    await alicePage.waitForFunction(() => !document.querySelector('.screen-stage'), { timeout: 8000 });
    if (process.env.REQUIRE_ICE_RENEWAL === '1') {
      assert.ok(turnMode, 'Renewal validation requires local TURN');
      await ownerPage.waitForFunction(() => {
        const scope = window as any;
        return scope.__qaIceExpiries.length >= 2 && scope.__qaIceRestarts >= 2 && Date.now() > scope.__qaIceExpiries[0] + 1000;
      }, { timeout: 140_000 });
      // Alice is muted by the earlier UI test; restore her mic for bidirectional RTP.
      await clickText(alicePage, '.voice-action', 'Microfone desligado');
      for (const page of [ownerPage, alicePage]) await assertAudioPackets(page);
      t.diagnostic('TURN TTL crossed: credentials renewed, both transports restarted, audio RTP continues');
    }
    await ownerPage.click('[aria-label="Abrir servidor Outro E2E"]');
    await ownerPage.waitForFunction(() => document.querySelector('.server-button.active')?.getAttribute('aria-label') === 'Abrir servidor Outro E2E');
    const oldCount = await ownerPage.evaluate(() => (window as any).__qaPeerConnections.length);
    await ownerPage.evaluate(() => (window as any).__qaVoiceSockets.at(-1).close());
    await ownerPage.waitForFunction((count: number) => {
      const pcs = (window as any).__qaPeerConnections as RTCPeerConnection[];
      return pcs.length >= count + 2 && pcs.filter(pc => pc.connectionState === 'connected').length === 2;
    }, { timeout: 30_000 }, oldCount);
    assert.equal(await ownerPage.evaluate(() => document.querySelector('.server-button.active')?.getAttribute('aria-label')), 'Abrir servidor Outro E2E');
    // The old server must receive the recovered owner's mic, while browsing stays on the new server.
    await assertAudioPackets(alicePage);
    await ownerPage.waitForFunction(() => document.querySelector('#member-sidebar')?.textContent?.includes('Observer') && !document.querySelector('#member-sidebar')?.textContent?.includes('Uriel'));
    t.diagnostic('Voice websocket recovered in original server/channel while browsing another server');
  } catch (error) {
    for (const context of browser?.browserContexts?.() ?? []) {
      for (const page of await context.pages()) {
        t.diagnostic((await page.evaluate(() => document.body.innerText)).slice(0, 4000));
      }
    }
    throw error;
  } finally {
    try { await browser?.close(); } catch {}
    await stopServer(child);
    if (turnServer) await stopServer(turnServer);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
