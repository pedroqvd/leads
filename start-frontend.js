// Wrapper para iniciar o Vite a partir do diretório correto
import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, 'frontend');

const server = await createServer({ root, configFile: path.join(root, 'vite.config.js') });
await server.listen();
server.printUrls();
