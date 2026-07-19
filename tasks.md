# Ticket-Manager — Tarefas de alto nível

Atualizado: 2026-07-19

## Legenda

- `[x]` feito
- `[ ]` pendente

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
