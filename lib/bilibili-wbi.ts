const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const sine = new Int32Array(64);
for (let i = 0; i < 64; i++) sine[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const rotate = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) | 0;

export function md5(input: string) {
  const message = new TextEncoder().encode(input), bitLength = message.length * 8;
  const length = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(length); padded.set(message); padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, bitLength >>> 0, true); view.setUint32(length - 4, Math.floor(bitLength / 4294967296), true);
  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  const words = new Int32Array(16);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + sine[i]! + words[g]!) | 0; a = d; d = c; c = b; b = (b + rotate(f, shifts[i]!)) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const output = new DataView(new ArrayBuffer(16));
  output.setInt32(0, a0, true); output.setInt32(4, b0, true); output.setInt32(8, c0, true); output.setInt32(12, d0, true);
  return Array.from({ length: 16 }, (_, i) => output.getUint8(i).toString(16).padStart(2, '0')).join('');
}

const mixinTable = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const imageKey = (url: string) => { const name = url.split('/').pop()?.split('?')[0] ?? ''; return name.slice(0, name.lastIndexOf('.') === -1 ? undefined : name.lastIndexOf('.')); };
const query = (params: Record<string, string | number>) => Object.keys(params).sort().map(key =>
  `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key] ?? '').replace(/[!'()*]/g, ''))}`).join('&');

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function boundedNavJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('B站 WBI 密钥没有响应体');
  const decoder = new TextDecoder(); let text = '', size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new Error('B站 WBI 密钥响应过大'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; } catch { throw new Error('B站 WBI 密钥响应格式异常'); }
}

function wbiKey(value: unknown) {
  if (typeof value !== 'string' || value.length > 4000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))) return '';
    const key = imageKey(url.pathname);
    return /^[a-f0-9]{32}$/i.test(key) ? key : '';
  } catch { return ''; }
}

export async function signedPlayerUrl(params: { aid: number; cid: number; bvid: string }, signal?: AbortSignal) {
  if (!Number.isSafeInteger(params.aid) || params.aid <= 0 || !Number.isSafeInteger(params.cid) || params.cid <= 0
    || !/^BV1[0-9A-Za-z]{9}$/.test(params.bvid)) throw new Error('B站 WBI 播放参数异常');
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    credentials: 'include', signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`B站 WBI 密钥请求失败：HTTP ${response.status}`);
  const payload = await boundedNavJson(response);
  if (!record(payload) || payload.code !== 0 || !record(payload.data) || !record(payload.data.wbi_img)) {
    throw new Error('B站 WBI 密钥接口返回异常');
  }
  const raw = wbiKey(payload.data.wbi_img.img_url) + wbiKey(payload.data.wbi_img.sub_url);
  if (raw.length !== 64) throw new Error('B站 WBI 密钥结构异常');
  const mixin = mixinTable.map(index => raw[index]).join('').slice(0, 32);
  const signed: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) };
  const encoded = query(signed); signed.w_rid = md5(encoded + mixin);
  return `https://api.bilibili.com/x/player/wbi/v2?${query(signed)}`;
}
