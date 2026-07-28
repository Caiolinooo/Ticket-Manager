# Ticket-Manager — Tarefas de alto nível

Atualizado: 2026-07-28

## Legenda

- `[x]` feito
- `[ ]` pendente

---

## 9. Feature Técnicos (multi-operador)

### Contexto avaliado (Foundation)

| Área | Estado atual |
|------|----------------|
| **Auth** | Operador: `SupportUser` local (roles `ADMIN` \| `AGENT`) + cookie JWT `session` (SHA-256 senha). Cliente: Portal/EmployeeHub → role `EMPLOYEE`. Soft-SSO via `abzToken`. |
| **SystemConfig** | Key/value em `ticket_support.SystemConfig` — IA (`ai_provider`, keys) + integração (`monitored_accounts`, sync flags). CRUD só ADMIN em `/api/settings`. |
| **monitored_accounts** | String CSV global no SystemConfig; `microsoft.ts` lê e sincroniza Teams/Exchange dessas caixas (setor compartilhado). |
| **Teams/Exchange sync** | On-demand via `/api/integrations/*`; agrupa em `ExternalTrace` PENDING; approve → Ticket. |
| **Tickets/KPI** | Admin UI: tickets, pending, KPIs; assignees via `/api/users` (ADMIN+AGENT). Sem filtro por técnico ainda. |

### Decisão de modelo (Foundation)

- **Estender `SupportUser`** (sem tabela Technician separada).
- Role nova: **`TECHNICIAN`** (distinta de `ADMIN`; `AGENT` permanece legado).
- Listas em colunas TEXT com JSON `string[]`; `receiveMode` + `active` no próprio user.

#### Contrato final (campos)

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid | PK SupportUser |
| `name` | string | espelhado do Portal |
| `email` | string unique | login = e-mail do Portal |
| `passwordHash` | string | marcador `portal-auth` (senha no Portal bcrypt) |
| `portalUserId` | string? | id em `public.users_unified` |
| `authSource` | `"portal"` \| `"local"` | técnicos novos = portal |
| `role` | `"TECHNICIAN"` | |
| `monitoredEmails` | `string[]` (JSON TEXT) | caixas Exchange do técnico |
| `monitoredTeamsAccounts` | `string[]` (JSON TEXT) | UPNs/contas Teams |
| `receiveMode` | `SHARED_WITH_ADMIN` \| `OWN_ONLY` | default efetivo: SHARED_WITH_ADMIN |
| `active` | boolean | default `true`; DELETE API = soft deactivate |

**receiveMode**
- `SHARED_WITH_ADMIN`: pendências das contas do técnico **+** contas compartilhadas do admin/setor (`SystemConfig.monitored_accounts`)
- `OWN_ONLY`: só `monitoredEmails` / `monitoredTeamsAccounts` dele

#### API (ADMIN only)

- `GET/POST /api/settings/technicians` (POST: `{ portalUserId \| email, … }` — sem senha)
- `GET /api/settings/technicians/portal-users?q=` — busca Portal
- `GET/PATCH/DELETE /api/settings/technicians/[id]` (DELETE → `active=false`)

### 9.1 Foundation (este agente) — schema + settings UI/API
- [x] Avaliar auth / SystemConfig / sync / KPI e documentar acima
- [x] Schema Prisma: campos technician em `SupportUser`
- [x] Migration SQL + `scripts/add-technician-fields.mjs`
- [x] API `/api/settings/technicians` (+ `[id]`) com validação de e-mail
- [x] UI Admin → Configurações → seção **Técnicos** (CRUD / ativar-desativar)
- [x] Aplicar colunas no DB (local + server compartilham Supabase)
- [x] Login operador aceitar `TECHNICIAN` (Auth + Routing)
- [x] Commit `feat(technicians): schema and settings UI`

### 9.2 Routing + KPI unificado (v1.3.0)
- [x] `accountUpn` em `ExternalTrace` + `Ticket` (migration + script)
- [x] Sync Graph: união `monitored_accounts` admin ∪ emails/Teams de técnicos ativos
- [x] Stamp `accountUpn` na coleta + grouping + approve
- [x] Filtro pendências/tickets por `receiveMode` (OWN_ONLY / SHARED_WITH_ADMIN)
- [x] KPI `/api/kpi` + export: **sempre setor inteiro** (ADMIN ≡ TECHNICIAN)
- [x] Auth matrix: `permissions.ts`, gates, login TECHNICIAN
- [x] Smoke `scripts/smoke-technician-routing.mjs` (+ auth smoke)
- [x] Bump `1.3.0` + tag + deploy

### 9.3 Auth / UX operadores
- [x] Tratar `TECHNICIAN` como operador no login (`area=admin`) e guards de API
- [x] Incluir TECHNICIAN em listas de assignee (`/api/users`)

### 9.4 Técnicos via Portal (v1.3.1)
- [x] `portalUserId` + `authSource` em `SupportUser` (migration + script)
- [x] `GET /api/settings/technicians/portal-users?q=` — busca `users_unified` (sem hash)
- [x] `POST /api/settings/technicians` cria TECHNICIAN a partir do Portal (sem senha local)
- [x] Login operador TECHNICIAN: bcrypt Portal; ADMIN local SHA-256 preservado
- [x] UI: search box Portal + config (emails/Teams/receiveMode/active)
- [x] Smoke portal-technician + bump `1.3.1` + tag + deploy

---

## 0b. Hotfix — login loop (cookie Secure em HTTP) — v1.2.2

### Causa
- `setSessionCookie` usava `secure: NODE_ENV === 'production'`.
- `next start` força `NODE_ENV=production`, então Set-Cookie vinha com `Secure`.
- App serve em `http://…:9120` (sem HTTPS) → browser **não grava** o cookie `session`.
- Login API 200 + redirect → `/me` 401 → volta ao login (loop Cliente e Operador).
- Soft-SSO sem `abzToken` respondia 401 e poluía o console.

### Fix
- [x] `shouldUseSecureCookies()` — Secure só com HTTPS / `TM_COOKIE_SECURE=true`
- [x] SSO sem token → `200 { skipped: true }` (não 401)
- [x] Login UI: SSO só se houver cookie portal; `credentials: 'include'`; autocomplete
- [x] Smoke `scripts/smoke-auth-cookie.mjs`
- [x] Bump `1.2.2` + tag + deploy

### Evidência
- curl login: Set-Cookie **sem** `Secure` em HTTP
- `/api/auth/me` com cookie → 200

---

## 0. Hotfix — Ticket.resolution (produção)

### Causa
- Schema Prisma já tinha `Ticket.resolution String?`, mas o PostgreSQL (`ticket_support."Ticket"`) não tinha a coluna.
- `POST /api/integrations/approve` chama `prisma.ticket.create()` → Prisma Client exige a coluna → erro em produção.

### Fix
- [x] Confirmar campo no `prisma/schema.prisma`
- [x] SQL: `ALTER TABLE "ticket_support"."Ticket" ADD COLUMN IF NOT EXISTS "resolution" TEXT`
- [x] Migration no repo: `prisma/migrations/20260719_add_ticket_resolution/migration.sql`
- [x] Script auxiliar: `scripts/add-ticket-resolution-column.mjs` (aplica + valida via information_schema)
- [x] Coluna aplicada no DB (Supabase compartilhado local/server)
- [x] Bump `1.0.2` + tag `v1.0.2` + deploy

### Evidência esperada
- `information_schema`: `resolution` = `text`, `is_nullable` = `YES`
- Approve não deve mais falhar com "column Ticket.resolution does not exist"

---

## 1. Coleta Microsoft Graph (Email + Teams)

### 1.1 Credenciais e token
- [x] Alinhar `.env` local com Graph (`MS_GRAPH_*`)
- [x] Alinhar `.env` do server (`/home/caio/ticket-manager`) — sem overwrite desnecessário
- [x] Validar `client_credentials` (HTTP 200)
- [x] Strip de aspas em env vars (`microsoft.ts`)

### 1.2 Email (Exchange)
- [x] Sync inbox com `Mail.Read`
- [x] Propagar erros Graph na rota `/api/integrations/exchange` (HTTP 502 se falha)
- [x] Admin UI: contagens + avisos

### 1.3 Teams
- [x] Propagar erros Graph na rota `/api/integrations/teams`
- [x] Admin Consent + roles Chat/Channel/Team no token
- [x] Sync criando ExternalTrace `TEAMS`
- [ ] (Opcional) Automatizar sync por `sync_interval_minutes` (hoje é on-demand)

---

## 2. Triagem IA

### 2.1 Prioridade de provedores
- [x] Gemini-first quando houver key (env ou SystemConfig)
- [x] Custom AI como fallback (timeout 8s, reject HTML)
- [x] Mock como último recurso
- [x] Smoke: inject Teams → análise Gemini (não mock)

### 2.2 Operação / qualidade
- [ ] Corrigir Custom AI na VM (`/v1/chat/completions` devolvendo HTML)
- [ ] Definir `GEMINI_API_KEY` no `.env` do server (opcional; DB já tem key)
- [ ] Avaliar modelos Gemini estáveis em produção

---

## 3. Git, versionamento e documentação

### 3.1 Repositório
- [x] `git init` no workspace
- [x] `.gitignore` sólido (`.env`, `node_modules`, `.next`, logs, secrets, DBs, zips)
- [x] `.env.example` sem secrets
- [x] Versão semântica `1.0.0` no `package.json`
- [x] Commit inicial/principal v1.0.0
- [x] Tag `v1.0.0`
- [x] Repo remoto GitHub **privado** + push branch + tag
- [x] Bump patch `1.0.1` + limpeza de branding organizacional
- [x] Tag `v1.0.1` + push
- [x] Bump patch `1.0.2` + fix coluna `Ticket.resolution`
- [x] Tag `v1.0.2` + push
- [x] Bump minor `1.1.0` — agrupamento Teams + IA auditoria
- [x] Tag `v1.1.0` + push
- [x] Bump minor `1.2.0` — auth client EmployeeHub/Portal
- [x] Tag `v1.2.0` + push
- [x] Patch `1.2.1` — aba Cliente/Operador no login (`area`)
- [x] Tag `v1.2.1` + push
- [x] Patch `1.2.2` — cookie session sem Secure em HTTP (login loop)
- [x] Tag `v1.2.2` + push
- [x] Bump minor `1.3.0` — técnicos: routing + KPI unificado
- [x] Tag `v1.3.0` + push
- [x] Bump patch `1.3.1` — técnicos via Portal (search + login bcrypt)
- [x] Tag `v1.3.1` + push

### 3.2 Licença e README
- [x] `LICENSE` proprietária (proíbe cópia/venda/redistribuição sem autorização)
- [x] `package.json` → `"license": "SEE LICENSE IN LICENSE"`
- [x] `README.md` completo (stack, env, Azure, SystemConfig, IA, deploy, troubleshooting)
- [x] Remover referências de branding organizacional (autor = Caio Correia apenas)
- [x] Defaults de demo com placeholders (`user@example.com`), não e-mails de organização

### 3.3 Tasks
- [x] Subdividir `tasks.md` em checklist com status

---

## 4. Deploy servidor Linux

### 4.1 Sync e build
- [x] Sync código local → `/home/caio/ticket-manager` (rsync, preservar `.env`)
- [x] `npm install` (se necessário)
- [x] `npx prisma generate`
- [x] `npm run build`
- [x] `pm2 restart ticket-manager`
- [x] Redeploy pós-limpeza de branding (v1.0.1)
- [x] Redeploy pós-fix `Ticket.resolution` (v1.0.2)
- [x] Redeploy v1.1.0 (agrupamento + Direct Fix auditoria)
- [x] Redeploy v1.3.1 (técnicos Portal auth)

### 4.2 Smoke
- [x] App respondendo na porta **9120** (`/` e `/admin` → HTTP 200)
- [x] PM2 `ticket-manager` online
- [x] Coluna `Ticket.resolution` presente no DB (approve desbloqueado)
- [ ] (Opcional) Smoke sync Teams/Exchange pós-deploy e checar logs AI

---

## 5. Branding / autoria (concluído)

- [x] Remover branding organizacional de LICENSE, README, package.json, UI, seeds, defaults e export
- [x] Copyright e author somente **Caio Correia**
- [x] Fallbacks de contas monitoradas → `user@example.com` (config real permanece no banco/Admin)
- [x] Filename de export Excel sem prefixo organizacional
- [x] Docs de deploy sem enfatizar marca de host (descrever como servidor Linux)

---

## 7. Inteligência — agrupamento + triagem + Direct Fix (v1.1.0)

### Problema
- Sync Teams gerava 1 pendência por mensagem (mesmo chat/pessoa em segundos = N cards).
- Direct Fix gerava texto longo/genérico (LGPD, passos inventados).
- Faltava distinguir continuação do mesmo atendimento vs atendimento novo.

### 7.1 Agrupamento / contexto
- [x] `conversationId` + `memberIds` em `ExternalTrace` (schema + migration + script SQL)
- [x] Coleta Teams/Exchange preenche `conversationId` (chatId / canal / email+assunto)
- [x] `src/lib/trace-grouping.ts`: cluster por chat + remetente + janela 45 min
- [x] Concatenar histórico no `rawContent` (`[Contexto agrupado — N mensagem(ns)]`)
- [x] Upsert/merge em `PENDING_APPROVAL` aberto do mesmo chat/thread
- [x] Rotas Teams/Exchange usam `processMessageBatch` / `upsertGroupedTrace`
- [x] Approve gera ticket com contexto agrupado completo
- [x] Smoke unitário: `scripts/smoke-trace-grouping.mjs` (2 msgs → 1 cluster)
- [x] Smoke remoto: `scripts/remote-smoke-grouping-inject.mjs` (2 msgs → 1 PENDING com contexto concatenado)

### 7.2 Triagem IA
- [x] `analyzeIncomingMessage` com `isContinuation` + contexto de pendência existente
- [x] Prompt pede classificação continuação vs novo com base no thread completo
- [x] Mock alinhado aos novos campos

### 7.3 Direct Fix (auditoria)
- [x] Prompt reescrito: relatório técnico curto (resumo / evidências / causa / ações / status)
- [x] Proibir inventar sistemas/LGPD; marcar "a confirmar" sem evidência
- [x] Mock audit-style (sem boilerplate genérico antigo)
- [x] Log `[AI/fix] mode=audit-report`

### 7.4 Entrega
- [x] Bump `1.1.0`
- [x] Commit + tag + push
- [x] Deploy server (rsync, migrate cols, build, pm2)

---

## 8. Auth Client ↔ EmployeeHub / Portal (v1.2.0)

### Descoberta
- [x] EmployeeHub: login em `/api/auth/login` → bcrypt em `public.users_unified` → JWT cookie `abzToken` (`JWT_SECRET`)
- [x] TM antigo: `SupportUser` + cookie `session` base64 (inseguro)
- [x] Mesmo Postgres Supabase (schemas `public` + `ticket_support`)

### Implementação
- [x] `src/lib/portal-auth.ts` — validar e-mail/senha / JWT do Portal
- [x] `src/lib/auth.ts` — sessão JWT assinada (`TM_SESSION_SECRET` ou `JWT_SECRET`)
- [x] Login: ADMIN/AGENT local; client via Portal
- [x] Soft-SSO `POST /api/auth/sso` (cookie `abzToken` ou Bearer)
- [x] Upsert `SupportUser` EMPLOYEE ao logar pelo Portal
- [x] UI login: hint Portal + auto-check sessão/SSO + abas Cliente/Operador
- [x] `.env.example` + README (sem secrets)
- [x] Smoke `scripts/smoke-portal-auth.mjs` + `remote-smoke-portal-login.mjs`
- [x] Deploy server: `JWT_SECRET` alinhado ao Portal + build + pm2
- [x] Validar login client com usuário real do Portal (`area=client`)

---

## 9b. Técnicos — login operador + permissões (AUTH) — integrado em 1.3.0

### Objetivo
- [x] Role `TECHNICIAN` (SupportUser) — login pela aba **Operador**
- [x] JWT/cookie claims com `role: TECHNICIAN | ADMIN` (AGENT = alias legado)
- [x] Matriz: TECHNICIAN vê/atualiza tickets e pendências; **não** settings, CRUD técnicos, sync Graph
- [x] Hooks `canAccessTicket` / routing por mailbox (`receiveMode`)
- [x] Guards em `/admin`, tickets, approve/ignore, settings, sync
- [x] Smoke `scripts/smoke-technician-auth.mjs`
- [x] Deploy / version bump via release Routing 1.3.0

### Matriz ADMIN vs TECHNICIAN

| Capacidade | ADMIN | TECHNICIAN |
|------------|:-----:|:----------:|
| Login operador (`area=admin`) | sim | sim |
| Fila de tickets / update / mensagens | sim | sim* |
| Pendências approve/ignore | sim | sim* |
| KPIs / export | sim | sim (setor unificado) |
| Configurações de sistema | sim | não |
| CRUD de técnicos | sim | não |
| Sync Microsoft (Teams/Exchange) | sim | não |

\* filtrado por `receiveMode` + `accountUpn`: `OWN_ONLY` = contas do técnico; `SHARED_WITH_ADMIN` = contas dele ∪ admin

---

## 6. Próximos passos (backlog)

- [ ] Agendar sync periódico (cron/PM2 ou job interno) usando `sync_interval_minutes`
- [ ] Hardening auth Admin (sessão/roles) se ainda houver gaps
- [ ] Observabilidade: health endpoint dedicado + alertas PM2
- [ ] Documentar runbook de rotação de `MS_GRAPH_CLIENT_SECRET` e Gemini key
- [ ] Testes E2E (Playwright) para login Admin + sync + approve
- [ ] (Opcional) Anexar follow-up a Ticket OPEN existente (além de PENDING ExternalTrace)

---

## Referência rápida do ambiente

| Item | Valor |
|------|-------|
| Host | servidor Linux do mantenedor |
| User | `caio` |
| Path | `/home/caio/ticket-manager` |
| PM2 | `ticket-manager` |
| Porta | `9120` |
| Contas monitoradas | configurar no Admin (`monitored_accounts`) — ex. placeholder `user@example.com` |
| Técnicos | Admin → Configurações → Técnicos (`SupportUser` role `TECHNICIAN`) |
| KPI | sempre agregação do setor (`/api/kpi`, export) — não silos por técnico |
