import { useState, useRef, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import { CSSTransition } from 'react-transition-group';
import type { TMessage } from 'librechat-data-provider';
import { useScreenshot, useMessageScrolling, useLocalize } from '~/hooks';
import ScrollToBottom from '~/components/Messages/ScrollToBottom';
import { MessagesViewProvider } from '~/Providers';
import { fontSizeAtom } from '~/store/fontSize';
import MultiMessage from './MultiMessage';
import { cn } from '~/utils';
import store from '~/store';

function flattenMessages(messages?: TMessage[] | null): TMessage[] {
  if (!Array.isArray(messages)) return [];

  const result: TMessage[] = [];

  const visit = (msg: TMessage) => {
    result.push(msg);

    if (Array.isArray(msg.children)) {
      msg.children.forEach(visit);
    }
  };

  messages.forEach(visit);
  return result;
}

function uniqByMessageId(messages: TMessage[]): TMessage[] {
  const map = new Map<string, TMessage>();

  for (const msg of messages) {
    if (!msg?.messageId) continue;
    map.set(String(msg.messageId), msg);
  }

  return Array.from(map.values());
}

function MessagesViewContent({
  messagesTree: _messagesTree,
}: {
  messagesTree?: TMessage[] | null;
}) {
  const localize = useLocalize();
  const fontSize = useAtomValue(fontSizeAtom);
  const { screenshotTargetRef } = useScreenshot();
  const scrollButtonPreference = useRecoilValue(store.showScrollButton);
  const [currentEditId, setCurrentEditId] = useState<number | string | null>(-1);
  const scrollToBottomRef = useRef<HTMLButtonElement>(null);

  const {
    conversation,
    scrollableRef,
    messagesEndRef,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  } = useMessageScrolling(_messagesTree);

  const { conversationId } = conversation ?? {};

  // Преобразуем дерево в плоский массив и сортируем по времени
  const flatMessages = useMemo(() => {
    const msgs = flattenMessages(_messagesTree);
    return msgs.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [_messagesTree]);

  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative h-full">
        <div
          className="scrollbar-gutter-stable"
          onScroll={debouncedHandleScroll}
          ref={scrollableRef}
          style={{ height: '100%', overflowY: 'auto', width: '100%' }}
        >
          <div className="flex flex-col pb-9 pt-14 dark:bg-transparent">
            {(!flatMessages || flatMessages.length === 0) ? (
              <div className={cn('flex w-full items-center justify-center p-3 text-text-secondary', fontSize)}>
                {localize('com_ui_nothing_found')}
              </div>
            ) : (
              <div ref={screenshotTargetRef}>
                <MultiMessage
                  key={conversationId}
                  messagesTree={_messagesTree}
                  messageId={null}
                  setCurrentEditId={setCurrentEditId}
                  currentEditId={currentEditId ?? null}
                />
              </div>
            )}
            <div
              id="messages-end"
              className="group h-0 w-full flex-shrink-0"
              ref={messagesEndRef}
            />
          </div>
        </div>

        <CSSTransition
          in={showScrollButton && scrollButtonPreference}
          timeout={{ enter: 550, exit: 700 }}
          classNames="scroll-animation"
          unmountOnExit={true}
          appear={true}
          nodeRef={scrollToBottomRef}
        >
          <ScrollToBottom ref={scrollToBottomRef} scrollHandler={handleSmoothToRef} />
        </CSSTransition>
      </div>
    </div>
  );
}

export default function MessagesView({ messagesTree }: { messagesTree?: TMessage[] | null }) {
  return (
    <MessagesViewProvider>
      <MessagesViewContent messagesTree={messagesTree} />
    </MessagesViewProvider>
  );
}