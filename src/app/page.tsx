'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail, ShieldAlert, Cpu, CheckCircle } from 'lucide-react';

function redirectForRole(role: string, router: ReturnType<typeof useRouter>) {
  const r = (role || '').toUpperCase();
  if (r === 'ADMIN' || r === 'TECHNICIAN' || r === 'AGENT') {
    router.push('/admin');
  } else {
    router.push('/client');
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [area, setArea] = useState<'client' | 'admin'>('client');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingSso, setCheckingSso] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function hasPortalCookie(): boolean {
      // Soft-SSO only when EmployeeHub left a JWT cookie (default abzToken).
      const name = process.env.NEXT_PUBLIC_PORTAL_JWT_COOKIE?.trim() || 'abzToken';
      return document.cookie.split(';').some((part) => part.trim().startsWith(`${name}=`));
    }

    async function tryExistingSession() {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (!cancelled && meData.user?.role) {
            redirectForRole(meData.user.role, router);
            return;
          }
        }

        if (!hasPortalCookie()) {
          return;
        }

        const ssoRes = await fetch('/api/auth/sso', {
          method: 'POST',
          credentials: 'include',
        });
        if (ssoRes.ok) {
          const ssoData = await ssoRes.json();
          if (!cancelled && ssoData.success && ssoData.user?.role) {
            redirectForRole(ssoData.user.role, router);
            return;
          }
        }
      } catch {
        // stay on login
      } finally {
        if (!cancelled) setCheckingSso(false);
      }
    }

    tryExistingSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, area }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao realizar login');
      }

      if (!data.user?.role) {
        throw new Error('Login sem papel de usuário — tente novamente.');
      }

      redirectForRole(data.user.role, router);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Falha na conexão com o servidor.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden bg-[#030712]">
      {/* Background glowing blobs */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl -z-10"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-600/5 rounded-full blur-3xl -z-10"></div>

      <div className="w-full max-w-md">
        {/* Branding header */}
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4 ring-1 ring-white/10">
            <Cpu className="h-8 w-8 text-white animate-pulse" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-indigo-200">
            Ticket-Manager <span className="text-indigo-400">AI</span>
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Plataforma Inteligente de Chamados e Auditoria
          </p>
          <p className="mt-3 text-xs text-slate-500 max-w-sm">
            Cliente: credenciais do Portal. Operador ADMIN: local. Operador técnico: mesmas credenciais do Portal.
          </p>
        </div>

        {/* Login Card */}
        <div className="glass-card rounded-2xl p-8 relative overflow-hidden shadow-2xl">
          {/* Card subtle top highlight */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent"></div>

          {checkingSso ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400 text-sm">
              <div className="h-6 w-6 border-2 border-white/20 border-t-indigo-400 rounded-full animate-spin" />
              Verificando sessão…
            </div>
          ) : (
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950/70 border border-white/5">
              <button
                type="button"
                onClick={() => setArea('client')}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  area === 'client'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Cliente (Portal)
              </button>
              <button
                type="button"
                onClick={() => setArea('admin')}
                className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                  area === 'admin'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Operador
              </button>
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex items-start gap-2.5 text-red-200 text-sm animate-shake">
                <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <span className="break-words max-w-[320px]">{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Endereço de E-mail
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="h-5 w-5" />
                </div>
                <input
                  type="email"
                  name="username"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-white/5 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  placeholder="exemplo@empresa.com"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Senha de Acesso
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <KeyRound className="h-5 w-5" />
                </div>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-white/5 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold rounded-xl text-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-lg shadow-indigo-600/20 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                'Entrar na plataforma'
              )}
            </button>
          </form>
          )}
        </div>

        {/* Small footer */}
        <p className="mt-8 text-center text-xs text-slate-500 flex justify-center items-center gap-1">
          <CheckCircle className="h-3 w-3 text-emerald-500" /> Servidor Ativo | Supabase PostgreSQL
        </p>
      </div>
    </div>
  );
}
