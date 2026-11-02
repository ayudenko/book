import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openStore } from './store.mjs';
import { validateLibrary, normalizeLibrary } from './validation.mjs';
const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'quiet_session';
const sessionAge = 14 * 24 * 60 * 60;
export const MAX_BODY = 20 * 1024 * 1024;
const emptyLibrary = () => ({version: 2, activeBookId: null, books: []});
const securityHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'};
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {status, headers: {...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers}});
}
export const errorResponse = (status, code, message, headers) => json({error: {code, message}}, status, headers);
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
  return `scrypt$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, expected] = stored.split('$');
  const actual = (await passwordHash(password, salt)).split('$')[2];
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export function createApp({databasePath = './data/quiet-chapter.sqlite', origin = 'http://localhost:4000', now = Date.now, rateLimit = 20, production = false} = {}) {
  const parsedOrigin = new URL(origin);
  if (origin !== parsedOrigin.origin || !['http:', 'https:'].includes(parsedOrigin.protocol)) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path');
  if (production && parsedOrigin.protocol !== 'https:') throw new Error('Production requires HTTPS APP_ORIGIN');
  const secure = parsedOrigin.protocol === 'https:';
  const db = openStore(databasePath);
  const dummyHash = passwordHash(randomBytes(32).toString('hex'));
  const cookie = (token, age = sessionAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  function tokenFrom(request) {
    const value = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function userFor(request) {
    const token = tokenFrom(request);
    const user = token && db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(hash(token), now());
    if (!user) throw new ApiError(401, 'unauthorized', 'Войдите в аккаунт, чтобы продолжить.');
    return user;
  }
  function startSession(userId, request) {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
    const previous = tokenFrom(request);
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(previous));
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token), userId, now() + sessionAge * 1000);
    return cookie(token);
  }
  function throttle(key) {
    const time = now();
    db.prepare('DELETE FROM auth_limits WHERE expires_at<=?').run(time);
    db.prepare('INSERT INTO auth_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(hash(key), time + 15 * 60 * 1000);
    if (db.prepare('SELECT attempts FROM auth_limits WHERE key=?').get(hash(key)).attempts > rateLimit) throw new ApiError(429, 'rate_limited', 'Слишком много попыток. Повторите через 15 минут.');
  }
  async function body(request, limit) {
    const text = await request.text();
    if (Buffer.byteLength(text) > limit) throw new ApiError(413, 'body_too_large', 'Размер запроса превышает допустимый.');
    try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
    catch { throw new ApiError(400, 'invalid_json', 'Ожидается JSON-объект.'); }
  }
  async function handle(request, {ip = 'local'} = {}) {
    try {
      const path = new URL(request.url).pathname, method = request.method;
      if (!['GET', 'POST', 'PUT'].includes(method)) return errorResponse(405, 'method_not_allowed', 'Метод не поддерживается.');
      if (method === 'GET' && path === '/api/health') {
        db.prepare('SELECT 1').get();
        return json({status:'ok'});
      }
      if (method !== 'GET') {
        if (request.headers.get('origin') !== origin) throw new ApiError(403, 'origin_rejected', 'Источник запроса не разрешён.');
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'json_required', 'Требуется Content-Type: application/json.');
      }
      if (method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
        throttle(`ip:${ip}`);
        const data = await body(request, 8192);
        const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof data.password !== 'string' || data.password.length > 128 || data.password.length < (path.endsWith('register') ? 12 : 1)) throw new ApiError(400, 'invalid_credentials', 'Укажите email и пароль длиной от 12 до 128 символов.');
        throttle(`email:${email}`);
        let user;
        if (path.endsWith('register')) {
          const encoded = await passwordHash(data.password);
          const id = randomUUID();
          db.exec('BEGIN IMMEDIATE');
          try {
            if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new ApiError(409, 'email_exists', 'Этот email уже зарегистрирован.');
            db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(id,email,encoded,now());
            db.prepare('INSERT INTO libraries(user_id,payload) VALUES(?,?)').run(id,JSON.stringify(emptyLibrary()));
            db.exec('COMMIT'); user = {id, email};
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        } else {
          const row = db.prepare('SELECT id,email,password_hash FROM users WHERE email=?').get(email);
          const valid = await verifyPassword(data.password, row?.password_hash || await dummyHash);
          if (!row || !valid) throw new ApiError(401, 'invalid_login', 'Неверный email или пароль.');
          user = {id: row.id, email: row.email};
        }
        return json({user}, path.endsWith('register') ? 201 : 200, {'Set-Cookie': startSession(user.id, request)});
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const token = tokenFrom(request);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
        return new Response(null, {status: 204, headers: {...securityHeaders, 'Set-Cookie': cookie('', 0)}});
      }
      if (path === '/api/auth/me' && method === 'GET') return json({user: userFor(request)});
      if (path === '/api/library' && ['GET','PUT'].includes(method)) {
        const user = userFor(request);
        if (request.headers.get('x-account-id') !== user.id) throw new ApiError(409, 'account_changed', 'Аккаунт изменился. Войдите снова перед продолжением.');
        if (method === 'GET') {
          const row = db.prepare('SELECT revision,payload FROM libraries WHERE user_id=?').get(user.id);
          return json({revision: row.revision, library: JSON.parse(row.payload)});
        }
        const data = await body(request, MAX_BODY);
        if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !validateLibrary(data.library)) throw new ApiError(400, 'invalid_library', 'Некорректная библиотека или превышены ограничения.');
        const result = db.prepare('UPDATE libraries SET payload=?,revision=revision+1 WHERE user_id=? AND revision=?').run(JSON.stringify(normalizeLibrary(data.library)), user.id, data.revision);
        if (!result.changes) throw new ApiError(409, 'revision_conflict', 'На сервере уже есть более новая версия. Сохраните копию и загрузите её перед продолжением.');
        return json({revision: data.revision + 1});
      }
      return errorResponse(404, 'not_found', 'Ресурс не найден.');
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error.status, error.code, error.message, error.status === 429 ? {'Retry-After':'900'} : {});
      console.error('API request failed:', error.code || error.name);
      return errorResponse(500, 'internal_error', 'Не удалось выполнить запрос. Повторите позже.');
    }
  }
  return {handle, close: () => db.close()};
}
