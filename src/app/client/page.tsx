'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LogOut, Plus, MessageSquare, AlertCircle, 
  HelpCircle, CheckCircle, Clock, Send, ShieldAlert, User, Sparkles
} from 'lucide-react';
import { categorySelectOptions } from '@/lib/ticket-categories';

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

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  source: string;
  externalReferenceId?: string | null;
  assignedToId?: string | null;
  createdAt: string;
  creator: { name: string; email: string };
  assignee?: { name: string; email: string };
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

export default function ClientPortal() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  
  // New ticket form
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('Geral');
  const [newPriority, setNewPriority] = useState('MEDIUM');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Chat message
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Fetch Session & Tickets
    async function loadData() {
      try {
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!userRes.ok) {
          router.replace('/');
          return;
        }
        const userData = await userRes.json();
        setUser(userData.user);

        const ticketsRes = await fetch('/api/tickets', { credentials: 'include' });
        if (ticketsRes.ok) {
          const ticketsData = await ticketsRes.json();
          setTickets(ticketsData.tickets);
        }
      } catch (err) {
        console.error('Error loading data:', err instanceof Error ? err.message : err);
        router.replace('/');
      }
    }
    loadData();
  }, [router]);

  useEffect(() => {
    // Scroll to bottom of chat
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedTicket?.messages]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDescription.trim()) {
      setFormError('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    setFormError('');
    setFormLoading(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          category: newCategory,
          priority: newPriority,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao abrir chamado');

      setTickets([data.ticket, ...tickets]);
      setShowNewModal(false);
      setNewTitle('');
      setNewDescription('');
      setNewCategory('Geral');
      setNewPriority('MEDIUM');
    } catch (err: any) {
      setFormError(err.message || 'Falha ao criar chamado.');
    } finally {
      setFormLoading(false);
    }
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

      // Append message
      const updatedMessages = [...(selectedTicket.messages || []), data.message];
      const updatedTicket = { ...selectedTicket, messages: updatedMessages };
      
      // Update tickets list and selection
      setTickets(tickets.map(t => t.id === selectedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
      setChatMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleCloseTicket = async (status: 'CLOSED' | 'RESOLVED') => {
    if (!selectedTicket) return;

    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update locally
      const updatedTicket = { ...selectedTicket, status };
      setTickets(tickets.map(t => t.id === selectedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return <span className="flex items-center gap-1 text-xs text-sky-400 font-medium"><Clock className="h-3.5 w-3.5" /> Aberto</span>;
      case 'IN_PROGRESS':
        return <span className="flex items-center gap-1 text-xs text-yellow-400 font-medium"><Clock className="h-3.5 w-3.5 animate-spin" /> Em Andamento</span>;
      case 'RESOLVED':
        return <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium"><CheckCircle className="h-3.5 w-3.5" /> Resolvido</span>;
      case 'CLOSED':
        return <span className="flex items-center gap-1 text-xs text-slate-400 font-medium"><CheckCircle className="h-3.5 w-3.5" /> Fechado</span>;
      default:
        return <span className="flex items-center gap-1 text-xs text-slate-400 font-medium">{status}</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Top navbar */}
      <header className="glass-card border-b border-white/5 py-4 px-6 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/10 ring-1 ring-white/10">
            <Sparkles className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Portal do Cliente</h1>
            <p className="text-[10px] text-slate-400">Logado como funcionário</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8.5 w-8.5 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center text-slate-300 font-bold text-xs" title={user?.name}>
              {user ? getInitials(user.name) : <User className="h-4 w-4" />}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-slate-200">{user?.name}</p>
              <p className="text-[10px] text-slate-500">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/5 rounded-xl transition-all cursor-pointer"
            title="Sair do portal"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Tickets List */}
        <div className={`flex-1 md:flex-initial md:w-[450px] flex flex-col border-r border-white/5 bg-slate-950/20 overflow-hidden ${selectedTicket ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Meus Chamados</h2>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/10"
            >
              <Plus className="h-3.5 w-3.5" /> Novo Chamado
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tickets.length === 0 ? (
              <div className="h-60 flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/5 rounded-xl">
                <HelpCircle className="h-8 w-8 text-slate-500 mb-2" />
                <p className="text-sm text-slate-400 font-semibold">Nenhum chamado aberto</p>
                <p className="text-xs text-slate-500 mt-1">Precisa de ajuda de TI? Clique em Novo Chamado acima.</p>
              </div>
            ) : (
              tickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicket(t)}
                  className={`glass-card glass-card-hover rounded-xl p-4 cursor-pointer text-left ${selectedTicket?.id === t.id ? 'border-indigo-500/40 bg-indigo-500/5' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-semibold text-slate-200 line-clamp-1 flex-1">{t.title}</h3>
                    {getPriorityBadge(t.priority)}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">{t.description}</p>
                  
                  <div className="flex items-center justify-between border-t border-white/5 pt-2.5 text-[11px] text-slate-500">
                    <span className="bg-white/5 px-2 py-0.5 rounded text-[10px] text-slate-400 font-medium">{t.category}</span>
                    {getStatusBadge(t.status)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Active Ticket Chat Thread */}
        <div className={`flex-1 flex flex-col bg-slate-950/40 relative overflow-hidden ${!selectedTicket ? 'hidden md:flex items-center justify-center' : 'flex'}`}>
          {!selectedTicket ? (
            <div className="text-center p-8 max-w-sm">
              <MessageSquare className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-400">Nenhum chamado selecionado</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">Selecione um chamado da lista para ver o histórico e falar com o suporte de TI.</p>
            </div>
          ) : (
            <>
              {/* Active Ticket Header */}
              <div className="p-4 border-b border-white/5 bg-slate-950/20 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setSelectedTicket(null)}
                    className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg border border-white/5 transition-all cursor-pointer"
                  >
                    Voltar
                  </button>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h2 className="text-sm font-bold text-slate-200 line-clamp-1">{selectedTicket.title}</h2>
                      {getPriorityBadge(selectedTicket.priority)}
                    </div>
                    <p className="text-xs text-slate-500">
                      ID: {selectedTicket.id.substring(0, 8)}... | Aberto em {new Date(selectedTicket.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTicket.status !== 'CLOSED' && selectedTicket.status !== 'RESOLVED' && (
                    <button
                      onClick={() => handleCloseTicket('RESOLVED')}
                      className="py-1.5 px-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-semibold rounded-lg text-xs transition-all cursor-pointer"
                    >
                      Marcar Resolvido
                    </button>
                  )}
                  <span className="hidden sm:inline bg-slate-900 border border-white/10 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold uppercase">
                    {selectedTicket.category}
                  </span>
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Initial Description Card */}
                <div className="glass-card rounded-xl p-4 border border-white/5 text-left mb-6 bg-slate-900/10">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Descrição Original do Chamado</p>
                  <p className="text-sm text-slate-300 leading-relaxed white-space-pre-line">{selectedTicket.description}</p>
                  {selectedTicket.assignee && (
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2 text-xs text-slate-400">
                      <div className="h-5 w-5 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] text-indigo-400 font-bold">T</div>
                      <span>Atendido por: <strong className="text-indigo-300">{selectedTicket.assignee.name}</strong></span>
                    </div>
                  )}
                </div>

                {/* Message list */}
                {selectedTicket.messages && selectedTicket.messages.map((msg) => {
                  const isOwnMessage = msg.senderId === user?.id;
                  const isAgent = msg.sender.role === 'ADMIN' || msg.sender.role === 'AGENT' || msg.sender.role === 'TECHNICIAN';
                  
                  return (
                    <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl p-4 text-left shadow-lg ${
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
                            <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
              {selectedTicket.status !== 'CLOSED' && selectedTicket.status !== 'RESOLVED' ? (
                <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-slate-950/20 flex gap-2 shrink-0">
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    placeholder="Digite sua resposta aqui para o analista de TI..."
                    className="flex-1 px-4 py-3 bg-slate-950 border border-white/5 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatMessage.trim()}
                    className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all cursor-pointer disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <div className="p-4 border-t border-white/5 bg-slate-900/20 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5 shrink-0">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  Este chamado foi solucionado. Caso precise de mais ajuda, abra uma nova solicitação.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent"></div>
            
            <div className="p-6 border-b border-white/5">
              <h2 className="text-base font-bold text-white">Solicitar Suporte de TI</h2>
              <p className="text-xs text-slate-400 mt-1">Abra um ticket para relatar problemas de hardware, softwares ou acesso.</p>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 space-y-4 text-left">
              {formError && (
                <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex items-start gap-2.5 text-red-200 text-sm">
                  <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Título do Problema *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                  placeholder="Ex: Acesso bloqueado ao SAP ou VPN instável"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Categoria *</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                  >
                    {categorySelectOptions(newCategory).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Impacto/Urgência *</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                  >
                    <option value="LOW">Baixo (Dúvidas/Melhorias)</option>
                    <option value="MEDIUM">Médio (Problema pontual)</option>
                    <option value="HIGH">Alto (Setor afetado/Parcialmente inativo)</option>
                    <option value="URGENT">Urgente (Trabalho totalmente impedido)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Descrição Detalhada *</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={4}
                  className="block w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm resize-none"
                  placeholder="Por favor, explique o que está acontecendo. Se houver códigos de erro, mencione-os aqui para que a IA analise."
                  required
                />
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="py-2.5 px-4 bg-white/5 hover:bg-white/10 text-slate-300 font-semibold rounded-xl text-xs transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-indigo-600/10 disabled:opacity-50"
                >
                  {formLoading ? 'Criando...' : 'Abrir Chamado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
