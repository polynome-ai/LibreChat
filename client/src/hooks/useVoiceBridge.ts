import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';

export type VoiceBridgeStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';

interface UseVoiceBridgeOptions {
  conversationId: string | null;
  onTranscript?: (text: string, isAgent: boolean, messageId: string, sender: string) => void;
  onInterimTranscript?: (text: string) => void;
  onUserSpeech?: (text: string) => void;
}

interface VoiceSession {
  token: string;
  roomName: string;
  serverUrl: string;
  sessionId: string;
}

function getAuthHeader(): Record<string, string> {
  const auth = axios.defaults.headers.common['Authorization'];
  return typeof auth === 'string' ? { Authorization: auth } : {};
}

async function startVoiceSession(conversationId: string): Promise<VoiceSession> {
  const res = await fetch(
    `/api/bridge/conversation/${encodeURIComponent(conversationId)}/voice/start`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() } },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Failed to start voice session');
  }
  return res.json() as Promise<VoiceSession>;
}

async function stopVoiceSession(conversationId: string): Promise<void> {
  await fetch(`/api/bridge/conversation/${encodeURIComponent(conversationId)}/voice/stop`, {
    method: 'POST',
    headers: getAuthHeader(),
  });
}

function buildStreamUrl(conversationId: string): string {
  const auth = axios.defaults.headers.common['Authorization'];
  const token = typeof auth === 'string' ? auth.replace('Bearer ', '') : '';
  const params = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/bridge/conversation/${encodeURIComponent(conversationId)}/stream${params}`;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface ISpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface ISpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: ISpeechRecognitionResult };
}

function createSpeechRecognition(): ISpeechRecognition | null {
  const w = window as Window & {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  const sr = new SR();
  sr.continuous = true;
  sr.interimResults = true;
  sr.lang = navigator.language || 'en-US';
  return sr;
}

export function useVoiceBridge({
  conversationId,
  onTranscript,
  onInterimTranscript,
  onUserSpeech,
}: UseVoiceBridgeOptions) {
  const [status, setStatus] = useState<VoiceBridgeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const srRef = useRef<ISpeechRecognition | null>(null);

  const stopSpeechRecognition = useCallback(() => {
    if (srRef.current) {
      srRef.current.onresult = null;
      srRef.current.onerror = null;
      srRef.current.onend = null;
      try {
        srRef.current.stop();
      } catch {
        /* ignore */
      }
      srRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (!conversationId || status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    setError(null);
    roomRef.current = null;

    try {
      const session = await startVoiceSession(conversationId);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.Disconnected, () => setStatus('idle'));

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach();
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
          track.on('ended', () => audioEl.remove());
        }
      });

      await room.connect(session.serverUrl, session.token);
      await room.startAudio();

      const audioTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
      await room.localParticipant.publishTrack(audioTrack);

      const sse = new EventSource(buildStreamUrl(conversationId));
      sseRef.current = sse;

      sse.addEventListener('message', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data as string) as {
            event?: string;
            data?: { text?: string; isAgent?: boolean; messageId?: string; sender?: string };
          };
          if (event.event === 'on_transcript_final' && event.data) {
            onTranscript?.(
              event.data.text ?? '',
              event.data.isAgent ?? false,
              event.data.messageId ?? '',
              event.data.sender ?? '',
            );
          }
        } catch {
          /* ignore malformed events */
        }
      });

      sse.onerror = () => sse.close();

      const sr = createSpeechRecognition();
      if (sr) {
        srRef.current = sr;
        sr.onresult = (e: ISpeechRecognitionEvent) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const text = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
              const trimmed = text.trim();
              if (trimmed) onUserSpeech?.(trimmed);
            } else {
              interim += text;
            }
          }
          if (interim) onInterimTranscript?.(interim);
        };
        sr.onerror = (e: { error: string }) => {
          if (e.error !== 'aborted' && e.error !== 'no-speech') {
            setError(`Speech recognition error: ${e.error}`);
          }
        };
        sr.onend = () => {
          if (srRef.current) {
            try {
              srRef.current.start();
            } catch {
              /* ignore */
            }
          }
        };
        sr.start();
      }

      setStatus('connected');
    } catch (err) {
      stopSpeechRecognition();
      sseRef.current?.close();
      sseRef.current = null;
      await roomRef.current?.disconnect().catch(() => null);
      roomRef.current = null;
      await stopVoiceSession(conversationId).catch(() => null);
      const message = err instanceof Error ? err.message : 'Voice session failed';
      setError(message);
      setStatus('idle');
    }
  }, [conversationId, status, onTranscript, onInterimTranscript, onUserSpeech, stopSpeechRecognition]);

  const disconnect = useCallback(async () => {
    if (!conversationId || status === 'idle' || status === 'error' || status === 'disconnecting') return;
    setStatus('disconnecting');

    stopSpeechRecognition();
    sseRef.current?.close();
    sseRef.current = null;

    await roomRef.current?.disconnect();
    roomRef.current = null;

    await stopVoiceSession(conversationId).catch(() => null);
    setStatus('idle');
  }, [conversationId, status, stopSpeechRecognition]);

  useEffect(() => {
    return () => {
      stopSpeechRecognition();
      sseRef.current?.close();
      roomRef.current?.disconnect();
    };
  }, [stopSpeechRecognition]);

  // Disconnect when conversation changes
  useEffect(() => {
    if (status === 'connected') {
      void disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return { status, error, isConnected: status === 'connected', connect, disconnect };
}
