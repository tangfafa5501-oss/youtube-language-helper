import { YIN } from 'pitchfinder';

export type PitchPoint = { time: number; hz: number | null; amplitude: number };
export type PitchContour = { points: PitchPoint[]; duration: number; min: number; max: number };
export function extractPitch(samples: Float32Array, sampleRate: number): PitchContour {
  const frameSize = 2048, hopSize = 512;
  const detect = YIN({ sampleRate, threshold: 0.1 });
  const points: PitchPoint[] = []; let min = Infinity, max = 0, peak = 0;
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray(offset, offset + frameSize);
    let power = 0; for (const sample of frame) power += sample * sample;
    const rms = Math.sqrt(power / frame.length);
    const pitch = rms >= 0.01 ? detect(frame) : null;
    const hz = pitch !== null && pitch >= 50 && pitch <= 500 ? pitch : null;
    if (hz !== null) { min = Math.min(min, hz); max = Math.max(max, hz); }
    peak = Math.max(peak, rms); points.push({ time: offset / sampleRate, hz, amplitude: rms });
  }
  if (peak) for (const point of points) point.amplitude /= peak;
  return { points, duration: samples.length / sampleRate, min: Number.isFinite(min) ? min : 0, max };
}
export async function pitchFromBlob(blob: Blob) {
  const context = new AudioContext();
  try { const buffer = await context.decodeAudioData(await blob.arrayBuffer()); return extractPitch(buffer.getChannelData(0), buffer.sampleRate); }
  finally { await context.close(); }
}
export function pitchChartData(reference: PitchContour | null, recording: PitchContour | null) {
  // Echo uses the reference vocal range for both sources, rather than a fixed Hz axis.
  const range = reference && reference.max > 0 ? reference : recording;
  const normalize = (hz: number | null | undefined) => {
    if (hz == null || !range) return null;
    if (range.max - range.min < 1) return 50;
    return Math.max(0, Math.min(100, (hz - range.min) / (range.max - range.min) * 100));
  };
  const nearest = (contour: PitchContour | null, percent: number) => {
    if (!contour?.points.length) return null;
    const target = contour.duration * percent;
    const step = contour.points[1]?.time ?? contour.duration;
    return contour.points[Math.min(contour.points.length - 1, Math.round(target / (step || 1)))]!;
  };
  return Array.from({ length: 100 }, (_, index) => {
    const r = nearest(reference, index / 99), u = nearest(recording, index / 99);
    return { time: index / 99 * 100, reference: normalize(r?.hz), recording: normalize(u?.hz),
      referenceHz: r?.hz ?? null, recordingHz: u?.hz ?? null,
      referenceAmplitude: r ? r.amplitude * 100 : null, recordingAmplitude: u ? u.amplitude * 100 : null };
  });
}
