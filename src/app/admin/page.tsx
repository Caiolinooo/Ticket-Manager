'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LogOut, MessageSquare, AlertCircle, CheckCircle, Clock, Send, 
  ShieldAlert, User, Cpu, Sparkles, Filter, Search, Download, 
  RefreshCw, Bot, Check, X, BarChart3, Database, MessageSquareWarning, 
  Settings2, ChevronRight,
  Zap, Wrench, Pencil, UserPlus
} from 'lucide-react';
import {
  canAccessOperatorArea,
  canManageSettings,
  canSyncMicrosoft,
  roleDisplayLabel,
} from '@/lib/permissions';
import { RoleBadge } from '@/components/permission-gates';
import { KpiDashboard } from '@/components/kpi-dashboard';

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

type ReceiveMode = 'SHARED_WITH_ADMIN' | 'OWN_ONLY';

interface Technician {
  id: string;
  name: string;
  email: string;
  role: string;
  monitoredEmails: string[];
  monitoredTeamsAccounts: string[];
  receiveMode: ReceiveMode;
  active: boolean;
  createdAt: string;
  portalUserId?: string | null;
  authSource?: string | null;
}

interface PortalUserHit {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: string;
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
  createdById?: string | null;
  assignedToId?: string | null;
  createdAt: string;
  resolvedAt?: string;
  creator: { name: string; email: string };
  assignee?: { id: string; name: string; email: string };
  messages: Message[];
}

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
  /** Sector-wide tickets for KPI/dashboard — never filtered by technician mailbox */
  const [sectorTickets, setSectorTickets] = useState<Ticket[]>([]);
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

  // Technicians (ADMIN settings)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [technicianError, setTechnicianError] = useState('');
  const [technicianSuccess, setTechnicianSuccess] = useState('');
  const [technicianSaving, setTechnicianSaving] = useState(false);
  const [editingTechnicianId, setEditingTechnicianId] = useState<string | null>(null);
  const [techFormName, setTechFormName] = useState('');
  const [techFormEmail, setTechFormEmail] = useState('');
  const [techFormPortalUserId, setTechFormPortalUserId] = useState('');
  const [techFormMonitoredEmails, setTechFormMonitoredEmails] = useState('');
  const [techFormTeamsAccounts, setTechFormTeamsAccounts] = useState('');
  const [techFormReceiveMode, setTechFormReceiveMode] = useState<ReceiveMode>('SHARED_WITH_ADMIN');
  const [techFormActive, setTechFormActive] = useState(true);
  const [portalSearchQuery, setPortalSearchQuery] = useState('');
  const [portalSearchResults, setPortalSearchResults] = useState<PortalUserHit[]>([]);
  const [portalSearchLoading, setPortalSearchLoading] = useState(false);
  const [portalSearchHint, setPortalSearchHint] = useState('');
  const portalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolution Modal State
  const [showResolutionModal, setShowResolutionModal] = useState(false);
  const [resolutionText, setResolutionText] = useState('');
  const [pendingCloseStatus, setPendingCloseStatus] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** Sector-wide tickets for Relatórios & KPIs (fallback: operator mailbox tickets). */
  const kpiSourceTickets = sectorTickets.length > 0 ? sectorTickets : tickets;

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

  const resetTechnicianForm = () => {
    setEditingTechnicianId(null);
    setTechFormName('');
    setTechFormEmail('');
    setTechFormPortalUserId('');
    setTechFormMonitoredEmails('');
    setTechFormTeamsAccounts('');
    setTechFormReceiveMode('SHARED_WITH_ADMIN');
    setTechFormActive(true);
    setPortalSearchQuery('');
    setPortalSearchResults([]);
    setPortalSearchHint('');
    setTechnicianError('');
  };

  const loadTechnicians = async () => {
    setTechniciansLoading(true);
    setTechnicianError('');
    try {
      const res = await fetch('/api/settings/technicians', { credentials: 'include' });
      if (res.status === 403) {
        setTechnicians([]);
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTechnicianError(data.error || 'Falha ao carregar técnicos');
        return;
      }
      setTechnicians(data.technicians || []);
    } catch (err: unknown) {
      setTechnicianError(err instanceof Error ? err.message : 'Erro ao carregar técnicos');
    } finally {
      setTechniciansLoading(false);
    }
  };

  const searchPortalUsers = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setPortalSearchResults([]);
      setPortalSearchHint(trimmed ? 'Digite ao menos 2 caracteres' : '');
      return;
    }
    setPortalSearchLoading(true);
    setPortalSearchHint('');
    try {
      const res = await fetch(
        `/api/settings/technicians/portal-users?q=${encodeURIComponent(trimmed)}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPortalSearchResults([]);
        setPortalSearchHint(data.error || 'Falha na busca do Portal');
        return;
      }
      const users = (data.users || []) as PortalUserHit[];
      setPortalSearchResults(users);
      setPortalSearchHint(users.length === 0 ? 'Nenhum usuário encontrado no Portal' : '');
    } catch (err: unknown) {
      setPortalSearchResults([]);
      setPortalSearchHint(err instanceof Error ? err.message : 'Erro ao buscar no Portal');
    } finally {
      setPortalSearchLoading(false);
    }
  };

  const onPortalSearchChange = (value: string) => {
    setPortalSearchQuery(value);
    if (portalSearchTimer.current) clearTimeout(portalSearchTimer.current);
    portalSearchTimer.current = setTimeout(() => {
      void searchPortalUsers(value);
    }, 300);
  };

  const selectPortalUser = (hit: PortalUserHit) => {
    setTechFormPortalUserId(hit.id);
    setTechFormName(hit.name);
    setTechFormEmail(hit.email);
    setPortalSearchQuery('');
    setPortalSearchResults([]);
    setPortalSearchHint('');
    setTechnicianError('');
  };

  const startEditTechnician = (tech: Technician) => {
    setEditingTechnicianId(tech.id);
    setTechFormName(tech.name);
    setTechFormEmail(tech.email);
    setTechFormPortalUserId(tech.portalUserId || '');
    setTechFormMonitoredEmails(tech.monitoredEmails.join(', '));
    setTechFormTeamsAccounts(tech.monitoredTeamsAccounts.join(', '));
    setTechFormReceiveMode(tech.receiveMode);
    setTechFormActive(tech.active);
    setPortalSearchQuery('');
    setPortalSearchResults([]);
    setTechnicianError('');
    setTechnicianSuccess('');
  };

  const parseCsvEmails = (raw: string): string[] =>
    raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

  const handleSaveTechnician = async (e: React.FormEvent) => {
    e.preventDefault();
    setTechnicianSaving(true);
    setTechnicianError('');
    setTechnicianSuccess('');
    try {
      const isEdit = Boolean(editingTechnicianId);

      if (!isEdit && !techFormPortalUserId && !techFormEmail) {
        setTechnicianError('Selecione um usuário do Portal');
        return;
      }

      const common = {
        monitoredEmails: parseCsvEmails(techFormMonitoredEmails),
        monitoredTeamsAccounts: parseCsvEmails(techFormTeamsAccounts),
        receiveMode: techFormReceiveMode,
        active: techFormActive,
      };

      const url = isEdit
        ? `/api/settings/technicians/${editingTechnicianId}`
        : '/api/settings/technicians';
      const body = isEdit
        ? common
        : {
            ...common,
            portalUserId: techFormPortalUserId || undefined,
            email: techFormEmail || undefined,
          };

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTechnicianError(data.error || 'Falha ao salvar técnico');
        return;
      }
      setTechnicianSuccess(isEdit ? 'Técnico atualizado.' : 'Técnico criado (login = Portal).');
      resetTechnicianForm();
      await loadTechnicians();
      setTimeout(() => setTechnicianSuccess(''), 4000);
    } catch (err: unknown) {
      setTechnicianError(err instanceof Error ? err.message : 'Erro ao salvar técnico');
    } finally {
      setTechnicianSaving(false);
    }
  };

  const handleToggleTechnicianActive = async (tech: Technician) => {
    setTechnicianError('');
    try {
      const res = await fetch(`/api/settings/technicians/${tech.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: !tech.active }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTechnicianError(data.error || 'Falha ao alterar status');
        return;
      }
      await loadTechnicians();
    } catch (err: unknown) {
      setTechnicianError(err instanceof Error ? err.message : 'Erro ao alterar status');
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!userRes.ok) { router.replace('/'); return; }
        const userData = await userRes.json();
        if (!canAccessOperatorArea(userData.user)) {
          router.replace('/client'); return;
        }
        setUser(userData.user);

        const ticketsRes = await fetch('/api/tickets', { credentials: 'include' });
        if (ticketsRes.ok) {
          const ticketsData = await ticketsRes.json();
          setTickets(ticketsData.tickets || []);
        }

        // Unified sector KPIs — same totals for ADMIN and TECHNICIAN
        const kpiRes = await fetch('/api/kpi', { credentials: 'include' });
        if (kpiRes.ok) {
          const kpiData = await kpiRes.json();
          setSectorTickets(kpiData.tickets || []);
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

        if (canManageSettings(userData.user)) {
          await loadSettings();
          await loadTechnicians();
        }
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

  const buildExportUrl = (from: string, to: string) => {
    const params = new URLSearchParams();
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);
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
              Ticket-Manager <RoleBadge role={user?.role} />
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

          {canSyncMicrosoft(user) && (
          <button
            onClick={handleSyncMicrosoft}
            disabled={syncing}
            title="Verificar novas pendências no Teams e Exchange"
            className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Verificar Canais'}
          </button>
          )}
          
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-bold text-xs shadow ring-1 ring-white/10">
              {user ? getInitials(user.name) : '?'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-slate-200">{user?.name}</p>
              <p className="text-[10px] text-slate-500">{roleDisplayLabel(user?.role)}</p>
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
              ...(canSyncMicrosoft(user) ? [{ tab: 'simulator', icon: Zap, label: 'Simulador' }] : []),
              ...(canManageSettings(user) ? [{ tab: 'settings', icon: Settings2, label: 'Configurações' }] : []),
            ].map(({ tab, icon: Icon, label, badge, badgeColor }: any) => (
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
            ...(canSyncMicrosoft(user) ? [{ tab: 'simulator', icon: Zap, label: 'Simulador' }] : []),
            ...(canManageSettings(user) ? [{ tab: 'settings', icon: Settings2, label: 'Config' }] : []),
          ].map(({ tab, icon: Icon, label, hasDot }: any) => (
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
                          const isAgent =
                            msg.sender.role === 'ADMIN' ||
                            msg.sender.role === 'AGENT' ||
                            msg.sender.role === 'TECHNICIAN';
                          
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
                {canSyncMicrosoft(user) && (
                <button
                  onClick={handleSyncMicrosoft}
                  disabled={syncing}
                  className="flex items-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/15 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Sincronizando...' : 'Varrer Mensagens'}
                </button>
                )}
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
            <KpiDashboard
              tickets={kpiSourceTickets}
              buildExportUrl={buildExportUrl}
              getPriorityBadge={getPriorityBadge}
              getStatusDot={getStatusDot}
              getStatusText={getStatusText}
            />
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

              {user?.role === 'ADMIN' && (
                <div className="glass-card rounded-2xl p-6 border border-white/5 relative shadow-lg space-y-5">
                  <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-emerald-400" /> Técnicos
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Vincule operadores TECHNICIAN a usuários do Portal. Login = e-mail e senha do Portal.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { resetTechnicianForm(); void loadTechnicians(); }}
                      className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg border border-white/5 cursor-pointer"
                    >
                      {techniciansLoading ? '...' : 'Atualizar'}
                    </button>
                  </div>

                  {technicianSuccess && (
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 text-emerald-200 text-xs flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      {technicianSuccess}
                    </div>
                  )}
                  {technicianError && (
                    <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-3 text-rose-200 text-xs flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      {technicianError}
                    </div>
                  )}

                  <div className="space-y-2">
                    {technicians.length === 0 && !techniciansLoading && (
                      <p className="text-xs text-slate-500 py-2">Nenhum técnico cadastrado.</p>
                    )}
                    {technicians.map((tech) => (
                      <div
                        key={tech.id}
                        className={`rounded-xl border px-3 py-2.5 flex items-start justify-between gap-3 ${
                          tech.active ? 'border-white/5 bg-slate-950/40' : 'border-white/5 bg-slate-950/20 opacity-70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white truncate">{tech.name}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tech.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>
                              {tech.active ? 'ATIVO' : 'INATIVO'}
                            </span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                              {tech.receiveMode === 'OWN_ONLY' ? 'OWN_ONLY' : 'SHARED_WITH_ADMIN'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{tech.email}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Auth: {tech.authSource === 'portal' || tech.portalUserId ? 'Portal' : 'legado'}
                            {tech.portalUserId ? ` · ${tech.portalUserId.slice(0, 8)}…` : ''}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-1">
                            E-mails: {tech.monitoredEmails.length ? tech.monitoredEmails.join(', ') : '—'}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Teams: {tech.monitoredTeamsAccounts.length ? tech.monitoredTeamsAccounts.join(', ') : '—'}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditTechnician(tech)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg border border-white/5 cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleTechnicianActive(tech)}
                            className="text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg border border-white/5 cursor-pointer"
                          >
                            {tech.active ? 'Desativar' : 'Ativar'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleSaveTechnician} className="pt-4 border-t border-white/5 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                      <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
                      {editingTechnicianId ? 'Editar técnico' : 'Adicionar técnico (Portal)'}
                      {editingTechnicianId && (
                        <button
                          type="button"
                          onClick={resetTechnicianForm}
                          className="ml-auto text-[10px] text-slate-500 hover:text-white cursor-pointer"
                        >
                          Cancelar edição
                        </button>
                      )}
                    </div>

                    {!editingTechnicianId && (
                      <div className="space-y-2">
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">
                          Buscar usuário no Portal
                        </label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                          <input
                            type="search"
                            value={portalSearchQuery}
                            onChange={(e) => onPortalSearchChange(e.target.value)}
                            className="block w-full pl-9 pr-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-xs"
                            placeholder="Nome ou e-mail no Portal…"
                            autoComplete="off"
                          />
                        </div>
                        {portalSearchLoading && (
                          <p className="text-[10px] text-slate-500">Buscando…</p>
                        )}
                        {portalSearchHint && !portalSearchLoading && (
                          <p className="text-[10px] text-slate-500">{portalSearchHint}</p>
                        )}
                        {portalSearchResults.length > 0 && (
                          <ul className="max-h-40 overflow-y-auto rounded-xl border border-white/5 bg-slate-950/80 divide-y divide-white/5">
                            {portalSearchResults.map((hit) => (
                              <li key={hit.id}>
                                <button
                                  type="button"
                                  onClick={() => selectPortalUser(hit)}
                                  className="w-full text-left px-3 py-2 hover:bg-emerald-950/30 cursor-pointer"
                                >
                                  <span className="block text-xs font-semibold text-white truncate">{hit.name}</span>
                                  <span className="block text-[10px] text-slate-400 truncate">{hit.email}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {(techFormEmail || editingTechnicianId) && (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-2">
                        <p className="text-[10px] font-semibold text-emerald-300 uppercase">Usuário selecionado</p>
                        <p className="text-xs font-bold text-white mt-0.5">{techFormName || '—'}</p>
                        <p className="text-[10px] text-slate-400">{techFormEmail}</p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Login do técnico = mesmas credenciais do Portal (sem senha local).
                        </p>
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">
                        monitoredEmails (caixas Exchange)
                      </label>
                      <input
                        type="text"
                        value={techFormMonitoredEmails}
                        onChange={(e) => setTechFormMonitoredEmails(e.target.value)}
                        className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-xs"
                        placeholder="caixa1@example.com, caixa2@example.com"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">
                        monitoredTeamsAccounts (UPNs Teams)
                      </label>
                      <input
                        type="text"
                        value={techFormTeamsAccounts}
                        onChange={(e) => setTechFormTeamsAccounts(e.target.value)}
                        className="block w-full px-3 py-2 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-xs"
                        placeholder="tecnico@example.com"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1.5">receiveMode</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTechFormReceiveMode('SHARED_WITH_ADMIN')}
                          className={`flex-1 py-2 rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${
                            techFormReceiveMode === 'SHARED_WITH_ADMIN'
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          SHARED_WITH_ADMIN
                        </button>
                        <button
                          type="button"
                          onClick={() => setTechFormReceiveMode('OWN_ONLY')}
                          className={`flex-1 py-2 rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${
                            techFormReceiveMode === 'OWN_ONLY'
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          OWN_ONLY
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        SHARED: contas do técnico + contas compartilhadas do admin/setor. OWN_ONLY: só as dele.
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={techFormActive}
                        onChange={(e) => setTechFormActive(e.target.checked)}
                        className="rounded border-white/20"
                      />
                      Ativo
                    </label>

                    <button
                      type="submit"
                      disabled={technicianSaving || (!editingTechnicianId && !techFormPortalUserId && !techFormEmail)}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {technicianSaving
                        ? 'Salvando...'
                        : editingTechnicianId
                          ? 'Salvar alterações'
                          : 'Criar técnico'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
