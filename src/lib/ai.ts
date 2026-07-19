import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '@/lib/db';

interface MessageAnalysis {
  isIssue: boolean;
  category: string;
  priority: string;
  title: string;
  summary: string;
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
    category: parsed.category || 'Geral',
    priority: parsed.priority || 'MEDIUM',
    title: parsed.title || `Chamado Detectado via ${sourceLabel}`,
    summary: parsed.summary || text.substring(0, 150),
  };
}

function smartMockAnalysis(text: string): MessageAnalysis {
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
    category,
    priority,
    title: title || 'Pendência Pendente via Chat',
    summary: summary || 'Mensagem sem problemas técnicos pendentes detectados.',
  };
}

/**
 * Analyzes a raw text message from Teams or Exchange to determine if it's an IT support issue.
 */
export async function analyzeIncomingMessage(
  text: string,
  sender: string,
  platform?: 'TEAMS' | 'EXCHANGE'
): Promise<MessageAnalysis> {
  const defaultResponse: MessageAnalysis = {
    isIssue: false,
    category: 'Geral',
    priority: 'LOW',
    title: '',
    summary: '',
  };

  if (!text || text.trim().length < 5) {
    return defaultResponse;
  }

  const prompt = `
Você é uma inteligência artificial especialista em triagem de suporte de TI corporativo.
Analise a seguinte mensagem enviada por um funcionário${platform ? ` via ${platform}` : ''} (${sender}) e determine se ela descreve, mesmo que informalmente, um problema técnico pendente, erro de sistema, necessidade de suporte, reset de senha, falha de hardware/software, ou qualquer situação que exija ação da equipe de TI.

IMPORTANTE: Mensagens do Teams costumam ser informais. Considere também situações como:
- "não consigo abrir o sistema", "tá lento", "caiu a internet", "não imprime"
- Reclamações genéricas sobre tecnologia ou sistemas corporativos
- Pedidos de ajuda mesmo que vagos ("você pode me ajudar com uma coisa?")
- Relatos de problema feitos de forma coloquial ou incompleta

ATENÇÃO: Se o funcionário disser explicitamente que o problema já foi resolvido, que deu certo, ou for apenas um agradecimento/aviso sem pendência em aberto, responda isIssue = false.

Mensagem:
"${text}"

Responda ESTRITAMENTE em formato JSON (sem markdown, sem blocos de código, apenas JSON puro) com a seguinte estrutura:
{
  "isIssue": boolean, // true se houver qualquer problema técnico pendente que a TI deveria saber
  "category": "Hardware" | "Software" | "Acessos" | "Redes" | "Geral",
  "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "title": "título curto e profissional resumindo o problema",
  "summary": "resumo profissional de 1 a 2 frases detalhando o que o funcionário relatou e o que precisa ser feito"
}
`;

  const config = await getAiConfig();
  const order = resolveProviderOrder(config);
  console.log(
    `[AI] providerOrder=${order.join('→')} ai_provider_setting=${config.ai_provider} ` +
      `geminiKey=${config.gemini_api_key ? 'yes' : 'no'} customUrl=${config.custom_ai_url ? 'yes' : 'no'}`
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
      return smartMockAnalysis(text);
    }
  }

  return smartMockAnalysis(text);
}

/**
 * Generates automated fix suggestions / solutions for a given ticket
 */
export async function suggestDirectFix(title: string, description: string, category: string): Promise<string> {
  const prompt = `
Você é uma inteligência artificial especialista em suporte de TI (Nível 2).
Sua tarefa é ler o título, a descrição e a categoria de um chamado de suporte aberto e sugerir uma lista detalhada, passo a passo, de procedimentos técnicos recomendados (no formato Markdown) que o técnico pode executar diretamente para resolver o chamado.

Título do Chamado: "${title}"
Categoria: "${category}"
Descrição do Problema:
"${description}"

Forneça sua resposta em Markdown limpo contendo:
### 💡 Guia de Correção Direta
- Passos técnicos organizados em ordem lógica.
- Comandos ou transações específicas (se aplicável, ex: SU01 no SAP, ipconfig, etc.).
- Procedimentos claros e diretos.
`;

  const config = await getAiConfig();
  const order = resolveProviderOrder(config);
  console.log(`[AI/fix] providerOrder=${order.join('→')}`);

  for (const provider of order) {
    if (provider === 'GEMINI') {
      try {
        console.log('[AI/fix] Calling Gemini API');
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

  // Smart Mock Fix Suggestions based on categories & keywords
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();

  if (category === 'Acessos' || titleLower.includes('senha') || descLower.includes('senha') || descLower.includes('bloqueado') || descLower.includes('sap')) {
    return `### 💡 Guia de Correção Direta (Acessos/SAP)

1. **Verificar Estado da Conta Active Directory (AD)**:
   - Abra o console do AD e busque pelo e-mail do usuário.
   - Verifique se a conta está marcada como \`Locked Out\`. Se sim, clique em \`Unlock Account\`.
2. **Reset de Senha SAP**:
   - Acesse a transação \`SU01\` no SAP GUI.
   - Digite o login do usuário e clique no ícone do cadeado para verificar bloqueios de senha.
   - Clique em "Modificar" (F6) -> Aba "Dados de Logon" -> "Nova Senha".
   - Defina uma senha temporária segura (ex: \`Empresa@2026\`) e marque a opção "Exigir alteração no próximo logon".
3. **Notificação**:
   - Envie a senha temporária de forma segura ao funcionário via Teams ou SMS.
4. **Auditoria**:
   - Registre o ID de desbloqueio nos logs do sistema de auditoria.`;
  }

  if (category === 'Hardware' || titleLower.includes('impressora') || descLower.includes('impressora') || descLower.includes('tela azul') || descLower.includes('azul')) {
    if (titleLower.includes('impressora') || descLower.includes('impressora')) {
      return `### 💡 Guia de Correção Direta (Impressora)

1. **Verificação de Rede & Fila de Impressão**:
   - Dê ping no IP da impressora do 3º andar para validar se está online.
   - Acesse o servidor de impressão local e limpe a fila de impressão pendente (\`Spooler\`).
2. **Resolução Física (Atolamento de Papel)**:
   - Oriente o funcionário a abrir a gaveta lateral direita da impressora e remover com cuidado qualquer fragmento de papel preso no rolo fusor.
   - Verifique os sensores ópticos de papel; poeira pode causar alertas falsos de luz vermelha.
3. **Reinicialização**:
   - Solicite desligar a impressora, aguardar 30 segundos e ligar novamente.`;
    }
    return `### 💡 Guia de Correção Direta (Tela Azul / BSOD)

1. **Identificar o Driver Causador**:
   - Peça ao funcionário para reiniciar o notebook em **Modo de Segurança com Rede**.
   - Execute o visualizador de eventos ou a ferramenta \`BlueScreenView\` para analisar o arquivo minidump (\`C:\\Windows\\Minidump\`).
2. **Atualização/Reversão de Drivers**:
   - Se o erro for \`SYSTEM_THREAD_EXCEPTION_NOT_HANDLED\`, geralmente está ligado ao driver de vídeo ou de rede Wifi.
   - Acesse o Gerenciador de Dispositivos, clique com o botão direito no adaptador suspeito e selecione "Reverter Driver", ou baixe a versão mais recente oficial no site do fabricante (Dell/Lenovo).
3. **Verificação de Arquivos de Sistema**:
   - Abra o Prompt de Comando como Administrador e execute:
     \`\`\`cmd
     sfc /scannow
     DISM /Online /Cleanup-Image /RestoreHealth
     \`\`\`
4. **Substituição de Hardware (Se persistir)**:
   - Agende a coleta do notebook para análise física de memória RAM ou SSD.`;
  }

  if (category === 'Redes' || titleLower.includes('vpn') || descLower.includes('vpn')) {
    return `### 💡 Guia de Correção Direta (VPN / Rede)

1. **Diagnóstico de Conexão Local**:
   - Solicite que o funcionário acesse [fast.com](https://fast.com) para verificar a velocidade e estabilidade da conexão residencial.
   - Verifique se ele está utilizando cabo ou Wi-Fi (conexões Wi-Fi instáveis derrubam o túnel VPN).
2. **Reset da Pilha de Rede (No notebook do usuário)**:
   - Oriente-o a abrir o PowerShell como Administrador e rodar os seguintes comandos:
     \`\`\`powershell
     ipconfig /release
     ipconfig /renew
     ipconfig /flushdns
     netsh int ip reset
     netsh winsock reset
     \`\`\`
   - Reinicie o computador.
3. **Configuração do Cliente VPN (FortiClient/Cisco AnyConnect)**:
   - Abra as configurações da VPN e verifique se o gateway de destino está correto.
   - Limpe o cache do navegador e do cliente VPN.
   - Se necessário, reinstale o perfil de conexão da empresa.`;
  }

  return `### 💡 Guia de Correção Direta (Geral)

1. **Entrar em contato com o Solicitante**:
   - Inicie um chat rápido no Teams com o funcionário para validar detalhes adicionais do comportamento do problema.
2. **Verificar Logs de Servidor**:
   - Se for um bug de sistema, verifique os logs da aplicação afetada no painel de monitoramento do servidor corporativo.
3. **Escalação**:
   - Caso o problema exija privilégios adicionais, encaminhe o ticket para a equipe de infraestrutura Nível 3.`;
}
