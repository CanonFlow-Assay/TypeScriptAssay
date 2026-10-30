import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTap, parseJSON } from '../index.mjs';
const tap = (lines, count = 1, extra = '') =>
  'TAP version 13\n' +
  lines +
  '\n1..' +
  count +
  '\n# tests ' +
  count +
  '\n# fail 0\n# skipped 0\n# cancelled 0\n' +
  extra;
test('flat executed TAP has named passing observations', () =>
  assert.equal(parseTap(tap('ok 1 - Requirement-A')).complete, true));
for (const [name, value] of [
  ['skip', tap('ok 1 - A # SKIP')],
  ['todo', tap('ok 1 - A # TODO')],
  ['failed assertion', tap('not ok 1 - A')],
  ['duplicate names', tap('ok 1 - A\nok 2 - A', 2)],
  ['count mismatch', tap('ok 1 - A', 2)],
  ['empty suite', tap('', 0)],
  ['ambiguous summary', tap('ok 1 - A', 1, '# tests 1\n')]
])
  test(name + ' cannot be complete evidence', () => assert.equal(parseTap(value).complete, false));

for (const text of ['{"key":1,"key":2}', '{"nested":{"a":1,"a":2}}', '{"a":1,"\\u0061":2}'])
  test('duplicate JSON fields are rejected: ' + text, () =>
    assert.throws(() => parseJSON(text), /Duplicate/)
  );
test('JSON string content is not mistaken for duplicate fields', () =>
  assert.deepEqual(parseJSON('{"a":"a:1,a:2","b":{"a":1}}'), { a: 'a:1,a:2', b: { a: 1 } }));

test('malformed UTF-8 JSON bytes are rejected before interpretation', () =>
  assert.throws(() =>
    parseJSON(
      Buffer.concat([Buffer.from('{"value":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')])
    )
  ));
