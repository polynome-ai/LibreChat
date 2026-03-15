import { ioredisClient } from '~/cache/redisClients';
import { SessionManager } from './SessionManager';

export const sessionManager = new SessionManager(ioredisClient);
