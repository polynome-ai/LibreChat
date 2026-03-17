import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useToastContext, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useVoiceBridge } from '~/hooks/useVoiceBridge';
import { cn } from '~/utils';

interface VoiceBridgeButtonProps {
  conversationId: string | null;
  disabled?: boolean;
}

const isRealConversationId = (id: string | null): id is string =>
  !!id && id !== Constants.NEW_CONVO;

// How long to wait after TranscriptionReceived marks a segment final before
// auto-removing a streaming placeholder that never received an SSE replacement
// (e.g. filler speech played with add_to_chat_ctx=False).
const FILLER_CLEANUP_DELAY_MS = 3000;

export default function VoiceBridgeButton({
  conversationId,
  disabled,
}: VoiceBridgeButtonProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();

  const activeConversationId = isRealConversationId(conversationId) ? conversationId : null;

  // Set of all tempIds for streaming voice messages currently in the cache.
  // Using a Set lets us clear ALL stale streaming messages (e.g. filler + real response).
  const streamingAgentIdsRef = useRef<Set<string>>(new Set());

  const removeStreamingMessages = useCallback(
    (idsToRemove: Set<string>) => {
      if (!activeConversationId || idsToRemove.size === 0) return;
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, activeConversationId],
        (existing = []) => existing.filter((m) => !idsToRemove.has(m.messageId)),
      );
    },
    [queryClient, activeConversationId],
  );

  const handleTranscript = useCallback(
    (text: string, isAgent: boolean, messageId: string, sender: string) => {
      if (!activeConversationId) return;
      const now = new Date().toISOString();

      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, activeConversationId],
        (existing = []) => {
          // Remove ALL streaming voice placeholders when a final message arrives for agent
          const idsToRemove = isAgent ? new Set(streamingAgentIdsRef.current) : new Set<string>();
          if (isAgent) streamingAgentIdsRef.current.clear();

          const base = idsToRemove.size > 0
            ? existing.filter((m) => !idsToRemove.has(m.messageId))
            : existing;

          const lastMsg = base[base.length - 1];
          const parentMessageId = lastMsg?.messageId ?? Constants.NO_PARENT;

          const newMessage: TMessage = {
            messageId: messageId || `voice-${Date.now()}`,
            conversationId: activeConversationId,
            parentMessageId,
            text,
            sender: sender || (isAgent ? 'AI' : 'User'),
            isCreatedByUser: !isAgent,
            createdAt: now,
            updatedAt: now,
            unfinished: false,
            error: false,
          };

          return [...base, newMessage];
        },
      );
    },
    [queryClient, activeConversationId],
  );

  const handleAgentStreaming = useCallback(
    (tempId: string, text: string) => {
      if (!activeConversationId) return;
      streamingAgentIdsRef.current.add(tempId);
      const now = new Date().toISOString();

      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, activeConversationId],
        (existing = []) => {
          // Remove only this specific streaming message (update in place)
          const withoutThis = existing.filter((m) => m.messageId !== tempId);
          const lastMsg = withoutThis[withoutThis.length - 1];
          const parentMessageId = lastMsg?.messageId ?? Constants.NO_PARENT;

          // Derive sender from the last AI message in cache so it shows the right name
          const lastAiMsg = [...withoutThis].reverse().find((m) => !m.isCreatedByUser);
          const streamingSender = lastAiMsg?.sender ?? 'AI';

          const streamingMsg: TMessage = {
            messageId: tempId,
            conversationId: activeConversationId,
            parentMessageId,
            text,
            sender: streamingSender,
            isCreatedByUser: false,
            createdAt: now,
            updatedAt: now,
            unfinished: false,
            error: false,
          };

          return [...withoutThis, streamingMsg];
        },
      );
    },
    [queryClient, activeConversationId],
  );

  const handleAgentStreamingDone = useCallback(
    (tempId: string) => {
      // SSE on_transcript_final should arrive shortly and replace the streaming message.
      // However, filler phrases (add_to_chat_ctx=False) never produce an SSE event.
      // After the delay, remove the placeholder only if it is STILL unfinished (i.e. was
      // not already replaced by a real on_transcript_final message).
      setTimeout(() => {
        if (!activeConversationId) return;
        streamingAgentIdsRef.current.delete(tempId);
        queryClient.setQueryData<TMessage[]>(
          [QueryKeys.messages, activeConversationId],
          (existing = []) => existing.filter((m) => m.messageId !== tempId),
        );
      }, FILLER_CLEANUP_DELAY_MS);
    },
    [queryClient, activeConversationId],
  );

  const { status, error, connect, disconnect } = useVoiceBridge({
    conversationId: activeConversationId,
    onTranscript: handleTranscript,
    onAgentStreaming: handleAgentStreaming,
    onAgentStreamingDone: handleAgentStreamingDone,
  });

  useEffect(() => {
    if (error) {
      showToast({ message: error, status: 'error' });
    }
  }, [error, showToast]);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting' || status === 'disconnecting';
  const isDisabled = disabled || !activeConversationId || isConnecting;

  const handleClick = async () => {
    if (isConnected) {
      await disconnect();
    } else {
      await connect();
    }
  };

  return (
    <TooltipAnchor
      description={isConnected ? localize('com_ui_voice_stop') : localize('com_ui_voice_start')}
      render={
        <button
          type="button"
          disabled={isDisabled}
          onClick={handleClick}
          aria-label={isConnected ? localize('com_ui_voice_stop') : localize('com_ui_voice_start')}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
            isConnected
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-token-text-secondary hover:bg-token-surface-secondary',
            isDisabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {isConnecting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isConnected ? (
            <PhoneOff className="h-5 w-5" />
          ) : (
            <Phone className="h-5 w-5" />
          )}
        </button>
      }
    />
  );
}
