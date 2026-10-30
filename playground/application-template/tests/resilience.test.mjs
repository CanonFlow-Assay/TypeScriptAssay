import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readStock } from '../build/adapters/stock-client.js';
const fixture = async (respond, exercise) => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    respond(response, attempts);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await exercise('http://127.0.0.1:' + server.address().port + '/stock', () => attempts);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
test('HTTP-001 transient503 retries once then succeeds', async () =>
  fixture(
    (reply, attempt) => {
      reply.writeHead(attempt === 1 ? 503 : 200);
      reply.end(attempt === 1 ? '' : JSON.stringify({ stock: 10 }));
    },
    async (url, attempts) => {
      assert.deepEqual(await readStock(url), { kind: 'Available', stock: 10 });
      assert.equal(attempts(), 2);
    }
  ));
test('HTTP-002 repeated503 stops after two attempts', async () =>
  fixture(
    (reply) => {
      reply.writeHead(503);
      reply.end();
    },
    async (url, attempts) => {
      assert.deepEqual(await readStock(url), { kind: 'Unavailable' });
      assert.equal(attempts(), 2);
    }
  ));
test('HTTP-003 malformed reply is explicit', async () =>
  fixture(
    (reply) => {
      reply.writeHead(200);
      reply.end('not JSON');
    },
    async (url, attempts) => {
      assert.deepEqual(await readStock(url), { kind: 'InvalidReply' });
      assert.equal(attempts(), 1);
    }
  ));
