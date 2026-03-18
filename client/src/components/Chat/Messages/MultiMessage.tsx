import type { TMessage } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import MessageContent from '~/components/Messages/MessageContent';
import MessageParts from './MessageParts';
import Message from './Message';

export default function MultiMessage({
  messagesTree,
  currentEditId,
  setCurrentEditId,
}: TMessageProps) {
  if (!messagesTree || messagesTree.length === 0) {
    return null;
  }

  return (
    <>
      {messagesTree.map((message, idx) => {
        if (!message) return null;

        // Ассистенты (с частями сообщения)
        if (message.endpoint && message.content && message.endpoint.includes('assistant')) {
          return (
            <MessageParts
              key={message.messageId}
              message={message}
              currentEditId={currentEditId}
              setCurrentEditId={setCurrentEditId}
            />
          );
        }

        // Сообщения с контентом
        if (message.content) {
          return (
            <MessageContent
              key={message.messageId}
              message={message}
              currentEditId={currentEditId}
              setCurrentEditId={setCurrentEditId}
            />
          );
        }

        // Любые другие типы сообщений
        return (
          <Message
            key={message.messageId}
            message={message}
            currentEditId={currentEditId}
            setCurrentEditId={setCurrentEditId}
          />
        );
      })}
    </>
  );
}