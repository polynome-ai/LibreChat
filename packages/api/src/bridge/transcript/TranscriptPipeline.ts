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

/**
 * Orchestrates: transcript fragment → SSE emit → persist to DB.
 * Never calls completeJob() — only voice/stop route does that.
 */
export class TranscriptPipeline {
  private buffers = new Map<string, TranscriptBuffer>();

  constructor(
    private readonly saveMessage: SaveMessageFn,
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

    const sender = isAgent ? (agentSender ?? this.agentSender) : 'User';
    const messageId = uuidv4();
    await this.persistMessage({ userId, conversationId, messageId, text: finalText, isCreatedByUser: !isAgent, sender });
    await GenerationJobManager.emitChunk(conversationId, {
      event: 'on_transcript_final',
      data: { messageId, text: finalText, isAgent, sender, isVoice: true },
    });
  }

  removeBuffer(conversationId: string): void {
    this.buffers.delete(conversationId);
  }

  private getBuffer(conversationId: string): TranscriptBuffer {
    let buf = this.buffers.get(conversationId);
    if (!buf) { buf = new TranscriptBuffer(); this.buffers.set(conversationId, buf); }
    return buf;
  }

  private async emitPartialChunk(conversationId: string, fragment: TranscriptFragment): Promise<void> {
    await GenerationJobManager.emitChunk(conversationId, {
      event: 'on_message_delta',
      data: { delta: { content: fragment.text }, isVoice: true, utteranceId: fragment.utteranceId },
    });
  }

  private async persistMessage(params: { userId: string; conversationId: string; messageId: string; text: string; sender: string; isCreatedByUser: boolean }): Promise<void> {
    try {
      await this.saveMessage(
        { user: { id: params.userId } },
        { messageId: params.messageId, conversationId: params.conversationId, text: params.text, sender: params.sender, isCreatedByUser: params.isCreatedByUser, unfinished: false, error: false, endpoint: 'voice-bridge' },
        { context: 'TranscriptPipeline' },
      );
    } catch (err) {
      logger.error('[TranscriptPipeline] Failed to persist message:', err);
    }
  }
}
