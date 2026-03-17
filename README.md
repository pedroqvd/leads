# Mini CRM — Sistema de Gestão de Leads

Sistema completo de captura e gestão de leads comerciais com Landing Page pública,
painel administrativo protegido por JWT e API REST.

---

## Estrutura de pastas

```
mini-crm/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # Schema do banco SQLite
│   ├── src/
│   │   ├── lib/
│   │   │   └── prisma.js        # Cliente Prisma singleton
│   │   ├── middleware/
│   │   │   └── auth.js          # Middleware JWT
│   │   └── routes/
│   │       ├── auth.js          # POST /auth/login, GET /auth/me
│   │       └── leads.js         # CRUD de leads + exportação CSV
│   ├── app.js                   # Servidor Express principal
│   ├── .env.example             # Variáveis de ambiente (copie para .env)
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── context/
    │   │   └── AuthContext.jsx  # Estado de autenticação global
    │   ├── pages/
    │   │   ├── LandingPage.jsx  # Página pública de captura
    │   │   ├── Login.jsx        # Tela de login
    │   │   └── Dashboard.jsx    # Painel administrativo
    │   ├── services/
    │   │   └── api.js           # Cliente Axios configurado
    │   ├── App.jsx              # Rotas e guards de autenticação
    │   ├── main.jsx
    │   └── index.css            # Tailwind + classes utilitárias
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── package.json
```

---

## Pré-requisitos

- **Node.js** >= 18
- **npm** >= 9

---

## Setup — Backend

```bash
cd backend

# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env e altere JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD

# 3. Criar o banco de dados e gerar o cliente Prisma
npm run db:push

# 4. Iniciar o servidor em modo desenvolvimento
npm run dev
# → http://localhost:3001
```

> Para visualizar o banco no browser: `npm run db:studio`

---

## Setup — Frontend

```bash
cd frontend

# 1. Instalar dependências
npm install

# 2. Iniciar em modo desenvolvimento
npm run dev
# → http://localhost:5173
```

> O Vite está configurado com proxy: todas as chamadas para `/api` são
> redirecionadas para `http://localhost:3001` automaticamente.

---

## Credenciais padrão

| Campo  | Valor             |
|--------|-------------------|
| E-mail | admin@minicrm.com |
| Senha  | Admin@123         |

> **Importante:** Altere esses valores no arquivo `.env` antes de qualquer deploy.

---

## API Reference

### Autenticação

| Método | Rota            | Descrição                  | Auth  |
|--------|-----------------|----------------------------|-------|
| POST   | `/api/auth/login` | Login, retorna JWT        | ✗     |
| GET    | `/api/auth/me`    | Valida token, retorna user | Bearer|

### Leads

| Método | Rota                  | Descrição                     | Auth   |
|--------|-----------------------|-------------------------------|--------|
| POST   | `/api/leads`          | Cria lead (Landing Page)      | ✗      |
| GET    | `/api/leads`          | Lista leads com paginação     | Bearer |
| PATCH  | `/api/leads/:id`      | Atualiza status/notas         | Bearer |
| DELETE | `/api/leads/:id`      | Remove lead                   | Bearer |
| GET    | `/api/leads/export`   | Exporta CSV com filtros       | Bearer |

#### Query params — GET /api/leads

| Param      | Tipo   | Default     | Descrição                              |
|------------|--------|-------------|----------------------------------------|
| page       | number | 1           | Página atual                           |
| limit      | number | 20          | Itens por página (máx. 100)            |
| search     | string | —           | Busca em nome ou e-mail                |
| status     | string | —           | Filtro: Novo, Em Contato, Convertido, Perdido |
| sortBy     | string | createdAt   | Coluna de ordenação                    |
| sortOrder  | string | desc        | asc ou desc                            |

---

## Status dos Leads

| Status      | Descrição                              |
|-------------|----------------------------------------|
| Novo        | Lead recém-capturado (padrão)          |
| Em Contato  | Equipe já abordou o lead               |
| Convertido  | Lead virou cliente                     |
| Perdido     | Lead descartado sem conversão          |

---

## Funcionalidades

### Landing Page
- Hero com headline de conversão e formulário inline
- Validação de campos no frontend e backend
- Idempotência: e-mails duplicados retornam sucesso sem erro
- Rate limiting: máx. 8 submissões por IP a cada 15 min
- Depoimentos e seção de benefícios
- CTA scrollável no rodapé

### Login
- Autenticação com JWT (8h de validade por padrão)
- Proteção contra brute-force (10 tentativas/10 min por IP)
- Redirecionamento automático se já autenticado

### Dashboard
- Cards com totais: leads, em contato, convertidos, perdidos
- Tabela com busca em tempo real (debounce 350ms)
- Filtro por status
- Ordenação por coluna (nome, e-mail, status, data)
- Alteração de status inline com select
- Exclusão com confirmação
- Exportação CSV com BOM UTF-8 (compatível com Excel)
- Paginação server-side
- Sessão restaurada automaticamente via localStorage

---

## Build para produção

```bash
# Frontend
cd frontend && npm run build
# Saída: frontend/dist/

# Backend — configure NODE_ENV=production no .env
cd backend && npm start
```
