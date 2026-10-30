import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
export const createPlaygroundServer = () =>
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const name = decodeURIComponent(url.pathname);
      const file = resolve(root, '.' + (name === '/' ? '/index.html' : name));
      const rel = relative(root, file);
      if (
        rel.startsWith('..') ||
        isAbsolute(rel) ||
        rel.split('/').some((part) => part.startsWith('.'))
      ) {
        response.writeHead(403);
        response.end('Outside playground scope');
        return;
      }
      const physical = await realpath(file);
      const physicalRel = relative(root, physical);
      if (physicalRel.startsWith('..') || isAbsolute(physicalRel)) {
        response.writeHead(403);
        response.end('Outside playground scope');
        return;
      }
      const bytes = await readFile(physical);
      response.writeHead(200, {
        'content-type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8'
          }[extname(file)] ?? 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4318);
  createPlaygroundServer().listen(port, '127.0.0.1', () =>
    console.log('Local playground: http://127.0.0.1:' + port)
  );
}
