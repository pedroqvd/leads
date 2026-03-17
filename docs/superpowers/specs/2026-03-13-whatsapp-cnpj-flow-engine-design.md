# Design Spec: WhatsApp Automation + CNPJ Extrator + Flow Engine
**Data:** 2026-03-13
**Projeto:** Mini-CRM (React + Vite + Express + Prisma/SQLite)
**Abordagem:** Modular sequencial — 3 fases independentes

---

## Contexto

O Mini-CRM já possui: autenticação JWT, dashboard de leads com UTMs, Meta CAPI, analytics, extrator de leads via landing page, integração com Meta/Google/Webhook via Settings.

Este spec define 3 novos módulos:
1. **Extrator de CNPJ** — prospecção em massa de empresas via dados públicos
2. **WhatsApp Core** — integração com Evolution API, QR code, envio manual, histórico
3. **Flow Engine** — chatbot de vendas com árvore de decisão, lead scoring, campanhas, A/B test

---

## Arquitetura Geral

### Stack (sem alterações)
- **Frontend:** React + Vite (porta 5173) + Tailwind CSS + React Router v6
- **Backend:** Express.js (porta 3001) + Prisma ORM + SQLite
- **Banco:** SQLite via Prisma (arquivo `dev.db`)
- **Auth:** JWT (já implementado)

### Autenticação nos novos endpoints
**Regra:** Todos os novos endpoints são protegidos pelo middleware `auth` existente — **exceto** `POST /api/whatsapp/webhook`, que é público por necessidade (Evolution API envia eventos sem JWT).

A segurança do webhook é garantida por validação de segredo (ver seção Webhook abaixo).

### Suporte a múltiplas instâncias WhatsApp
O sistema suporta **múltiplas instâncias** (ex: número de vendas + número de suporte). Cada instância tem seu próprio `WaInstance`. O operador seleciona qual instância usar ao iniciar uma conversa ou campanha. A instância padrão é a marcada como `isDefault=true`.

### Paginação padrão
Todos os endpoints de listagem aceitam `?page=1&limit=20`. A resposta inclui `{ data: [...], total, page, limit, pages }`.

---

## Novos modelos Prisma

```prisma
// fix #8: resultados separados em model próprio para evitar JSON gigante em um campo
model CnpjImport {
  id          Int               @id @default(autoincrement())
  name        String
  status      String            @default("pending") // pending | processing | done | error
  total       Int               @default(0)
  processed   Int               @default(0)
  imported    Int               @default(0)
  errors      Int               @default(0)
  filters     String            @default("{}") // JSON: {cnae, estado, cidade, porte}
  results     CnpjImportResult[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
}

model CnpjImportResult {
  id          Int        @id @default(autoincrement())
  importId    Int
  cnpj        String
  razaoSocial String
  nomeFantasia String?
  cnae        String?
  situacao    String?
  porte       String?
  telefone    String?
  email       String?
  municipio   String?
  uf          String?
  socios      String?    // JSON array
  asLead      Boolean    @default(false) // true = já importado como lead
  import      CnpjImport @relation(fields: [importId], references: [id], onDelete: Cascade)
  createdAt   DateTime   @default(now())
}

// fix #6: suporta múltiplas instâncias
model WaInstance {
  id           Int      @id @default(autoincrement())
  instanceName String   @unique
  apiUrl       String
  apiKey       String
  webhookSecret String  // fix #1: segredo para validar eventos recebidos
  status       String   @default("disconnected") // connected | disconnected | connecting
  isDefault    Boolean  @default(false)
  label        String?  // ex: "Vendas", "Suporte"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// fix #5: removida constraint @unique de leadId — uma conversa ativa por lógica, não por DB
model WaConversation {
  id           Int        @id @default(autoincrement())
  leadId       Int
  instanceId   Int
  phone        String
  flowId       Int?
  flowVersion  Int?
  nodeId       String     @default("start")
  status       String     @default("bot")  // bot | human | closed
  optOut       Boolean    @default(false)
  score        Int        @default(0)
  assignedTo   String?
  tags         String     @default("[]")
  variables    String     @default("{}")
  lead         Lead       @relation(fields: [leadId], references: [id])
  messages     WaMessage[]
  // fix #4: scheduled messages para follow-up
  scheduled    WaScheduledMessage[]
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

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

// fix #4: persistência de follow-ups agendados (sobrevive a restart do servidor)
model WaScheduledMessage {
  id             Int            @id @default(autoincrement())
  conversationId Int
  nodeId         String
  message        String
  scheduledFor   DateTime       // quando deve ser enviada
  sent           Boolean        @default(false)
  cancelled      Boolean        @default(false)
  conversation   WaConversation @relation(fields: [conversationId], references: [id])
  createdAt      DateTime       @default(now())

  @@index([scheduledFor, sent, cancelled])
}

model WaFlow {
  id           Int      @id @default(autoincrement())
  name         String
  description  String?
  active       Boolean  @default(false)
  version      Int      @default(1)
  nodes        String   @default("{}")
  triggers     String   @default("[]") // JSON: ["Meta Ads", "Orgânico"]
  workingHours String   @default("{}") // JSON: {start:"08:00",end:"18:00",days:[1,2,3,4,5],holidays:[]}
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
  status         String   @default("draft") // draft | scheduled | running | done | cancelled
  scheduledAt    DateTime?
  sentCount      Int      @default(0)
  repliedCount   Int      @default(0)
  convertedCount Int      @default(0)
  rateLimit      Int      @default(30)      // msgs por hora
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, scheduledAt])
}

// fix #9: status, datas e endpoint de encerramento adicionados
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
  winner     String?  // "A" | "B" | null
  status     String   @default("running") // running | ended
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  createdAt  DateTime @default(now())
}
```

### Alteração no modelo Lead
```prisma
// Adicionar ao model Lead:
waConversations WaConversation[]   // fix #5: plural, pois não há mais @unique
score           Int      @default(0)
tags            String   @default("[]")
optOut          Boolean  @default(false)
cnpj            String?
cargo           String?
empresa         String?
```

---

## Fase 1 — Extrator de CNPJ

### Fontes de dados públicas (gratuitas)
| Fonte | Endpoint | Uso |
|---|---|---|
| cnpj.ws | `https://publica.cnpj.ws/cnpj/{cnpj}` | Busca individual — primária |
| BrasilAPI | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` | Fallback individual |
| ReceitaWS | `https://receitaws.com.br/v1/cnpj/{cnpj}` | Segundo fallback |

**Nota sobre prospecção em massa:** APIs públicas não oferecem filtro por CNAE+cidade. A solução é: o usuário fornece lista de CNPJs (via upload de CSV ou colagem), e o sistema enriquece automaticamente cada um via API. Para obtenção de listas brutas de CNPJs, o usuário pode usar os arquivos abertos da Receita Federal (dados.rfb.gov.br) ou outras fontes públicas.

### Endpoints backend `/api/cnpj/*` (todos autenticados via JWT)
```
GET    /api/cnpj/lookup/:cnpj              → busca individual, retorna dados da empresa
POST   /api/cnpj/imports                   → inicia importação em lote (CNPJs + filtros)
GET    /api/cnpj/imports?page&limit        → lista importações (paginado)
GET    /api/cnpj/imports/:id               → status/progresso + resultados (paginado)
GET    /api/cnpj/imports/:id/results?page&limit&uf&porte → resultados filtrados
POST   /api/cnpj/imports/:id/leads         → importa empresas selecionadas como leads
DELETE /api/cnpj/imports/:id               → deleta importação e resultados
```

### Serviço `cnpjEnricher.js`
- Tenta `cnpj.ws` → fallback `BrasilAPI` → fallback `ReceitaWS`
- Rate limiting: max 3 req/s (token bucket — evita bloqueio das APIs)
- Retorna campos normalizados: `{ cnpj, razaoSocial, nomeFantasia, cnae, cnaePrincipal, situacao, porte, telefone, email, logradouro, municipio, uf, socios }`
- Processa CNPJs em fila `async` background (loop com `setImmediate`), atualiza `processed` no DB a cada item
- Em caso de erro por CNPJ: registra `CnpjImportResult` com `situacao="erro"`, incrementa `errors`, continua

### Página `/prospecting`
**Aba "Busca Unitária":**
- Campo CNPJ com máscara XX.XXX.XXX/XXXX-XX
- Botão Buscar → exibe card com dados da empresa
- Botão "Adicionar como Lead" → cria lead com `source="Prospecção CNPJ"`

**Aba "Importação em Massa":**
- Filtros para referência: CNAE (dropdown com tabela IBGE), Estado, Cidade, Porte, Situação
- Upload CSV ou textarea para colar CNPJs (um por linha)
- Botão "Iniciar Enriquecimento" → cria CnpjImport, processa em background
- Barra de progresso em tempo real (polling `GET /imports/:id` a cada 2s enquanto `status=processing`)
- Tabela de resultados paginada com checkboxes: CNPJ, Razão Social, Município, UF, Telefone, Email, CNAE, Porte
- Botão "Importar selecionados como Leads"

---

## Fase 2 — WhatsApp Core

### Integração com Evolution API
- Usuário instala Evolution API na própria infraestrutura
- No painel (Settings → aba WhatsApp): configura URL, API Key, nome da instância e `webhookSecret`
- Backend gerencia instâncias via REST da Evolution API

### Segurança do Webhook (fix #1)
O endpoint `POST /api/whatsapp/webhook` é público mas validado:
- O campo `webhookSecret` é armazenado em `WaInstance`
- Evolution API envia o header `x-webhook-secret: <valor>` em cada request
- Backend verifica `x-webhook-secret` contra o secret da instância correspondente
- Requests sem secret válido retornam `401` e são logados
- O secret é configurado no painel de Settings e enviado para a Evolution API no momento da criação da instância

### Fluxo de conexão
1. Usuário clica "Conectar" → backend chama `POST /instance/create` na Evolution API (inclui webhookUrl + webhookSecret)
2. Frontend faz polling `GET /api/whatsapp/instances/:id/status` a cada 3s
3. Quando estado = `connecting`, exibe QR code
4. Quando estado = `open`, exibe "Conectado ✓" e para polling

### Regra de disparo (Híbrido — opção C)
- **Automático:** leads criados pelo formulário da landing page → primeira mensagem do fluxo ativo dispara imediatamente após criação
- **Manual:** leads importados (CNPJ, CSV, criados manualmente) → botão "Iniciar conversa no WhatsApp" no Dashboard

### Endpoints backend `/api/whatsapp/*` (todos autenticados via JWT, exceto webhook)

**Instâncias:**
```
GET    /api/whatsapp/instances              → lista instâncias (paginado)
POST   /api/whatsapp/instances             → cria instância
GET    /api/whatsapp/instances/:id         → detalhe
PATCH  /api/whatsapp/instances/:id         → edita (label, rateLimit, etc.)
DELETE /api/whatsapp/instances/:id         → remove instância
POST   /api/whatsapp/instances/:id/connect    → inicia conexão
POST   /api/whatsapp/instances/:id/disconnect → desconecta
GET    /api/whatsapp/instances/:id/qr         → QR code atual (base64)
GET    /api/whatsapp/instances/:id/status     → estado atual da conexão
```

**Webhook (público, validado por secret):**
```
POST   /api/whatsapp/webhook               → recebe eventos da Evolution API
```

**Conversas:**
```
GET    /api/whatsapp/conversations?status&instanceId&page&limit → lista (paginado)
GET    /api/whatsapp/conversations/:id     → detalhe + mensagens (paginado)
POST   /api/whatsapp/conversations/:id/assign    → atribui a operador
POST   /api/whatsapp/conversations/:id/transfer  → passa para humano / devolve ao bot
POST   /api/whatsapp/conversations/:id/close     → encerra conversa
POST   /api/whatsapp/conversations/:id/message   → operador envia mensagem manual
POST   /api/whatsapp/leads/:leadId/start         → inicia conversa manual para um lead
```

### Página `/whatsapp`
**Layout em 3 colunas:**
- Coluna esquerda: lista de conversas com abas (Bot / Humano / Aguardando / Encerradas) + busca + filtros
- Coluna central: histórico de mensagens + campo de texto para operador responder
- Coluna direita: card do lead (score, status CRM, tags, notas automáticas)

---

## Fase 3 — Flow Engine Definitivo

### Motor de fluxo (backend) — `flowEngine.js`
```
processIncoming(instanceId, phone, message)
  1. busca WaConversation ativa (status != "closed") pelo phone + instanceId
  2. verifica opt-out → se true, ignora silenciosamente
  3. verifica horário de funcionamento do fluxo → se fora, executa nó offHours
  4. carrega WaFlow pela versão salva na conversa (flowVersion)
  5. carrega nó atual (nodeId)
  6. processa resposta do lead (fuzzyMatch para menus, validação para collect)
  7. executa ações do nó atual (score, tag, action, webhook, notify)
  8. avança para próximo nó
  9. envia mensagem(s) do próximo nó via evolutionApi.js
  10. persiste novo nodeId, score, tags, variáveis na conversa
  11. sincroniza campos/status no modelo Lead se nó for action/score/tag
  12. se nó for followup: cria WaScheduledMessage no DB para cada step
```

**Match fuzzy para menus:**
- Normaliza texto (remove acentos, lowercase, trim)
- Tenta match exato do número ("1", "2")
- Tenta match por palavras-chave definidas no nó
- Se sem match após `maxRetries` tentativas → envia fallback + repete menu
- Se atingir `maxRetries`: executa `onMaxRetries` (ex: transfere para humano)

### Scheduler de follow-ups e campanhas (fix #3 e #4)
**Estratégia:** `node-cron` rodando no mesmo processo Express, verificando o DB a cada minuto.

```javascript
// campaignScheduler.js
cron.schedule('* * * * *', async () => {
  // 1. Processar WaScheduledMessage vencidas (follow-ups)
  const due = await prisma.waScheduledMessage.findMany({
    where: { scheduledFor: { lte: new Date() }, sent: false, cancelled: false }
  });
  for (const msg of due) { await sendAndMark(msg); }

  // 2. Iniciar WaCampaigns agendadas
  const campaigns = await prisma.waCampaign.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } }
  });
  for (const campaign of campaigns) { await startCampaign(campaign); }
});
```

**Resiliência:** ao reiniciar o servidor, o cron encontra mensagens não enviadas (`sent=false`) com `scheduledFor` no passado e as processa imediatamente no próximo tick. Não há perda de dados.

### Tipos de nó — implementação JSON

```json
{
  "id": "node_001",
  "type": "menu",
  "content": "Como posso te ajudar? 😊",
  "options": [
    { "label": "Ver planos", "keywords": ["plano", "planos", "ver", "preço"], "next": "node_plans" },
    { "label": "Suporte", "keywords": ["ajuda", "problema", "erro", "suporte"], "next": "node_support" },
    { "label": "Falar com humano", "keywords": ["humano", "pessoa", "atendente"], "next": "node_transfer" }
  ],
  "fallback": "Não entendi. Por favor, responda com o número da opção. 😊",
  "maxRetries": 3,
  "onMaxRetries": "node_transfer"
}
```

```json
{
  "id": "node_collect_email",
  "type": "collect",
  "content": "Qual é o seu email? 📧",
  "field": "email",
  "validate": "email",
  "errorMessage": "Esse email parece inválido. Pode confirmar?",
  "saveToLead": true,
  "next": "node_score_email"
}
```

```json
{
  "id": "node_score_email",
  "type": "score",
  "points": 15,
  "reason": "Forneceu email",
  "next": "node_status_update"
}
```

```json
{
  "id": "node_ab",
  "type": "ab_test",
  "testId": "abtest_001",
  "variantA": { "content": "Olá {nome}! 👋 Posso te ajudar?" },
  "variantB": { "content": "Oi {nome}! Que bom ter você aqui! 😊" },
  "next": "node_menu"
}
```

```json
{
  "id": "node_followup",
  "type": "followup",
  "steps": [
    { "delayHours": 1,  "message": "Oi {nome}! Ficou alguma dúvida? 😊" },
    { "delayHours": 24, "message": "Olá! Ainda posso te ajudar? 🙌" },
    { "delayHours": 72, "message": "Última tentativa: ainda há interesse? Responda SIM ou NÃO." }
  ],
  "onNoResponse": "node_end"
}
```
**Follow-up — implementação:** ao processar um nó `followup`, o engine cria uma `WaScheduledMessage` por step com `scheduledFor = now() + delayHours`. O cron envia no horário correto. Se o lead responder antes, o engine cancela (`cancelled=true`) todas as mensagens pendentes da conversa.

### Endpoints de Fluxos `/api/flows/*` (todos autenticados via JWT)

**CRUD de fluxos (fix #2):**
```
GET    /api/flows?page&limit               → lista fluxos
POST   /api/flows                          → cria fluxo
GET    /api/flows/:id                      → detalhe + nodes
PATCH  /api/flows/:id                      → salva rascunho (não publica)
DELETE /api/flows/:id                      → deleta (só se não houver conversas ativas)
POST   /api/flows/:id/publish              → publica versão atual (cria WaFlowVersion)
PATCH  /api/flows/:id/rollback/:version    → rollback para versão anterior
GET    /api/flows/:id/versions             → lista versões
POST   /api/flows/:id/simulate             → simula sem enviar mensagem real
GET    /api/flows/:id/analytics?days       → métricas do fluxo
```

**A/B Tests (fix #9):**
```
GET    /api/flows/:id/abtests              → lista testes do fluxo
POST   /api/flows/:id/abtests             → cria teste
GET    /api/flows/:id/abtests/:testId      → detalhe + stats
POST   /api/flows/:id/abtests/:testId/end  → encerra teste e declara vencedor
DELETE /api/flows/:id/abtests/:testId      → deleta teste (só se ended)
```

### Campanhas de Broadcast `/api/whatsapp/campaigns/*` (todos autenticados)
```
GET    /api/whatsapp/campaigns?page&limit  → lista (paginado)
POST   /api/whatsapp/campaigns             → cria campanha
GET    /api/whatsapp/campaigns/:id         → detalhe + stats
PATCH  /api/whatsapp/campaigns/:id         → edita (só draft/scheduled)
POST   /api/whatsapp/campaigns/:id/send    → dispara agora
POST   /api/whatsapp/campaigns/:id/cancel  → cancela
GET    /api/whatsapp/campaigns/:id/stats   → métricas pós-envio
```

**Segmentação:** status, source, score (min/max), tags, optOut=false, createdAt (range), instanceId

**Anti-spam:**
- Rate limit: padrão 30 msgs/hora (configurável)
- Intervalo aleatório entre envios: 2–8s
- Opt-out automático: SAIR/STOP/PARAR → `optOut=true` + cancela scheduled

### Versionamento
- `POST /api/flows/:id/publish` → cria `WaFlowVersion` com snapshot dos nodes
- Conversas guardam `flowVersion` → engine carrega a versão correta mesmo após nova publicação
- Rollback: copia `nodes` da versão alvo de volta para o fluxo ativo + incrementa `version`

### Simulador
- `POST /api/flows/:id/simulate` com body `{ message: string, state: { nodeId, variables, score } }`
- Retorna `{ messages: [...], nextState: { nodeId, variables, score }, actions: [...] }`
- Stateless: frontend mantém o estado entre chamadas

### Analytics de fluxo
```json
{
  "started": 142,
  "completed": 89,
  "dropped": 53,
  "completionRate": 62.7,
  "avgDurationMs": 270000,
  "nodeStats": [
    { "nodeId": "start", "entries": 142, "exits": 140, "dropRate": 1.4 },
    { "nodeId": "collect_email", "entries": 98, "exits": 86, "dropRate": 12.2 }
  ],
  "abTests": [
    {
      "testId": "abtest_001",
      "variantA": { "count": 71, "completedRate": 58 },
      "variantB": { "count": 71, "completedRate": 67 },
      "winner": "B",
      "status": "ended"
    }
  ],
  "avgScore": 72,
  "peakHour": 10,
  "hourlyDistribution": [0,0,0,0,0,0,2,8,14,22,18,12,9,11,10,8,6,5,4,3,2,1,0,0]
}
```

### Horário de funcionamento
- Configurado por fluxo: `{ start: "08:00", end: "18:00", days: [1,2,3,4,5], holidays: ["2025-12-25"] }`
- Fora do horário: executa nó `offHours` do fluxo
- Feriados: lista de datas `YYYY-MM-DD` configurável no mesmo objeto

### Opt-out / LGPD
- Palavras-chave: SAIR, PARAR, STOP, NÃO QUERO, CANCELAR, DESCADASTRAR
- Bot responde confirmação → `optOut=true` em Lead e WaConversation → cancela todos os WaScheduledMessage pendentes
- Sistema nunca mais envia mensagens para este número

### Editor visual `/flows`
**Canvas com:**
- Drag-and-drop de nós
- Zoom / pan / mini-mapa
- Painel lateral direito: editor de propriedades do nó selecionado
- Linhas de conexão com label do caminho (ex: "opção 1", "sim", "não")
- Badge de estatísticas em cada nó (entradas / drop rate) — só visível no modo analytics
- Barra superior: [+ Nó ▼] [Templates ▼] [Simular] [Versões] [Publicar]

**Templates pré-construídos:**
1. "Qualificação de Lead" — coleta empresa, cargo, necessidade → status Qualificado
2. "Apresentação de Produto" — envia mídia → menu → follow-up
3. "Reengajamento" — pergunta interesse → sim/não → branch

### Sidebar do CRM atualizada
- **Prospecção** (`/prospecting`) — ícone de lupa/empresa
- **WhatsApp** (`/whatsapp`) — ícone WhatsApp com badge de mensagens aguardando
- **Fluxos** (`/flows`) — ícone de diagrama/árvore

---

## Sumário de novos arquivos

### Backend
```
backend/src/routes/cnpj.js
backend/src/routes/whatsapp.js
backend/src/routes/flows.js
backend/src/routes/campaigns.js
backend/src/services/cnpjEnricher.js
backend/src/services/evolutionApi.js
backend/src/services/flowEngine.js
backend/src/services/campaignScheduler.js   ← node-cron, follow-ups + campanhas
backend/src/services/fuzzyMatch.js
```

### Frontend
```
frontend/src/pages/Prospecting.jsx
frontend/src/pages/WhatsApp.jsx
frontend/src/pages/Flows.jsx
frontend/src/components/FlowCanvas.jsx
frontend/src/components/FlowNode.jsx
frontend/src/components/FlowNodeEditor.jsx
frontend/src/components/FlowSimulator.jsx
frontend/src/components/ConversationPanel.jsx
frontend/src/components/CampaignForm.jsx
```

### Prisma
```
backend/prisma/schema.prisma  (atualizado com novos modelos)
```

---

## Ordem de implementação (por fase)

### Fase 1 — CNPJ Extrator
1. Atualizar schema Prisma (CnpjImport + CnpjImportResult + campos no Lead)
2. `cnpjEnricher.js` — enriquecimento multi-fonte com fallback + rate limit
3. `cnpj.js` — todos os endpoints
4. Registrar rota em `app.js`
5. `Prospecting.jsx` — duas abas, progresso em tempo real
6. Adicionar rota `/prospecting` em `App.jsx` + item na sidebar `Layout.jsx`

### Fase 2 — WhatsApp Core
1. Atualizar schema Prisma (WaInstance + WaConversation + WaMessage + WaScheduledMessage + relação no Lead)
2. `evolutionApi.js` — wrapper REST para Evolution API
3. `whatsapp.js` — routes (instâncias, webhook com validação de secret, conversas, envio)
4. Registrar rota em `app.js`
5. Adicionar aba WhatsApp em `Settings.jsx` (instância + secret)
6. `WhatsApp.jsx` — painel 3 colunas
7. Adicionar botão "Iniciar conversa" no `Dashboard.jsx`
8. Adicionar rota e sidebar

### Fase 3 — Flow Engine
1. Atualizar schema Prisma (WaFlow, WaFlowVersion, WaCampaign, WaAbTest)
2. `fuzzyMatch.js` — normalização + match de texto
3. `flowEngine.js` — motor de processamento
4. `campaignScheduler.js` — node-cron para follow-ups e campanhas
5. `flows.js` + `campaigns.js` — routes
6. Registrar rotas em `app.js`
7. `FlowCanvas.jsx` — canvas drag-and-drop
8. `FlowNode.jsx` + `FlowNodeEditor.jsx`
9. `FlowSimulator.jsx`
10. `Flows.jsx` — página completa
11. `CampaignForm.jsx` + aba Campanhas em `/whatsapp`
12. Analytics de fluxo — nova aba em `/flows`
