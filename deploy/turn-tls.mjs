// Older Coturn versions need explicit TLS 1.0/1.1 disabling. New versions
// default to TLS 1.2 and removed these switches; detect supported options.
export function turnTlsSettings(enabled, help, cert = '/etc/verdant/turn-tls/fullchain.pem', key = '/etc/verdant/turn-tls/privkey.pem') {
  if (!enabled) return 'no-tls';
  const lines = [`cert=${cert}`, `pkey=${key}`];
  if (/--no-tlsv1\s/.test(help)) lines.push('no-tlsv1', 'no-tlsv1_1');
  else if (!/--tlsv1\s/.test(help)) throw new Error('Não foi possível determinar suporte TLS do Coturn instalado.');
  return lines.join('\n');
}
