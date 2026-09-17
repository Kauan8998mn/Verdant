import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';

const cookie = 0x2112a442;
function attribute(type: number, value: Buffer): Buffer {
  const result = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4);
  result.writeUInt16BE(type); result.writeUInt16BE(value.length, 2); value.copy(result, 4);
  return result;
}
function attributes(packet: Buffer): Map<number, Buffer> {
  const result = new Map<number, Buffer>();
  for (let offset = 20; offset + 4 <= packet.length;) {
    const type = packet.readUInt16BE(offset), length = packet.readUInt16BE(offset + 2);
    result.set(type, packet.subarray(offset + 4, offset + 4 + length));
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return result;
}

// Minimal independent RFC 5389/5766 client for the local relay regression test.
// Exercises ChannelData framing directly rather than relying on a load generator.
export async function checkTurnRelay(options: {
  mode: 'udp' | 'tcp' | 'tls'; port: number; ca: Buffer;
  username: string; credential: string; expired?: boolean;
}): Promise<void> {
  let stream = Buffer.alloc(0);
  const pending = new Map<string, (packet: Buffer) => void>();
  let channelResolve: ((data: Buffer) => void) | undefined;
  const receive = (packet: Buffer) => {
    if (packet.readUInt16BE(0) === 0x4001) {
      channelResolve?.(packet.subarray(4, 4 + packet.readUInt16BE(2))); return;
    }
    pending.get(packet.subarray(8, 20).toString('hex'))?.(packet);
  };
  const receiveStream = (data: Buffer) => {
    stream = Buffer.concat([stream, data]);
    while (stream.length >= 4) {
      const isChannel = (stream[0] & 0xc0) === 0x40;
      const size = isChannel ? 4 + Math.ceil(stream.readUInt16BE(2) / 4) * 4 : 20 + stream.readUInt16BE(2);
      if (stream.length < size) break;
      receive(stream.subarray(0, size)); stream = stream.subarray(size);
    }
  };
  const udp = options.mode === 'udp' ? dgram.createSocket('udp4') : undefined;
  const socket = options.mode === 'tls'
    ? tls.connect({ host: '127.0.0.1', port: options.port, servername: 'localhost', ca: options.ca, rejectUnauthorized: true })
    : options.mode === 'tcp' ? net.connect(options.port, '127.0.0.1') : undefined;
  const echo = dgram.createSocket('udp4');
  try {
    if (udp) {
      udp.on('message', receive);
      await new Promise<void>((resolve, reject) => { udp.once('error', reject); udp.connect(options.port, '127.0.0.1', resolve); });
    } else {
      socket!.on('data', receiveStream);
      await new Promise<void>((resolve, reject) => { socket!.once('error', reject); socket!.once(options.mode === 'tls' ? 'secureConnect' : 'connect', resolve); });
    }
    const send = (packet: Buffer) => { if (udp) udp.send(packet); else socket!.write(packet); };
    let realm: Buffer | undefined, nonce: Buffer | undefined;
    const request = async (type: number, attrs: Buffer[], authenticated = true) => {
      const transaction = randomBytes(12), id = transaction.toString('hex');
      const header = Buffer.alloc(20); header.writeUInt16BE(type); header.writeUInt32BE(cookie, 4); transaction.copy(header, 8);
      if (authenticated) attrs = [...attrs, attribute(6, Buffer.from(options.username)), attribute(0x14, realm!), attribute(0x15, nonce!)];
      const body = Buffer.concat(attrs);
      header.writeUInt16BE(body.length + (authenticated ? 24 : 0), 2);
      let packet = Buffer.concat([header, body]);
      if (authenticated) {
        const key = createHash('md5').update(`${options.username}:${realm!.toString()}:${options.credential}`).digest();
        packet = Buffer.concat([packet, attribute(8, createHmac('sha1', key).update(packet).digest())]);
      }
      return await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('TURN response timeout')); }, 5000);
        pending.set(id, response => { clearTimeout(timer); pending.delete(id); resolve(response); });
        send(packet);
      });
    };
    const transport = attribute(0x19, Buffer.from([17, 0, 0, 0]));
    const challenge = await request(3, [transport], false);
    assert.equal(challenge.readUInt16BE(0), 0x113);
    realm = attributes(challenge).get(0x14); nonce = attributes(challenge).get(0x15);
    assert.ok(realm && nonce);
    const allocation = await request(3, [transport]);
    if (options.expired) {
      assert.equal(allocation.readUInt16BE(0), 0x113);
      const error = attributes(allocation).get(9)!;
      assert.equal(error[2] * 100 + error[3], 401); return;
    }
    assert.equal(allocation.readUInt16BE(0), 0x103);
    assert.ok(attributes(allocation).has(0x16), 'relay address returned');
    await new Promise<void>(resolve => echo.bind(0, '127.0.0.1', resolve));
    echo.on('message', (data, peer) => echo.send(data, peer.port, peer.address));
    const peer = Buffer.alloc(8); peer[1] = 1;
    peer.writeUInt16BE(echo.address().port ^ (cookie >>> 16), 2);
    peer.writeUInt32BE((0x7f000001 ^ cookie) >>> 0, 4);
    const bind = await request(9, [attribute(0x0c, Buffer.from([0x40, 1, 0, 0])), attribute(0x12, peer)]);
    assert.equal(bind.readUInt16BE(0), 0x109);
    for (let i = 0; i < 5; i++) {
      const payload = Buffer.from(`Verdant relay packet ${i}`);
      const packet = Buffer.alloc(4 + Math.ceil(payload.length / 4) * 4);
      packet.writeUInt16BE(0x4001); packet.writeUInt16BE(payload.length, 2); payload.copy(packet, 4);
      const received = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TURN relay packet timeout')), 5000);
        channelResolve = data => { clearTimeout(timer); resolve(data); };
        send(packet);
      });
      assert.deepEqual(received, payload);
    }
    assert.equal((await request(4, [attribute(0x0d, Buffer.alloc(4))])).readUInt16BE(0), 0x104);
  } finally {
    socket?.destroy();
    if (udp) udp.close();
    try { echo.close(); } catch {}
  }
}
