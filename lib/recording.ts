const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'] as const;

export function preferredRecordingType(supports?: (type: string) => boolean) {
  if (!supports) return '';
  return RECORDING_TYPES.find(type => supports(type)) ?? '';
}

export function recordedAudio(chunks: Blob[], mimeType: string) {
  const size = chunks.reduce((total, chunk) => total + chunk.size, 0);
  return size ? new Blob(chunks, { type: mimeType || 'audio/webm' }) : null;
}

export function stopMediaTracks(stream: { getTracks(): Array<{ stop(): void }> } | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* A track may already be ended. */ }
  }
}
