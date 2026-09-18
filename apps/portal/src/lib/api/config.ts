export type ApiMode = 'mock' | 'live';

export function resolveApiMode(value: string | undefined): ApiMode {
  return value === 'live' ? 'live' : 'mock';
}

export const API_MODE = resolveApiMode(process.env.NEXT_PUBLIC_API_MODE);

export function isLiveMode(): boolean {
  return API_MODE === 'live';
}
