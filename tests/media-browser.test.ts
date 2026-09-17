import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('Fases 4 e 5 reais: voz Opus e uma transmissão de tela/áudio atravessam o mediasoup SFU', { timeout: 45_000 }, async t => {
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
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
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

    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
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
      }, created.server.id, session);
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

    await clickText(ownerPage, '.screen-stage button, .screen-controls button', 'Parar transmissão');
    await alicePage.waitForFunction(() => !document.querySelector('.screen-stage'), { timeout: 8000 });
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
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
