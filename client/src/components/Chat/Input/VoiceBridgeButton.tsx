import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilValue } from 'recoil';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useToastContext, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useVoiceBridge } from '~/hooks/useVoiceBridge';
import { cn } from '~/utils';
import store from '~/store';

interface VoiceBridgeButtonProps {
  disabled?: boolean;
}

const isRealConversationId = (id: string | null): id is string =>
  !!id && id !== Constants.NEW_CONVO;

// How long to wait after TranscriptionReceived marks a segment final before
// auto-removing a streaming placeholder that never received an SSE replacement
// (e.g. filler speech played with add_to_chat_ctx=False).
const FILLER_CLEANUP_DELAY_MS = 3000;

export default function VoiceBridgeButton({
  disabled,
}: VoiceBridgeButtonProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();

  const conversation = useRecoilValue(store.conversationByIndex(0));
  const activeConversationId = conversation?.conversationId ?? null;

  // Set of all tempIds for streaming voice messages currently in the cache.
  // Separate active and completed streaming IDs to avoid race conditions
  const activeStreamingIdsRef = useRef<Set<string>>(new Set());
  const completedStreamingIdsRef = useRef<Set<string>>(new Set());

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
          // If user speech, interrupt any active agent streaming and remove unfinished agent message
          if (!isAgent) {
            const idsToRemove = new Set(activeStreamingIdsRef.current);
            activeStreamingIdsRef.current.clear();
            if (idsToRemove.size > 0) {
              existing = existing.filter((m) => !idsToRemove.has(m.messageId));
              // Also remove the last unfinished agent message to prevent branching
              const lastMsg = existing[existing.length - 1];
              if (lastMsg && !lastMsg.isCreatedByUser && lastMsg.unfinished) {
                existing = existing.slice(0, -1);
              }
            }
          }

          // Remove only completed streaming voice placeholders when a final message arrives for agent
          // But ignore if there are active streams (to prevent adding finals for interrupted responses)
          const idsToRemove = isAgent && activeStreamingIdsRef.current.size === 0 ? new Set(completedStreamingIdsRef.current) : new Set<string>();
          if (isAgent && activeStreamingIdsRef.current.size === 0) completedStreamingIdsRef.current.clear();

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
      activeStreamingIdsRef.current.add(tempId);
      const now = new Date().toISOString();

      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, activeConversationId],
        (existing = []) => {
          // Remove only this specific streaming message (update in place)
          const withoutThis = existing.filter((m) => m.messageId !== tempId);
          const lastMsg = withoutThis[withoutThis.length - 1];
          const parentMessageId = lastMsg?.messageId ?? Constants.NO_PARENT;

          // If the last message is an unfinished agent message, update it instead of adding a new one
          if (lastMsg && !lastMsg.isCreatedByUser && lastMsg.unfinished) {
            return withoutThis.map((m) =>
              m.messageId === lastMsg.messageId
                ? { ...m, text, updatedAt: now }
                : m
            );
          }

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
      // Move from active to completed
      activeStreamingIdsRef.current.delete(tempId);
      completedStreamingIdsRef.current.add(tempId);
      // SSE on_transcript_final should arrive shortly and replace the streaming message.
      // However, filler phrases (add_to_chat_ctx=False) never produce an SSE event.
      // After the delay, remove the placeholder only if it is STILL unfinished (i.e. was
      // not already replaced by a real on_transcript_final message).
      setTimeout(() => {
        if (!activeConversationId) return;
        completedStreamingIdsRef.current.delete(tempId);
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
