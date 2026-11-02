import { isIP } from 'node:net';
export function clientIp(request, trustFlyProxy = false) {
  const forwarded = request.headers['fly-client-ip'];
  if (trustFlyProxy && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return request.socket.remoteAddress || 'unknown';
}
