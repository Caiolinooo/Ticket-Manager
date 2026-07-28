import { NextResponse } from 'next/server';
import { searchPortalUsers } from '@/lib/portal-auth';
import { requireAdmin } from '../_helpers';

/**
 * GET /api/settings/technicians/portal-users?q=
 * ADMIN only — search Portal (users_unified) by name/email. No password hashes.
 */
export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return NextResponse.json({
        success: true,
        users: [],
        message: 'Digite ao menos 2 caracteres para buscar no Portal',
      });
    }

    const users = await searchPortalUsers(q, 25);
    return NextResponse.json({ success: true, users });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    console.error('portal-users search error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
