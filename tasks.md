# Ticket-Manager — Tarefas de alto nível

Atualizado: 2026-07-19

## Legenda

- `[x]` feito
- `[ ]` pendente

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

### 3.2 Licença e README
- [x] `LICENSE` proprietária (proíbe cópia/venda/redistribuição sem autorização)
- [x] `package.json` → `"license": "SEE LICENSE IN LICENSE"`
- [x] `README.md` completo (stack, env, Azure, SystemConfig, IA, deploy, troubleshooting)

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

### 4.2 Smoke
- [x] App respondendo na porta **9120**
- [ ] (Opcional) Smoke sync Teams/Exchange pós-deploy e checar logs AI

---

## 5. Próximos passos (backlog)

- [ ] Agendar sync periódico (cron/PM2 ou job interno) usando `sync_interval_minutes`
- [ ] Hardening auth Admin (sessão/roles) se ainda houver gaps
- [ ] Observabilidade: health endpoint dedicado + alertas PM2
- [ ] Documentar runbook de rotação de `MS_GRAPH_CLIENT_SECRET` e Gemini key
- [ ] Testes E2E (Playwright) para login Admin + sync + approve

---

## Referência rápida do ambiente

| Item | Valor |
|------|-------|
| Host | `vm.groupabz.com` |
| User | `caio` |
| Path | `/home/caio/ticket-manager` |
| PM2 | `ticket-manager` |
| Porta | `9120` |
| Contas monitoradas | `caio.correia@groupabz.com`, `suporte@groupabz.com` |
