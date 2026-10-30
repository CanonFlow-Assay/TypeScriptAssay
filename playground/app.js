import { reserve } from './reservation/build/domain/reservation.js';
import { decode } from './reservation/build/adapters/decode.js';
const byId = (id) => document.getElementById(id);
const run = () => {
  const decoded = decode({
    sku: byId('sku').value,
    stock: byId('stock').valueAsNumber,
    quantity: byId('quantity').valueAsNumber
  });
  const outcome =
    decoded.kind === 'Decoded' ? reserve(decoded.value.stock, decoded.value.quantity) : decoded;
  byId('result').textContent = JSON.stringify(outcome, null, 2);
  const meanings = {
    InvalidInput: 'Transport data did not decode into the declared input shape.',
    InvalidStock: 'Stock must be a nonnegative safe integer.',
    InvalidQuantity:
      'Quantity must be a positive safe integer. Zero is a named acceptance boundary.',
    InsufficientStock: 'The request exceeds current stock; no reservation occurs.',
    Reserved: 'The reservation succeeds without changing the caller’s stock value.'
  };
  byId('explanation').textContent =
    meanings[outcome.kind] + ' Outcome frozen: ' + Object.isFrozen(outcome) + '.';
};
byId('reservation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});
for (const button of document.querySelectorAll('[data-case]'))
  button.addEventListener('click', () => {
    const name = button.dataset.case;
    byId('stock').value = name === 'short' ? '1' : '10';
    byId('quantity').value = name === 'zero' ? '0' : name === 'exact' ? '10' : '2';
    run();
  });
byId('artifact').addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) throw new Error('Choose an artifact smaller than 4 MiB');
    const value = JSON.parse(await file.text());
    const receipt = value.receipt ?? value;
    byId('artifact-summary').textContent = JSON.stringify(
      {
        schema: value.schemaVersion ?? null,
        verdict: receipt.verdict ?? value.baseline ?? null,
        completed: value.completed ?? null,
        sourceUnchanged: value.sourceUnchanged ?? receipt.freshness?.unchanged ?? null,
        survivors: value.survivors ?? null,
        cases:
          value.cases?.map((item) => ({
            id: item.id,
            before: item.beforeStatus,
            after: item.afterStatus,
            advice: item.advice?.kind
          })) ?? null,
        authority: receipt.authority ?? receipt.authoritative ?? null
      },
      null,
      2
    );
  } catch (error) {
    byId('artifact-summary').textContent = 'Unable to read artifact: ' + error.message;
  }
});
run();
