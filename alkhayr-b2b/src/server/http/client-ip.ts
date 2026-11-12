import { isIP } from 'node:net';

/**
 * Client address resolution (docs/SECURITY.md §7).
 * X-Forwarded-For is honoured ONLY when the TCP peer is one of the configured
 * TRUST_PROXY addresses; the list is then read from the right, skipping trusted
 * proxies, and the first untrusted address is the client. Any malformed entry
 * stops the walk and the peer address is used (fail safe). Direct clients can
 * never choose their own address by sending the header.
 */

export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v.startsWith('::ffff:') && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) === 0 ? null : v;
}

const MAX_FORWARDED_ENTRIES = 20;

export function resolveClientIp(remoteAddress: string | undefined, forwardedFor: string | string[] | undefined, trustedProxies: ReadonlySet<string>): string {
  const peer = normalizeIp(remoteAddress) ?? '0.0.0.0';
  if (!trustedProxies.has(peer) || forwardedFor === undefined) return peer;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const entries = header.split(',').slice(-MAX_FORWARDED_ENTRIES);
  for (let i = entries.length - 1; i >= 0; i--) {
    const ip = normalizeIp(entries[i]);
    if (!ip) return peer;
    if (!trustedProxies.has(ip)) return ip;
  }
  return peer;
}

export function trustedProxySet(list: readonly string[]): ReadonlySet<string> {
  return new Set(list.map((ip) => normalizeIp(ip)).filter((ip): ip is string => ip !== null));
}

function expandIPv6(ip: string): string[] {
  let v = ip;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (v4) {
    const parts = v4[1]!.split('.').map(Number);
    v = v.slice(0, -v4[1]!.length) + `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const [head, tail] = v.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, '0'));
}

/**
 * Identity used for per-IP rate limiting: IPv4 address, or the IPv6 /64
 * prefix (one end site normally controls a whole /64).
 */
export function rateLimitIdentity(ip: string): string {
  if (isIP(ip) !== 6) return `v4:${ip}`;
  return `v6:${expandIPv6(ip).slice(0, 4).join(':')}::/64`;
}
