export type Order = { readonly id: string; readonly quantity: number };

export type PlaceOrder =
  | { readonly kind: 'accepted'; readonly order: Order }
  | { readonly kind: 'rejected'; readonly reason: string };

export const placeOrder = (id: string, quantity: number): PlaceOrder => {
  if (id.length === 0 || quantity < 1) return { kind: 'rejected', reason: 'invalid order' };
  return { kind: 'accepted', order: { id, quantity } };
};
