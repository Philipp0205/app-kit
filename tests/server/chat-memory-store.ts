import type { ChatMessage, ChatStore } from "../../server/chat.ts";

/** An in-memory ChatStore for tests, with the rules the kit asks of a real one. Not a test file itself. */
export function memoryChatStore() {
  const messages: ChatMessage[] = [];
  const names = new Map<string, string>();
  const reads = new Map<string, number>();
  const mutes = new Set<string>();
  const calls = { unreadCounts: 0 };
  const key = (userId: string, chatId: string): string => JSON.stringify([userId, chatId]);

  const store: ChatStore = {
    listMessages(chatId, limit) {
      const own = messages.filter((m) => m.chatId === chatId);
      return own.slice(Math.max(0, own.length - limit));
    },
    insertMessage(message) {
      messages.push({ ...message, userName: names.get(message.userId) ?? "" });
    },
    setReadAt(userId, chatId, at) {
      reads.set(key(userId, chatId), at);
    },
    unreadCounts(userId, chatIds) {
      calls.unreadCounts += 1;
      const out: Record<string, number> = {};
      for (const chatId of chatIds) {
        const readAt = reads.get(key(userId, chatId)) ?? 0;
        out[chatId] = messages.filter((m) => m.chatId === chatId && m.userId !== userId && m.createdAt > readAt).length;
      }
      return out;
    },
    setMuted(userId, chatId, muted) {
      if (muted) mutes.add(key(userId, chatId));
      else mutes.delete(key(userId, chatId));
    },
    isMuted: (userId, chatId) => mutes.has(key(userId, chatId)),
  };

  return {
    store,
    messages,
    calls,
    /** What the app's users table would give the join in listMessages. */
    setName(userId: string, name: string): void {
      names.set(userId, name);
    },
  };
}
