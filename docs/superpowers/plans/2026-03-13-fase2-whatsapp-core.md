# Fase 2 — WhatsApp Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o Mini-CRM com a Evolution API para gerenciar conexões WhatsApp, exibir e responder conversas no painel, e disparar mensagens manualmente para leads.

**Architecture:** Novo serviço `evolutionApi.js` encapsula todas as chamadas REST à Evolution API; rota `whatsapp.js` exposta em `/api/whatsapp/*`; webhook público validado por `x-webhook-secret`; página `WhatsApp.jsx` com layout 3 colunas; aba WhatsApp em Settings para configurar instância; botão "Iniciar conversa" no Dashboard.

**Tech Stack:** Express.js, Prisma/SQLite, React + Tailwind CSS, node-fetch (nativo Node 18+), Evolution API (self-hosted pelo usuário)

**Pré-requisito:** Fase 1 concluída (schema Prisma já tem campos score/tags/optOut/cnpj no Lead).

---

## Chunk 1: Backend — Schema + Serviço Evolution API

### Task 1: Atualizar Schema Prisma

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Adicionar modelos WaInstance, WaConversation, WaMessage, WaScheduledMessage**

Adicionar ao final de `backend/prisma/schema.prisma`:

```prisma
model WaInstance {
  id            Int      @id @default(autoincrement())
  instanceName  String   @unique
  apiUrl        String
  apiKey        String
  webhookSecret String
  status        String   @default("disconnected") // connected | disconnected | connecting
  isDefault     Boolean  @default(false)
  label         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model WaConversation {
  id          Int                  @id @default(autoincrement())
  leadId      Int
  instanceId  Int
  phone       String
  flowId      Int?
  flowVersion Int?
  nodeId      String               @default("start")
  status      String               @default("bot")  // bot | human | closed
  optOut      Boolean              @default(false)
  score       Int                  @default(0)
  assignedTo  String?
  tags        String               @default("[]")
  variables   String               @default("{}")
  lead        Lead                 @relation(fields: [leadId], references: [id])
  messages    WaMessage[]
  scheduled   WaScheduledMessage[]
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  @@index([leadId])
  @@index([phone])
  @@index([status])
}

model WaMessage {
  id             Int            @id @default(autoincrement())
  conversationId Int
  direction      String         // in | out
  content        String
  type           String         @default("text")
  mediaUrl       String?
  nodeId         String?
  conversation   WaConversation @relation(fields: [conversationId], references: [id])
  createdAt      DateTime       @default(now())
}

model WaScheduledMessage {
  id             Int            @id @default(autoincrement())
  conversationId Int
  nodeId         String
  message        String
  scheduledFor   DateTime
  sent           Boolean        @default(false)
  cancelled      Boolean        @default(false)
  conversation   WaConversation @relation(fields: [conversationId], references: [id])
  createdAt      DateTime       @default(now())

  @@index([scheduledFor, sent, cancelled])
}
```

E adicionar a relação no modelo `Lead` (antes de `createdAt`):

```prisma
  waConversations WaConversation[]
```

- [ ] **Step 2: Aplicar o schema**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && npx prisma db push
```

Resultado esperado: `Your database is now in sync with the Prisma schema`.

---

### Task 2: Criar o serviço evolutionApi.js

**Files:**
- Create: `backend/src/services/evolutionApi.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/services/evolutionApi.js`:

```javascript
/**
 * evolutionApi.js
 * Wrapper para a Evolution API REST.
 * Todas as funções recebem o objeto instance (WaInstance) como primeiro argumento.
 */

async function call(instance, method, path, body) {
  const url = `${instance.apiUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': instance.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Evolution API ${method} ${path} → ${res.status}: ${text}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/**
 * Cria uma instância na Evolution API e configura webhook.
 * @param {WaInstance} instance
 * @param {string} webhookUrl - URL pública do nosso backend para receber eventos
 */
export async function createInstance(instance, webhookUrl) {
  return call(instance, 'POST', '/instance/create', {
    instanceName: instance.instanceName,
    token: instance.apiKey,
    qrcode: true,
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      webhookHeaders: { 'x-webhook-secret': instance.webhookSecret },
    },
  });
}

/**
 * Retorna o estado atual da conexão.
 */
export async function getConnectionState(instance) {
  return call(instance, 'GET', `/instance/connectionState/${instance.instanceName}`);
}

/**
 * Retorna o QR code atual em base64.
 */
export async function getQrCode(instance) {
  return call(instance, 'GET', `/instance/qrcode/${instance.instanceName}?image=true`);
}

/**
 * Desconecta a instância.
 */
export async function disconnectInstance(instance) {
  return call(instance, 'DELETE', `/instance/logout/${instance.instanceName}`);
}

/**
 * Envia mensagem de texto.
 * @param {WaInstance} instance
 * @param {string} phone - número no formato 5511999999999
 * @param {string} text
 */
export async function sendText(instance, phone, text) {
  return call(instance, 'POST', `/message/sendText/${instance.instanceName}`, {
    number: phone,
    text,
  });
}

/**
 * Envia arquivo de mídia.
 */
export async function sendMedia(instance, phone, { mediaUrl, mediaType, caption }) {
  return call(instance, 'POST', `/message/sendMedia/${instance.instanceName}`, {
    number: phone,
    mediatype: mediaType,
    media: mediaUrl,
    caption,
  });
}
```

---

### Task 3: Criar a rota whatsapp.js

**Files:**
- Create: `backend/src/routes/whatsapp.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/routes/whatsapp.js`:

```javascript
/**
 * whatsapp.js
 * Rotas para gerenciamento de instâncias WhatsApp e conversas.
 * Todas as rotas requerem JWT exceto POST /webhook.
 */
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import auth from '../middleware/auth.js';
import * as evo from '../services/evolutionApi.js';

const router = Router();

// ─── Webhook (público, validado por secret) ───────────────────────────────────

router.post('/webhook', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];

  // Identifica a instância pelo instanceName no body
  const instanceName = req.body?.instance || req.body?.instanceName;
  if (!instanceName) return res.status(400).json({ error: 'instanceName ausente.' });

  const instance = await prisma.waInstance.findUnique({ where: { instanceName } });
  if (!instance || instance.webhookSecret !== secret) {
    return res.status(401).json({ error: 'Webhook secret inválido.' });
  }

  const event = req.body.event || req.body.type;

  // ─── Atualização de estado de conexão ───────────────────────────────────────
  if (event === 'CONNECTION_UPDATE' || event === 'connection.update') {
    const state = req.body.data?.state || req.body.state;
    const statusMap = { open: 'connected', close: 'disconnected', connecting: 'connecting' };
    const newStatus = statusMap[state] || 'disconnected';
    await prisma.waInstance.update({
      where: { id: instance.id },
      data: { status: newStatus },
    });
    return res.json({ ok: true });
  }

  // ─── Mensagem recebida ───────────────────────────────────────────────────────
  if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
    const msg = req.body.data?.messages?.[0] || req.body.data;
    if (!msg || msg.key?.fromMe) return res.json({ ok: true }); // ignora mensagens enviadas por nós

    const phone = msg.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const text  = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

    if (!phone || !text) return res.json({ ok: true });

    // Busca ou cria conversa
    let conversation = await prisma.waConversation.findFirst({
      where: { phone, instanceId: instance.id, status: { not: 'closed' } },
    });

    if (conversation) {
      // Salva mensagem recebida
      await prisma.waMessage.create({
        data: { conversationId: conversation.id, direction: 'in', content: text },
      });
    }
    // Flow engine será adicionado na Fase 3 — por ora, só registra

    return res.json({ ok: true });
  }

  res.json({ ok: true });
});

// ─── Aplicar auth em todas as rotas abaixo ───────────────────────────────────
router.use(auth);

// ─── Instâncias ───────────────────────────────────────────────────────────────

router.get('/instances', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, parseInt(req.query.limit || '20'));
  const skip  = (page - 1) * limit;

  const [total, data] = await Promise.all([
    prisma.waInstance.count(),
    prisma.waInstance.findMany({
      skip, take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, instanceName: true, label: true, status: true, isDefault: true, apiUrl: true, createdAt: true },
    }),
  ]);

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

router.post('/instances', async (req, res) => {
  const { instanceName, apiUrl, apiKey, webhookSecret, label } = req.body;
  if (!instanceName || !apiUrl || !apiKey || !webhookSecret) {
    return res.status(400).json({ error: 'instanceName, apiUrl, apiKey e webhookSecret são obrigatórios.' });
  }

  // Se for a primeira instância, torna padrão automaticamente
  const count = await prisma.waInstance.count();
  const instance = await prisma.waInstance.create({
    data: { instanceName, apiUrl, apiKey: apiKey.trim(), webhookSecret, label, isDefault: count === 0 },
  });

  res.status(201).json(instance);
});

router.get('/instances/:id', async (req, res) => {
  const instance = await prisma.waInstance.findUnique({
    where: { id: parseInt(req.params.id) },
    select: { id: true, instanceName: true, label: true, status: true, isDefault: true, apiUrl: true, createdAt: true },
  });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });
  res.json(instance);
});

router.patch('/instances/:id', async (req, res) => {
  const { label, isDefault } = req.body;
  const updated = await prisma.waInstance.update({
    where: { id: parseInt(req.params.id) },
    data: { label, isDefault },
  });
  res.json(updated);
});

router.delete('/instances/:id', async (req, res) => {
  await prisma.waInstance.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ ok: true });
});

router.post('/instances/:id/connect', async (req, res) => {
  const instance = await prisma.waInstance.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });

  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  const webhookUrl = `${baseUrl}/api/whatsapp/webhook`;

  try {
    await evo.createInstance(instance, webhookUrl);
    await prisma.waInstance.update({
      where: { id: instance.id },
      data: { status: 'connecting' },
    });
    res.json({ ok: true, status: 'connecting' });
  } catch (err) {
    res.status(502).json({ error: `Erro ao conectar na Evolution API: ${err.message}` });
  }
});

router.post('/instances/:id/disconnect', async (req, res) => {
  const instance = await prisma.waInstance.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });

  try {
    await evo.disconnectInstance(instance);
  } catch { /* ignora erros de desconexão */ }

  await prisma.waInstance.update({ where: { id: instance.id }, data: { status: 'disconnected' } });
  res.json({ ok: true });
});

router.get('/instances/:id/qr', async (req, res) => {
  const instance = await prisma.waInstance.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });

  try {
    const data = await evo.getQrCode(instance);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/instances/:id/status', async (req, res) => {
  const instance = await prisma.waInstance.findUnique({
    where: { id: parseInt(req.params.id) },
    select: { id: true, status: true, instanceName: true },
  });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });

  try {
    const remote = await evo.getConnectionState(instance);
    const state  = remote?.instance?.state || remote?.state || 'unknown';
    const newStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
    if (newStatus !== instance.status) {
      await prisma.waInstance.update({ where: { id: instance.id }, data: { status: newStatus } });
    }
    res.json({ status: newStatus });
  } catch {
    res.json({ status: instance.status });
  }
});

// ─── Conversas ────────────────────────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  const page       = Math.max(1, parseInt(req.query.page       || '1'));
  const limit      = Math.min(100, parseInt(req.query.limit    || '20'));
  const skip       = (page - 1) * limit;
  const status     = req.query.status;
  const instanceId = req.query.instanceId ? parseInt(req.query.instanceId) : undefined;

  const where = {};
  if (status)     where.status     = status;
  if (instanceId) where.instanceId = instanceId;

  const [total, data] = await Promise.all([
    prisma.waConversation.count({ where }),
    prisma.waConversation.findMany({
      where, skip, take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        lead: { select: { nome: true, email: true, telefone: true, status: true, source: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    }),
  ]);

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

router.get('/conversations/:id', async (req, res) => {
  const id      = parseInt(req.params.id);
  const msgPage = Math.max(1, parseInt(req.query.msgPage || '1'));
  const msgLimit= Math.min(100, parseInt(req.query.msgLimit || '50'));

  const conversation = await prisma.waConversation.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const [msgTotal, messages] = await Promise.all([
    prisma.waMessage.count({ where: { conversationId: id } }),
    prisma.waMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      skip: (msgPage - 1) * msgLimit,
      take: msgLimit,
    }),
  ]);

  res.json({ ...conversation, messages, msgTotal, msgPage, msgLimit });
});

router.post('/conversations/:id/assign', async (req, res) => {
  const { assignedTo } = req.body;
  const updated = await prisma.waConversation.update({
    where: { id: parseInt(req.params.id) },
    data: { assignedTo },
  });
  res.json(updated);
});

router.post('/conversations/:id/transfer', async (req, res) => {
  const { toBot = false } = req.body;
  const updated = await prisma.waConversation.update({
    where: { id: parseInt(req.params.id) },
    data: { status: toBot ? 'bot' : 'human' },
  });
  res.json(updated);
});

router.post('/conversations/:id/close', async (req, res) => {
  const updated = await prisma.waConversation.update({
    where: { id: parseInt(req.params.id) },
    data: { status: 'closed' },
  });
  res.json(updated);
});

router.post('/conversations/:id/message', async (req, res) => {
  const id   = parseInt(req.params.id);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text é obrigatório.' });

  const conversation = await prisma.waConversation.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });

  const instance = await prisma.waInstance.findUnique({ where: { id: conversation.instanceId } });
  if (!instance) return res.status(404).json({ error: 'Instância não encontrada.' });

  await evo.sendText(instance, conversation.phone, text);
  const msg = await prisma.waMessage.create({
    data: { conversationId: id, direction: 'out', content: text },
  });

  res.json(msg);
});

// ─── Iniciar conversa para um lead ───────────────────────────────────────────

router.post('/leads/:leadId/start', async (req, res) => {
  const leadId     = parseInt(req.params.leadId);
  const { message, instanceId } = req.body;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead)      return res.status(404).json({ error: 'Lead não encontrado.' });
  if (!lead.telefone) return res.status(400).json({ error: 'Lead sem telefone cadastrado.' });
  if (lead.optOut)    return res.status(400).json({ error: 'Lead optou por não receber mensagens.' });

  const phone = lead.telefone.replace(/\D/g, '');

  // Busca instância ativa
  const instId = instanceId ? parseInt(instanceId) : undefined;
  const instance = instId
    ? await prisma.waInstance.findUnique({ where: { id: instId } })
    : await prisma.waInstance.findFirst({ where: { isDefault: true, status: 'connected' } });

  if (!instance || instance.status !== 'connected') {
    return res.status(400).json({ error: 'Nenhuma instância WhatsApp conectada disponível.' });
  }

  // Cria ou reabre conversa
  let conversation = await prisma.waConversation.findFirst({
    where: { leadId, instanceId: instance.id, status: { not: 'closed' } },
  });

  if (!conversation) {
    conversation = await prisma.waConversation.create({
      data: { leadId, instanceId: instance.id, phone, status: 'human' },
    });
  }

  const text = message || `Olá, ${lead.nome.split(' ')[0]}! Aqui é da equipe comercial. Como posso te ajudar?`;
  await evo.sendText(instance, phone, text);
  await prisma.waMessage.create({
    data: { conversationId: conversation.id, direction: 'out', content: text },
  });

  res.json({ conversationId: conversation.id });
});

export default router;
```

---

### Task 4: Registrar rotas em app.js

**Files:**
- Modify: `backend/app.js`

- [ ] **Step 1: Adicionar import e registro da rota whatsapp**

Em `backend/app.js`, adicionar após o import de `cnpjRouter`:

```javascript
import whatsappRouter from './src/routes/whatsapp.js';
```

E após `app.use('/api/cnpj', cnpjRouter);`:

```javascript
app.use('/api/whatsapp', whatsappRouter);
```

- [ ] **Step 2: Verificar que o servidor inicia sem erros**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && node app.js
```

Resultado esperado: `✅ Banco de dados conectado` e `🚀 Servidor rodando em http://localhost:3001`. Encerrar com Ctrl+C.

---

## Chunk 2: Frontend — Painel WhatsApp

### Task 5: Criar a página WhatsApp.jsx

**Files:**
- Create: `frontend/src/pages/WhatsApp.jsx`

- [ ] **Step 1: Criar o arquivo**

Criar `frontend/src/pages/WhatsApp.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout.jsx';
import api from '../services/api.js';
import {
  MessageCircle, Send, User, Bot, Clock, CheckCircle2,
  AlertCircle, Loader2, Phone, MoreVertical, UserCheck,
  RefreshCw, QrCode, Wifi, WifiOff
} from 'lucide-react';

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const colors = {
    connected:    'bg-green-500',
    connecting:   'bg-yellow-500 animate-pulse',
    disconnected: 'bg-gray-400',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-400'}`} />;
}

function ConvStatusBadge({ status }) {
  const map = {
    bot:   { label: 'Bot',    cls: 'bg-blue-100 text-blue-700' },
    human: { label: 'Humano', cls: 'bg-purple-100 text-purple-700' },
    closed:{ label: 'Encerrado', cls: 'bg-gray-100 text-gray-500' },
  };
  const { label, cls } = map[status] || { label: status, cls: 'bg-gray-100' };
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{label}</span>;
}

// ─── Painel de conexão da instância ─────────────────────────────────────────

function InstanceStatus() {
  const [instances, setInstances] = useState([]);
  const [qr, setQr]               = useState(null);
  const [polling, setPolling]     = useState(false);
  const pollRef                   = useRef();

  async function load() {
    const { data } = await api.get('/whatsapp/instances');
    setInstances(data.data);
  }

  useEffect(() => { load(); }, []);

  async function handleConnect(inst) {
    await api.post(`/whatsapp/instances/${inst.id}/connect`);
    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/instances/${inst.id}/status`);
        if (data.status === 'connected') {
          clearInterval(pollRef.current);
          setPolling(false);
          setQr(null);
          load();
        } else if (data.status === 'connecting') {
          const qrData = await api.get(`/whatsapp/instances/${inst.id}/qr`).then(r => r.data);
          setQr(qrData?.qrcode || qrData?.base64 || null);
        }
      } catch { /* continua polling */ }
    }, 3000);
  }

  async function handleDisconnect(inst) {
    await api.post(`/whatsapp/instances/${inst.id}/disconnect`);
    clearInterval(pollRef.current);
    setPolling(false);
    setQr(null);
    load();
  }

  useEffect(() => () => clearInterval(pollRef.current), []);

  if (instances.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        <WifiOff size={32} className="mx-auto mb-2 text-gray-300" />
        Nenhuma instância configurada.<br />
        Vá em <b>Configurações → WhatsApp</b> para adicionar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {instances.map((inst) => (
        <div key={inst.id} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={inst.status} />
              <div>
                <p className="font-medium text-sm text-gray-900">{inst.label || inst.instanceName}</p>
                <p className="text-xs text-gray-400">{inst.apiUrl}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {inst.status !== 'connected'
                ? (
                  <button
                    onClick={() => handleConnect(inst)}
                    disabled={polling}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 disabled:opacity-50"
                  >
                    {polling ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                    Conectar
                  </button>
                )
                : (
                  <button
                    onClick={() => handleDisconnect(inst)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50"
                  >
                    <WifiOff size={12} /> Desconectar
                  </button>
                )
              }
            </div>
          </div>
          {qr && inst.status !== 'connected' && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <QrCode size={12} /> Escaneie o QR code com o WhatsApp do celular
              </p>
              <img src={qr} alt="QR Code WhatsApp" className="w-48 h-48 border rounded-lg" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Lista de conversas ───────────────────────────────────────────────────────

function ConversationList({ selected, onSelect }) {
  const [tab, setTab]           = useState('bot');
  const [conversations, setConvs] = useState([]);
  const [loading, setLoading]   = useState(false);

  async function load(status) {
    setLoading(true);
    try {
      const { data } = await api.get(`/whatsapp/conversations?status=${status}&limit=50`);
      setConvs(data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(tab); }, [tab]);

  const tabs = [
    { id: 'bot',    label: 'Bot' },
    { id: 'human',  label: 'Humano' },
    { id: 'closed', label: 'Encerradas' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Abas */}
      <div className="flex border-b border-gray-100">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'text-brand-600 border-b-2 border-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        )}
        {!loading && conversations.length === 0 && (
          <div className="text-center py-8 text-xs text-gray-400">Nenhuma conversa</div>
        )}
        {conversations.map((conv) => {
          const lastMsg = conv.messages?.[0];
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                selected?.id === conv.id ? 'bg-brand-50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <User size={14} className="text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{conv.lead?.nome || conv.phone}</p>
                    <p className="text-xs text-gray-400 truncate">{lastMsg?.content || '—'}</p>
                  </div>
                </div>
                <ConvStatusBadge status={conv.status} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Painel de conversa ───────────────────────────────────────────────────────

function ConversationPanel({ conv }) {
  const [messages, setMessages] = useState([]);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef               = useRef();

  async function loadMessages() {
    const { data } = await api.get(`/whatsapp/conversations/${conv.id}`);
    setMessages(data.messages || []);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  useEffect(() => { loadMessages(); }, [conv.id]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/whatsapp/conversations/${conv.id}/message`, { text });
      setText('');
      await loadMessages();
    } finally {
      setSending(false);
    }
  }

  async function handleTransfer(toBot) {
    await api.post(`/whatsapp/conversations/${conv.id}/transfer`, { toBot });
    await loadMessages();
  }

  async function handleClose() {
    await api.post(`/whatsapp/conversations/${conv.id}/close`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <div>
          <p className="font-medium text-sm text-gray-900">{conv.lead?.nome || conv.phone}</p>
          <p className="text-xs text-gray-400">{conv.phone}</p>
        </div>
        <div className="flex items-center gap-2">
          <ConvStatusBadge status={conv.status} />
          {conv.status === 'bot' && (
            <button
              onClick={() => handleTransfer(false)}
              className="flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <UserCheck size={12} /> Assumir
            </button>
          )}
          {conv.status === 'human' && (
            <button
              onClick={() => handleTransfer(true)}
              className="flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Bot size={12} /> Dev. ao Bot
            </button>
          )}
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.direction === 'out'
                  ? 'bg-brand-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm'
              }`}
            >
              {msg.content}
              <p className={`text-[10px] mt-1 ${msg.direction === 'out' ? 'text-brand-200' : 'text-gray-400'}`}>
                {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 px-4 py-3 border-t border-gray-100 bg-white">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Digite uma mensagem…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="px-3 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}

// ─── Card de lead (coluna direita) ───────────────────────────────────────────

function LeadCard({ lead }) {
  if (!lead) return null;
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
          <User size={18} className="text-brand-600" />
        </div>
        <div>
          <p className="font-semibold text-sm text-gray-900">{lead.nome}</p>
          <p className="text-xs text-gray-400">{lead.email}</p>
        </div>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Status CRM</span>
          <span className="font-medium text-gray-800">{lead.status}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Origem</span>
          <span className="font-medium text-gray-800">{lead.source}</span>
        </div>
        {lead.telefone && (
          <div className="flex justify-between">
            <span className="text-gray-500">Telefone</span>
            <span className="font-medium text-gray-800">{lead.telefone}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function WhatsApp() {
  const [selected, setSelected] = useState(null);
  const [view, setView]         = useState('conversations'); // conversations | instances

  return (
    <Layout>
      <div className="flex h-[calc(100vh-0px)] md:h-screen flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
          <h1 className="font-semibold text-gray-900">WhatsApp</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setView('conversations')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${view === 'conversations' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              Conversas
            </button>
            <button
              onClick={() => setView('instances')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${view === 'instances' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              Conexão
            </button>
          </div>
        </div>

        {view === 'instances' && (
          <div className="p-6 overflow-y-auto max-w-lg">
            <InstanceStatus />
          </div>
        )}

        {view === 'conversations' && (
          <div className="flex flex-1 min-h-0">
            {/* Lista */}
            <div className="w-72 border-r border-gray-200 bg-white flex-shrink-0 overflow-hidden flex flex-col">
              <ConversationList selected={selected} onSelect={setSelected} />
            </div>

            {/* Conversa */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selected
                ? <ConversationPanel conv={selected} />
                : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    <div className="text-center">
                      <MessageCircle size={32} className="mx-auto mb-2 opacity-30" />
                      Selecione uma conversa
                    </div>
                  </div>
                )
              }
            </div>

            {/* Card do lead */}
            {selected && (
              <div className="w-64 border-l border-gray-200 bg-white flex-shrink-0 overflow-y-auto">
                <LeadCard lead={selected.lead} />
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
```

---

### Task 6: Adicionar aba WhatsApp em Settings.jsx

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

O arquivo atual tem a estrutura: imports → `useIntegration` hook → `Field` → `Toggle` → `SaveBar` → `MetaTab` → `GoogleTab` → `WebhookTab` → `const TABS = [...]` → `export default function Settings`.

- [ ] **Step 1: Adicionar componente WhatsappTab antes de `const TABS`**

Inserir o seguinte bloco imediatamente antes da linha `// ─── Página Settings ───` em `frontend/src/pages/Settings.jsx`:

```jsx
// ─── Aba WhatsApp ─────────────────────────────────────────────────────────────
function WhatsappTab() {
  const [form, setForm]      = useState({ instanceName: '', apiUrl: '', apiKey: '', webhookSecret: '', label: '' });
  const [saving, setSaving]  = useState(false);
  const [saved, setSaved]    = useState(false);
  const [error, setError]    = useState('');
  const [instances, setInst] = useState([]);

  useEffect(() => {
    api.get('/whatsapp/instances').then(({ data }) => setInst(data.data)).catch(() => {});
  }, []);

  function field(key) {
    return { value: form[key], onChange: (v) => setForm((f) => ({ ...f, [key]: v })) };
  }

  async function handleSave() {
    if (!form.instanceName || !form.apiUrl || !form.apiKey || !form.webhookSecret) {
      setError('Preencha todos os campos obrigatórios (*).');
      return;
    }
    setSaving(true); setError(''); setSaved(false);
    try {
      const { data } = await api.post('/whatsapp/instances', form);
      setInst((prev) => [...prev, data]);
      setForm({ instanceName: '', apiUrl: '', apiKey: '', webhookSecret: '', label: '' });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao salvar instância.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {instances.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Instâncias cadastradas</p>
          {instances.map((inst) => (
            <div key={inst.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
              <div>
                <span className="font-medium text-gray-900">{inst.label || inst.instanceName}</span>
                <span className="ml-2 text-gray-400 text-xs">{inst.apiUrl}</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${inst.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {inst.status}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-sm font-semibold text-gray-700 pt-2">Adicionar nova instância</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nome da Instância *" placeholder="minha-instancia" hint="Identificador único, sem espaços." {...field('instanceName')} />
        <Field label="Label (apelido)" placeholder="Vendas" hint="Nome amigável exibido no painel." {...field('label')} />
      </div>
      <Field label="URL da Evolution API *" placeholder="http://localhost:8080" hint="Endereço onde sua Evolution API está rodando." {...field('apiUrl')} />
      <Field label="API Key *" placeholder="sua-api-key-aqui" secret hint="Chave de autenticação configurada na Evolution API." {...field('apiKey')} />
      <Field label="Webhook Secret *" placeholder="segredo-webhook-aleatorio" secret hint="String aleatória para validar eventos recebidos pela Evolution API." {...field('webhookSecret')} />
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        <strong>Webhook URL:</strong> Configure na Evolution API como <code className="bg-blue-100 px-1 rounded">http://seu-backend:3001/api/whatsapp/webhook</code>
      </div>
      <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
    </div>
  );
}
```

- [ ] **Step 2: Adicionar `whatsapp` ao array TABS**

Localizar em `frontend/src/pages/Settings.jsx`:
```javascript
const TABS = [
  { id: 'meta',    label: 'Meta Ads' },
  { id: 'google',  label: 'Google Ads' },
  { id: 'webhook', label: 'Webhook' },
];
```

Substituir por:
```javascript
const TABS = [
  { id: 'meta',     label: 'Meta Ads' },
  { id: 'google',   label: 'Google Ads' },
  { id: 'webhook',  label: 'Webhook' },
  { id: 'whatsapp', label: 'WhatsApp' },
];
```

- [ ] **Step 3: Adicionar renderização da aba no JSX de Settings**

Localizar:
```jsx
          {tab === 'webhook' && <WebhookTab />}
```

Substituir por:
```jsx
          {tab === 'webhook'   && <WebhookTab />}
          {tab === 'whatsapp'  && <WhatsappTab />}
```

- [ ] **Step 4: Verificar que o frontend compila**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\frontend" && npm run build 2>&1 | tail -5
```

Resultado esperado: `built in X.XXs` sem erros de compilação.

---

### Task 7: Adicionar botão "Iniciar conversa" no Dashboard.jsx

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

O arquivo atual tem a coluna de ações (última coluna da tabela) nas linhas ~488–501, contendo apenas o botão de deletar.

- [ ] **Step 1: Adicionar import de `MessageCircle` e estado para o botão WhatsApp**

Em `frontend/src/pages/Dashboard.jsx`, localizar a linha:
```javascript
import {
  Users, CheckCircle, XCircle, PhoneCall,
  Download, Search, RefreshCw, Trash2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, Mail, Calendar, Filter, AlertCircle, ExternalLink,
} from 'lucide-react';
```

Substituir por (adiciona `MessageCircle`):
```javascript
import {
  Users, CheckCircle, XCircle, PhoneCall,
  Download, Search, RefreshCw, Trash2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, Mail, Calendar, Filter, AlertCircle, ExternalLink, MessageCircle,
} from 'lucide-react';
```

- [ ] **Step 2: Adicionar estado e handler para iniciar conversa WhatsApp**

Após a linha `const [exporting, setExporting] = useState(false);` no componente Dashboard, adicionar:

```javascript
const [startingWa, setStartingWa] = useState(null); // leadId em progresso
const [waSuccess, setWaSuccess]   = useState(null); // leadId com sucesso

async function handleStartWhatsApp(lead) {
  if (!lead.telefone) return;
  setStartingWa(lead.id);
  try {
    await api.post(`/whatsapp/leads/${lead.id}/start`, {});
    setWaSuccess(lead.id);
    setTimeout(() => setWaSuccess(null), 4000);
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao iniciar conversa. Verifique se há uma instância WhatsApp conectada.');
  } finally {
    setStartingWa(null);
  }
}
```

- [ ] **Step 3: Adicionar botão WhatsApp na coluna de ações da tabela**

Localizar no JSX da tabela a seção `{/* Ações */}`:
```jsx
                        {/* Ações */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <button
                            onClick={() => handleDelete(lead.id, lead.nome)}
```

Substituir o conteúdo do `<td>` de ações por:
```jsx
                        {/* Ações */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {/* Botão WhatsApp */}
                            <button
                              onClick={() => handleStartWhatsApp(lead)}
                              disabled={!lead.telefone || startingWa === lead.id}
                              title={lead.telefone ? 'Iniciar conversa no WhatsApp' : 'Lead sem telefone cadastrado'}
                              className={`p-1.5 rounded-lg transition-colors disabled:cursor-not-allowed ${
                                waSuccess === lead.id
                                  ? 'text-green-500 bg-green-50'
                                  : lead.telefone
                                    ? 'text-gray-300 hover:text-green-600 hover:bg-green-50'
                                    : 'text-gray-200'
                              }`}
                            >
                              {startingWa === lead.id
                                ? <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                                : <MessageCircle className="w-4 h-4" />
                              }
                            </button>
                            {/* Botão Deletar */}
                            <button
                              onClick={() => handleDelete(lead.id, lead.nome)}
                              disabled={deletingId === lead.id}
                              title="Remover lead"
                              className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 disabled:cursor-not-allowed"
                            >
                              {deletingId === lead.id
                                ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </button>
                          </div>
                        </td>
```

- [ ] **Step 4: Verificar que o frontend compila**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\frontend" && npm run build 2>&1 | tail -5
```

Resultado esperado: `built in X.XXs` sem erros.

---

### Task 8: Registrar rotas e sidebar

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Adicionar rota /whatsapp em App.jsx**

```javascript
import WhatsApp from './pages/WhatsApp.jsx';
```

```jsx
<Route path="/whatsapp" element={<PrivateRoute><WhatsApp /></PrivateRoute>} />
```

- [ ] **Step 2: Adicionar item na sidebar em Layout.jsx**

Adicionar ao import do lucide-react: `MessageCircle`

Adicionar ao `NAV_ITEMS`:
```javascript
{ to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
```

- [ ] **Step 3: Verificar que o frontend compila**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\frontend" && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit da Fase 2**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR" && git add -A && git commit -m "feat(fase2): WhatsApp Core — Evolution API, painel de conversas, disparo manual"
```
