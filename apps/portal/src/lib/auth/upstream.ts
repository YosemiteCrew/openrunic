export function upstreamUrl(path: string): URL | null {
  const configured = process.env.OPENRUNIC_API_URL?.trim();
  if (!configured) return null;
  try {
    const base = new URL(configured);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    return new URL(path, base.href.endsWith('/') ? base : `${base.href}/`);
  } catch {
    return null;
  }
}
