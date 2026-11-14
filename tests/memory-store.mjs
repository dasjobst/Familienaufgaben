// Speicher-Store mit derselben Schnittstelle wie Netlify Blobs (für Tests).
export function memoryStore() {
  const m = new Map();
  let n = 0;
  const conv = (v, type) => {
    if (type === 'json') return JSON.parse(v);
    if (type === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v.slice(0);
    return v;
  };
  const put = (k, v, o = {}) => {
    const e = m.get(k);
    if (o.onlyIfNew && e) return { modified: false };
    if (o.onlyIfMatch !== undefined && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
    const etag = '"' + (++n) + '"';
    m.set(k, { v, etag, meta: o.metadata || {} });
    return { modified: true, etag };
  };
  return {
    async get(k, o = {}) { const e = m.get(k); return e ? conv(e.v, o.type) : null; },
    async getWithMetadata(k, o = {}) { await Promise.resolve(); const e = m.get(k); return e ? { data: conv(e.v, o.type), etag: e.etag, metadata: e.meta } : null; },
    async set(k, v, o) { return put(k, v, o); },
    async setJSON(k, v, o) { await Promise.resolve(); return put(k, JSON.stringify(v), o); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, etag: e.etag })) }; },
    _raw: m
  };
}
