import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import * as crypto from 'crypto';
import { cookies } from 'next/headers';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'E-mail e senha são obrigatórios' }, { status: 400 });
    }

    const passwordHash = hashPassword(password);
    
    // Find user
    const user = await prisma.supportUser.findUnique({
      where: { email }
    });

    if (!user || user.passwordHash !== passwordHash) {
      return NextResponse.json({ success: false, error: 'Credenciais inválidas' }, { status: 401 });
    }

    // Set session cookie
    const sessionData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    const sessionString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    
    const cookieStore = await cookies();
    cookieStore.set('session', sessionString, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 24, // 1 day
      path: '/'
    });

    // Also write an audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        details: `Usuário ${user.name} logou no sistema.`
      }
    });

    return NextResponse.json({
      success: true,
      user: sessionData
    });
  } catch (error: any) {
    console.error('Login API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
