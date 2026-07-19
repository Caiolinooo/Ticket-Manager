import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/db';

export interface MessageAnalysis {
  isIssue: boolean;
  /** True when this message continues an open atendimento (same chat/assunto). */
  isContinuation: boolean;
  category: string;
  priority: string;
  title: string;
  summary: string;
}

export interface AnalyzeContext {
  conversationId?: string;
  existingPendingSummary?: string;
}

type ResolvedProvider = 'GEMINI' | 'CUSTOM' | 'MOCK';

/**
 * Helper to dynamically load AI settings from the database (or environment variables as fallback)
 */
async function getAiConfig() {
  try {
    const configs = await prisma.systemConfig.findMany();
    const configMap = configs.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    return {
      ai_provider: (configMap['ai_provider'] || 'GEMINI').toUpperCase(),
      gemini_api_key: (configMap['gemini_api_key'] || process.env.GEMINI_API_KEY || '').trim(),
      custom_ai_url: (configMap['custom_ai_url'] || '').trim(),
      custom_ai_key: (configMap['custom_ai_key'] || '').trim(),
    };
  } catch (err) {
    console.error('Failed to read system configs from DB, using env fallback:', err);
    return {
      ai_provider: 'GEMINI',
      gemini_api_key: (process.env.GEMINI_API_KEY || '').trim(),
      custom_ai_url: '',
      custom_ai_key: '',
    };
  }
}

/**
 * Business priority:
 * 1) Gemini when a key exists (env or SystemConfig), regardless of ai_provider=CUSTOM
 * 2) Custom AI URL only as fallback / when Gemini key is absent
 * 3) Smart Mock keywords
 */
function resolveProviderOrder(config: Awaited<ReturnType<typeof getAiConfig>>): ResolvedProvider[] {
  const order: ResolvedProvider[] = [];
  if (config.gemini_api_key) order.push('GEMINI');
  if (config.custom_ai_url) order.push('CUSTOM');
  order.push('MOCK');
  return order;
}

/**
 * Standard OpenAI format calling helper for custom APIs.
 * Fail-fast: short timeout + reject HTML/non-JSON immediately.
 */
async function callCustomAi(url: string, apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Custom AI server responded with code ${response.status}: ${errText.substring(0, 200)}`);
    }

    const rawText = await response.text();
    const trimmed = rawText.trimStart();

    // Detect HTML error pages (e.g. nginx/apache proxy returning 200 but serving HTML)
    if (trimmed.startsWith('<') || /^<!doctype/i.test(trimmed)) {
      throw new Error(
        `Custom AI endpoint returned an HTML page instead of JSON. Check if the URL is correct and the service is running. URL: ${url}`
      );
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Custom AI endpoint returned non-JSON body (${rawText.substring(0, 80)}...)`);
    }

    if (data.choices?.[0]?.message?.content) {
      return String(data.choices[0].message.content).trim();
    }
    if (data.response) return String(data.response).trim(); // Ollama format
    if (data.output) return String(data.output).trim();
    if (typeof data === 'string') return data.trim();
    return JSON.stringify(data);
  } finally {
    clearTimeout(timer);
  }
}

const GEMINI_MODEL_CANDIDATES = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-flash-latest',
] as const;

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const ai = new GoogleGenerativeAI(apiKey);
  let lastError: unknown;

  for (const modelName of GEMINI_MODEL_CANDIDATES) {
    try {
      const geminiModel = ai.getGenerativeModel({ model: modelName });
      const result = await geminiModel.generateContent(prompt);
      console.log(`[AI] Gemini model ok: ${modelName}`);
      return result.response.text().trim();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only rotate models on "model unavailable / not found"; otherwise fail immediately.
      if (!/404|not found|no longer available|not supported/i.test(msg)) {
        throw err;
      }
      console.warn(`[AI] Gemini model unavailable (${modelName}), trying next…`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All Gemini model candidates failed');
}

function parseAnalysisJson(resultText: string, text: string, sourceLabel: string): MessageAnalysis {
  const cleanJson = resultText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleanJson);
  return {
    isIssue: !!parsed.isIssue,
    isContinuation: !!parsed.isContinuation,
    category: parsed.category || 'Geral',
    priority: parsed.priority || 'MEDIUM',
    title: parsed.title || `Chamado Detectado via ${sourceLabel}`,
    summary: parsed.summary || text.substring(0, 150),
  };
}

function smartMockAnalysis(text: string, ctx?: AnalyzeContext): MessageAnalysis {
  const lowerText = text.toLowerCase();

  let category = 'Geral';
  let priority = 'MEDIUM';
  let isIssue = false;
  let title = '';
  let summary = '';

  const hasIssueKeywords = [
    'erro', 'problema', 'bug', 'travando', 'bloqueado', 'não funciona',
    'fora do ar', 'não consigo', 'ajuda', 'tela azul', 'senha', 'acesso',
    'vpn', 'impressora', 'lentidão', 'lento', 'quebrado', 'falha', 'atendimento',
  ];

  const isDirectIssue = hasIssueKeywords.some(kw => lowerText.includes(kw));

  const hasResolvedKeywords = [
    'resolvido', 'funcionou', 'deu certo', 'esquece', 'obrigado', 'resolvi', 'deixa pra lá',
  ];
  const isResolved = hasResolvedKeywords.some(kw => lowerText.includes(kw));

  const continuationHints = [
    'ainda', 'continua', 'mesmo problema', 'como falei', 'sobre aquilo',
    'update', 'atualizando', 'tentei de novo', 'não deu',
  ];
  const looksLikeContinuation =
    !!ctx?.existingPendingSummary ||
    continuationHints.some(kw => lowerText.includes(kw)) ||
    lowerText.includes('[contexto agrupado');

  if (isDirectIssue && !isResolved) {
    isIssue = true;
    if (lowerText.includes('impressora') || lowerText.includes('teclado') || lowerText.includes('mouse') || lowerText.includes('notebook')) {
      category = 'Hardware';
      priority = lowerText.includes('impressora') ? 'MEDIUM' : 'LOW';
      title = lowerText.includes('impressora') ? 'Falha na Impressora do Setor' : 'Problema de Hardware Relatado';
    } else if (lowerText.includes('senha') || lowerText.includes('bloqueado') || lowerText.includes('acesso') || lowerText.includes('login') || lowerText.includes('sap')) {
      category = 'Acessos';
      priority = lowerText.includes('sap') || lowerText.includes('bloqueado') ? 'HIGH' : 'MEDIUM';
      title = lowerText.includes('sap') ? 'Reset de Senha / Desbloqueio SAP' : 'Problema com Acesso / Senha';
    } else if (lowerText.includes('vpn') || lowerText.includes('wifi') || lowerText.includes('internet') || lowerText.includes('conectar')) {
      category = 'Redes';
      priority = 'HIGH';
      title = lowerText.includes('vpn') ? 'Erro de Acesso VPN Corporativa' : 'Instabilidade de Rede Relatada';
    } else {
      category = 'Software';
      priority = 'LOW';
      title = 'Erro de Execução em Software';
    }

    summary = `O funcionário relatou uma pendência ligada a ${category}: "${text.substring(0, 100)}..."`;
  }

  return {
    isIssue,
    isContinuation: looksLikeContinuation && (isIssue || !!ctx?.existingPendingSummary),
    category,
    priority,
    title: title || 'Pendência Pendente via Chat',
    summary: summary || 'Mensagem sem problemas técnicos pendentes detectados.',
  };
}

function buildTriagePrompt(
  text: string,
  sender: string,
  platform?: 'TEAMS' | 'EXCHANGE',
  ctx?: AnalyzeContext
): string {
  const existingBlock = ctx?.existingPendingSummary
    ? `
CONTEXTO DE PENDÊNCIA JÁ ABERTA (mesmo chat/thread recente):
"""
${ctx.existingPendingSummary}
"""
Se a nova mensagem for continuidade óbvia do mesmo assunto, marque isContinuation=true e isIssue=true (não trate como chamado novo isolado).
`
    : '';

  const conversationHint = ctx?.conversationId
    ? `Identificador da conversa: ${ctx.conversationId}`
    : '';

  return `
Você é um analista de triagem de suporte de TI corporativo. Seu papel é classificar relatos com precisão — sem inventar detalhes.

Analise o texto abaixo enviado por ${sender}${platform ? ` via ${platform}` : ''}.
${conversationHint}
${existingBlock}

O texto pode ser um CONTEXTO AGRUPADO (várias mensagens do mesmo chat com timestamps). Use o histórico completo para decidir.

Classifique:
1) Há problema técnico pendente que a TI deve tratar? (isIssue)
2) É CONTINUAÇÃO de um atendimento já em andamento no mesmo chat/assunto, ou um atendimento NOVO? (isContinuation)
   - Continuação: mesmo chat, mesmo assunto, follow-up, "ainda não funciona", detalhes adicionais.
   - Novo: assunto diferente, outro sistema, ou intervalo/contexto claramente distinto.

Regras:
- Mensagens informais do Teams ("tá lento", "não imprime", "não consigo abrir") CONTAM como issue se houver pendência.
- Se o funcionário disser que já resolveu / obrigado sem nova pendência → isIssue=false, isContinuation=false.
- NÃO invente sistemas, portais ou sintomas que não estejam no texto.
- title e summary devem refletir o contexto agrupado (não só a última linha).

Texto:
"""
${text}
"""

Responda ESTRITAMENTE em JSON puro (sem markdown):
{
  "isIssue": boolean,
  "isContinuation": boolean,
  "category": "Hardware" | "Software" | "Acessos" | "Redes" | "Geral",
  "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "title": "título curto e profissional",
  "summary": "resumo técnico de 1 a 3 frases com base no contexto completo"
}
`;
}

/**
 * Analyzes a raw text message (or grouped thread context) from Teams/Exchange.
 */
export async function analyzeIncomingMessage(
  text: string,
  sender: string,
  platform?: 'TEAMS' | 'EXCHANGE',
  ctx?: AnalyzeContext
): Promise<MessageAnalysis> {
  const defaultResponse: MessageAnalysis = {
    isIssue: false,
    isContinuation: false,
    category: 'Geral',
    priority: 'LOW',
    title: '',
    summary: '',
  };

  if (!text || text.trim().length < 5) {
    return defaultResponse;
  }

  const prompt = buildTriagePrompt(text, sender, platform, ctx);

  const config = await getAiConfig();
  const order = resolveProviderOrder(config);
  console.log(
    `[AI] providerOrder=${order.join('→')} ai_provider_setting=${config.ai_provider} ` +
      `geminiKey=${config.gemini_api_key ? 'yes' : 'no'} customUrl=${config.custom_ai_url ? 'yes' : 'no'} ` +
      `continuationCtx=${ctx?.existingPendingSummary ? 'yes' : 'no'}`
  );

  for (const provider of order) {
    if (provider === 'GEMINI') {
      try {
        console.log('[AI] Calling Gemini API');
        const resultText = await callGemini(config.gemini_api_key, prompt);
        return parseAnalysisJson(resultText, text, 'Gemini');
      } catch (err) {
        console.error('[AI] Gemini failed, trying next provider:', err);
        continue;
      }
    }

    if (provider === 'CUSTOM') {
      try {
        console.log(`[AI] Calling Custom AI (fallback) at URL: ${config.custom_ai_url}`);
        const resultText = await callCustomAi(config.custom_ai_url, config.custom_ai_key, prompt);
        return parseAnalysisJson(resultText, text, 'Custom AI');
      } catch (err) {
        console.error('[AI] Custom AI failed fast, trying next provider:', err);
        continue;
      }
    }

    if (provider === 'MOCK') {
      console.log('[AI] Using Smart Mock keyword triage');
      return smartMockAnalysis(text, ctx);
    }
  }

  return smartMockAnalysis(text, ctx);
}

function buildDirectFixPrompt(title: string, description: string, category: string): string {
  return `
Você é um técnico de TI preenchendo um RELATÓRIO DE AUDITORIA / guia de correção direta.
Tom: objetivo, factual, específico ao conteúdo do chamado. Sem enrolação, sem boilerplate genérico.

PROIBIDO:
- Inventar sistemas, portais, servidores, políticas LGPD/compliance ou passos sem evidência no relato
- Textos genéricos do tipo "verificar boas práticas", "garantir conformidade", "entrar em contato para entender melhor" sem necessidade
- Textos inventados (ex.: SU01, FortiClient, IP do 3º andar) se NÃO constarem no relato — se precisar, marque como "a confirmar"
- Textos longos, motivacionais ou repetitivos

OBRIGATÓRIO — use EXATAMENTE esta estrutura Markdown (máx. ~400–600 palavras no total):

### Relatório técnico — Correção direta

**1. Resumo do problema**
(1–2 frases, só com base no relato)

**2. Evidências**
(trechos relevantes das mensagens/descrição; cite literalmente quando possível)

**3. Causa provável**
(somente se suportada pelo contexto; senão: "Insuficiente no relato — a confirmar")

**4. Ações executadas / a executar**
(checklist curto, específico, numerado; cada item verificável)

**5. Resultado / status**
(ex.: pendente de execução | resolvido após X | aguardando confirmação do usuário)

Dados do chamado:
- Título: "${title}"
- Categoria: "${category}"
- Descrição / contexto:
"""
${description}
"""
`;
}

function smartMockDirectFix(title: string, description: string, category: string): string {
  const evidence = description
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((l) => `- ${l.substring(0, 180)}`)
    .join('\n');

  const lower = `${title} ${description}`.toLowerCase();
  const actions: string[] = [];

  if (lower.includes('senha') || lower.includes('bloqueado') || lower.includes('acesso') || category === 'Acessos') {
    actions.push('Validar se a conta do usuário está bloqueada no diretório (AD) — a confirmar ferramenta usada no ambiente.');
    actions.push('Se houver menção a SAP no relato: verificar bloqueio/reset na transação indicada pelo cliente (a confirmar).');
    actions.push('Registrar senha temporária apenas se o procedimento padrão da empresa autorizar; comunicar ao usuário por canal seguro.');
  } else if (lower.includes('impressora') || category === 'Hardware') {
    actions.push('Confirmar status online da impressora citada no relato (ping/painel — a confirmar IP/nome).');
    actions.push('Verificar fila/spooler no posto do usuário e limpar trabalhos travados se aplicável.');
    actions.push('Orientar reinício físico do equipamento se o relato indicar atolamento ou luz de erro.');
  } else if (lower.includes('vpn') || lower.includes('rede') || category === 'Redes') {
    actions.push('Validar conectividade local do usuário (link/Wi-Fi) antes do túnel VPN.');
    actions.push('Coletar sintoma exato (erro na tela / momento da falha) a partir do contexto agrupado.');
    actions.push('Testar reconexão do cliente VPN corporativo usado no ambiente (nome a confirmar).');
  } else {
    actions.push('Reproduzir o sintoma descrito nas evidências com o usuário ou no ambiente equivalente.');
    actions.push('Isolar se o problema é estação, rede ou aplicação — com base só no que o relato permite.');
    actions.push('Documentar o resultado do teste e próxima ação específica.');
  }

  return `### Relatório técnico — Correção direta

**1. Resumo do problema**
${title}. Categoria: ${category}.

**2. Evidências**
${evidence || '- (sem trechos adicionais no relato)'}

**3. Causa provável**
Insuficiente no relato para afirmar causa raiz — a confirmar após as ações abaixo.

**4. Ações executadas / a executar**
${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

**5. Resultado / status**
Pendente de execução / validação com o solicitante.`;
}

/**
 * Generates an audit-style direct-fix report for a ticket (not generic fluff).
 */
export async function suggestDirectFix(title: string, description: string, category: string): Promise<string> {
  const prompt = buildDirectFixPrompt(title, description, category);

  const config = await getAiConfig();
  const order = resolveProviderOrder(config);
  console.log(`[AI/fix] providerOrder=${order.join('→')} mode=audit-report`);

  for (const provider of order) {
    if (provider === 'GEMINI') {
      try {
        console.log('[AI/fix] Calling Gemini API (audit direct-fix)');
        return await callGemini(config.gemini_api_key, prompt);
      } catch (err) {
        console.error('[AI/fix] Gemini failed, trying next provider:', err);
        continue;
      }
    }

    if (provider === 'CUSTOM') {
      try {
        console.log(`[AI/fix] Calling Custom AI (fallback) at URL: ${config.custom_ai_url}`);
        return await callCustomAi(config.custom_ai_url, config.custom_ai_key, prompt);
      } catch (err) {
        console.error('[AI/fix] Custom AI failed fast, trying next provider:', err);
        continue;
      }
    }
  }

  console.log('[AI/fix] Using Smart Mock audit-style report');
  return smartMockDirectFix(title, description, category);
}
