import test from 'node:test';
import assert from 'node:assert/strict';
import { reserve } from '../build/domain/reservation.js';
test('RES-001 positive reservation', () =>
  assert.deepEqual(reserve(10, 2), { kind: 'Reserved', quantity: 2, remaining: 8 }));
test('RES-001 insufficient stock', () =>
  assert.deepEqual(reserve(1, 2), { kind: 'InsufficientStock', available: 1 }));
test('RES-001 negative request', () => assert.equal(reserve(10, -1).kind, 'InvalidQuantity'));
