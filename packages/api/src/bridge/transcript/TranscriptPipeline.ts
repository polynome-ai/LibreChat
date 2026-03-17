import { v4 as uuidv4 } from 'uuid';
import { logger } from '@librechat/data-schemas';
import { GenerationJobManager } from '~/stream';
import type { BridgeSession, TranscriptFragment } from '~/bridge/types';
import { TranscriptBuffer } from './TranscriptBuffer';

interface SyntheticReq {
  user: { id: string };
}

type SaveMessageFn = (
  req: SyntheticReq,
  params: Record<string, unknown>,
  metadata?: { context: string },
) => Promise<unknown>;

type GetMessagesFn = (
  filter: Record<string, unknown>,
  select?: string,
) => Promise<Array<{ messageId?: string; sender?: string; isCreatedByUser?: boolean; endpoint?: string }>>;

/**
 * Orchestrates: transcript fragment → SSE emit → persist to DB.
 * Never calls completeJob() — only voice/stop route does that.
 */
export class TranscriptPipeline {
  private buffers = new Map<string, TranscriptBuffer>();
  private lastMessageIdPerConvo = new Map<string, string | null>();
  private senderPerConvo = new Map<string, string | null>();

  constructor(
    private readonly saveMessage: SaveMessageFn,
    private readonly getMessages?: GetMessagesFn,
    private readonly agentSender: string = 'Voice Agent',
  ) {}

  async processFragment(session: BridgeSession, fragment: TranscriptFragment, agentSender?: string): Promise<void> {
    const { conversationId, userId, agentIdentity } = session;
    const isAgent = fragment.participantIdentity === agentIdentity;

    if (fragment.kind === 'partial') {
      if (isAgent) await this.emitPartialChunk(conversationId, fragment);
      return;
    }

    const buf = this.getBuffer(conversationId);
    const finalText = buf.ingest(fragment);
    if (!finalText) {
      logger.warn(`[TranscriptPipeline] Empty final for utterance ${fragment.utteranceId}`);
      return;
    }

    const { parentId, existingSender } = await this.ensureInit(conversationId);
    const sender = isAgent
      ? (agentSender ?? existingSender ?? this.agentSender)
      : 'User';

    const messageId = uuidv4();
    await this.persistMessage({ userId, conversationId, messageId, parentMessageId: parentId, text: finalText, isCreatedByUser: !isAgent, sender });

    this.lastMessageIdPerConvo.set(conversationId, messageId);

    await GenerationJobManager.emitChunk(conversationId, {
      event: 'on_transcript_final',
      data: { messageId, text: finalText, isAgent, sender, isVoice: true },
    });
  }

  removeBuffer(conversationId: string): void {
    this.buffers.delete(conversationId);
    this.lastMessageIdPerConvo.delete(conversationId);
    this.senderPerConvo.delete(conversationId);
  }

  private getBuffer(conversationId: string): TranscriptBuffer {
    let buf = this.buffers.get(conversationId);
    if (!buf) { buf = new TranscriptBuffer(); this.buffers.set(conversationId, buf); }
    return buf;
  }

  /**
   * Lazy-initializes parentMessageId and existingSender for a conversation.
   * On first call: loads last message from DB to establish the parent chain and sender name.
   * Subsequent calls: returns cached values (updated after each saved message).
   */
  private async ensureInit(conversationId: string): Promise<{ parentId: string | null; existingSender: string | null }> {
    if (this.lastMessageIdPerConvo.has(conversationId)) {
      return {
        parentId: this.lastMessageIdPerConvo.get(conversationId) ?? null,
        existingSender: this.senderPerConvo.get(conversationId) ?? null,
      };
    }

    if (!this.getMessages) {
      this.lastMessageIdPerConvo.set(conversationId, null);
      this.senderPerConvo.set(conversationId, null);
      return { parentId: null, existingSender: null };
    }

    try {
      const msgs = await this.getMessages({ conversationId }, 'messageId sender isCreatedByUser endpoint');
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const parentId = lastMsg?.messageId ?? null;
      // Look for sender from a non-voice text chat assistant message (most reliable display name)
      const existingSender = msgs.find(
        (m) => m.isCreatedByUser === false
          && m.sender
          && (m as Record<string, unknown>)['endpoint'] !== 'voice-bridge',
      )?.sender ?? null;

      this.lastMessageIdPerConvo.set(conversationId, parentId);
      this.senderPerConvo.set(conversationId, existingSender ?? null);

      return { parentId, existingSender: existingSender ?? null };
    } catch (err) {
      logger.warn('[TranscriptPipeline] ensureInit failed:', err);
      this.lastMessageIdPerConvo.set(conversationId, null);
      this.senderPerConvo.set(conversationId, null);
      return { parentId: null, existingSender: null };
    }
  }

  private async emitPartialChunk(conversationId: string, fragment: TranscriptFragment): Promise<void> {
    await GenerationJobManager.emitChunk(conversationId, {
      event: 'on_message_delta',
      data: { delta: { content: fragment.text }, isVoice: true, utteranceId: fragment.utteranceId },
    });
  }

  private async persistMessage(params: { userId: string; conversationId: string; messageId: string; parentMessageId: string | null; text: string; sender: string; isCreatedByUser: boolean }): Promise<void> {
    try {
      await this.saveMessage(
        { user: { id: params.userId } },
        { messageId: params.messageId, conversationId: params.conversationId, parentMessageId: params.parentMessageId, text: params.text, sender: params.sender, isCreatedByUser: params.isCreatedByUser, unfinished: false, error: false, endpoint: 'voice-bridge' },
        { context: 'TranscriptPipeline' },
      );
    } catch (err) {
      logger.error('[TranscriptPipeline] Failed to persist message:', err);
    }
  }
}
