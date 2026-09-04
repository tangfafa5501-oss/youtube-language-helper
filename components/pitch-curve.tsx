import React, { useId, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { pitchChartData, type PitchContour } from '../lib/pitch';

type Props = { reference: PitchContour | null; recording: PitchContour | null; amplitude: boolean;
  showReference: boolean; showRecording: boolean; playbackProgress: number | null };

export default function PitchCurve({ reference, recording, amplitude, showReference, showRecording, playbackProgress }: Props) {
  const id = useId().replaceAll(':', '');
  const data = useMemo(() => pitchChartData(reference, recording).map(point => ({ ...point,
    progress: playbackProgress !== null && point.time <= playbackProgress ? 100 : 0 })), [reference, recording, playbackProgress]);
  return <div className="practice-chart" role="img" aria-label="音高曲线：原声与录音共用原声音域，High 高、Mid 中、Low 低；虚线表示振幅">
    <ResponsiveContainer width="100%" height={100} minWidth={0}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`${id}-reference`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--practice-reference)" stopOpacity={.5}/><stop offset="95%" stopColor="var(--practice-reference)" stopOpacity={.05}/></linearGradient>
          <linearGradient id={`${id}-recording`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--practice-recording)" stopOpacity={.5}/><stop offset="95%" stopColor="var(--practice-recording)" stopOpacity={.05}/></linearGradient>
          <linearGradient id={`${id}-progress`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--echo-text)" stopOpacity={.25}/><stop offset="100%" stopColor="var(--echo-text)" stopOpacity={.1}/></linearGradient>
        </defs>
        <XAxis dataKey="time" hide/>
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} width={32} tickLine={false} axisLine={false} tickMargin={4}
          tick={{ fontSize: 10, fill: 'var(--echo-text)' }} tickFormatter={value => value === 100 ? 'High' : value === 50 ? 'Mid' : 'Low'}/>
        <Tooltip cursor={false} content={({ active, payload }) => {
          const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
          if (!active || !point) return null;
          return <div className="practice-chart-tooltip">{showReference && point.referenceHz !== null && <div>原声 {Math.round(point.referenceHz)} Hz</div>}{showRecording && point.recordingHz !== null && <div>录音 {Math.round(point.recordingHz)} Hz</div>}</div>;
        }}/>
        {playbackProgress !== null && <Area className="practice-progress" dataKey="progress" type="stepAfter" fill={`url(#${id}-progress)`} stroke="var(--echo-text)" strokeOpacity={.5} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false}/>}
        {amplitude && showReference && <Area className="practice-amplitude-reference" dataKey="referenceAmplitude" type="monotone" fill="none" stroke="var(--practice-reference-amplitude)" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={.7} dot={false} activeDot={false} connectNulls isAnimationActive={false}/>}
        {amplitude && showRecording && <Area className="practice-amplitude-recording" dataKey="recordingAmplitude" type="monotone" fill="none" stroke="var(--practice-recording)" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={.7} dot={false} activeDot={false} connectNulls isAnimationActive={false}/>}
        {showReference && <Area className="practice-pitch-reference" dataKey="reference" type="monotone" fill={`url(#${id}-reference)`} stroke="var(--practice-reference)" strokeWidth={2.5} dot={{ r: 1.5, fill: 'var(--practice-reference)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/>}
        {showRecording && <Area className="practice-pitch-recording" dataKey="recording" type="monotone" fill={`url(#${id}-recording)`} stroke="var(--practice-recording)" strokeWidth={2.5} dot={{ r: 1.5, fill: 'var(--practice-recording)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/>}
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
