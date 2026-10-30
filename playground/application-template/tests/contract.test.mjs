import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reserve } from '../build/domain/reservation.js';
import { decode } from '../build/adapters/decode.js';
const contract = JSON.parse(
  readFileSync(new URL('../contracts/reservation-v1.json', import.meta.url), 'utf8')
);
test('WIRE-001 original reserved response remains compatible', () => {
  const result = JSON.parse(JSON.stringify(reserve(10, 2)));
  assert.deepEqual(Object.keys(result).sort(), [...contract.reservedFields].sort());
  assert.deepEqual(result, { kind: 'Reserved', quantity: 2, remaining: 8 });
  assert.ok(contract.domainCases.includes(result.kind));
});
test('WIRE-002 original decoder cases remain compatible', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(decode(null))), { kind: 'InvalidInput' });
  assert.deepEqual(JSON.parse(JSON.stringify(decode({ sku: ' A ', stock: 10, quantity: 2 }))), {
    kind: 'Decoded',
    value: { sku: 'A', stock: 10, quantity: 2 }
  });
  assert.deepEqual(contract.decoderCases, ['InvalidInput', 'Decoded']);
});
