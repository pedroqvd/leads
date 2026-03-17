// Wrapper para o preview tool iniciar o Vite neste diretório
import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = await createServer({
  root: __dirname,
  configFile: path.join(__dirname, 'vite.config.js'),
});
await server.listen();
server.printUrls();
