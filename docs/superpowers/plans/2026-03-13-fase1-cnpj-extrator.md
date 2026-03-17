# Fase 1 — CNPJ Extrator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao Mini-CRM uma página de prospecção de empresas via CNPJ, com busca unitária e importação em massa com enriquecimento automático via APIs públicas da Receita Federal.

**Architecture:** Novo serviço `cnpjEnricher.js` com fallback entre 3 APIs públicas gratuitas; nova rota `cnpj.js` exposta em `/api/cnpj/*`; fila assíncrona de processamento em background via loop com `setImmediate`; dois novos modelos Prisma (`CnpjImport`, `CnpjImportResult`); nova página React `Prospecting.jsx` com duas abas.

**Tech Stack:** Express.js, Prisma/SQLite, React + Tailwind CSS, APIs públicas: publica.cnpj.ws / brasilapi.com.br / receitaws.com.br

---

## Chunk 1: Backend — Schema + Serviço de Enriquecimento

### Task 1: Atualizar Schema Prisma

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Ler o schema atual**

```bash
cat backend/prisma/schema.prisma
```

- [ ] **Step 2: Adicionar modelos CnpjImport e CnpjImportResult e campos no Lead**

Abrir `backend/prisma/schema.prisma` e adicionar após o modelo `Integration`:

```prisma
model CnpjImport {
  id          Int                @id @default(autoincrement())
  name        String
  status      String             @default("pending") // pending | processing | done | error
  total       Int                @default(0)
  processed   Int                @default(0)
  imported    Int                @default(0)
  errors      Int                @default(0)
  filters     String             @default("{}") // JSON: {cnae, estado, cidade, porte}
  results     CnpjImportResult[]
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
}

model CnpjImportResult {
  id           Int        @id @default(autoincrement())
  importId     Int
  cnpj         String
  razaoSocial  String
  nomeFantasia String?
  cnae         String?
  situacao     String?
  porte        String?
  telefone     String?
  email        String?
  municipio    String?
  uf           String?
  socios       String?    // JSON array serializado
  asLead       Boolean    @default(false)
  import       CnpjImport @relation(fields: [importId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())
}
```

E adicionar os seguintes campos ao model `Lead` (antes de `createdAt`):

```prisma
  score          Int      @default(0)
  tags           String   @default("[]")
  optOut         Boolean  @default(false)
  cnpj           String?
  cargo          String?
  empresa        String?
```

- [ ] **Step 3: Aplicar o schema ao banco**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && npx prisma db push
```

Resultado esperado: `The database is already in sync with the Prisma schema` ou `Your database is now in sync`.

- [ ] **Step 4: Verificar que as tabelas foram criadas no banco**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && npx prisma db execute --stdin <<< ".tables" 2>/dev/null || node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRawUnsafe('SELECT name FROM sqlite_master WHERE type=\"table\"').then(r=>{console.log(r.map(x=>x.name).join(', '));p.\$disconnect();})"
```

Resultado esperado: lista de tabelas contendo `CnpjImport` e `CnpjImportResult` (além das existentes).

---

### Task 2: Criar o serviço cnpjEnricher.js

**Files:**
- Create: `backend/src/services/cnpjEnricher.js`

- [ ] **Step 1: Criar o arquivo do serviço**

Criar `backend/src/services/cnpjEnricher.js` com o conteúdo:

```javascript
/**
 * cnpjEnricher.js
 * Enriquece dados de CNPJs usando 3 APIs públicas gratuitas com fallback automático.
 * Rate limit interno: máx 3 req/s via token bucket simples.
 */

// Token bucket simples: libera 1 token a cada 333ms (3 req/s)
let _tokens = 3;
const _maxTokens = 3;
setInterval(() => { if (_tokens < _maxTokens) _tokens++; }, 333);

async function waitToken() {
  while (_tokens <= 0) {
    await new Promise((r) => setTimeout(r, 100));
  }
  _tokens--;
}

/**
 * Normaliza o CNPJ para apenas dígitos.
 */
function normalizeCnpj(cnpj) {
  return String(cnpj).replace(/\D/g, '');
}

/**
 * Tenta buscar dados de uma URL e retorna JSON ou null em caso de erro.
 */
async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MiniCRM/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Normaliza o retorno da API cnpj.ws (publica.cnpj.ws).
 */
function normalizeCnpjWs(data) {
  if (!data || !data.razao_social) return null;
  const est = data.estabelecimento || {};
  const cnae = est.atividade_principal?.codigo
    ? `${est.atividade_principal.codigo} - ${est.atividade_principal.descricao}`
    : null;
  const telefone = est.ddd1 && est.telefone1
    ? `(${est.ddd1}) ${est.telefone1}`
    : null;
  const socios = (data.socios || []).map((s) => s.nome).join(', ') || null;
  return {
    cnpj: normalizeCnpj(est.cnpj || ''),
    razaoSocial: data.razao_social,
    nomeFantasia: est.nome_fantasia || null,
    cnae,
    situacao: est.situacao_cadastral || null,
    porte: data.porte?.descricao || null,
    telefone,
    email: est.email || null,
    municipio: est.cidade?.nome || null,
    uf: est.estado?.sigla || null,
    socios,
  };
}

/**
 * Normaliza o retorno da API BrasilAPI.
 */
function normalizeBrasilApi(data) {
  if (!data || !data.razao_social) return null;
  const cnae = data.cnae_fiscal
    ? `${data.cnae_fiscal} - ${data.cnae_fiscal_descricao || ''}`
    : null;
  const telefone = data.ddd_telefone_1
    ? data.ddd_telefone_1.trim()
    : null;
  return {
    cnpj: normalizeCnpj(data.cnpj || ''),
    razaoSocial: data.razao_social,
    nomeFantasia: data.nome_fantasia || null,
    cnae,
    situacao: data.descricao_situacao_cadastral || null,
    porte: data.porte || null,
    telefone,
    email: data.email || null,
    municipio: data.municipio || null,
    uf: data.uf || null,
    socios: null,
  };
}

/**
 * Normaliza o retorno da API ReceitaWS.
 */
function normalizeReceitaWs(data) {
  if (!data || data.status === 'ERROR' || !data.nome) return null;
  return {
    cnpj: normalizeCnpj(data.cnpj || ''),
    razaoSocial: data.nome,
    nomeFantasia: data.fantasia || null,
    cnae: data.atividade_principal?.[0]?.code
      ? `${data.atividade_principal[0].code} - ${data.atividade_principal[0].text}`
      : null,
    situacao: data.situacao || null,
    porte: data.porte || null,
    telefone: data.telefone || null,
    email: data.email || null,
    municipio: data.municipio || null,
    uf: data.uf || null,
    socios: (data.qsa || []).map((s) => s.nome).join(', ') || null,
  };
}

/**
 * Busca e enriquece dados de um CNPJ com fallback entre 3 APIs.
 * Retorna objeto normalizado ou null se todas falharem.
 */
export async function enrichCnpj(cnpj) {
  await waitToken();
  const digits = normalizeCnpj(cnpj);

  // Tentativa 1: cnpj.ws (mais completa, inclui sócios)
  const d1 = await fetchJson(`https://publica.cnpj.ws/cnpj/${digits}`);
  const r1 = normalizeCnpjWs(d1);
  if (r1) return r1;

  // Tentativa 2: BrasilAPI
  await waitToken();
  const d2 = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  const r2 = normalizeBrasilApi(d2);
  if (r2) return r2;

  // Tentativa 3: ReceitaWS
  await waitToken();
  const d3 = await fetchJson(`https://www.receitaws.com.br/v1/cnpj/${digits}`);
  const r3 = normalizeReceitaWs(d3);
  return r3; // pode ser null se todas falharam
}

/**
 * Processa uma importação em lote em background.
 * Atualiza o registro CnpjImport no banco a cada item processado.
 * @param {PrismaClient} prisma
 * @param {number} importId
 * @param {string[]} cnpjs - array de strings de CNPJ
 */
export async function processImportBatch(prisma, importId, cnpjs) {
  await prisma.cnpjImport.update({
    where: { id: importId },
    data: { status: 'processing', total: cnpjs.length },
  });

  let processed = 0;
  let errors = 0;

  for (const cnpj of cnpjs) {
    // Cede o event loop a cada item para não bloquear o servidor
    await new Promise((r) => setImmediate(r));

    try {
      const data = await enrichCnpj(cnpj);
      if (data) {
        await prisma.cnpjImportResult.create({
          data: {
            importId,
            cnpj: data.cnpj || cnpj,
            razaoSocial: data.razaoSocial || cnpj,
            nomeFantasia: data.nomeFantasia,
            cnae: data.cnae,
            situacao: data.situacao,
            porte: data.porte,
            telefone: data.telefone,
            email: data.email,
            municipio: data.municipio,
            uf: data.uf,
            // socios já é string "Nome1, Nome2" — não usar JSON.stringify
            socios: data.socios || null,
          },
        });
      } else {
        // CNPJ não encontrado em nenhuma API
        await prisma.cnpjImportResult.create({
          data: {
            importId,
            cnpj,
            razaoSocial: 'Não encontrado',
            situacao: 'erro',
          },
        });
        errors++;
      }
    } catch {
      errors++;
    }

    processed++;
    // Atualiza progresso a cada 10 itens ou no último
    if (processed % 10 === 0 || processed === cnpjs.length) {
      await prisma.cnpjImport.update({
        where: { id: importId },
        data: { processed, errors },
      });
    }
  }

  await prisma.cnpjImport.update({
    where: { id: importId },
    data: { status: 'done', processed, errors },
  });
}
```

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
ls "C:\Users\Meu Computador\PROJETO VICTOR\backend\src\services\"
```

Resultado esperado: lista contendo `cnpjEnricher.js`.

---

### Task 3: Criar a rota cnpj.js

**Files:**
- Create: `backend/src/routes/cnpj.js`

- [ ] **Step 1: Criar o arquivo de rota**

Criar `backend/src/routes/cnpj.js`:

```javascript
/**
 * cnpj.js
 * Rotas para busca e importação de CNPJs.
 * Todas as rotas requerem autenticação JWT.
 */
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import auth from '../middleware/auth.js';
import { enrichCnpj, processImportBatch } from '../services/cnpjEnricher.js';

const router = Router();

// Aplicar auth em todas as rotas
router.use(auth);

// ─── Busca unitária ──────────────────────────────────────────────────────────

/**
 * GET /api/cnpj/lookup/:cnpj
 * Busca e enriquece um CNPJ individual.
 */
router.get('/lookup/:cnpj', async (req, res) => {
  const { cnpj } = req.params;
  const digits = cnpj.replace(/\D/g, '');

  if (digits.length !== 14) {
    return res.status(400).json({ error: 'CNPJ deve ter 14 dígitos.' });
  }

  const data = await enrichCnpj(digits);
  if (!data) {
    return res.status(404).json({ error: 'CNPJ não encontrado nas fontes públicas.' });
  }

  res.json(data);
});

// ─── Importações em lote ─────────────────────────────────────────────────────

/**
 * GET /api/cnpj/imports?page=1&limit=20
 * Lista importações anteriores com paginação.
 */
router.get('/imports', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, parseInt(req.query.limit || '20'));
  const skip  = (page - 1) * limit;

  const [total, imports] = await Promise.all([
    prisma.cnpjImport.count(),
    prisma.cnpjImport.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, status: true,
        total: true, processed: true, imported: true, errors: true,
        createdAt: true, updatedAt: true,
      },
    }),
  ]);

  res.json({ data: imports, total, page, limit, pages: Math.ceil(total / limit) });
});

/**
 * POST /api/cnpj/imports
 * Inicia importação em lote.
 * Body: { name: string, cnpjs: string[], filters?: object }
 */
router.post('/imports', async (req, res) => {
  const { name, cnpjs, filters = {} } = req.body;

  if (!name || !Array.isArray(cnpjs) || cnpjs.length === 0) {
    return res.status(400).json({ error: 'Informe name e um array de CNPJs.' });
  }

  // Normalizar e deduplicar CNPJs
  const normalized = [...new Set(
    cnpjs.map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 14)
  )];

  if (normalized.length === 0) {
    return res.status(400).json({ error: 'Nenhum CNPJ válido fornecido (14 dígitos).' });
  }

  const importRecord = await prisma.cnpjImport.create({
    data: {
      name,
      filters: JSON.stringify(filters),
      total: normalized.length,
    },
  });

  // Processar em background — não aguarda
  processImportBatch(prisma, importRecord.id, normalized).catch((err) => {
    console.error(`[CnpjImport #${importRecord.id}] Erro no processamento:`, err);
    prisma.cnpjImport.update({
      where: { id: importRecord.id },
      data: { status: 'error' },
    }).catch(() => {});
  });

  res.status(202).json({
    id: importRecord.id,
    message: 'Importação iniciada. Acompanhe o progresso em GET /api/cnpj/imports/:id',
  });
});

/**
 * GET /api/cnpj/imports/:id
 * Status e progresso de uma importação.
 */
router.get('/imports/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const importRecord = await prisma.cnpjImport.findUnique({
    where: { id },
    select: {
      id: true, name: true, status: true,
      total: true, processed: true, imported: true, errors: true,
      filters: true, createdAt: true, updatedAt: true,
    },
  });

  if (!importRecord) return res.status(404).json({ error: 'Importação não encontrada.' });

  const pct = importRecord.total > 0
    ? Math.round((importRecord.processed / importRecord.total) * 100)
    : 0;

  res.json({ ...importRecord, progressPct: pct });
});

/**
 * GET /api/cnpj/imports/:id/results?page=1&limit=20&uf=SP&porte=ME&situacao=Ativa
 * Resultados paginados de uma importação com filtros opcionais.
 */
router.get('/imports/:id/results', async (req, res) => {
  const id    = parseInt(req.params.id);
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(200, parseInt(req.query.limit || '50'));
  const skip  = (page - 1) * limit;

  const where = { importId: id };
  if (req.query.uf)       where.uf       = req.query.uf;
  if (req.query.porte)    where.porte    = { contains: req.query.porte };
  if (req.query.situacao) where.situacao = { contains: req.query.situacao };

  const [total, results] = await Promise.all([
    prisma.cnpjImportResult.count({ where }),
    prisma.cnpjImportResult.findMany({
      where, skip, take: limit,
      orderBy: { razaoSocial: 'asc' },
    }),
  ]);

  res.json({ data: results, total, page, limit, pages: Math.ceil(total / limit) });
});

/**
 * POST /api/cnpj/imports/:id/leads
 * Importa resultados selecionados como Leads.
 * Body: { resultIds: number[] }
 */
router.post('/imports/:id/leads', async (req, res) => {
  const importId = parseInt(req.params.id);
  const { resultIds } = req.body;

  if (!Array.isArray(resultIds) || resultIds.length === 0) {
    return res.status(400).json({ error: 'Informe resultIds com os IDs dos resultados.' });
  }

  const results = await prisma.cnpjImportResult.findMany({
    where: { id: { in: resultIds }, importId, asLead: false },
  });

  const created = [];
  const skipped = [];

  for (const r of results) {
    try {
      const lead = await prisma.lead.create({
        data: {
          nome:    r.nomeFantasia || r.razaoSocial,
          email:   r.email || `cnpj_${r.cnpj}@importado.local`,
          telefone: r.telefone,
          empresa: r.razaoSocial,
          cnpj:    r.cnpj,
          source:  'Prospecção CNPJ',
          notas:   `CNAE: ${r.cnae || '-'} | Sócios: ${r.socios || '-'}`,
        },
      });
      await prisma.cnpjImportResult.update({
        where: { id: r.id },
        data: { asLead: true },
      });
      created.push(lead.id);
    } catch {
      skipped.push(r.id); // email duplicado ou outro erro
    }
  }

  // Atualiza contador de importados
  await prisma.cnpjImport.update({
    where: { id: importId },
    data: { imported: { increment: created.length } },
  });

  res.json({ created: created.length, skipped: skipped.length, leadIds: created });
});

/**
 * DELETE /api/cnpj/imports/:id
 * Deleta importação e todos os resultados (cascade).
 */
router.delete('/imports/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const importRecord = await prisma.cnpjImport.findUnique({ where: { id } });
  if (!importRecord) return res.status(404).json({ error: 'Importação não encontrada.' });
  if (importRecord.status === 'processing') {
    return res.status(409).json({ error: 'Não é possível deletar uma importação em andamento.' });
  }

  await prisma.cnpjImport.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
```

---

### Task 4: Registrar a rota em app.js

**Files:**
- Modify: `backend/app.js`

- [ ] **Step 1: Adicionar import e registro da rota cnpj**

Em `backend/app.js`, adicionar após a linha do import de `integrationsRouter`:

```javascript
import cnpjRouter from './src/routes/cnpj.js';
```

E após `app.use('/api/integrations', integrationsRouter);`:

```javascript
app.use('/api/cnpj', cnpjRouter);
```

- [ ] **Step 2: Verificar que o servidor inicia sem erros**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && node app.js
```

Resultado esperado: `✅ Banco de dados conectado` e `🚀 Servidor rodando em http://localhost:3001`. Encerrar com Ctrl+C.

- [ ] **Step 3: Obter token de autenticação e testar endpoint de lookup**

Primeiro, obter um token JWT fazendo login:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@minicrm.com","password":"Admin@123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Token: $TOKEN"
```

Depois testar o lookup:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/cnpj/lookup/00000000000191
```

Resultado esperado: JSON com dados do CNPJ (Banco do Brasil) ou `{ "error": "CNPJ não encontrado..." }` dependendo da disponibilidade das APIs públicas.

---

## Chunk 2: Frontend — Página de Prospecção

### Task 5: Criar a página Prospecting.jsx

**Files:**
- Create: `frontend/src/pages/Prospecting.jsx`

- [ ] **Step 1: Criar o arquivo da página**

Criar `frontend/src/pages/Prospecting.jsx`:

```jsx
import { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout.jsx';
import api from '../services/api.js';
import { Search, Upload, CheckSquare, Square, Download, Loader2, AlertCircle, CheckCircle2, Building2 } from 'lucide-react';

// ─── Utilidades ──────────────────────────────────────────────────────────────

function formatCnpj(v) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function parseCnpjList(text) {
  return text
    .split(/[\n,;]/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length === 14);
}

// ─── Componentes menores ─────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-700',
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-700',
    blue:   'bg-blue-100 text-blue-700',
    yellow: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function CompanyCard({ data, onAdd, adding }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">{data.razaoSocial}</p>
          {data.nomeFantasia && <p className="text-sm text-gray-500">{data.nomeFantasia}</p>}
        </div>
        <Badge color={data.situacao?.toLowerCase().includes('ativa') ? 'green' : 'gray'}>
          {data.situacao || 'Situação desconhecida'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
        {data.cnpj     && <span>CNPJ: <b>{data.cnpj}</b></span>}
        {data.cnae     && <span>CNAE: {data.cnae}</span>}
        {data.porte    && <span>Porte: {data.porte}</span>}
        {data.municipio && <span>Cidade: {data.municipio}/{data.uf}</span>}
        {data.telefone && <span>Tel: {data.telefone}</span>}
        {data.email    && <span>Email: {data.email}</span>}
        {data.socios   && <span className="col-span-2">Sócios: {data.socios}</span>}
      </div>
      <button
        onClick={onAdd}
        disabled={adding}
        className="w-full py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {adding ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
        {adding ? 'Adicionando…' : 'Adicionar como Lead'}
      </button>
    </div>
  );
}

// ─── Aba: Busca Unitária ─────────────────────────────────────────────────────

function SingleSearch() {
  const [cnpj, setCnpj]       = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const [adding, setAdding]   = useState(false);
  const [added, setAdded]     = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    const digits = cnpj.replace(/\D/g, '');
    if (digits.length !== 14) {
      setError('CNPJ deve ter 14 dígitos.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setAdded(false);
    try {
      const data = await api.get(`/cnpj/lookup/${digits}`).then((r) => r.data);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'CNPJ não encontrado.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!result) return;
    setAdding(true);
    try {
      // Cria importação de 1 CNPJ e importa imediatamente
      const { data: imp } = await api.post('/cnpj/imports', {
        name: `Busca unitária: ${result.cnpj}`,
        cnpjs: [result.cnpj],
      });
      // Aguarda processamento (máx 10s)
      let attempts = 0;
      let done = false;
      while (!done && attempts < 20) {
        await new Promise((r) => setTimeout(r, 500));
        const { data: status } = await api.get(`/cnpj/imports/${imp.id}`);
        if (status.status === 'done' || status.status === 'error') done = true;
        attempts++;
      }
      // Importa o resultado
      const { data: results } = await api.get(`/cnpj/imports/${imp.id}/results`);
      if (results.data.length > 0) {
        await api.post(`/cnpj/imports/${imp.id}/leads`, { resultIds: [results.data[0].id] });
      }
      setAdded(true);
    } catch {
      setError('Erro ao adicionar lead.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={cnpj}
          onChange={(e) => setCnpj(formatCnpj(e.target.value))}
          placeholder="00.000.000/0000-00"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          maxLength={18}
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Buscar
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {added && (
        <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 rounded-lg p-3">
          <CheckCircle2 size={14} /> Lead adicionado com sucesso!
        </div>
      )}

      {result && !added && (
        <CompanyCard data={result} onAdd={handleAdd} adding={adding} />
      )}
    </div>
  );
}

// ─── Aba: Importação em Massa ─────────────────────────────────────────────────

function BulkImport() {
  const [cnpjText, setCnpjText]       = useState('');
  const [importId, setImportId]       = useState(null);
  const [progress, setProgress]       = useState(null);
  const [results, setResults]         = useState([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultPage, setResultPage]   = useState(1);
  const [selected, setSelected]       = useState(new Set());
  const [importing, setImporting]     = useState(false);
  const [importDone, setImportDone]   = useState(false);
  const [error, setError]             = useState('');
  const fileRef                       = useRef();
  const pollRef                       = useRef();

  const cnpjCount = parseCnpjList(cnpjText).length;

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCnpjText(ev.target.result);
    reader.readAsText(file);
  }

  async function handleStart() {
    const cnpjs = parseCnpjList(cnpjText);
    if (cnpjs.length === 0) {
      setError('Nenhum CNPJ válido encontrado no texto.');
      return;
    }
    setError('');
    setProgress({ status: 'processing', processed: 0, total: cnpjs.length, progressPct: 0 });
    setResults([]);
    setSelected(new Set());
    setImportDone(false);

    const { data } = await api.post('/cnpj/imports', {
      name: `Importação ${new Date().toLocaleDateString('pt-BR')} — ${cnpjs.length} CNPJs`,
      cnpjs,
    });
    setImportId(data.id);
  }

  // Polling de progresso
  useEffect(() => {
    if (!importId) return;
    pollRef.current = setInterval(async () => {
      const { data } = await api.get(`/cnpj/imports/${importId}`);
      setProgress(data);
      if (data.status === 'done' || data.status === 'error') {
        clearInterval(pollRef.current);
        loadResults(1);
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [importId]);

  async function loadResults(page = 1) {
    if (!importId) return;
    const { data } = await api.get(`/cnpj/imports/${importId}/results?page=${page}&limit=50`);
    setResults(data.data);
    setResultTotal(data.total);
    setResultPage(page);
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((r) => r.id)));
    }
  }

  async function handleImportLeads() {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const { data } = await api.post(`/cnpj/imports/${importId}/leads`, {
        resultIds: [...selected],
      });
      setImportDone(true);
      setSelected(new Set());
      await loadResults(resultPage);
      alert(`✅ ${data.created} lead(s) criado(s). ${data.skipped} ignorado(s) (duplicados).`);
    } catch {
      setError('Erro ao importar leads.');
    } finally {
      setImporting(false);
    }
  }

  const isProcessing = progress?.status === 'processing';
  const isDone       = progress?.status === 'done';

  return (
    <div className="space-y-4">
      {/* Entrada de CNPJs */}
      {!importId && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Upload size={14} /> Upload CSV
            </button>
            <span className="text-sm text-gray-400">ou cole os CNPJs abaixo</span>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </div>
          <textarea
            value={cnpjText}
            onChange={(e) => setCnpjText(e.target.value)}
            placeholder="Cole os CNPJs aqui (um por linha, vírgula ou ponto e vírgula)"
            rows={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
          {cnpjCount > 0 && (
            <p className="text-sm text-gray-500">{cnpjCount} CNPJ(s) válido(s) detectado(s)</p>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button
            onClick={handleStart}
            disabled={cnpjCount === 0}
            className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            Iniciar Enriquecimento ({cnpjCount} CNPJs)
          </button>
        </div>
      )}

      {/* Progresso */}
      {progress && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {isProcessing ? 'Processando…' : isDone ? 'Concluído' : 'Erro'}
            </span>
            <span className="font-medium">{progress.progressPct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all duration-500"
              style={{ width: `${progress.progressPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">
            {progress.processed}/{progress.total} — {progress.errors} erro(s)
          </p>
          {isProcessing && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Atualizando automaticamente…
            </p>
          )}
        </div>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <button onClick={toggleAll} className="text-gray-400 hover:text-brand-600">
                {selected.size === results.length
                  ? <CheckSquare size={16} />
                  : <Square size={16} />}
              </button>
              <span className="text-sm text-gray-600">{resultTotal} empresa(s) — {selected.size} selecionada(s)</span>
            </div>
            <button
              onClick={handleImportLeads}
              disabled={selected.size === 0 || importing}
              className="flex items-center gap-2 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Importar selecionados como Leads
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="w-8 px-4 py-2"></th>
                  <th className="px-4 py-2 text-left">Razão Social</th>
                  <th className="px-4 py-2 text-left">CNPJ</th>
                  <th className="px-4 py-2 text-left">Cidade/UF</th>
                  <th className="px-4 py-2 text-left">Telefone</th>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Porte</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-gray-50 cursor-pointer ${r.asLead ? 'opacity-50' : ''}`}
                    onClick={() => !r.asLead && toggleSelect(r.id)}
                  >
                    <td className="px-4 py-2">
                      {r.asLead
                        ? <CheckCircle2 size={14} className="text-green-500" />
                        : selected.has(r.id)
                          ? <CheckSquare size={14} className="text-brand-600" />
                          : <Square size={14} className="text-gray-300" />}
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900">{r.razaoSocial}</td>
                    <td className="px-4 py-2 font-mono text-gray-600">{r.cnpj}</td>
                    <td className="px-4 py-2 text-gray-600">{r.municipio}/{r.uf}</td>
                    <td className="px-4 py-2 text-gray-600">{r.telefone || '—'}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-[180px] truncate">{r.email || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.porte || '—'}</td>
                    <td className="px-4 py-2">
                      <Badge color={r.asLead ? 'green' : r.situacao === 'erro' ? 'red' : 'gray'}>
                        {r.asLead ? 'Lead criado' : r.situacao || '—'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {resultTotal > 50 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
              <button
                disabled={resultPage === 1}
                onClick={() => loadResults(resultPage - 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40"
              >Anterior</button>
              <span className="text-gray-500">Página {resultPage}</span>
              <button
                disabled={resultPage * 50 >= resultTotal}
                onClick={() => loadResults(resultPage + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40"
              >Próxima</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Prospecting() {
  const [tab, setTab] = useState('bulk');

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Prospecção de Empresas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Busque e importe empresas via CNPJ usando dados públicos da Receita Federal.
          </p>
        </div>

        {/* Abas */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
          {[
            { id: 'bulk',   label: 'Importação em Massa' },
            { id: 'single', label: 'Busca Unitária' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'single' ? <SingleSearch /> : <BulkImport />}
      </div>
    </Layout>
  );
}
```

---

### Task 6: Registrar rota e sidebar

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Adicionar import e rota em App.jsx**

Em `frontend/src/App.jsx`, adicionar após o import de `Settings`:

```javascript
import Prospecting from './pages/Prospecting.jsx';
```

E adicionar nova rota antes de `<Route path="*" ...>`:

```jsx
<Route
  path="/prospecting"
  element={
    <PrivateRoute>
      <Prospecting />
    </PrivateRoute>
  }
/>
```

- [ ] **Step 2: Adicionar item na sidebar em Layout.jsx**

Em `frontend/src/components/Layout.jsx`, adicionar ao import de lucide-react:

```javascript
Building2,
```

E adicionar ao array `NAV_ITEMS`:

```javascript
{ to: '/prospecting', label: 'Prospecção', icon: Building2 },
```

Posicionar entre 'Leads' e 'Analytics'.

- [ ] **Step 3: Verificar que o frontend compila**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\frontend" && npm run build 2>&1 | tail -5
```

Resultado esperado: `built in X.XXs` sem erros.

- [ ] **Step 4: Commit da Fase 1 completa**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR" && git add -A && git commit -m "feat(fase1): extrator de CNPJ — busca unitária + importação em massa com enriquecimento automático"
```
