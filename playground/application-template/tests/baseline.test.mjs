import './original.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reserve } from '../build/domain/reservation.js';
import { decode } from '../build/adapters/decode.js';
test('RES-001 zero request is invalid', () => assert.equal(reserve(10, 0).kind, 'InvalidQuantity'));
test('RES-001 exact stock is accepted', () =>
  assert.deepEqual(reserve(2, 2), { kind: 'Reserved', quantity: 2, remaining: 0 }));
test('RES-001 empty stock rejects positive request', () =>
  assert.equal(reserve(0, 1).kind, 'InsufficientStock'));
test('RES-001 invalid stock is explicit', () => {
  for (const stock of [-1, 0.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(reserve(stock, 1).kind, 'InvalidStock');
});
test('RES-001 invalid quantity is explicit', () => {
  for (const quantity of [0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(reserve(10, quantity).kind, 'InvalidQuantity');
});
test('RES-001 immutable outcome', () => {
  const result = reserve(10, 2);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => {
    result.remaining = 10;
  }, TypeError);
});
test('RES-002 transport rejects unknown values', () => {
  for (const raw of [
    null,
    1,
    [],
    {},
    { sku: ' ', stock: 10, quantity: 1 },
    { sku: 'A', stock: '10', quantity: 1 }
  ])
    assert.equal(decode(raw).kind, 'InvalidInput');
});
test('RES-002 transport creates trusted frozen value', () => {
  const raw = { sku: ' A ', stock: 10, quantity: 2 };
  const result = decode(raw);
  assert.deepEqual(result, { kind: 'Decoded', value: { sku: 'A', stock: 10, quantity: 2 } });
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(raw.sku, ' A ');
});

test('RES-002 accessor fields are rejected without invoking getters', () => {
  let reads = 0;
  const raw = { sku: 'A', stock: 10 };
  Object.defineProperty(raw, 'quantity', {
    get() {
      reads += 1;
      return reads === 1 ? 1 : 'wrong';
    },
    enumerable: true
  });
  assert.equal(decode(raw).kind, 'InvalidInput');
  assert.equal(reads, 0);
});
test('RES-002 descriptor failures are explicit invalid input', () => {
  const raw = new Proxy(
    { sku: 'A', stock: 10, quantity: 1 },
    {
      getOwnPropertyDescriptor() {
        throw new Error('hostile descriptor');
      }
    }
  );
  assert.deepEqual(decode(raw), { kind: 'InvalidInput' });
});
test('RES-002 inherited transport fields are rejected', () =>
  assert.equal(decode(Object.create({ sku: 'A', stock: 10, quantity: 1 })).kind, 'InvalidInput'));
