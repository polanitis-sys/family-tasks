import {createHmac, randomBytes} from 'node:crypto';

export class BridgeError extends Error {
  constructor(message, code = 'UPSTREAM_ERROR') { super(message); this.code = code; }
}
export function validateBridgeConfig({backendUrl, secret}) {
  let url;
  try { url = new URL(backendUrl); } catch { throw new Error('Set APPS_SCRIPT_URL to your deployed Apps Script URL ending /exec.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error('APPS_SCRIPT_URL must be the https://script.google.com/macros/s/.../exec deployment URL, without query parameters.');
  }
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Set HOSTING_SECRET to the private 64-character code shown by showHostingConnection.');
}
export function signRequest(request, secret, {timestamp = Date.now(), nonce = randomBytes(16).toString('hex')} = {}) {
  const payload = JSON.stringify(request);
  const signature = createHmac('sha256', secret).update(`v1\n${timestamp}\n${nonce}\n${payload}`).digest('hex');
  return {timestamp, nonce, payload, signature};
}
async function limitedText(response) {
  const limit = 4 * 1024 * 1024;
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new BridgeError('The spreadsheet response is too large.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createBridge({backendUrl, secret, fetchImpl = globalThis.fetch, timeoutMs = 90000}) {
  validateBridgeConfig({backendUrl, secret});
  return async function bridge(request) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await fetchImpl(backendUrl, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(signRequest(request, secret))
      });
      // Apps Script ContentService intentionally redirects its JSON result.
      // Only follow the documented content host, and never forward the signed body.
      if ([301, 302, 303].includes(response.status)) {
        const location = response.headers.get('location');
        let target; try { target = new URL(location || ''); } catch { throw new BridgeError('The spreadsheet connection redirected unexpectedly.'); }
        if (target.protocol !== 'https:' || target.hostname !== 'script.googleusercontent.com' || target.username || target.password || target.port) {
          throw new BridgeError('Check that the Apps Script deployment executes as its owner and allows Anyone access.');
        }
        if (response.body) await response.body.cancel();
        response = await fetchImpl(target.href, {method: 'GET', redirect: 'error', signal: controller.signal, headers: {Accept: 'application/json'}});
      }
      if (!response.ok) throw new BridgeError('The spreadsheet connection returned an error.');
      const text = await limitedText(response);
      let result; try { result = JSON.parse(text); } catch { throw new BridgeError('Check your Apps Script URL, deployment version, and Anyone access setting.'); }
      if (!result || typeof result.ok !== 'boolean') throw new BridgeError('The spreadsheet returned an unexpected response.');
      if (!result.ok && (!result.error || typeof result.error.code !== 'string' || typeof result.error.message !== 'string')) throw new BridgeError('The spreadsheet returned an invalid error.');
      return result;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (controller.signal.aborted) throw new BridgeError('The spreadsheet connection timed out. Refresh before repeating an action; it may already have been saved.', 'UPSTREAM_TIMEOUT');
      throw new BridgeError('The spreadsheet connection is temporarily unavailable. Refresh before repeating an action; it may already have been saved.');
    } finally { clearTimeout(timer); }
  };
}
