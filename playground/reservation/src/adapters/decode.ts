type Decoded =
  | { readonly kind: 'InvalidInput' }
  | {
      readonly kind: 'Decoded';
      readonly value: { readonly sku: string; readonly stock: number; readonly quantity: number };
    };
// Accept own data properties only. Snapshot primitive values before validation.
export const decode = (raw: unknown): Decoded => {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      return Object.freeze({ kind: 'InvalidInput' });
    const skuField = Object.getOwnPropertyDescriptor(raw, 'sku'),
      stockField = Object.getOwnPropertyDescriptor(raw, 'stock'),
      quantityField = Object.getOwnPropertyDescriptor(raw, 'quantity');
    if (
      !skuField ||
      !stockField ||
      !quantityField ||
      !('value' in skuField) ||
      !('value' in stockField) ||
      !('value' in quantityField)
    )
      return Object.freeze({ kind: 'InvalidInput' });
    const sku: unknown = skuField.value,
      stock: unknown = stockField.value,
      quantity: unknown = quantityField.value;
    if (
      typeof sku !== 'string' ||
      sku.trim().length === 0 ||
      typeof stock !== 'number' ||
      !Number.isSafeInteger(stock) ||
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity)
    )
      return Object.freeze({ kind: 'InvalidInput' });
    return Object.freeze({
      kind: 'Decoded',
      value: Object.freeze({ sku: sku.trim(), stock, quantity })
    });
  } catch {
    return Object.freeze({ kind: 'InvalidInput' });
  }
};
