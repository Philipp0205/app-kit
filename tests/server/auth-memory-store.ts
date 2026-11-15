import type { AuthStore, AuthUser, LinkKind } from "../../server/auth.ts";

type UserRow = AuthUser & { recoveryHash: string; createdAt: number };
type LinkRow = { tokenHash: string; userId: string; kind: LinkKind; email: string; expiresAt: number };

/** An in-memory AuthStore for tests, with the same rules the kit asks of a real one. Not a test file itself. */
export function memoryStore() {
  const users = new Map<string, UserRow>();
  const sessions: { userId: string; tokenHash: string; createdAt: number }[] = [];
  let links: LinkRow[] = [];

  const view = (row: UserRow | undefined): AuthUser | undefined =>
    row && { id: row.id, name: row.name, email: row.email, emailVerifiedAt: row.emailVerifiedAt };

  const store: AuthStore = {
    insertUser(user) {
      users.set(user.id, { ...user, emailVerifiedAt: null });
    },
    findUserById: (id) => view(users.get(id)),
    findUserByRecoveryHash: (hash) => view([...users.values()].find((u) => u.recoveryHash === hash)),
    findUserByVerifiedEmail: (email) =>
      view([...users.values()].find((u) => u.email === email && u.emailVerifiedAt !== null)),
    setRecoveryHash(userId, hash) {
      const row = users.get(userId);
      if (row) row.recoveryHash = hash;
    },
    setEmail(userId, email) {
      const row = users.get(userId);
      if (row) {
        row.email = email;
        row.emailVerifiedAt = null;
      }
    },
    markEmailVerified(userId, email, at) {
      const row = users.get(userId);
      if (!row || row.email !== email) return false;
      if ([...users.values()].some((u) => u.id !== userId && u.email === email && u.emailVerifiedAt !== null)) return false;
      row.emailVerifiedAt = at;
      return true;
    },
    insertSession(session) {
      sessions.push({ ...session });
    },
    findUserBySessionHash(tokenHash) {
      const session = sessions.find((s) => s.tokenHash === tokenHash);
      return session ? view(users.get(session.userId)) : undefined;
    },
    deleteSession(tokenHash) {
      const i = sessions.findIndex((s) => s.tokenHash === tokenHash);
      if (i >= 0) sessions.splice(i, 1);
    },
    deleteSessionsForUser(userId, exceptTokenHash) {
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].userId === userId && sessions[i].tokenHash !== exceptTokenHash) sessions.splice(i, 1);
      }
    },
    insertLink(link) {
      links.push({ ...link });
    },
    takeLink(tokenHash, kind, now) {
      const i = links.findIndex((l) => l.tokenHash === tokenHash && l.kind === kind);
      if (i < 0) return undefined;
      const [link] = links.splice(i, 1);
      return link.expiresAt > now ? { userId: link.userId, email: link.email } : undefined;
    },
    deleteLinksForUser(userId, kind) {
      links = links.filter((l) => !(l.userId === userId && l.kind === kind));
    },
  };

  return {
    store,
    users,
    sessions,
    links: () => links,
    /** Puts a user in directly, e.g. a legacy user with a null email or one that is already verified. */
    seedUser(user: Partial<UserRow> & { id: string }): UserRow {
      const row: UserRow = {
        name: "Seed",
        email: null,
        emailVerifiedAt: null,
        recoveryHash: `seed-${user.id}`,
        createdAt: 0,
        ...user,
      };
      users.set(row.id, row);
      return row;
    },
  };
}
