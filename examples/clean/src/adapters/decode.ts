import type { Order } from '../domain/order.js';

export const decodeOrder = (input: unknown): Order | undefined => {
  if (
    input !== null &&
    typeof input === 'object' &&
    'id' in input &&
    'quantity' in input &&
    typeof input.id === 'string' &&
    typeof input.quantity === 'number'
  ) {
    return { id: input.id, quantity: input.quantity };
  }
  return undefined;
};
