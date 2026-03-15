import { logger } from '@librechat/data-schemas';
import type { Redis, Cluster } from 'ioredis';
import type { BridgeSession, BridgeMode, BridgeSessionUpdate } from '~/bridge/types';

const SESSION_KEY = (conversationId: string) => `bridge:session:{${conversationId}}`;
const SESSION_TTL_SECS = 7200;

/**
 * Redis-backed bridge session store.
 * Falls back to in-memory Map when Redis is unavailable.
 */
export class SessionManager {
  private memoryFallback = new Map<string, BridgeSession>();

  constructor(private readonly redis: Redis | Cluster | null) {}

  async createSession(params: {
    conversationId: string;
    userId: string;
    liveKitRoomId: string;
    liveKitRoomSid: string;
    agentIdentity: string;
    mode: BridgeMode;
  }): Promise<BridgeSession> {
    const now = Date.now();
    const session: BridgeSession = {
      sessionId: params.conversationId,
      conversationId: params.conversationId,
      userId: params.userId,
      liveKitRoomId: params.liveKitRoomId,
      liveKitRoomSid: params.liveKitRoomSid,
      agentIdentity: params.agentIdentity,
      mode: params.mode,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.write(params.conversationId, session);
    return session;
  }

  async getSession(conversationId: string): Promise<BridgeSession | null> {
    if (!this.redis) {
      return this.memoryFallback.get(conversationId) ?? null;
    }
    try {
      const data = await this.redis.hgetall(SESSION_KEY(conversationId));
      if (!data || Object.keys(data).length === 0) return null;
      return this.deserialize(data);
    } catch (err) {
      logger.error('[SessionManager] getSession error:', err);
      return this.memoryFallback.get(conversationId) ?? null;
    }
  }

  async getSessionForUser(conversationId: string, userId: string): Promise<BridgeSession | null> {
    const session = await this.getSession(conversationId);
    if (!session || session.userId !== userId) return null;
    return session;
  }

  async updateSession(conversationId: string, updates: BridgeSessionUpdate): Promise<void> {
    const existing = await this.getSession(conversationId);
    if (!existing) return;
    const updated: BridgeSession = { ...existing, ...updates, updatedAt: Date.now() };
    await this.write(conversationId, updated);
  }

  async deleteSession(conversationId: string): Promise<void> {
    this.memoryFallback.delete(conversationId);
    if (!this.redis) return;
    try {
      await this.redis.del(SESSION_KEY(conversationId));
    } catch (err) {
      logger.error('[SessionManager] deleteSession error:', err);
    }
  }

  private async write(conversationId: string, session: BridgeSession): Promise<void> {
    this.memoryFallback.set(conversationId, session);
    if (!this.redis) return;
    try {
      const key = SESSION_KEY(conversationId);
      await this.redis.hset(key, this.serialize(session));
      await this.redis.expire(key, SESSION_TTL_SECS);
    } catch (err) {
      logger.error('[SessionManager] write error:', err);
    }
  }

  private serialize(session: BridgeSession): Record<string, string> {
    return {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      userId: session.userId,
      liveKitRoomId: session.liveKitRoomId,
      liveKitRoomSid: session.liveKitRoomSid,
      agentIdentity: session.agentIdentity,
      mode: session.mode,
      status: session.status,
      createdAt: String(session.createdAt),
      updatedAt: String(session.updatedAt),
    };
  }

  private deserialize(data: Record<string, string>): BridgeSession {
    return {
      sessionId: data.sessionId,
      conversationId: data.conversationId,
      userId: data.userId,
      liveKitRoomId: data.liveKitRoomId,
      liveKitRoomSid: data.liveKitRoomSid,
      agentIdentity: data.agentIdentity,
      mode: data.mode as BridgeMode,
      status: data.status as BridgeSession['status'],
      createdAt: Number(data.createdAt),
      updatedAt: Number(data.updatedAt),
    };
  }
}
