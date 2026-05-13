import Mux from '@mux/mux-node';

let cached: Mux | null = null;

export function getMux(): Mux {
  if (cached) return cached;
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error('Missing MUX_TOKEN_ID / MUX_TOKEN_SECRET');
  }
  cached = new Mux({ tokenId, tokenSecret });
  return cached;
}

export const MUX_WEBHOOK_SECRET = process.env.MUX_WEBHOOK_SECRET ?? '';
