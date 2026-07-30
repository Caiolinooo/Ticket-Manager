# Changelog

Todas as mudanças relevantes do Ticket Manager são documentadas neste arquivo.

Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento: [SemVer](https://semver.org/lang/pt-BR/).

## [1.3.2] - 2026-07-30

### Added
- Motor compartilhado `src/lib/kpi-metrics.ts` (fonte única para UI, `GET /api/kpi` e export Excel).
- Aba **Relatórios & KPIs** (`KpiDashboard`): total, taxa de resolução, MTTR, MTTFR, compliance SLA, estouros e backlog.
- Filtros de período: Hoje, 7d, 30d, 90d e intervalo personalizado.
- Breakdowns por técnico, prioridade, status, categoria e fonte; tendência de volume diário.
- Smoke unitário `scripts/smoke-kpi-metrics.mjs`.
- `CHANGELOG.md` e documentação de Relatórios & KPIs no README.

### Changed
- `GET /api/kpi` com summary, breakdowns, trends e filtro `dateFrom`/`dateTo`.
- Export Excel (`GET /api/export`) alinhado às mesmas definições de SLA/MTTR/MTTFR.
- LICENSE: nota explícita de que dependências npm permanecem sob as licenças próprias.
- `package.json` → **1.3.2**.

### SLA / métricas (tempo corrido)
- Urgente / Alta: 2h · Média: 24h · Baixa: 72h.
- Cumprido = resolvido dentro da meta; estourado = aberto ou resolvido após a meta; no prazo = aberto ainda dentro da meta.
- Compliance = cumpridos ÷ (cumpridos + estourados); tickets “no prazo” fora do denominador.
- MTTR = média `(resolvedAt − createdAt)` em Resolvidos/Fechados; MTTFR = média até 1ª mensagem de agente.

## [1.3.1] - 2026-07-28

### Added
- Técnicos vinculados a usuários do Portal (`portalUserId` / `authSource`).
- Busca de usuários Portal e login do técnico com credenciais do Portal (bcrypt).

## [1.3.0] - 2026-07-28

### Added
- Routing multi-operador (`accountUpn`), sync unificado e KPIs de setor para ADMIN e TECHNICIAN.
- Matriz de permissões operador ADMIN vs TECHNICIAN.

## [1.2.2] - 2026-07

### Fixed
- Cookies de sessão em deploys HTTP (`Secure` condicional) para evitar loop de login.

## [1.2.1] - 2026-07

### Fixed
- Separação do login Cliente (Portal) da área Operador.

## [1.2.0] / [1.1.0] / [1.0.x]

- Agrupamento de traces, Direct Fix / auditoria, portal client auth, baseline do produto.

[1.3.2]: https://github.com/Caiolinooo/Ticket-Manager/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/Caiolinooo/Ticket-Manager/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Caiolinooo/Ticket-Manager/compare/v1.2.2...v1.3.0

