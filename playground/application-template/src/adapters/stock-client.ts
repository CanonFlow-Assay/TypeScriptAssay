export type StockReply =
  | { readonly kind: 'Unavailable' }
  | { readonly kind: 'InvalidReply' }
  | { readonly kind: 'Available'; readonly stock: number };
export const readStock = async (url: string): Promise<StockReply> => {
  for (const attempt of [0, 1]) {
    try {
      const reply = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (reply.status === 503 && attempt === 0) continue;
      if (!reply.ok) return Object.freeze({ kind: 'Unavailable' });
      let raw: unknown;
      try {
        raw = await reply.json();
      } catch {
        return Object.freeze({ kind: 'InvalidReply' });
      }
      if (
        raw === null ||
        typeof raw !== 'object' ||
        !('stock' in raw) ||
        typeof raw.stock !== 'number' ||
        !Number.isSafeInteger(raw.stock) ||
        raw.stock < 0
      )
        return Object.freeze({ kind: 'InvalidReply' });
      return Object.freeze({ kind: 'Available', stock: raw.stock });
    } catch {
      return Object.freeze({ kind: 'Unavailable' });
    }
  }
  return Object.freeze({ kind: 'Unavailable' });
};
