import { useEffect, useCallback } from 'react';
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

export default function VoiceBridgeButton({
  conversationId,
  disabled,
}: VoiceBridgeButtonProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();

  const activeConversationId = isRealConversationId(conversationId) ? conversationId : null;

  const handleTranscript = useCallback(
    (text: string, isAgent: boolean, messageId: string, sender: string) => {
      if (!activeConversationId) return;
      const now = new Date().toISOString();
      const newMessage: TMessage = {
        messageId: messageId || `voice-${Date.now()}`,
        conversationId: activeConversationId,
        parentMessageId: null,
        text,
        sender: sender || (isAgent ? 'AI' : 'User'),
        isCreatedByUser: !isAgent,
        createdAt: now,
        updatedAt: now,
        unfinished: false,
        error: false,
      };
      const existing = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, activeConversationId]) ?? [];
      queryClient.setQueryData([QueryKeys.messages, activeConversationId], [...existing, newMessage]);
    },
    [queryClient, activeConversationId],
  );

  const { status, error, connect, disconnect } = useVoiceBridge({
    conversationId: activeConversationId,
    onTranscript: handleTranscript,
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
