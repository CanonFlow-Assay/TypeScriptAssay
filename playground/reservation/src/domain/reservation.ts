export type Reservation =
  | { readonly kind: 'InvalidStock' }
  | { readonly kind: 'InvalidQuantity' }
  | { readonly kind: 'InsufficientStock'; readonly available: number }
  | { readonly kind: 'Reserved'; readonly quantity: number; readonly remaining: number };

export const reserve = (stock: number, quantity: number): Reservation => {
  if (!Number.isSafeInteger(stock) || stock < 0) return Object.freeze({ kind: 'InvalidStock' });
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    return Object.freeze({ kind: 'InvalidQuantity' });
  if (quantity > stock) return Object.freeze({ kind: 'InsufficientStock', available: stock });
  return Object.freeze({ kind: 'Reserved', quantity, remaining: stock - quantity });
};
