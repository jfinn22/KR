import bcrypt from 'bcryptjs'

/**
 * Password hashing, deliberately apart from the Auth.js config.
 *
 * `config.ts` imports next-auth, which cannot be loaded outside a Next runtime
 * — so anything importing `hashPassword` from there drags the whole framework
 * in with it, and the signup service became untestable the moment it did.
 * Hashing a password is not an Auth.js concern anyway.
 */

/** Cost 10: the usual trade between a slow login and a slow attacker. */
const ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
