# Ticket Manager

Sistema de gestão de tickets de suporte que coleta mensagens de **Microsoft Exchange (e-mail)** e **Microsoft Teams** via Microsoft Graph, tria com IA e organiza o fluxo de aprovação/atendimento.

**Versão:** 1.2.0  
**Autor:** Caio Correia  
**Licença:** Proprietária — ver [LICENSE](./LICENSE)

---

## Visão geral

O Ticket Manager monitora contas autorizadas, importa mensagens como *external traces*, analisa com IA (Gemini com fallback) e permite que operadores aprovem, ignorem ou convertam itens em tickets.

Principais capacidades:

- Sync de inbox Exchange (`Mail.Read`)
- Sync de chats e canais Teams (`Chat.Read.All`, `ChannelMessage.Read.All`, `Team.ReadBasic.All`)
- Triagem IA com prioridade Gemini → Custom AI → Mock
- Painel Admin (configuração, sync manual, revisão de traces)
- Persistência PostgreSQL (Prisma)

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| ORM | Prisma 7 |
| Banco | PostgreSQL (ex.: Supabase) |
| Integrações | Microsoft Graph (Azure AD app) |
| IA | Google Gemini (`@google/generative-ai`) + Custom AI opcional |
| Processo (prod) | PM2, porta **9120** |

---

## Pré-requisitos

- Node.js 20+ (recomendado)
- npm
- PostgreSQL acessível (`DATABASE_URL`)
- App Azure AD com permissões Graph + Admin Consent
- Conta com acesso ao servidor de deploy (opcional)

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha (nunca commite secrets):

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string PostgreSQL (pooler IPv4 ok); precisa acessar `public.users_unified` e `ticket_support` |
| `JWT_SECRET` | Mesmo secret do EmployeeHub/Portal — valida soft-SSO (`abzToken`) e assina sessão se `TM_SESSION_SECRET` ausente |
| `TM_SESSION_SECRET` | Opcional — secret dedicado do cookie de sessão do Ticket-Manager |
| `PORTAL_JWT_COOKIE` | Nome do cookie JWT do Portal (default `abzToken`) |
| `MS_GRAPH_CLIENT_ID` | Application (client) ID do app Azure |
| `MS_GRAPH_CLIENT_SECRET` | Client secret do app |
| `MS_GRAPH_TENANT_ID` | Directory (tenant) ID |
| `GEMINI_API_KEY` | Chave Gemini (opcional se já existir em SystemConfig) |

Configurações adicionais ficam em **SystemConfig** (banco / Admin UI), não necessariamente no `.env`.

---

## Autenticação (Admin vs Client)

| Área | Fonte de credenciais |
|------|----------------------|
| **Admin / Agent** | Tabela `ticket_support.SupportUser` (hash SHA-256 local) |
| **Client (funcionário)** | Mesmas credenciais do Portal / EmployeeHub (`public.users_unified`, bcrypt) |

Fluxo do client:

1. Login em `/` com e-mail/senha do Portal → TM valida bcrypt em `users_unified` → upsert de `SupportUser` role `EMPLOYEE` → cookie de sessão JWT (`session`).
2. Soft-SSO: se o browser já tiver o cookie JWT do Portal (`abzToken`) e `JWT_SECRET` for o mesmo, `POST /api/auth/sso` cria a sessão do client sem pedir senha de novo (só funciona se o cookie for visível no host do TM — mesmo site/domínio pai).
3. Logout limpa o cookie `session` do TM (não encerra a sessão do Portal em outro domínio).

Smoke local: `node scripts/smoke-portal-auth.mjs` (opcional: `PORTAL_TEST_EMAIL` + `PORTAL_TEST_PASSWORD`).

---

## Setup local

```bash
git clone <url-do-repo>
cd Ticket-Manager
cp .env.example .env   # edite com seus valores
npm install
npx prisma generate
npm run dev
```

App de desenvolvimento: `http://localhost:3000`  
Produção local: `npm run build && npm start` (porta **9120**).

---

## Azure AD / Microsoft Graph

Crie (ou use) um App Registration com **Application permissions** e conceda **Admin Consent**:

| Permissão | Uso |
|-----------|-----|
| `Mail.Read` | Leitura de e-mails (Exchange) |
| `Chat.Read.All` | Chats 1:1 / grupo |
| `ChannelMessage.Read.All` | Mensagens de canais |
| `Team.ReadBasic.All` | Listar times (`joinedTeams`) |

Fluxo de token: `client_credentials` contra `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` com scope `https://graph.microsoft.com/.default`.

Sem Admin Consent para Teams, o sync de e-mail pode funcionar enquanto Teams retorna **403**. As rotas de integração propagam `errors`/`warnings` e podem responder HTTP **502** quando o Graph falha.

---

## SystemConfig (Admin)

Chaves relevantes gerenciadas pela UI Admin / API `/api/settings`:

| Key | Função |
|-----|--------|
| `monitored_accounts` | Contas monitoradas (e-mails separados por vírgula) |
| `sync_since_date` | Data inicial de sync (ISO date) |
| `teams_enabled` | `true` / `false` |
| `exchange_enabled` | `true` / `false` |
| `gemini_api_key` | Chave Gemini (alternativa ao `.env`) |
| `ai_provider` | Preferência legada; **não impede** Gemini se houver key |
| `custom_ai_url` / `custom_ai_key` | Fallback OpenAI-compatible |
| `sync_interval_minutes` | Reservado (sync atual é on-demand) |

Exemplo de configuração (placeholders — configure os UPNs reais no Admin / SystemConfig):

- `monitored_accounts` = `user@example.com, support@example.com`
- `teams_enabled` / `exchange_enabled` = `true`

Os defaults de código usam `user@example.com` apenas como fallback de demo. Em produção, defina as contas reais via Admin UI (elas ficam no banco e **não** são sobrescritas pelo deploy).

---

## Prioridade de IA

Ordem fixa em `src/lib/ai.ts`:

1. **Gemini** — se existir `gemini_api_key` (SystemConfig) ou `GEMINI_API_KEY` (env), independentemente de `ai_provider=CUSTOM`
2. **Custom AI** — URL OpenAI-compatible; timeout 8s; rejeita HTML/non-JSON
3. **Mock** — heurística por palavras-chave

Modelos Gemini tentados em sequência (ex.: `gemini-3.5-flash` → `2.5` → `2.0` → `1.5` → `flash-latest`).

---

## Sync Email / Teams

Sync é **manual** via Admin (ou APIs):

| Endpoint | Função |
|----------|--------|
| `POST /api/integrations/exchange` | Sync e-mail |
| `POST /api/integrations/teams` | Sync Teams |
| `GET /api/integrations/pending` | Traces pendentes |

Respostas incluem contagens e, em falha Graph, `errors` / `warnings`.

---

## Deploy no servidor (PM2)

Ambiente de produção típico (servidor Linux):

| Item | Valor |
|------|-------|
| Host | servidor Linux do mantenedor |
| Path | `/home/caio/ticket-manager` |
| Processo PM2 | `ticket-manager` |
| Porta | `9120` |

Sync de código (exemplo com rsync, **preservando** `.env` do servidor):

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .env --exclude .git \
  ./ USER@HOST:/home/caio/ticket-manager/
```

Substitua `USER@HOST` pelo usuário e hostname SSH do seu servidor.

No servidor:

```bash
cd /home/caio/ticket-manager
npm install
npx prisma generate
npm run build
pm2 restart ticket-manager
# ou: pm2 start npm --name ticket-manager -- start
pm2 status
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9120/
```

O script `npm start` já sobe em `-p 9120`.

---

## Estrutura relevante

```
src/
  app/
    admin/                 # Painel administrativo
    client/                # Área do cliente
    api/
      integrations/        # exchange, teams, approve, ignore, pending
      tickets/             # CRUD tickets + messages
      settings/            # SystemConfig
      ai/                  # suggest-fix
      auth/                # login / me / logout
  lib/
    ai.ts                  # Gemini → Custom → Mock
    microsoft.ts           # Graph token + coleta
    db.ts                  # Prisma / PostgreSQL
prisma/                    # Schema Prisma
LICENSE                    # Licença proprietária
tasks.md                   # Checklist de alto nível
```

---

## Licença

Software **proprietário**. Cópia, redistribuição, venda e uso comercial sem autorização escrita do autor (**Caio Correia**) são proibidos. Uso interno apenas por pessoas autorizadas pelo autor.

Detalhes: [LICENSE](./LICENSE)

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Teams sync 0 itens / 403 | Falta Application permission ou Admin Consent | Conceder `Chat.Read.All`, `ChannelMessage.Read.All`, `Team.ReadBasic.All` + consent |
| API responde 502 no sync | Graph falhou; erros não são mais engolidos | Ver `errors`/`warnings` no JSON e logs PM2 |
| IA lenta / HTML na Custom AI | URL Custom devolve HTML (não JSON) | Garantir Gemini key; Custom só é fallback |
| `ai_provider=CUSTOM` mas usa Gemini | Comportamento esperado se houver key Gemini | Remover key só se quiser forçar Custom |
| Token Graph inválido | Secrets errados ou com aspas | Conferir `MS_GRAPH_*` sem aspas extras |
| Build falha no server | Dependências / Prisma desatualizados | `npm install && npx prisma generate && npm run build` |

Logs úteis:

```bash
pm2 logs ticket-manager --lines 100
```

---

## Versionamento

- Semântico em `package.json` (`1.0.1`)
- Tags Git: `v1.0.1`, …
- Repositório privado no GitHub (conta do mantenedor)
