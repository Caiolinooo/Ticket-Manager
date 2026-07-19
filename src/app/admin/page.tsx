'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LogOut, MessageSquare, AlertCircle, CheckCircle, Clock, Send, 
  ShieldAlert, User, Cpu, Sparkles, Filter, Search, Download, 
  RefreshCw, Bot, Check, X, BarChart3, Database, MessageSquareWarning, 
  Settings2, Calendar, TrendingUp, TrendingDown, Minus, ChevronRight,
  FileSpreadsheet, Zap
} from 'lucide-react';

interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    role: string;
  };
}

interface ExternalTrace {
  id: string;
  platform: string;
  externalId: string;
  originalSender: string;
  channelOrSubject: string;
  rawContent: string;
  receivedAt: string;
  status: string;
}

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  resolution?: string | null;
  source: string;
  externalReferenceId?: string | null;
  assignedToId?: string | null;
  createdAt: string;
  resolvedAt?: string;
  creator: { name: string; email: string };
  assignee?: { id: string; name: string; email: string };
  messages: Message[];
}

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

function getInitials(name: string): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(n => n.length > 0)
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Fortaleza',
  });
}

export default function AdminDashboard() {
  const router = useRouter();
  
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'tickets' | 'pending' | 'kpis' | 'simulator' | 'settings'>('tickets');
  
  const [user, setUser] = useState<UserInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [agents, setAgents] = useState<UserInfo[]>([]);
  const [pendingTraces, setPendingTraces] = useState<ExternalTrace[]>([]);
  
  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  
  // AI Direct Fix
  const [aiFixText, setAiFixText] = useState<string>('');
  const [aiFixLoading, setAiFixLoading] = useState(false);
  
  // Chat input
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Sync / Integration State
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; msg: string } | null>(null);

  // Simulator Form States
  const [simPlatform, setSimPlatform] = useState<'TEAMS' | 'EXCHANGE'>('TEAMS');
  const [simSenderName, setSimSenderName] = useState('');
  const [simSenderEmail, setSimSenderEmail] = useState('');
  const [simContent, setSimContent] = useState('');
  const [simSubject, setSimSubject] = useState('');
  const [simLoading, setSimLoading] = useState(false);
  const [simSuccessMsg, setSimSuccessMsg] = useState('');

  // AI Settings States
  const [aiProvider, setAiProvider] = useState<'GEMINI' | 'CUSTOM'>('GEMINI');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [customAiUrl, setCustomAiUrl] = useState('');
  const [customAiKey, setCustomAiKey] = useState('');
  const [monitoredAccounts, setMonitoredAccounts] = useState('user@example.com');
  const [syncSinceDate, setSyncSinceDate] = useState('');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState('30');
  const [exchangeEnabled, setExchangeEnabled] = useState(true);
  const [teamsEnabled, setTeamsEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState('');

  // Resolution Modal State
  const [showResolutionModal, setShowResolutionModal] = useState(false);
  const [resolutionText, setResolutionText] = useState('');
  const [pendingCloseStatus, setPendingCloseStatus] = useState<string | null>(null);

  // ── KPI Date Filters ──────────────────────────────────────────────────────
  const [kpiPreset, setKpiPreset] = useState<DatePreset>('30d');
  const [kpiDateFrom, setKpiDateFrom] = useState('');
  const [kpiDateTo, setKpiDateTo] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Compute effective from/to dates based on preset
  const effectiveDates = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (kpiPreset === 'today') {
      return { from: todayStr, to: todayStr };
    } else if (kpiPreset === '7d') {
      const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { from, to: todayStr };
    } else if (kpiPreset === '30d') {
      const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { from, to: todayStr };
    } else if (kpiPreset === '90d') {
      const from = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { from, to: todayStr };
    } else {
      // custom
      return { from: kpiDateFrom, to: kpiDateTo };
    }
  }, [kpiPreset, kpiDateFrom, kpiDateTo]);

  // Tickets filtered by KPI date range
  const kpiTickets = useMemo(() => {
    if (!effectiveDates.from && !effectiveDates.to) return tickets;
    return tickets.filter(t => {
      const created = new Date(t.createdAt);
      const from = effectiveDates.from ? new Date(effectiveDates.from + 'T00:00:00') : null;
      const to = effectiveDates.to ? new Date(effectiveDates.to + 'T23:59:59') : null;
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
  }, [tickets, effectiveDates]);

  // KPI calculations (based on filtered tickets)
  const totalTicketsCount = kpiTickets.length;
  const resolvedCount = kpiTickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length;
  const openCount = kpiTickets.filter(t => t.status === 'OPEN').length;
  const inProgressCount = kpiTickets.filter(t => t.status === 'IN_PROGRESS').length;

  // MTTR
  const resolvedWithTime = kpiTickets.filter(t => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolvedAt);
  let mttrHours = '0.0';
  if (resolvedWithTime.length > 0) {
    const totalMs = resolvedWithTime.reduce((acc, t) => {
      const start = new Date(t.createdAt).getTime();
      const end = new Date(t.resolvedAt!).getTime();
      return acc + (end - start);
    }, 0);
    mttrHours = (totalMs / (resolvedWithTime.length * 1000 * 60 * 60)).toFixed(1);
  }

  // SLA Breaches (High/Urgent open for > 2 hours)
  const slaBreaches = kpiTickets.filter(t => {
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
    if (t.priority !== 'HIGH' && t.priority !== 'URGENT') return false;
    const ageMs = Date.now() - new Date(t.createdAt).getTime();
    return ageMs > 1000 * 60 * 120;
  }).length;

  // Resolution rate
  const resolutionRate = totalTicketsCount > 0
    ? ((resolvedCount / totalTicketsCount) * 100).toFixed(0)
    : '0';

  // Category distribution
  const categories = ['Hardware', 'Software', 'Acessos', 'Redes', 'Geral'];
  const categoryCounts = categories.map(cat => kpiTickets.filter(t => t.category === cat).length);
  const totalCatSum = categoryCounts.reduce((a, b) => a + b, 0);

  // Status distributions
  const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const statusCounts = statuses.map(s => kpiTickets.filter(t => t.status === s).length);

  // Source distribution
  const sources = ['PORTAL', 'TEAMS', 'EMAIL'];
  const sourceLabels = ['Portal', 'Teams', 'E-mail'];
  const sourceCounts = sources.map(s => kpiTickets.filter(t => t.source === s).length);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setAiProvider(data.settings.ai_provider);
        setGeminiApiKey(data.settings.gemini_api_key);
        setCustomAiUrl(data.settings.custom_ai_url);
        setCustomAiKey(data.settings.custom_ai_key);
        setMonitoredAccounts(data.settings.monitored_accounts || 'user@example.com');
        setSyncSinceDate(data.settings.sync_since_date || '');
        setSyncIntervalMinutes(data.settings.sync_interval_minutes || '30');
        setExchangeEnabled(data.settings.exchange_enabled !== 'false');
        setTeamsEnabled(data.settings.teams_enabled !== 'false');
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsLoading(true);
    setSettingsSaveSuccess('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_provider: aiProvider,
          gemini_api_key: geminiApiKey,
          custom_ai_url: customAiUrl,
          custom_ai_key: customAiKey,
          monitored_accounts: monitoredAccounts,
          sync_since_date: syncSinceDate,
          sync_interval_minutes: syncIntervalMinutes,
          exchange_enabled: String(exchangeEnabled),
          teams_enabled: String(teamsEnabled),
        })
      });
      if (res.ok) {
        setSettingsSaveSuccess('Configurações salvas com sucesso!');
        setTimeout(() => setSettingsSaveSuccess(''), 4000);
      } else {
        const errData = await res.json();
        alert('Erro ao salvar: ' + errData.error);
      }
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!userRes.ok) { router.replace('/'); return; }
        const userData = await userRes.json();
        if (userData.user.role !== 'ADMIN' && userData.user.role !== 'AGENT') {
          router.replace('/client'); return;
        }
        setUser(userData.user);

        const ticketsRes = await fetch('/api/tickets', { credentials: 'include' });
        if (ticketsRes.ok) {
          const ticketsData = await ticketsRes.json();
          setTickets(ticketsData.tickets);
        }

        const agentsRes = await fetch('/api/users', { credentials: 'include' });
        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          setAgents(agentsData.agents);
        }

        const tracesRes = await fetch('/api/integrations/pending', { credentials: 'include' });
        if (tracesRes.ok) {
          const tracesData = await tracesRes.json();
          setPendingTraces(tracesData.pendingTraces);
        }

        await loadSettings();
      } catch (err) {
        console.error('Error loading initial data:', err instanceof Error ? err.message : err);
        router.replace('/');
      }
    }
    loadData();
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedTicket?.messages]);

  useEffect(() => {
    if (selectedTicket) {
      loadAiFix(selectedTicket.id);
    } else {
      setAiFixText('');
    }
  }, [selectedTicket?.id]);

  const loadAiFix = async (ticketId: string) => {
    setAiFixLoading(true);
    setAiFixText('');
    try {
      const res = await fetch('/api/ai/suggest-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiFixText(data.suggestion);
      } else {
        setAiFixText('Não foi possível gerar soluções recomendadas pela IA.');
      }
    } catch (err) {
      setAiFixText('Erro na comunicação com a API de IA.');
    } finally {
      setAiFixLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncMicrosoft = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const [teamsRes, exchangeRes] = await Promise.all([
        fetch('/api/integrations/teams'),
        fetch('/api/integrations/exchange'),
      ]);

      const teamsData = await teamsRes.json();
      const exchangeData = await exchangeRes.json();

      const tracesRes = await fetch('/api/integrations/pending');
      if (tracesRes.ok) {
        const tracesData = await tracesRes.json();
        setPendingTraces(tracesData.pendingTraces);
      }

      const teamsOk = teamsData.success !== false;
      const exchangeOk = exchangeData.success !== false;
      const teamsProcessed = teamsData.processedCount ?? 0;
      const exchangeProcessed = exchangeData.processedCount ?? 0;
      const warnParts = [
        ...(teamsData.warnings || []).map((w: string) => `Teams: ${w}`),
        ...(exchangeData.warnings || []).map((w: string) => `Email: ${w}`),
        ...(teamsData.errors || []).map((e: string) => `Teams: ${e}`),
        ...(exchangeData.errors || []).map((e: string) => `Email: ${e}`),
      ];

      if (!teamsOk || !exchangeOk) {
        const errs = [
          !teamsOk ? `Teams: ${teamsData.error || teamsData.errors?.[0] || 'Erro desconhecido'}` : null,
          !exchangeOk ? `Email: ${exchangeData.error || exchangeData.errors?.[0] || 'Erro desconhecido'}` : null,
        ].filter(Boolean).join(' | ');
        setSyncResult({
          success: false,
          msg: `Sincronização com erros — ${errs}` +
            ` (Email: ${exchangeProcessed} msg, Teams: ${teamsProcessed} msg)`,
        });
      } else {
        const newCount = (teamsData.newPendingTraces?.length || 0) + (exchangeData.newPendingTraces?.length || 0);
        const base = newCount > 0
          ? `Sincronização concluída! ${newCount} nova(s) pendência(s).`
          : 'Sincronização concluída. Nenhuma nova pendência detectada.';
        const counts = ` Email=${exchangeProcessed}, Teams=${teamsProcessed}.`;
        const warn = warnParts.length ? ` Avisos: ${warnParts.slice(0, 2).join(' | ')}` : '';
        setSyncResult({
          success: warnParts.length === 0,
          msg: base + counts + warn,
        });
      }
    } catch (err: any) {
      setSyncResult({ success: false, msg: `Falha na sincronização: ${err.message}` });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 6000);
    }
  };

  const handleApproveTrace = async (traceId: string) => {
    try {
      const res = await fetch('/api/integrations/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traceId })
      });
      
      const data = await res.json();
      if (res.ok) {
        setPendingTraces(pendingTraces.filter(t => t.id !== traceId));
        setTickets([data.ticket, ...tickets]);
        alert(`✅ Ticket "${data.ticket.title}" criado com sucesso!`);
      } else {
        alert('Erro ao aprovar: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleIgnoreTrace = async (traceId: string) => {
    try {
      const res = await fetch('/api/integrations/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traceId })
      });

      if (res.ok) {
        setPendingTraces(pendingTraces.filter(t => t.id !== traceId));
      } else {
        const data = await res.json();
        alert('Erro ao ignorar: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateTicketMeta = async (fields: {
    status?: string;
    priority?: string;
    category?: string;
    assignedToId?: string | null;
    resolution?: string;
  }) => {
    if (!selectedTicket) return;

    const isClosing = fields.status === 'RESOLVED' || fields.status === 'CLOSED';
    if (isClosing && !selectedTicket.resolution && !fields.resolution) {
      setPendingCloseStatus(fields.status!);
      setResolutionText(aiFixText ? aiFixText.substring(0, 500) : '');
      setShowResolutionModal(true);
      return;
    }

    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const updatedTicket = {
        ...selectedTicket,
        ...fields,
        resolution: fields.resolution ?? selectedTicket.resolution,
        assignee: data.ticket.assignee,
      };
      setTickets(tickets.map(t => t.id === selectedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmResolution = async () => {
    if (!selectedTicket || !pendingCloseStatus) return;
    setShowResolutionModal(false);
    await handleUpdateTicketMeta({
      status: pendingCloseStatus,
      resolution: resolutionText.trim() || 'Sem descrição de resolução informada.',
    });
    setPendingCloseStatus(null);
    setResolutionText('');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !selectedTicket) return;

    setChatLoading(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chatMessage.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      let newStatus = selectedTicket.status;
      if (selectedTicket.status === 'OPEN') newStatus = 'IN_PROGRESS';

      const updatedMessages = [...(selectedTicket.messages || []), data.message];
      const updatedTicket = { ...selectedTicket, status: newStatus, messages: updatedMessages };

      setTickets(tickets.map(t => t.id === selectedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
      setChatMessage('');
    } catch (err) {
      console.error(err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simContent.trim()) return;

    setSimLoading(true);
    setSimSuccessMsg('');

    try {
      const route = simPlatform === 'TEAMS' ? '/api/integrations/teams' : '/api/integrations/exchange';
      const body: any = {
        senderName: simSenderName,
        senderEmail: simSenderEmail,
        content: simContent.trim(),
      };
      
      if (simPlatform === 'TEAMS') {
        body.channelName = 'Suporte Geral';
      } else {
        body.subject = simSubject;
      }

      const res = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const injectedTrace = data.trace;
      const analysisTitle = data.aiAnalysis?.title || 'Pendência detectada';

      if (injectedTrace?.status === 'PENDING_APPROVAL') {
        const mergeHint = data.action === 'merged' ? ' (mesclado ao mesmo chat/thread)' : '';
        setSimSuccessMsg(`Mensagem injetada! A IA identificou: "${analysisTitle}" e gerou uma pendência na aba Pendências.${mergeHint}`);
        setPendingTraces([injectedTrace, ...pendingTraces.filter((t) => t.id !== injectedTrace.id)]);
      } else if (data.action === 'merged' && injectedTrace) {
        setSimSuccessMsg(`Mensagem mesclada ao contexto da pendência existente (${analysisTitle}).`);
        setPendingTraces([injectedTrace, ...pendingTraces.filter((t) => t.id !== injectedTrace.id)]);
      } else {
        setSimSuccessMsg('Mensagem injetada. A IA interpretou que NÃO se trata de um problema de suporte de TI.');
      }

      setSimContent('');
    } catch (err: any) {
      alert('Erro na simulação: ' + err.message);
    } finally {
      setSimLoading(false);
    }
  };

  // Build export URL with active date filters
  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (effectiveDates.from) params.set('dateFrom', effectiveDates.from);
    if (effectiveDates.to) params.set('dateTo', effectiveDates.to);
    const qs = params.toString();
    return `/api/export${qs ? '?' + qs : ''}`;
  };

  // Filtered tickets (ticket queue tab)
  const filteredTickets = tickets.filter(t => {
    const matchesSearch =
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.creator.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesPriority = priorityFilter === 'ALL' || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 pulse-indicator">URGENTE</span>;
      case 'HIGH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/20">ALTA</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/20">MÉDIA</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400 border border-slate-500/20">BAIXA</span>;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'OPEN': return 'Aberto';
      case 'IN_PROGRESS': return 'Em Andamento';
      case 'RESOLVED': return 'Resolvido';
      case 'CLOSED': return 'Fechado';
      case 'PENDING': return 'Pendente';
      default: return status;
    }
  };

  const getStatusDot = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-sky-400',
      IN_PROGRESS: 'bg-amber-400',
      RESOLVED: 'bg-emerald-400',
      CLOSED: 'bg-slate-400',
      PENDING: 'bg-yellow-400',
    };
    return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] || 'bg-slate-400'} shrink-0`} />;
  };

  const presetLabel: Record<DatePreset, string> = {
    today: 'Hoje',
    '7d': '7 dias',
    '30d': '30 dias',
    '90d': '90 dias',
    custom: 'Personalizado',
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">

      {/* Resolution Modal */}
      {showResolutionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-card rounded-2xl border border-indigo-500/20 p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Registrar Resolução do Chamado</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Descreva como o chamado foi resolvido. Este campo será incluído no relatório Excel e no histórico do ticket.
            </p>
            <textarea
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              rows={5}
              className="block w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              placeholder="Ex: Realizado reset de senha no SAP via transação SU01. Conta desbloqueada no AD. Usuário confirmou acesso."
            />
            <div className="flex gap-3">
              <button
                onClick={handleConfirmResolution}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Fechar Chamado com Resolução
              </button>
              <button
                onClick={() => { setShowResolutionModal(false); setPendingCloseStatus(null); }}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 rounded-xl text-xs cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <header className="glass-card border-b border-white/5 py-3.5 px-6 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
            <Cpu className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              Ticket-Manager <span className="text-indigo-400 text-xs px-2 py-0.5 rounded bg-indigo-500/10 font-bold border border-indigo-500/20">ADMIN</span>
            </h1>
            <p className="text-[10px] text-slate-400">Plataforma Inteligente · Teams & Exchange</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Sync result notification */}
          {syncResult && (
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold border ${
              syncResult.success
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
              {syncResult.success ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {syncResult.msg}
            </div>
          )}

          <button
            onClick={handleSyncMicrosoft}
            disabled={syncing}
            title="Verificar novas pendências no Teams e Exchange"
            className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Verificar Canais'}
          </button>
          
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-bold text-xs shadow ring-1 ring-white/10">
              {user ? getInitials(user.name) : '?'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-slate-200">{user?.name}</p>
              <p className="text-[10px] text-slate-500">{user?.role === 'ADMIN' ? 'Administrador' : 'Técnico de TI'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/5 rounded-xl transition-all cursor-pointer"
            title="Sair do painel"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation bar */}
        <aside className="w-60 border-r border-white/5 bg-slate-950/30 flex flex-col shrink-0 hidden lg:flex">
          <div className="p-4 flex flex-col gap-1">
            {[
              { tab: 'tickets', icon: MessageSquare, label: 'Fila de Tickets', badge: tickets.filter(t => t.status === 'OPEN').length },
              { tab: 'pending', icon: MessageSquareWarning, label: 'Pendências', badge: pendingTraces.length, badgeColor: 'red' },
              { tab: 'kpis', icon: BarChart3, label: 'Relatórios & KPIs' },
              { tab: 'simulator', icon: Zap, label: 'Simulador' },
              { tab: 'settings', icon: Settings2, label: 'Configurações' },
            ].map(({ tab, icon: Icon, label, badge, badgeColor }) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{label}</span>
                </div>
                {badge !== undefined && badge > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                    badgeColor === 'red'
                      ? 'bg-red-500 text-white pulse-indicator'
                      : 'bg-indigo-500/30 text-indigo-300'
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-auto p-4 border-t border-white/5 space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-semibold">
              <Database className="h-3.5 w-3.5 text-emerald-500" />
              <span>Supabase PostgreSQL</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-semibold">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-indicator" />
              <span>{tickets.length} tickets no sistema</span>
            </div>
          </div>
        </aside>

        {/* Mobile Bottom Nav */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 h-16 bg-[#030712]/95 border-t border-white/5 flex items-center justify-around z-30 px-2 backdrop-blur">
          {[
            { tab: 'tickets', icon: MessageSquare, label: 'Tickets' },
            { tab: 'pending', icon: MessageSquareWarning, label: 'Pendências', hasDot: pendingTraces.length > 0 },
            { tab: 'kpis', icon: BarChart3, label: 'KPIs' },
            { tab: 'simulator', icon: Zap, label: 'Simulador' },
            { tab: 'settings', icon: Settings2, label: 'Config' },
          ].map(({ tab, icon: Icon, label, hasDot }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex flex-col items-center gap-1 text-[10px] font-semibold relative ${
                activeTab === tab ? 'text-indigo-400' : 'text-slate-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
              {hasDot && <span className="absolute top-0 right-2 h-2 w-2 rounded-full bg-red-500" />}
            </button>
          ))}
        </div>

        {/* Tab Content Areas */}
        <div className="flex-1 flex overflow-hidden pb-16 lg:pb-0">
          
          {/* TAB 1: FILA DE TICKETS */}
          {activeTab === 'tickets' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Tickets List */}
              <div className={`flex-1 md:flex-initial md:w-[400px] flex flex-col border-r border-white/5 bg-slate-950/20 overflow-hidden ${selectedTicket ? 'hidden md:flex' : 'flex'}`}>
                {/* Search & Filters */}
                <div className="p-4 border-b border-white/5 shrink-0 space-y-3">
                  <div className="relative">
                    <Search className="absolute inset-y-0 left-3 h-4 w-4 text-slate-500 flex items-center pointer-events-none mt-3" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Pesquisar tickets ou usuários..."
                      className="block w-full pl-9 pr-4 py-2 bg-slate-950/80 border border-white/5 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-slate-300 text-[10px] focus:outline-none"
                    >
                      <option value="ALL">Todos Status</option>
                      <option value="OPEN">Abertos</option>
                      <option value="IN_PROGRESS">Em Andamento</option>
                      <option value="PENDING">Pendentes</option>
                      <option value="RESOLVED">Resolvidos</option>
                      <option value="CLOSED">Fechados</option>
                    </select>
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-slate-300 text-[10px] focus:outline-none"
                    >
                      <option value="ALL">Todas Prioridades</option>
                      <option value="LOW">Baixa</option>
                      <option value="MEDIUM">Média</option>
                      <option value="HIGH">Alta</option>
                      <option value="URGENT">Urgente</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-slate-500">{filteredTickets.length} ticket(s) encontrado(s)</p>
                </div>

                {/* Ticket rows */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {filteredTickets.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/5 rounded-xl text-slate-500">
                      <AlertCircle className="h-6 w-6 mb-2" />
                      <p className="text-xs font-semibold">Nenhum ticket encontrado</p>
                    </div>
                  ) : (
                    filteredTickets.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTicket(t)}
                        className={`glass-card glass-card-hover rounded-xl p-3.5 cursor-pointer text-left transition-all ${selectedTicket?.id === t.id ? 'border-indigo-500/40 bg-indigo-500/5' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                            {t.category}
                          </span>
                          {getPriorityBadge(t.priority)}
                        </div>
                        <h3 className="text-xs font-bold text-slate-200 line-clamp-1 mb-1">{t.title}</h3>
                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2.5">{t.description}</p>
                        
                        <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1.5">
                            {getStatusDot(t.status)}
                            {getStatusText(t.status)}
                          </span>
                          <span className="text-slate-500">{t.creator.name}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Ticket Workspace Detail & Chat & AI Fix */}
              <div className={`flex-1 flex overflow-hidden relative ${!selectedTicket ? 'hidden md:flex items-center justify-center bg-slate-950/40' : 'flex'}`}>
                {!selectedTicket ? (
                  <div className="text-center p-8 max-w-sm">
                    <div className="h-16 w-16 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center mx-auto mb-4">
                      <MessageSquare className="h-8 w-8 text-slate-600" />
                    </div>
                    <h3 className="text-base font-bold text-slate-400">Nenhum ticket selecionado</h3>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">Selecione um chamado da fila de suporte para visualizar a auditoria, responder ou ver soluções da IA.</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    
                    {/* Chat Column */}
                    <div className="flex-1 flex flex-col border-r border-white/5 bg-slate-950/30 overflow-hidden h-full">
                      {/* Ticket Detail Header */}
                      <div className="p-4 border-b border-white/5 bg-slate-950/20 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setSelectedTicket(null)}
                            className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg border border-white/5 transition-all cursor-pointer text-xs"
                          >
                            Voltar
                          </button>
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              {getStatusDot(selectedTicket.status)}
                              <h2 className="text-sm font-bold text-white line-clamp-1">{selectedTicket.title}</h2>
                            </div>
                            <p className="text-[10px] text-slate-500">
                              {selectedTicket.creator.name} ({selectedTicket.creator.email}) · via {selectedTicket.source} · {formatDate(selectedTicket.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Messages list */}
                      <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        {/* Initial Description Card */}
                        <div className="glass-card rounded-xl p-4 border border-white/5 text-left mb-6 bg-slate-900/10">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Relato Inicial</p>
                          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{selectedTicket.description}</p>
                          
                          {selectedTicket.externalReferenceId && (
                            <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-1.5 text-[10px] text-indigo-400">
                              <Bot className="h-4 w-4 shrink-0 animate-pulse" />
                              <span>Detectado automaticamente no {selectedTicket.source} · ID: {selectedTicket.externalReferenceId}</span>
                            </div>
                          )}
                        </div>

                        {selectedTicket.messages && selectedTicket.messages.map((msg) => {
                          const isOwnMessage = msg.senderId === user?.id;
                          const isAgent = msg.sender.role === 'ADMIN' || msg.sender.role === 'AGENT';
                          
                          return (
                            <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[75%] rounded-2xl p-4 text-left shadow-lg ${
                                isOwnMessage 
                                  ? 'bg-indigo-600 text-white rounded-br-none' 
                                  : isAgent
                                    ? 'bg-slate-900 border border-indigo-500/20 text-slate-100 rounded-bl-none'
                                    : 'bg-slate-900 border border-white/5 text-slate-100 rounded-bl-none'
                              }`}>
                                <div className="flex items-center gap-2 mb-2 opacity-80">
                                  <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isAgent ? 'bg-indigo-500/20 text-indigo-200' : 'bg-white/10 text-slate-200'}`}>
                                    {getInitials(msg.sender.name)}
                                  </div>
                                  <div className="flex-1 flex items-center justify-between gap-4 text-[10px] font-semibold">
                                    <span title={msg.sender.name}>{msg.sender.name} {isAgent && '(TI)'}</span>
                                    <span>{new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                </div>
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Chat Input */}
                      <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-slate-950/20 flex gap-2 shrink-0">
                        <input
                          type="text"
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          placeholder="Responda ao chamado do funcionário aqui..."
                          className="flex-1 px-4 py-3 bg-slate-950 border border-white/5 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                          disabled={chatLoading}
                        />
                        <button
                          type="submit"
                          disabled={chatLoading || !chatMessage.trim()}
                          className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </form>
                    </div>

                    {/* Metadata & AI Fix Column */}
                    <div className="w-full md:w-80 flex flex-col overflow-y-auto shrink-0 bg-slate-950/50 p-4 border-t md:border-t-0 md:border-l border-white/5 h-full">
                      {/* Ticket Control Panel */}
                      <div className="space-y-4 text-left border-b border-white/5 pb-4 mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ações e Controle</h3>
                        
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Status do Chamado</label>
                          <select
                            value={selectedTicket.status}
                            onChange={(e) => handleUpdateTicketMeta({ status: e.target.value })}
                            className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="OPEN">Aberto</option>
                            <option value="IN_PROGRESS">Em Andamento</option>
                            <option value="PENDING">Pendente</option>
                            <option value="RESOLVED">Resolvido</option>
                            <option value="CLOSED">Fechado</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Prioridade / SLA</label>
                          <select
                            value={selectedTicket.priority}
                            onChange={(e) => handleUpdateTicketMeta({ priority: e.target.value })}
                            className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="LOW">Baixa</option>
                            <option value="MEDIUM">Média</option>
                            <option value="HIGH">Alta</option>
                            <option value="URGENT">Urgente</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Técnico Responsável</label>
                          <select
                            value={selectedTicket.assignedToId || ''}
                            onChange={(e) => handleUpdateTicketMeta({ assignedToId: e.target.value ? e.target.value : null })}
                            className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="">Não Atribuído</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Categoria de Triagem</label>
                          <select
                            value={selectedTicket.category}
                            onChange={(e) => handleUpdateTicketMeta({ category: e.target.value })}
                            className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="Hardware">Hardware</option>
                            <option value="Software">Software</option>
                            <option value="Acessos">Acessos</option>
                            <option value="Redes">Redes</option>
                            <option value="Geral">Geral</option>
                          </select>
                        </div>

                        {selectedTicket.resolution && (
                          <div className="pt-2 border-t border-white/5">
                            <label className="block text-[10px] font-semibold text-emerald-500 uppercase mb-1">✅ Resolução Registrada</label>
                            <div className="rounded-xl bg-emerald-950/20 border border-emerald-500/20 p-3 text-xs text-emerald-200 leading-relaxed whitespace-pre-line">
                              {selectedTicket.resolution}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* AI - Direct Fix Panel */}
                      <div className="flex-1 flex flex-col text-left">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                            <Bot className="h-4 w-4 animate-pulse" /> IA - Direct Fix
                          </h3>
                          <button
                            onClick={() => loadAiFix(selectedTicket.id)}
                            disabled={aiFixLoading}
                            className="text-[10px] text-slate-400 hover:text-indigo-400 flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                            title="Recarregar sugestões"
                          >
                            <RefreshCw className={`h-3 w-3 ${aiFixLoading ? 'animate-spin' : ''}`} /> Recarregar
                          </button>
                        </div>

                        <div className="flex-1 rounded-xl bg-indigo-500/5 border border-indigo-500/10 p-4 overflow-y-auto text-xs leading-relaxed text-slate-300 relative shadow-inner">
                          {aiFixLoading ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                              <div className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                              <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">Avaliando solução...</span>
                            </div>
                          ) : (
                            <div className="whitespace-pre-line text-slate-300 leading-relaxed">
                              {aiFixText}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PENDÊNCIAS DO TEAMS / EXCHANGE */}
          {activeTab === 'pending' && (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto text-left max-w-6xl mx-auto w-full">
              <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <MessageSquareWarning className="h-5 w-5 text-yellow-500" /> Pendências Detectadas
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Comunicações identificadas pela IA como chamados técnicos não abertos formalmente.
                  </p>
                </div>
                <button
                  onClick={handleSyncMicrosoft}
                  disabled={syncing}
                  className="flex items-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/15 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Sincronizando...' : 'Varrer Mensagens'}
                </button>
              </div>

              {syncResult && (
                <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border ${
                  syncResult.success
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-300 border-red-500/20'
                }`}>
                  {syncResult.success ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {syncResult.msg}
                </div>
              )}

              {pendingTraces.length === 0 ? (
                <div className="h-80 flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/5 rounded-2xl">
                  <Bot className="h-10 w-10 text-slate-600 mb-3" />
                  <h3 className="text-sm font-bold text-slate-400">Nenhuma pendência identificada</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-md">
                    Todos os chats e e-mails foram analisados. Nenhuma pendência de TI aguarda criação de ticket.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {pendingTraces.map((trace) => (
                    <div key={trace.id} className="glass-card rounded-2xl p-5 border border-white/5 relative overflow-hidden shadow-lg">
                      <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-yellow-500/40 via-amber-500/20 to-transparent" />
                      
                      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              trace.platform === 'TEAMS' 
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' 
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}>
                              {trace.platform === 'TEAMS' ? 'MICROSOFT TEAMS' : 'EXCHANGE EMAIL'}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(trace.receivedAt).toLocaleString('pt-BR')}
                            </span>
                          </div>
                          
                          <p className="text-xs text-slate-500">
                            Remetente: <strong className="text-slate-300">{trace.originalSender}</strong>
                          </p>
                          <p className="text-xs text-slate-500">
                            Canal/Assunto: <strong className="text-slate-300">{trace.channelOrSubject}</strong>
                          </p>
                          
                          <div className="bg-slate-950/60 border border-white/5 rounded-xl p-4 mt-2">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Mensagem:</p>
                            <p className="text-sm text-slate-200 leading-relaxed italic">"{trace.rawContent}"</p>
                          </div>
                        </div>

                        <div className="flex sm:flex-col gap-2 w-full sm:w-auto shrink-0">
                          <button
                            onClick={() => handleApproveTrace(trace.id)}
                            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-emerald-600/10"
                          >
                            <Check className="h-4 w-4" /> Gerar Ticket
                          </button>
                          <button
                            onClick={() => handleIgnoreTrace(trace.id)}
                            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 py-2.5 px-4 bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/5 hover:border-red-500/20 text-slate-300 font-semibold rounded-xl text-xs transition-all cursor-pointer"
                          >
                            <X className="h-4 w-4" /> Ignorar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: KPIS & RELATORIOS */}
          {activeTab === 'kpis' && (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto text-left max-w-6xl mx-auto w-full space-y-6">
              
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-white/5 pb-5">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-indigo-500" /> Relatórios de Suporte e KPIs
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Monitore eficiência operacional, SLAs e MTTR. Filtre por período e exporte em Excel.
                  </p>
                </div>

                {/* Export button */}
                <a
                  href={buildExportUrl()}
                  download
                  className="flex items-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-emerald-600/15 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Exportar Excel com Filtro
                </a>
              </div>

              {/* Date filter row */}
              <div className="glass-card rounded-2xl p-4 border border-white/5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <Calendar className="h-4 w-4 text-indigo-400" />
                  Período:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['today', '7d', '30d', '90d', 'custom'] as DatePreset[]).map(preset => (
                    <button
                      key={preset}
                      onClick={() => setKpiPreset(preset)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                        kpiPreset === preset
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                          : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                      }`}
                    >
                      {presetLabel[preset]}
                    </button>
                  ))}
                </div>

                {kpiPreset === 'custom' && (
                  <div className="flex items-center gap-2 ml-1">
                    <input
                      type="date"
                      value={kpiDateFrom}
                      onChange={e => setKpiDateFrom(e.target.value)}
                      className="px-3 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-slate-500 text-xs">até</span>
                    <input
                      type="date"
                      value={kpiDateTo}
                      onChange={e => setKpiDateTo(e.target.value)}
                      className="px-3 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}

                <span className="ml-auto text-[10px] text-slate-500 font-semibold">
                  {totalTicketsCount} ticket(s) no período
                </span>
              </div>

              {/* KPI Cards Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total */}
                <div className="glass-card rounded-2xl p-5 border border-white/5 text-left space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total de Tickets</p>
                  <p className="text-3xl font-extrabold text-white">{totalTicketsCount}</p>
                  <p className="text-[10px] text-slate-400">
                    {openCount} aberto(s) · {inProgressCount} em andamento
                  </p>
                </div>
                {/* Resolution Rate */}
                <div className="glass-card rounded-2xl p-5 border border-white/5 text-left space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Taxa de Resolução</p>
                  <p className={`text-3xl font-extrabold ${parseInt(resolutionRate) >= 80 ? 'text-emerald-400' : parseInt(resolutionRate) >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {resolutionRate}%
                  </p>
                  <p className="text-[10px] text-slate-400">{resolvedCount} resolvido(s)/fechado(s)</p>
                </div>
                {/* MTTR */}
                <div className="glass-card rounded-2xl p-5 border border-white/5 text-left space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">MTTR</p>
                  <p className="text-3xl font-extrabold text-indigo-400">{mttrHours}h</p>
                  <p className="text-[10px] text-slate-400">Tempo médio de resolução</p>
                </div>
                {/* SLA Breaches */}
                <div className="glass-card rounded-2xl p-5 border border-white/5 text-left space-y-1 relative overflow-hidden">
                  {slaBreaches > 0 && <div className="absolute top-2 right-2 h-2 w-2 bg-red-500 pulse-indicator rounded-full" />}
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Estouro de SLA</p>
                  <p className={`text-3xl font-extrabold ${slaBreaches > 0 ? 'text-red-400' : 'text-white'}`}>{slaBreaches}</p>
                  <p className="text-[10px] text-slate-400">Alta/Urgente abertos &gt; 2h</p>
                </div>
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Pie Chart: Categories */}
                <div className="glass-card rounded-2xl p-6 border border-white/5 text-left flex flex-col h-[360px]">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">Volume por Categoria</h3>
                  <div className="flex-1 flex items-center justify-center relative">
                    {totalCatSum === 0 ? (
                      <div className="text-center text-slate-600 text-xs">
                        <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        Sem dados no período
                      </div>
                    ) : (
                      <svg width="200" height="200" viewBox="-100 -100 200 200" className="transform -rotate-90">
                        {(() => {
                          let cumulativeAngle = 0;
                          const colors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#6b7280'];
                          return categoryCounts.map((count, i) => {
                            if (count === 0) return null;
                            const percentage = count / totalCatSum;
                            const angle = percentage * 360;
                            const startAngle = cumulativeAngle;
                            const endAngle = cumulativeAngle + angle;
                            cumulativeAngle = endAngle;

                            const rad = Math.PI / 180;
                            const x1 = 85 * Math.cos(startAngle * rad);
                            const y1 = 85 * Math.sin(startAngle * rad);
                            const x2 = 85 * Math.cos(endAngle * rad);
                            const y2 = 85 * Math.sin(endAngle * rad);
                            const largeArc = angle > 180 ? 1 : 0;

                            return (
                              <path
                                key={i}
                                d={`M 0 0 L ${x1} ${y1} A 85 85 0 ${largeArc} 1 ${x2} ${y2} Z`}
                                fill={colors[i % colors.length]}
                                stroke="#030712"
                                strokeWidth="2.5"
                                className="transition-all duration-300 hover:opacity-90"
                              />
                            );
                          });
                        })()}
                        <circle r="48" fill="#030712" />
                        {/* Center text via foreignObject workaround */}
                      </svg>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5 text-[10px] text-slate-400 font-semibold">
                    {[
                      { label: 'Hardware', color: '#6366f1', count: categoryCounts[0] },
                      { label: 'Software', color: '#8b5cf6', count: categoryCounts[1] },
                      { label: 'Acessos', color: '#10b981', count: categoryCounts[2] },
                      { label: 'Redes', color: '#f59e0b', count: categoryCounts[3] },
                      { label: 'Geral', color: '#6b7280', count: categoryCounts[4] },
                    ].map(({ label, color, count }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        {label} ({count})
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bar Chart: Status */}
                <div className="glass-card rounded-2xl p-6 border border-white/5 text-left flex flex-col h-[360px]">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">Volume por Status</h3>
                  <div className="flex-1 flex flex-col justify-center space-y-4 px-2">
                    {statuses.map((status, i) => {
                      const count = statusCounts[i];
                      const maxCount = Math.max(...statusCounts, 1);
                      const pct = (count / maxCount) * 100;
                      const colorMap: Record<string, string> = {
                        OPEN: 'from-sky-500 to-indigo-500',
                        IN_PROGRESS: 'from-yellow-500 to-amber-500',
                        RESOLVED: 'from-emerald-500 to-teal-500',
                        CLOSED: 'from-slate-500 to-gray-500',
                      };
                      return (
                        <div key={status} className="space-y-1.5">
                          <div className="flex justify-between text-[11px] font-bold text-slate-300">
                            <span className="flex items-center gap-1.5">{getStatusDot(status)} {getStatusText(status)}</span>
                            <span>{count} ({totalTicketsCount > 0 ? ((count / totalTicketsCount) * 100).toFixed(0) : 0}%)</span>
                          </div>
                          <div className="h-3 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-gradient-to-r ${colorMap[status] || 'from-indigo-600 to-violet-600'} rounded-full transition-all duration-700`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Source mini breakdown */}
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Por Canal de Origem</p>
                    <div className="flex gap-3">
                      {sources.map((src, i) => (
                        <div key={src} className="flex-1 text-center">
                          <p className="text-lg font-extrabold text-white">{sourceCounts[i]}</p>
                          <p className="text-[10px] text-slate-500">{sourceLabels[i]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent tickets table */}
              {kpiTickets.length > 0 && (
                <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Tickets Recentes no Período</h3>
                    <span className="text-[10px] text-slate-500">{Math.min(kpiTickets.length, 10)} de {kpiTickets.length}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5 bg-slate-950/40">
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Título</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Categoria</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Prioridade</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Status</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Solicitante</th>
                          <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">Abertura</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpiTickets.slice(0, 10).map((t, i) => (
                          <tr key={t.id} className={`border-b border-white/5 hover:bg-white/2.5 transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                            <td className="px-4 py-2.5 text-slate-200 font-medium max-w-[200px] truncate">{t.title}</td>
                            <td className="px-4 py-2.5 text-slate-400">{t.category}</td>
                            <td className="px-4 py-2.5">{getPriorityBadge(t.priority)}</td>
                            <td className="px-4 py-2.5">
                              <span className="flex items-center gap-1.5">
                                {getStatusDot(t.status)}
                                {getStatusText(t.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-400">{t.creator.name}</td>
                            <td className="px-4 py-2.5 text-slate-500 text-[10px]">
                              {new Date(t.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 4: SIMULADOR DE INJEÇÃO */}
          {activeTab === 'simulator' && (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto text-left max-w-2xl mx-auto w-full space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Zap className="h-5 w-5 text-indigo-500" /> Simulador de Comunicação Externa
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Injete mensagens simuladas do Teams ou e-mails corporativos para testar a triagem automática.
                </p>
              </div>

              <div className="glass-card rounded-2xl p-6 border border-white/5 relative shadow-lg">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />

                <form onSubmit={handleSimulate} className="space-y-5">
                  {simSuccessMsg && (
                    <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-4 flex items-start gap-2.5 text-indigo-200 text-xs">
                      <Sparkles className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                      <span>{simSuccessMsg}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Canal</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSimPlatform('TEAMS')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${simPlatform === 'TEAMS' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'}`}
                      >
                        Microsoft Teams
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimPlatform('EXCHANGE')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${simPlatform === 'EXCHANGE' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'}`}
                      >
                        Exchange / Outlook
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Nome do Funcionário</label>
                      <input
                        type="text"
                        value={simSenderName}
                        onChange={(e) => setSimSenderName(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        placeholder="Ex: João Silva"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">E-mail do Funcionário</label>
                      <input
                        type="email"
                        value={simSenderEmail}
                        onChange={(e) => setSimSenderEmail(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        placeholder="joao@empresa.com"
                      />
                    </div>
                  </div>

                  {simPlatform === 'EXCHANGE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Assunto do E-mail</label>
                      <input
                        type="text"
                        value={simSubject}
                        onChange={(e) => setSimSubject(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        placeholder="Ex: Acesso bloqueado no sistema"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Texto da Mensagem</label>
                    <textarea
                      value={simContent}
                      onChange={(e) => setSimContent(e.target.value)}
                      rows={4}
                      className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs resize-none"
                      placeholder="Ex: Oi, o link da VPN parou de funcionar e está dando erro 800. Consegue ajudar? Estou sem trabalhar."
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={simLoading || !simContent.trim()}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-600/10 disabled:opacity-50 cursor-pointer"
                  >
                    {simLoading ? 'Processando com IA...' : 'Injetar Mensagem no Monitoramento'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: AI CONFIGURATIONS */}
          {activeTab === 'settings' && (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto text-left max-w-2xl mx-auto w-full space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-indigo-500" /> Configurações de IA e Integrações
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure chaves, endpoints e contas monitoradas pelo Teams/Outlook.
                </p>
              </div>

              <div className="glass-card rounded-2xl p-6 border border-white/5 relative shadow-lg">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />

                <form onSubmit={handleSaveSettings} className="space-y-5">
                  {settingsSaveSuccess && (
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-2.5 text-emerald-200 text-xs">
                      <Check className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{settingsSaveSuccess}</span>
                    </div>
                  )}

                  {/* AI Provider */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Provedor de IA</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAiProvider('GEMINI')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${aiProvider === 'GEMINI' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'}`}
                      >
                        Gemini Pro/Flash (Google)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiProvider('CUSTOM')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${aiProvider === 'CUSTOM' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'}`}
                      >
                        API Customizada (REST)
                      </button>
                    </div>
                  </div>

                  {aiProvider === 'GEMINI' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Google Gemini API Key</label>
                      <input
                        type="password"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        placeholder="Insira sua GEMINI_API_KEY"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Utilizado para triagem de chamados e sugestões de solução com gemini-2.5-flash.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">URL do Endpoint (POST)</label>
                        <input
                          type="url"
                          value={customAiUrl}
                          onChange={(e) => setCustomAiUrl(e.target.value)}
                          className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                          placeholder="https://sua-ia.corporativa.com/v1/chat/completions"
                          required={aiProvider === 'CUSTOM'}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Token de Autenticação (Opcional)</label>
                        <input
                          type="password"
                          value={customAiKey}
                          onChange={(e) => setCustomAiKey(e.target.value)}
                          className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                          placeholder="Bearer token, se necessário"
                        />
                      </div>
                    </div>
                  )}

                  {/* Integration Config */}
                  <div className="pt-4 border-t border-white/5 space-y-4">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 text-indigo-400" /> Integração Microsoft 365
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setTeamsEnabled(v => !v)}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          teamsEnabled
                            ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                            : 'bg-slate-950 border-white/5 text-slate-500'
                        }`}
                      >
                        <span>Microsoft Teams</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${teamsEnabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                          {teamsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExchangeEnabled(v => !v)}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          exchangeEnabled
                            ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-950 border-white/5 text-slate-500'
                        }`}
                      >
                        <span>Exchange / E-mail</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${exchangeEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                          {exchangeEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Buscar mensagens a partir de</label>
                        <input
                          type="date"
                          value={syncSinceDate}
                          onChange={(e) => setSyncSinceDate(e.target.value)}
                          className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Mensagens mais antigas serão ignoradas.</p>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Intervalo de verificação (min)</label>
                        <input
                          type="number"
                          min="5"
                          max="1440"
                          value={syncIntervalMinutes}
                          onChange={(e) => setSyncIntervalMinutes(e.target.value)}
                          className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Referência para automação futura.</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Contas Microsoft 365 a Monitorar
                      </label>
                      <input
                        type="text"
                        value={monitoredAccounts}
                        onChange={(e) => setMonitoredAccounts(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                        placeholder="user@example.com, support@example.com"
                        required
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Separe múltiplas contas por vírgula. O sistema monitorará Teams e Exchange dessas caixas.
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={settingsLoading}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-600/10 disabled:opacity-50 cursor-pointer"
                  >
                    {settingsLoading ? 'Salvando...' : 'Salvar Configurações'}
                  </button>
                </form>
              </div>

              <div className="p-4 bg-slate-950/20 border border-white/5 rounded-xl text-xs text-slate-400 leading-relaxed">
                <span className="font-semibold text-slate-200">ℹ️ Modo de Simulação:</span> Sem credenciais configuradas, o sistema opera em modo simulado fornecendo respostas realistas para homologação e auditoria técnica.
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
