import os from 'node:os';

export interface NetworkAddress {
  name: string;
  address: string;
  kind: 'lan' | 'hamachi' | 'vpn' | 'other';
}

export function detectNetworkAddresses(): NetworkAddress[] {
  let interfaces: ReturnType<typeof os.networkInterfaces>;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // Containers restritos e alguns estados transitórios do sistema podem
    // negar a enumeração. O host local não deve cair por causa disso.
    return [];
  }
  const output: NetworkAddress[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const lowered = name.toLowerCase();
      if (/docker|br-|veth|virbr|podman|loopback/.test(lowered)) continue;

      let kind: NetworkAddress['kind'] = 'other';
      if (entry.address.startsWith('25.')) kind = 'hamachi';
      else if (/hamachi|ham0/.test(lowered)) kind = 'hamachi';
      else if (/tun|tap|wg|tailscale|zerotier/.test(lowered)) kind = 'vpn';
      else if (isPrivateIPv4(entry.address)) kind = 'lan';

      output.push({ name, address: entry.address, kind });
    }
  }

  const rank = { lan: 0, hamachi: 1, vpn: 2, other: 3 } as const;
  return output.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}
