import type { TranscriptFragment, UtteranceBuffer } from '~/bridge/types';

export class TranscriptBuffer {
  private utterances = new Map<string, UtteranceBuffer>();

  ingest(fragment: TranscriptFragment): string | null {
    let buf = this.utterances.get(fragment.utteranceId);
    if (!buf) {
      buf = {
        utteranceId: fragment.utteranceId,
        participantIdentity: fragment.participantIdentity,
        fragments: new Map(),
        lastUpdated: fragment.timestamp,
        isSealed: false,
      };
      this.utterances.set(fragment.utteranceId, buf);
    }
    buf.fragments.set(fragment.sequenceNumber, fragment.text);
    buf.lastUpdated = fragment.timestamp;
    if (fragment.kind === 'final') {
      buf.isSealed = true;
      const text = this.reconstruct(buf);
      this.utterances.delete(fragment.utteranceId);
      return text;
    }
    return null;
  }

  private reconstruct(buf: UtteranceBuffer): string {
    return [...buf.fragments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join('');
  }

  evictStale(maxAgeMs: number): void {
    const threshold = Date.now() - maxAgeMs;
    for (const [id, buf] of this.utterances) {
      if (buf.lastUpdated < threshold) this.utterances.delete(id);
    }
  }
}
