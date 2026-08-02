import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'

/**
 * Auth.js v5.
 *
 * JWT sessions rather than database sessions: the Credentials provider cannot
 * use the database strategy, and a JWT keeps the per-request tenant lookup to
 * a single indexed query in `context.ts`.
 *
 * The token deliberately carries only the user id. Salon, role and permissions
 * are resolved fresh on every request, so revoking a membership takes effect
 * immediately rather than whenever the token happens to expire.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login', error: '/login' },
  trustHost: true,
  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const user = await unsafeDb.user.findUnique({
          where: { email: parsed.data.email.toLowerCase().trim() },
          select: { id: true, email: true, name: true, image: true, passwordHash: true },
        })

        // Compare against a dummy hash when the user is missing so the response
        // time does not reveal whether an email is registered.
        const hash =
          user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'
        const ok = await bcrypt.compare(parsed.data.password, hash)
        if (!user?.passwordHash || !ok) return null

        await unsafeDb.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      return session
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}
