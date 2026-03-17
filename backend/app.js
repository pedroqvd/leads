import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import prisma from './src/lib/prisma.js';
import leadsRouter from './src/routes/leads.js';
import authRouter from './src/routes/auth.js';
import analyticsRouter from './src/routes/analytics.js';
import integrationsRouter from './src/routes/integrations.js';
import cnpjRouter from './src/routes/cnpj.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middlewares globais ───────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
// Rate limit geral da API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em breve.' },
});

// Rate limit estrito para submissão de leads (anti-spam)
const leadSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
  keyGenerator: (req) => req.ip,
});

// Rate limit para login (proteção brute-force)
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde 10 minutos.' },
});

app.use('/api', generalLimiter);
app.use('/api/auth/login', loginLimiter);

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);

// Aplica rate limit de submissão apenas para POST /leads
app.use('/api/leads', (req, res, next) => {
  if (req.method === 'POST') return leadSubmitLimiter(req, res, next);
  next();
});
app.use('/api/leads', leadsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/cnpj', cnpjRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── Error handler global ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor.',
  });
});

// ─── Inicialização ────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('✅ Banco de dados conectado');

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
      console.log(`📋 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('\n👋 Servidor encerrado.');
  process.exit(0);
});

bootstrap();
