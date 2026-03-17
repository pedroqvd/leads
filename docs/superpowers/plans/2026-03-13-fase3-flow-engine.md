# Fase 3 — Flow Engine Definitivo Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o motor de chatbot de vendas para WhatsApp — com editor visual de fluxos, árvore de decisão, lead scoring, follow-up automático, campanhas de broadcast, A/B testing e analytics por nó.

**Architecture:** `fuzzyMatch.js` para correspondência de respostas; `flowEngine.js` como motor de processamento stateless; `campaignScheduler.js` com `node-cron` para follow-ups e campanhas agendadas; `flows.js` e `campaigns.js` para as rotas; `FlowCanvas.jsx` para o editor drag-and-drop; `Flows.jsx` como página principal; integração com o webhook da Fase 2.

**Tech Stack:** Express.js, Prisma/SQLite, node-cron, React + Tailwind CSS

**Pré-requisito:** Fases 1 e 2 concluídas. Backend está recebendo mensagens via webhook.

**Dependência de pacote:** `node-cron` precisa ser instalado no backend.

---

## Chunk 1: Backend — Schema + Serviços Core

### Task 1: Instalar node-cron e atualizar schema Prisma

**Files:**
- Modify: `backend/package.json` (via npm install)
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Instalar node-cron**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && npm install node-cron
```

Resultado esperado: `added X packages`.

- [ ] **Step 2: Adicionar modelos WaFlow, WaFlowVersion, WaCampaign, WaAbTest**

Adicionar ao final de `backend/prisma/schema.prisma`:

```prisma
model WaFlow {
  id           Int      @id @default(autoincrement())
  name         String
  description  String?
  active       Boolean  @default(false)
  version      Int      @default(1)
  nodes        String   @default("{}")
  triggers     String   @default("[]")
  workingHours String   @default("{}")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model WaFlowVersion {
  id        Int      @id @default(autoincrement())
  flowId    Int
  version   Int
  nodes     String
  createdAt DateTime @default(now())

  @@unique([flowId, version])
}

model WaCampaign {
  id             Int      @id @default(autoincrement())
  name           String
  instanceId     Int
  flowId         Int?
  message        String
  segment        String   @default("{}")
  status         String   @default("draft")
  scheduledAt    DateTime?
  sentCount      Int      @default(0)
  repliedCount   Int      @default(0)
  convertedCount Int      @default(0)
  rateLimit      Int      @default(30)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, scheduledAt])
}

model WaAbTest {
  id         Int      @id @default(autoincrement())
  flowId     Int
  nodeId     String
  variantA   String
  variantB   String
  splitPct   Int      @default(50)
  countA     Int      @default(0)
  countB     Int      @default(0)
  completedA Int      @default(0)
  completedB Int      @default(0)
  winner     String?
  status     String   @default("running")
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 3: Aplicar o schema**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && npx prisma db push
```

Resultado esperado: `Your database is now in sync with the Prisma schema`.

---

### Task 2: Criar o serviço fuzzyMatch.js

**Files:**
- Create: `backend/src/services/fuzzyMatch.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/services/fuzzyMatch.js`:

```javascript
/**
 * fuzzyMatch.js
 * Correspondência fuzzy de respostas de texto para menus do chatbot.
 */

/**
 * Normaliza string: remove acentos, lowercase, trim, remove pontuação.
 */
export function normalize(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Verifica se o texto contém alguma das palavras-chave.
 */
function matchesKeywords(text, keywords = []) {
  const norm = normalize(text);
  return keywords.some((kw) => norm.includes(normalize(kw)));
}

/**
 * Tenta corresponder o texto de entrada a uma das opções de um nó menu.
 * Estratégias (em ordem de prioridade):
 *   1. Match exato do número ("1", "2", etc.)
 *   2. Match por palavras-chave definidas na opção
 *   3. Match por início do label da opção
 *
 * @param {string} text - texto enviado pelo lead
 * @param {Array<{label: string, keywords?: string[], next: string}>} options
 * @returns {{ next: string, label: string } | null}
 */
export function matchMenuOption(text, options) {
  const normalized = normalize(text);

  // 1. Match exato por número ("1", "2", "3")
  const num = parseInt(text.trim());
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options[num - 1];
  }

  // 2. Match por palavras-chave
  for (const opt of options) {
    if (matchesKeywords(text, opt.keywords || [])) return opt;
  }

  // 3. Match por início do label ("ver plan" → "Ver planos")
  for (const opt of options) {
    if (normalize(opt.label).startsWith(normalized.slice(0, 4)) && normalized.length >= 3) {
      return opt;
    }
  }

  return null;
}

/**
 * Verifica se o texto é um pedido de opt-out.
 */
export function isOptOut(text) {
  const keywords = ['sair', 'parar', 'stop', 'nao quero', 'cancelar', 'descadastrar', 'remover'];
  return keywords.some((kw) => normalize(text).includes(kw));
}
```

---

### Task 3: Criar o serviço flowEngine.js

**Files:**
- Create: `backend/src/services/flowEngine.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/services/flowEngine.js`:

```javascript
/**
 * flowEngine.js
 * Motor de processamento do chatbot de funil de vendas.
 * Stateless: recebe phone+message, carrega estado do DB, processa, salva.
 */
import prisma from '../lib/prisma.js';
import * as evo from './evolutionApi.js';
import { matchMenuOption, isOptOut, normalize } from './fuzzyMatch.js';

// ─── Substituição de variáveis ────────────────────────────────────────────────

function interpolate(template, lead, variables = {}) {
  const vars = {
    nome:     lead.nome?.split(' ')[0] || 'você',
    empresa:  lead.empresa || '',
    telefone: lead.telefone || '',
    email:    lead.email || '',
    ...variables,
  };
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
}

// ─── Verificação de horário de funcionamento ─────────────────────────────────

function isWithinWorkingHours(workingHoursJson) {
  try {
    const wh = JSON.parse(workingHoursJson || '{}');
    if (!wh.start || !wh.end) return true; // sem restrição

    const now    = new Date();
    const day    = now.getDay(); // 0=Dom, 1=Seg...
    const days   = wh.days || [1, 2, 3, 4, 5];
    if (!days.includes(day)) return false;

    const today  = now.toISOString().slice(0, 10);
    if ((wh.holidays || []).includes(today)) return false;

    const [startH, startM] = wh.start.split(':').map(Number);
    const [endH,   endM]   = wh.end.split(':').map(Number);
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const startMins = startH * 60 + startM;
    const endMins   = endH * 60 + endM;

    return nowMins >= startMins && nowMins < endMins;
  } catch {
    return true;
  }
}

// ─── Envio de mensagem via Evolution API ─────────────────────────────────────

async function sendMessage(instance, phone, content) {
  await evo.sendText(instance, phone, content);
}

// ─── Processamento de um nó ───────────────────────────────────────────────────

async function processNode(node, conversation, lead, instance) {
  const { type } = node;
  const variables = JSON.parse(conversation.variables || '{}');

  if (type === 'message') {
    const text = interpolate(node.content, lead, variables);
    if (node.delay) await new Promise((r) => setTimeout(r, Math.min(node.delay * 1000, 5000)));
    await sendMessage(instance, conversation.phone, text);
    return node.next || null;
  }

  if (type === 'menu') {
    const lines = (node.options || []).map((o, i) => `${i + 1}. ${o.label}`).join('\n');
    const text  = `${interpolate(node.content, lead, variables)}\n\n${lines}`;
    await sendMessage(instance, conversation.phone, text);
    return null; // aguarda resposta
  }

  if (type === 'collect') {
    await sendMessage(instance, conversation.phone, interpolate(node.content, lead, variables));
    return null; // aguarda resposta
  }

  if (type === 'delay') {
    // Agenda envio do próximo nó após o delay
    const scheduledFor = new Date(Date.now() + (node.delayMs || 0));
    await prisma.waScheduledMessage.create({
      data: {
        conversationId: conversation.id,
        nodeId: node.next,
        message: '',
        scheduledFor,
      },
    });
    return '__scheduled__';
  }

  if (type === 'followup') {
    let accumulatedHours = 0;
    for (const step of node.steps || []) {
      accumulatedHours += step.delayHours || 0;
      const scheduledFor = new Date(Date.now() + accumulatedHours * 3600000);
      await prisma.waScheduledMessage.create({
        data: {
          conversationId: conversation.id,
          nodeId: node.id,
          message: interpolate(step.message, lead, variables),
          scheduledFor,
        },
      });
    }
    return node.onNoResponse || null;
  }

  if (type === 'score') {
    const newScore = (conversation.score || 0) + (node.points || 0);
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { score: newScore } });
    await prisma.lead.update({ where: { id: lead.id }, data: { score: newScore } });
    conversation.score = newScore;
    return node.next || null;
  }

  if (type === 'tag') {
    const tags = JSON.parse(conversation.tags || '[]');
    if (node.add && !tags.includes(node.add)) tags.push(node.add);
    if (node.remove) {
      const idx = tags.indexOf(node.remove);
      if (idx !== -1) tags.splice(idx, 1);
    }
    const tagsJson = JSON.stringify(tags);
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { tags: tagsJson } });
    await prisma.lead.update({ where: { id: lead.id }, data: { tags: tagsJson } });
    return node.next || null;
  }

  if (type === 'action') {
    if (node.leadStatus) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: node.leadStatus } });
    }
    if (node.addNote) {
      const nota = interpolate(node.addNote, lead, variables);
      const existing = lead.notas ? `${lead.notas}\n` : '';
      await prisma.lead.update({ where: { id: lead.id }, data: { notas: `${existing}[Bot] ${nota}` } });
    }
    return node.next || null;
  }

  if (type === 'condition') {
    const fieldVal = normalize(String(lead[node.field] || variables[node.field] || ''));
    const condVal  = normalize(String(node.value || ''));
    const match    = node.operator === 'contains'
      ? fieldVal.includes(condVal)
      : node.operator === 'gte'
        ? parseFloat(fieldVal) >= parseFloat(condVal)
        : fieldVal === condVal;
    return match ? node.nextIfTrue : node.nextIfFalse;
  }

  if (type === 'transfer') {
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { status: 'human' } });
    if (node.message) {
      await sendMessage(instance, conversation.phone, interpolate(node.message, lead, variables));
    }
    return null;
  }

  if (type === 'end') {
    if (node.message) {
      await sendMessage(instance, conversation.phone, interpolate(node.message, lead, variables));
    }
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { status: 'closed' } });
    return null;
  }

  // Nó ab_test: distribui 50/50 entre variantes
  if (type === 'ab_test') {
    const abTest = await prisma.waAbTest.findFirst({
      where: { flowId: conversation.flowId, nodeId: node.id, status: 'running' },
    });
    if (!abTest) return node.next || null;

    const useA = (abTest.countA + abTest.countB) % 2 === 0
      || (abTest.countA / (abTest.countA + abTest.countB || 1)) < (abTest.splitPct / 100);

    const variant = useA ? abTest.variantA : abTest.variantB;
    const variantData = JSON.parse(variant);
    await sendMessage(instance, conversation.phone, interpolate(variantData.content, lead, variables));
    await prisma.waAbTest.update({
      where: { id: abTest.id },
      data: useA ? { countA: { increment: 1 } } : { countB: { increment: 1 } },
    });
    return node.next || null;
  }

  return node.next || null;
}

// ─── Processamento de resposta a um nó collect ────────────────────────────────

async function processCollectResponse(node, text, conversation, lead) {
  const variables = JSON.parse(conversation.variables || '{}');

  // Validação de formato
  if (node.validate === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return { valid: false, error: node.errorMessage || 'Formato inválido. Tente novamente.' };
  }
  if (node.validate === 'cnpj' && text.replace(/\D/g, '').length !== 14) {
    return { valid: false, error: node.errorMessage || 'CNPJ inválido. Informe 14 dígitos.' };
  }
  if (node.validate === 'phone' && text.replace(/\D/g, '').length < 10) {
    return { valid: false, error: node.errorMessage || 'Telefone inválido.' };
  }

  // Salvar no lead se solicitado
  if (node.saveToLead && node.field) {
    const allowed = ['nome', 'email', 'telefone', 'empresa', 'cnpj', 'cargo'];
    if (allowed.includes(node.field)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { [node.field]: text } });
    }
  }

  // Salvar em variáveis de sessão
  variables[node.field] = text;
  await prisma.waConversation.update({
    where: { id: conversation.id },
    data: { variables: JSON.stringify(variables) },
  });

  return { valid: true };
}

// ─── Entrada principal ────────────────────────────────────────────────────────

/**
 * Processa uma mensagem recebida de um lead.
 * @param {number} instanceId
 * @param {string} phone
 * @param {string} text
 */
export async function processIncoming(instanceId, phone, text) {
  const instance = await prisma.waInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return;

  // Busca conversa ativa
  let conversation = await prisma.waConversation.findFirst({
    where: { phone, instanceId, status: { not: 'closed' } },
  });

  if (!conversation) {
    // Nenhuma conversa ativa — ignora (conversa deve ser iniciada pelo operador ou landing page)
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: conversation.leadId } });
  if (!lead) return;

  // Salvar mensagem recebida
  await prisma.waMessage.create({
    data: { conversationId: conversation.id, direction: 'in', content: text },
  });

  // Opt-out
  if (isOptOut(text)) {
    await prisma.lead.update({ where: { id: lead.id }, data: { optOut: true } });
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { optOut: true, status: 'closed' } });
    // Cancela follow-ups pendentes
    await prisma.waScheduledMessage.updateMany({
      where: { conversationId: conversation.id, sent: false },
      data: { cancelled: true },
    });
    await sendMessage(instance, phone, 'Ok! Você não receberá mais mensagens. 👋');
    return;
  }

  // Conversa em modo humano — só registra, não processa
  if (conversation.status === 'human') return;

  // Carrega o fluxo
  const flowId = conversation.flowId;
  if (!flowId) return;

  const flow = conversation.flowVersion
    ? await prisma.waFlowVersion.findFirst({ where: { flowId, version: conversation.flowVersion } })
        .then((v) => v ? { nodes: v.nodes } : null)
    : await prisma.waFlow.findUnique({ where: { id: flowId } });

  if (!flow) return;

  const nodes = JSON.parse(flow.nodes || '{}');
  let currentNodeId = conversation.nodeId;
  let currentNode   = nodes[currentNodeId];

  if (!currentNode) return;

  // Cancelar follow-ups pendentes (lead respondeu)
  await prisma.waScheduledMessage.updateMany({
    where: { conversationId: conversation.id, sent: false },
    data: { cancelled: true },
  });

  // Verificar horário de funcionamento
  const fullFlow = await prisma.waFlow.findUnique({ where: { id: flowId } });
  if (fullFlow && !isWithinWorkingHours(fullFlow.workingHours)) {
    const offNode = nodes['offHours'];
    if (offNode?.content) {
      await sendMessage(instance, phone, interpolate(offNode.content, lead, {}));
    }
    return;
  }

  // ─── Processar resposta ao nó atual ─────────────────────────────────────────

  let nextNodeId = null;

  if (currentNode.type === 'menu') {
    const match = matchMenuOption(text, currentNode.options || []);
    if (!match) {
      // Sem match — incrementa retries
      const retries = (conversation.retries || 0) + 1;
      await prisma.waConversation.update({ where: { id: conversation.id }, data: { retries } });

      if (retries >= (currentNode.maxRetries || 3)) {
        await prisma.waConversation.update({ where: { id: conversation.id }, data: { retries: 0 } });
        nextNodeId = currentNode.onMaxRetries || null;
      } else {
        const fallback = currentNode.fallback || 'Não entendi. Por favor, responda com o número da opção.';
        await sendMessage(instance, phone, fallback);
        return; // permanece no mesmo nó
      }
    } else {
      await prisma.waConversation.update({ where: { id: conversation.id }, data: { retries: 0 } });
      nextNodeId = match.next;
    }
  } else if (currentNode.type === 'collect') {
    const result = await processCollectResponse(currentNode, text, conversation, lead);
    if (!result.valid) {
      await sendMessage(instance, phone, result.error);
      return; // permanece no mesmo nó
    }
    nextNodeId = currentNode.next;
  }

  // ─── Avançar pelo fluxo ──────────────────────────────────────────────────────

  // Reload conversation (pode ter sido atualizada)
  conversation = await prisma.waConversation.findUnique({ where: { id: conversation.id } });
  const reloadedLead = await prisma.lead.findUnique({ where: { id: lead.id } });

  let iter = 0;
  while (nextNodeId && nextNodeId !== '__scheduled__' && iter < 10) {
    iter++;
    const node = nodes[nextNodeId];
    if (!node) break;

    await prisma.waConversation.update({ where: { id: conversation.id }, data: { nodeId: nextNodeId } });
    nextNodeId = await processNode(node, conversation, reloadedLead || lead, instance);

    // Recarrega conversa para refletir mudanças de score/tags
    conversation = await prisma.waConversation.findUnique({ where: { id: conversation.id } });
  }
}

/**
 * Processa um nó agendado (follow-up / delay).
 * Chamado pelo campaignScheduler.
 */
export async function processScheduledMessage(scheduledMsg) {
  const conversation = await prisma.waConversation.findUnique({
    where: { id: scheduledMsg.conversationId },
  });
  if (!conversation || conversation.status === 'closed' || conversation.optOut) return;

  const lead = await prisma.lead.findUnique({ where: { id: conversation.leadId } });
  const instance = await prisma.waInstance.findUnique({ where: { id: conversation.instanceId } });
  if (!lead || !instance) return;

  if (scheduledMsg.message) {
    await sendMessage(instance, conversation.phone, interpolate(scheduledMsg.message, lead, {}));
  } else if (scheduledMsg.nodeId) {
    // É um delay — avança para o próximo nó
    await prisma.waConversation.update({ where: { id: conversation.id }, data: { nodeId: scheduledMsg.nodeId } });
    const flow = await prisma.waFlow.findUnique({ where: { id: conversation.flowId } });
    if (flow) {
      const nodes = JSON.parse(flow.nodes || '{}');
      const node  = nodes[scheduledMsg.nodeId];
      if (node) await processNode(node, conversation, lead, instance);
    }
  }

  await prisma.waScheduledMessage.update({ where: { id: scheduledMsg.id }, data: { sent: true } });
}
```

---

### Task 4: Criar o campaignScheduler.js

**Files:**
- Create: `backend/src/services/campaignScheduler.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/services/campaignScheduler.js`:

```javascript
/**
 * campaignScheduler.js
 * Cron job que processa follow-ups agendados e campanhas programadas.
 * Roda a cada minuto no mesmo processo Express.
 */
import cron from 'node-cron';
import prisma from '../lib/prisma.js';
import * as evo from './evolutionApi.js';
import { processScheduledMessage } from './flowEngine.js';

// ─── Processar follow-ups vencidos ───────────────────────────────────────────

async function processScheduledMessages() {
  const due = await prisma.waScheduledMessage.findMany({
    where: { scheduledFor: { lte: new Date() }, sent: false, cancelled: false },
    take: 50, // processa até 50 por tick
  });

  for (const msg of due) {
    try {
      await processScheduledMessage(msg);
    } catch (err) {
      console.error(`[Scheduler] Erro ao processar WaScheduledMessage #${msg.id}:`, err.message);
    }
  }
}

// ─── Processar campanhas agendadas ───────────────────────────────────────────

async function processScheduledCampaigns() {
  const campaigns = await prisma.waCampaign.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
  });

  for (const campaign of campaigns) {
    try {
      await startCampaign(campaign);
    } catch (err) {
      console.error(`[Scheduler] Erro ao iniciar campanha #${campaign.id}:`, err.message);
      await prisma.waCampaign.update({ where: { id: campaign.id }, data: { status: 'cancelled' } });
    }
  }
}

// ─── Envio de campanha ───────────────────────────────────────────────────────

async function startCampaign(campaign) {
  await prisma.waCampaign.update({ where: { id: campaign.id }, data: { status: 'running' } });

  const segment = JSON.parse(campaign.segment || '{}');
  const where   = { optOut: false };

  if (segment.status)   where.status   = segment.status;
  if (segment.source)   where.source   = segment.source;
  if (segment.minScore) where.score    = { gte: segment.minScore };
  if (segment.maxScore) where.score    = { ...where.score, lte: segment.maxScore };

  const leads = await prisma.lead.findMany({ where, select: { id: true, nome: true, telefone: true } });

  const instance = await prisma.waInstance.findUnique({ where: { id: campaign.instanceId } });
  if (!instance || instance.status !== 'connected') {
    await prisma.waCampaign.update({ where: { id: campaign.id }, data: { status: 'cancelled' } });
    return;
  }

  let sent = 0;
  const msPerMsg = Math.ceil(3600000 / (campaign.rateLimit || 30));

  for (const lead of leads) {
    if (!lead.telefone) continue;
    const phone = lead.telefone.replace(/\D/g, '');
    const text  = campaign.message.replace(/\{nome\}/g, lead.nome.split(' ')[0]);

    try {
      await evo.sendText(instance, phone, text);
      sent++;

      // Cria/atualiza conversa para rastreamento
      let conv = await prisma.waConversation.findFirst({
        where: { leadId: lead.id, instanceId: instance.id, status: { not: 'closed' } },
      });
      if (!conv) {
        conv = await prisma.waConversation.create({
          data: { leadId: lead.id, instanceId: instance.id, phone, status: 'bot', flowId: campaign.flowId },
        });
      }
      await prisma.waMessage.create({
        data: { conversationId: conv.id, direction: 'out', content: text },
      });
    } catch (err) {
      console.error(`[Campaign #${campaign.id}] Erro ao enviar para ${phone}:`, err.message);
    }

    // Rate limit + intervalo aleatório (2–8s) entre envios
    const jitter = Math.floor(Math.random() * 6000) + 2000;
    await new Promise((r) => setTimeout(r, Math.max(msPerMsg, jitter)));
  }

  await prisma.waCampaign.update({
    where: { id: campaign.id },
    data: { status: 'done', sentCount: sent },
  });
}

// ─── Inicialização ───────────────────────────────────────────────────────────

export function startScheduler() {
  // Roda a cada minuto
  cron.schedule('* * * * *', async () => {
    await processScheduledMessages().catch((e) => console.error('[Scheduler] follow-up error:', e));
    await processScheduledCampaigns().catch((e) => console.error('[Scheduler] campaign error:', e));
  });

  console.log('⏰ Campaign scheduler iniciado (a cada minuto)');
}
```

---

### Task 5: Criar a rota flows.js

**Files:**
- Create: `backend/src/routes/flows.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/routes/flows.js`:

```javascript
/**
 * flows.js
 * CRUD de fluxos de chatbot + simulate + analytics + A/B tests.
 */
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import auth from '../middleware/auth.js';

const router = Router();
router.use(auth);

// ─── CRUD de fluxos ──────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, parseInt(req.query.limit || '20'));
  const skip  = (page - 1) * limit;

  const [total, data] = await Promise.all([
    prisma.waFlow.count(),
    prisma.waFlow.findMany({
      skip, take: limit, orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, description: true, active: true, version: true, triggers: true, createdAt: true, updatedAt: true },
    }),
  ]);

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

router.post('/', async (req, res) => {
  const { name, description, nodes, triggers, workingHours } = req.body;
  if (!name) return res.status(400).json({ error: 'name é obrigatório.' });

  const flow = await prisma.waFlow.create({
    data: {
      name,
      description,
      nodes: JSON.stringify(nodes || {}),
      triggers: JSON.stringify(triggers || []),
      workingHours: JSON.stringify(workingHours || {}),
    },
  });
  res.status(201).json(flow);
});

router.get('/:id', async (req, res) => {
  const flow = await prisma.waFlow.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });
  res.json(flow);
});

router.patch('/:id', async (req, res) => {
  const { name, description, nodes, triggers, workingHours, active } = req.body;
  const updated = await prisma.waFlow.update({
    where: { id: parseInt(req.params.id) },
    data: {
      ...(name !== undefined        && { name }),
      ...(description !== undefined && { description }),
      ...(nodes !== undefined       && { nodes: JSON.stringify(nodes) }),
      ...(triggers !== undefined    && { triggers: JSON.stringify(triggers) }),
      ...(workingHours !== undefined && { workingHours: JSON.stringify(workingHours) }),
      ...(active !== undefined      && { active }),
    },
  });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const activeConvs = await prisma.waConversation.count({
    where: { flowId: id, status: { not: 'closed' } },
  });
  if (activeConvs > 0) {
    return res.status(409).json({ error: `Existem ${activeConvs} conversa(s) ativa(s) usando este fluxo.` });
  }
  await prisma.waFlow.delete({ where: { id } });
  res.json({ ok: true });
});

// ─── Publicação e versionamento ──────────────────────────────────────────────

router.post('/:id/publish', async (req, res) => {
  const id   = parseInt(req.params.id);
  const flow = await prisma.waFlow.findUnique({ where: { id } });
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });

  const newVersion = flow.version + 1;
  await prisma.waFlowVersion.create({
    data: { flowId: id, version: newVersion, nodes: flow.nodes },
  });
  const updated = await prisma.waFlow.update({
    where: { id },
    data: { active: true, version: newVersion },
  });
  res.json(updated);
});

router.get('/:id/versions', async (req, res) => {
  const versions = await prisma.waFlowVersion.findMany({
    where: { flowId: parseInt(req.params.id) },
    orderBy: { version: 'desc' },
  });
  res.json(versions);
});

router.patch('/:id/rollback/:version', async (req, res) => {
  const id      = parseInt(req.params.id);
  const version = parseInt(req.params.version);
  const snap    = await prisma.waFlowVersion.findFirst({ where: { flowId: id, version } });
  if (!snap) return res.status(404).json({ error: 'Versão não encontrada.' });

  const current = await prisma.waFlow.findUnique({ where: { id } });
  const newVersion = (current?.version || 1) + 1;

  // Salva versão atual como snapshot e restaura a selecionada
  await prisma.waFlowVersion.create({
    data: { flowId: id, version: newVersion, nodes: current.nodes },
  });
  const updated = await prisma.waFlow.update({
    where: { id },
    data: { nodes: snap.nodes, version: newVersion },
  });
  res.json(updated);
});

// ─── Simulador ───────────────────────────────────────────────────────────────

router.post('/:id/simulate', async (req, res) => {
  const flow = await prisma.waFlow.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado.' });

  const { message = '', state = {} } = req.body;
  const nodes    = JSON.parse(flow.nodes || '{}');
  const nodeId   = state.nodeId || 'start';
  const node     = nodes[nodeId];
  const variables = state.variables || {};
  const fakeLead = { nome: 'Visitante', email: '', empresa: '', ...variables };

  if (!node) return res.status(400).json({ error: `Nó "${nodeId}" não encontrado no fluxo.` });

  const messages = [];
  const actions  = [];
  let nextNodeId = null;
  let newScore   = state.score || 0;
  let newVars    = { ...variables };

  // Simular processamento
  function simInterpolate(t) {
    return t.replace(/\{(\w+)\}/g, (_, k) => fakeLead[k] || newVars[k] || `{${k}}`);
  }

  if (node.type === 'message') {
    messages.push({ direction: 'out', content: simInterpolate(node.content) });
    nextNodeId = node.next;
  } else if (node.type === 'menu') {
    const lines = (node.options || []).map((o, i) => `${i + 1}. ${o.label}`).join('\n');
    messages.push({ direction: 'out', content: `${simInterpolate(node.content)}\n\n${lines}` });
    if (message) {
      const num = parseInt(message.trim());
      const match = (!isNaN(num) && num >= 1 && num <= node.options.length)
        ? node.options[num - 1]
        : (node.options || []).find((o) => (o.keywords || []).some((k) => message.toLowerCase().includes(k)));
      if (match) {
        nextNodeId = match.next;
      } else {
        messages.push({ direction: 'out', content: node.fallback || 'Não entendi.' });
      }
    }
  } else if (node.type === 'collect') {
    messages.push({ direction: 'out', content: simInterpolate(node.content) });
    if (message && node.field) {
      newVars[node.field] = message;
      actions.push(`Coletou ${node.field}: "${message}"`);
      nextNodeId = node.next;
    }
  } else if (node.type === 'score') {
    newScore += node.points || 0;
    actions.push(`Score +${node.points} → ${newScore}`);
    nextNodeId = node.next;
  } else if (node.type === 'action') {
    if (node.leadStatus) actions.push(`Status → ${node.leadStatus}`);
    nextNodeId = node.next;
  } else if (node.type === 'transfer') {
    messages.push({ direction: 'out', content: node.message || 'Transferindo para atendente…' });
    actions.push('Transferido para humano');
  } else if (node.type === 'end') {
    if (node.message) messages.push({ direction: 'out', content: simInterpolate(node.message) });
    actions.push('Fluxo encerrado');
  }

  res.json({
    messages,
    actions,
    nextState: { nodeId: nextNodeId || nodeId, variables: newVars, score: newScore },
  });
});

// ─── Analytics ───────────────────────────────────────────────────────────────

router.get('/:id/analytics', async (req, res) => {
  const flowId = parseInt(req.params.id);
  const days   = parseInt(req.query.days || '30');
  const since  = new Date(Date.now() - days * 86400000);

  const conversations = await prisma.waConversation.findMany({
    where: { flowId, createdAt: { gte: since } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  const total     = conversations.length;
  const completed = conversations.filter((c) => c.status === 'closed').length;
  const dropped   = total - completed;

  const durations = conversations
    .filter((c) => c.status === 'closed' && c.messages.length > 0)
    .map((c) => {
      const first = c.messages[0]?.createdAt;
      const last  = c.messages[c.messages.length - 1]?.createdAt;
      return first && last ? new Date(last) - new Date(first) : 0;
    });

  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Distribuição por hora do dia
  const hourly = Array(24).fill(0);
  for (const c of conversations) {
    hourly[new Date(c.createdAt).getHours()]++;
  }
  const peakHour = hourly.indexOf(Math.max(...hourly));

  // Score médio
  const avgScore = total
    ? Math.round(conversations.reduce((a, c) => a + (c.score || 0), 0) / total)
    : 0;

  res.json({
    started: total,
    completed,
    dropped,
    completionRate: total ? Math.round((completed / total) * 1000) / 10 : 0,
    avgDurationMs,
    avgScore,
    peakHour,
    hourlyDistribution: hourly,
  });
});

// ─── A/B Tests ───────────────────────────────────────────────────────────────

router.get('/:id/abtests', async (req, res) => {
  const tests = await prisma.waAbTest.findMany({
    where: { flowId: parseInt(req.params.id) },
    orderBy: { createdAt: 'desc' },
  });
  res.json(tests);
});

router.post('/:id/abtests', async (req, res) => {
  const { nodeId, variantA, variantB, splitPct = 50 } = req.body;
  if (!nodeId || !variantA || !variantB) {
    return res.status(400).json({ error: 'nodeId, variantA e variantB são obrigatórios.' });
  }
  const test = await prisma.waAbTest.create({
    data: {
      flowId: parseInt(req.params.id),
      nodeId,
      variantA: JSON.stringify(variantA),
      variantB: JSON.stringify(variantB),
      splitPct,
    },
  });
  res.status(201).json(test);
});

router.post('/:id/abtests/:testId/end', async (req, res) => {
  const { winner } = req.body; // "A" | "B"
  const test = await prisma.waAbTest.update({
    where: { id: parseInt(req.params.testId) },
    data: { status: 'ended', endedAt: new Date(), winner: winner || null },
  });
  res.json(test);
});

router.delete('/:id/abtests/:testId', async (req, res) => {
  const test = await prisma.waAbTest.findUnique({ where: { id: parseInt(req.params.testId) } });
  if (!test) return res.status(404).json({ error: 'Teste não encontrado.' });
  if (test.status === 'running') return res.status(409).json({ error: 'Encerre o teste antes de deletar.' });
  await prisma.waAbTest.delete({ where: { id: parseInt(req.params.testId) } });
  res.json({ ok: true });
});

export default router;
```

---

### Task 6: Criar a rota campaigns.js

**Files:**
- Create: `backend/src/routes/campaigns.js`

- [ ] **Step 1: Criar o arquivo**

Criar `backend/src/routes/campaigns.js`:

```javascript
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import auth from '../middleware/auth.js';

const router = Router();
router.use(auth);

router.get('/', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, parseInt(req.query.limit || '20'));
  const skip  = (page - 1) * limit;

  const [total, data] = await Promise.all([
    prisma.waCampaign.count(),
    prisma.waCampaign.findMany({
      skip, take: limit,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

router.post('/', async (req, res) => {
  const { name, instanceId, flowId, message, segment, scheduledAt, rateLimit } = req.body;
  if (!name || !instanceId || !message) {
    return res.status(400).json({ error: 'name, instanceId e message são obrigatórios.' });
  }

  const campaign = await prisma.waCampaign.create({
    data: {
      name,
      instanceId: parseInt(instanceId),
      flowId:     flowId ? parseInt(flowId) : null,
      message,
      segment:    JSON.stringify(segment || {}),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      rateLimit:   rateLimit || 30,
      status:     scheduledAt ? 'scheduled' : 'draft',
    },
  });

  res.status(201).json(campaign);
});

router.get('/:id', async (req, res) => {
  const campaign = await prisma.waCampaign.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  res.json(campaign);
});

router.patch('/:id', async (req, res) => {
  const campaign = await prisma.waCampaign.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    return res.status(409).json({ error: 'Apenas campanhas em rascunho ou agendadas podem ser editadas.' });
  }

  const { name, message, segment, scheduledAt, rateLimit } = req.body;
  const updated = await prisma.waCampaign.update({
    where: { id: parseInt(req.params.id) },
    data: {
      ...(name        !== undefined && { name }),
      ...(message     !== undefined && { message }),
      ...(segment     !== undefined && { segment: JSON.stringify(segment) }),
      ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }),
      ...(rateLimit   !== undefined && { rateLimit }),
    },
  });
  res.json(updated);
});

router.post('/:id/send', async (req, res) => {
  const campaign = await prisma.waCampaign.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });

  // Agenda para agora (o scheduler pega no próximo tick de 1 minuto)
  await prisma.waCampaign.update({
    where: { id: parseInt(req.params.id) },
    data: { status: 'scheduled', scheduledAt: new Date() },
  });

  res.json({ ok: true, message: 'Campanha agendada para disparo imediato.' });
});

router.post('/:id/cancel', async (req, res) => {
  await prisma.waCampaign.update({
    where: { id: parseInt(req.params.id) },
    data: { status: 'cancelled' },
  });
  res.json({ ok: true });
});

router.get('/:id/stats', async (req, res) => {
  const campaign = await prisma.waCampaign.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });

  res.json({
    sentCount:      campaign.sentCount,
    repliedCount:   campaign.repliedCount,
    convertedCount: campaign.convertedCount,
    replyRate:      campaign.sentCount ? Math.round((campaign.repliedCount / campaign.sentCount) * 1000) / 10 : 0,
    conversionRate: campaign.sentCount ? Math.round((campaign.convertedCount / campaign.sentCount) * 1000) / 10 : 0,
  });
});

export default router;
```

---

### Task 7: Registrar rotas e scheduler em app.js

**Files:**
- Modify: `backend/app.js`

- [ ] **Step 1: Adicionar imports, registrar rotas e iniciar scheduler**

Em `backend/app.js`, adicionar após os imports existentes:

```javascript
import flowsRouter     from './src/routes/flows.js';
import campaignsRouter from './src/routes/campaigns.js';
import { startScheduler } from './src/services/campaignScheduler.js';
```

Após `app.use('/api/whatsapp', whatsappRouter);`:

```javascript
app.use('/api/flows',     flowsRouter);
app.use('/api/whatsapp/campaigns', campaignsRouter);
```

E na função `bootstrap()`, após `app.listen(...)`:

```javascript
startScheduler();
```

- [ ] **Step 2: Atualizar webhook do whatsapp.js para usar o flowEngine**

Em `backend/src/routes/whatsapp.js`, na seção que processa mensagens recebidas (`MESSAGES_UPSERT`), adicionar a chamada ao flowEngine:

```javascript
import { processIncoming } from '../services/flowEngine.js';
// ...
// Dentro do handler MESSAGES_UPSERT, após salvar a mensagem:
if (conversation && conversation.status === 'bot' && conversation.flowId) {
  processIncoming(instance.id, phone, text).catch((err) =>
    console.error('[FlowEngine] Erro:', err.message)
  );
}
```

- [ ] **Step 3: Verificar que o servidor inicia**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\backend" && node app.js
```

Resultado esperado: `✅ Banco de dados conectado`, `🚀 Servidor rodando em http://localhost:3001`, `⏰ Campaign scheduler iniciado`. Encerrar com Ctrl+C.

---

## Chunk 2: Frontend — Editor de Fluxos e Campanhas

### Task 8: Criar a página Flows.jsx com editor visual

**Files:**
- Create: `frontend/src/pages/Flows.jsx`

- [ ] **Step 1: Criar o arquivo**

Criar `frontend/src/pages/Flows.jsx` com o editor visual de fluxos:

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout.jsx';
import api from '../services/api.js';
import {
  Plus, Play, GitBranch, Save, ChevronRight, Trash2, Copy,
  MessageSquare, List, Zap, Clock, Users, AlertOctagon,
  CheckCircle2, BarChart2, Loader2, X, ArrowLeft
} from 'lucide-react';

// ─── Ícone por tipo de nó ─────────────────────────────────────────────────────

const NODE_ICONS = {
  message:   MessageSquare,
  menu:      List,
  collect:   Users,
  condition: GitBranch,
  score:     Zap,
  tag:       CheckCircle2,
  action:    CheckCircle2,
  delay:     Clock,
  followup:  Clock,
  transfer:  Users,
  end:       AlertOctagon,
};

const NODE_COLORS = {
  message:   'border-blue-300   bg-blue-50   text-blue-700',
  menu:      'border-purple-300 bg-purple-50 text-purple-700',
  collect:   'border-orange-300 bg-orange-50 text-orange-700',
  condition: 'border-yellow-300 bg-yellow-50 text-yellow-700',
  score:     'border-green-300  bg-green-50  text-green-700',
  tag:       'border-teal-300   bg-teal-50   text-teal-700',
  action:    'border-indigo-300 bg-indigo-50 text-indigo-700',
  delay:     'border-gray-300   bg-gray-50   text-gray-700',
  followup:  'border-pink-300   bg-pink-50   text-pink-700',
  transfer:  'border-red-300    bg-red-50    text-red-700',
  end:       'border-red-400    bg-red-100   text-red-800',
};

// ─── Nó no canvas ────────────────────────────────────────────────────────────

function FlowNode({ node, nodeId, selected, onSelect, onDrag, stats }) {
  const Icon = NODE_ICONS[node.type] || MessageSquare;
  const colorCls = NODE_COLORS[node.type] || NODE_COLORS.message;

  const handleMouseDown = (e) => {
    e.stopPropagation();
    onSelect(nodeId);
    onDrag(nodeId, e);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`absolute select-none cursor-grab active:cursor-grabbing rounded-xl border-2 p-3 w-48 transition-shadow ${colorCls} ${selected ? 'shadow-lg ring-2 ring-brand-500' : 'shadow-sm hover:shadow-md'}`}
      style={{ left: node.x || 100, top: node.y || 100 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} />
        <span className="text-xs font-semibold uppercase tracking-wide opacity-60">{node.type}</span>
      </div>
      <p className="text-sm font-medium truncate">
        {node.content?.slice(0, 40) || node.name || nodeId}
      </p>
      {stats && (
        <p className="text-[10px] opacity-50 mt-1">
          {stats.entries} entradas · {stats.dropRate?.toFixed(1)}% drop
        </p>
      )}
    </div>
  );
}

// ─── Editor de propriedades do nó ────────────────────────────────────────────

function NodeEditor({ nodeId, node, onChange, onDelete }) {
  if (!node) return null;

  function update(field, value) {
    onChange(nodeId, { ...node, [field]: value });
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-gray-800 capitalize">{node.type}</h3>
        <button onClick={onDelete} className="text-red-400 hover:text-red-600">
          <Trash2 size={14} />
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">ID do nó</label>
        <input
          value={nodeId}
          readOnly
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 font-mono"
        />
      </div>

      {['message', 'menu', 'collect'].includes(node.type) && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Texto / Pergunta</label>
          <textarea
            value={node.content || ''}
            onChange={(e) => update('content', e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Use {nome}, {empresa} para variáveis"
          />
        </div>
      )}

      {node.type === 'menu' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Opções</label>
          {(node.options || []).map((opt, i) => (
            <div key={i} className="flex gap-2 mb-1">
              <input
                value={opt.label}
                onChange={(e) => {
                  const opts = [...(node.options || [])];
                  opts[i] = { ...opts[i], label: e.target.value };
                  update('options', opts);
                }}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                placeholder={`Opção ${i + 1}`}
              />
              <input
                value={opt.next || ''}
                onChange={(e) => {
                  const opts = [...(node.options || [])];
                  opts[i] = { ...opts[i], next: e.target.value };
                  update('options', opts);
                }}
                className="w-24 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                placeholder="next_id"
              />
            </div>
          ))}
          <button
            onClick={() => update('options', [...(node.options || []), { label: '', next: '' }])}
            className="text-xs text-brand-600 hover:text-brand-700 mt-1"
          >
            + Opção
          </button>
        </div>
      )}

      {node.type === 'collect' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Campo a coletar</label>
            <select
              value={node.field || ''}
              onChange={(e) => update('field', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="">Selecione…</option>
              {['nome', 'email', 'telefone', 'empresa', 'cnpj', 'cargo'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Validação</label>
            <select
              value={node.validate || ''}
              onChange={(e) => update('validate', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="">Nenhuma</option>
              <option value="email">Email</option>
              <option value="phone">Telefone</option>
              <option value="cnpj">CNPJ</option>
            </select>
          </div>
        </div>
      )}

      {node.type === 'score' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Pontos (+/-)</label>
          <input
            type="number"
            value={node.points || 0}
            onChange={(e) => update('points', parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          />
        </div>
      )}

      {node.type === 'action' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Novo status do lead</label>
          <select
            value={node.leadStatus || ''}
            onChange={(e) => update('leadStatus', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">Não alterar</option>
            {['Novo', 'Em Contato', 'Qualificado', 'Proposta', 'Convertido', 'Perdido'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {!['menu', 'transfer', 'end'].includes(node.type) && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Próximo nó (next)</label>
          <input
            value={node.next || ''}
            onChange={(e) => update('next', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono"
            placeholder="node_id"
          />
        </div>
      )}
    </div>
  );
}

// ─── Simulador embutido ───────────────────────────────────────────────────────

function FlowSimulator({ flowId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [state, setState]       = useState({ nodeId: 'start', variables: {}, score: 0 });
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef();

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && messages.length === 0) {
      // Primeira mensagem: inicializa o fluxo
      await step('');
      return;
    }
    const userMsg = input.trim();
    setInput('');
    setMessages((m) => [...m, { direction: 'in', content: userMsg }]);
    await step(userMsg);
  }

  async function step(msg) {
    setLoading(true);
    try {
      const { data } = await api.post(`/flows/${flowId}/simulate`, { message: msg, state });
      setMessages((m) => [...m, ...data.messages]);
      setState(data.nextState);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { step(''); }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div>
          <p className="font-medium text-sm">Simulador</p>
          <p className="text-xs text-gray-400">Nó: {state.nodeId} · Score: {state.score}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.direction === 'out' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
              m.direction === 'out'
                ? 'bg-white border border-gray-200 text-gray-900'
                : 'bg-brand-600 text-white'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-white border rounded-xl px-3 py-2 text-gray-400 text-sm">…</div></div>}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} className="flex gap-2 p-3 bg-white border-t border-gray-200">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Responda como o lead…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button type="submit" className="px-3 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
          <ChevronRight size={16} />
        </button>
      </form>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const NODE_TYPES = ['message', 'menu', 'collect', 'condition', 'score', 'tag', 'action', 'delay', 'followup', 'transfer', 'end'];

export default function Flows() {
  const [flows, setFlows]         = useState([]);
  const [selected, setSelected]   = useState(null); // fluxo selecionado para editar
  const [nodes, setNodes]         = useState({});
  const [selectedNode, setSelNode] = useState(null);
  const [showSim, setShowSim]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [publishing, setPublish]  = useState(false);
  const canvasRef                 = useRef();
  const dragRef                   = useRef(null);

  async function loadFlows() {
    const { data } = await api.get('/flows');
    setFlows(data.data);
  }

  useEffect(() => { loadFlows(); }, []);

  async function openFlow(flow) {
    const { data } = await api.get(`/flows/${flow.id}`);
    setSelected(data);
    setNodes(JSON.parse(data.nodes || '{}'));
    setSelNode(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/flows/${selected.id}`, { nodes });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublish(true);
    try {
      await api.patch(`/flows/${selected.id}`, { nodes });
      await api.post(`/flows/${selected.id}/publish`);
      alert('Fluxo publicado com sucesso!');
      loadFlows();
    } finally {
      setPublish(false);
    }
  }

  async function createFlow() {
    const name = prompt('Nome do novo fluxo:');
    if (!name) return;
    const { data } = await api.post('/flows', {
      name,
      nodes: {
        start: { type: 'message', content: 'Olá {nome}! 👋', x: 200, y: 100, next: null },
      },
    });
    await loadFlows();
    openFlow(data);
  }

  function addNode(type) {
    const id = `node_${Date.now()}`;
    const canvas = canvasRef.current?.getBoundingClientRect();
    setNodes((prev) => ({
      ...prev,
      [id]: { type, content: '', x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 },
    }));
    setSelNode(id);
  }

  function updateNode(id, updated) {
    setNodes((prev) => ({ ...prev, [id]: updated }));
  }

  function deleteNode(id) {
    setNodes((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setSelNode(null);
  }

  // Drag de nós no canvas
  function startDrag(nodeId, e) {
    const startX = e.clientX - (nodes[nodeId]?.x || 0);
    const startY = e.clientY - (nodes[nodeId]?.y || 0);
    dragRef.current = { nodeId, startX, startY };

    function onMove(ev) {
      if (!dragRef.current) return;
      setNodes((prev) => ({
        ...prev,
        [dragRef.current.nodeId]: {
          ...prev[dragRef.current.nodeId],
          x: ev.clientX - dragRef.current.startX,
          y: ev.clientY - dragRef.current.startY,
        },
      }));
    }

    function onUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ─── Lista de fluxos ────────────────────────────────────────────────────────

  if (!selected) {
    return (
      <Layout>
        <div className="p-6 max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Fluxos de Atendimento</h1>
              <p className="text-sm text-gray-500 mt-1">Crie e edite os fluxos de chatbot do WhatsApp.</p>
            </div>
            <button
              onClick={createFlow}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
            >
              <Plus size={15} /> Novo Fluxo
            </button>
          </div>

          <div className="space-y-3">
            {flows.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">
                <GitBranch size={32} className="mx-auto mb-2 opacity-30" />
                Nenhum fluxo criado ainda.
              </div>
            )}
            {flows.map((flow) => (
              <div
                key={flow.id}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between hover:border-brand-300 transition-colors cursor-pointer"
                onClick={() => openFlow(flow)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{flow.name}</p>
                    {flow.active && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">Ativo</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">v{flow.version} · atualizado em {new Date(flow.updatedAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  // ─── Editor de fluxo ────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="flex flex-col h-screen">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
              <ArrowLeft size={16} />
            </button>
            <div>
              <p className="font-semibold text-sm text-gray-900">{selected.name}</p>
              <p className="text-[10px] text-gray-400">v{selected.version}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Adicionar nó */}
            <select
              onChange={(e) => { if (e.target.value) { addNode(e.target.value); e.target.value = ''; } }}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="">+ Nó</option>
              {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <button
              onClick={() => setShowSim((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ${showSim ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              <Play size={12} /> Simular
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Salvar
            </button>

            <button
              onClick={handlePublish}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {publishing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Publicar
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Canvas */}
          <div
            ref={canvasRef}
            className="flex-1 relative bg-gray-100 overflow-auto"
            style={{ backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)', backgroundSize: '24px 24px' }}
            onClick={() => setSelNode(null)}
          >
            {Object.entries(nodes).map(([id, node]) => (
              <FlowNode
                key={id}
                nodeId={id}
                node={node}
                selected={selectedNode === id}
                onSelect={setSelNode}
                onDrag={startDrag}
              />
            ))}
          </div>

          {/* Painel lateral */}
          {(selectedNode || showSim) && (
            <div className="w-72 border-l border-gray-200 bg-white flex-shrink-0 overflow-hidden flex flex-col">
              {showSim
                ? <FlowSimulator flowId={selected.id} onClose={() => setShowSim(false)} />
                : <NodeEditor
                    nodeId={selectedNode}
                    node={nodes[selectedNode]}
                    onChange={updateNode}
                    onDelete={() => deleteNode(selectedNode)}
                  />
              }
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
```

---

### Task 9: Registrar rota /flows e atualizar sidebar

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Adicionar rota /flows em App.jsx**

```javascript
import Flows from './pages/Flows.jsx';
```

```jsx
<Route path="/flows" element={<PrivateRoute><Flows /></PrivateRoute>} />
```

- [ ] **Step 2: Adicionar item na sidebar em Layout.jsx**

Adicionar ao import do lucide-react: `GitBranch`

Adicionar ao `NAV_ITEMS`:
```javascript
{ to: '/flows', label: 'Fluxos', icon: GitBranch },
```

- [ ] **Step 3: Verificar que o frontend compila**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR\frontend" && npm run build 2>&1 | tail -5
```

Resultado esperado: `built in X.XXs` sem erros.

- [ ] **Step 4: Commit da Fase 3**

```bash
cd "C:\Users\Meu Computador\PROJETO VICTOR" && git add -A && git commit -m "feat(fase3): Flow Engine definitivo — editor visual, lead scoring, follow-up, campanhas, A/B test"
```
