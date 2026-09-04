import React, { useId, useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, Tooltip } from 'recharts';
import { pitchChartData, type PitchContour } from '../lib/pitch';

type Props = { reference: PitchContour | null; recording: PitchContour | null; amplitude: boolean;
  showReference: boolean; showRecording: boolean; playbackProgress: number | null };

export default function PitchCurve({ reference, recording, amplitude, showReference, showRecording, playbackProgress }: Props) {
  const id = useId().replaceAll(':', '');
  const data = useMemo(() => pitchChartData(reference, recording), [reference, recording]);
  return <div className="practice-chart" role="img" aria-label="音高曲线：青色原声、橙色录音；底部阴影表示音量强度，音高空白表示停顿；竖线表示播放位置">
    <ResponsiveContainer width="100%" height={100} minWidth={0}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`${id}-reference`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--practice-reference)" stopOpacity={.5}/><stop offset="95%" stopColor="var(--practice-reference)" stopOpacity={.05}/></linearGradient>
          <linearGradient id={`${id}-recording`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--practice-recording)" stopOpacity={.5}/><stop offset="95%" stopColor="var(--practice-recording)" stopOpacity={.05}/></linearGradient>
        </defs>
        <XAxis dataKey="time" type="number" domain={[0, 100]} hide/>
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} width={32} tickLine={false} axisLine={false} tickMargin={4}
          tick={{ fontSize: 10, fill: 'var(--echo-text)' }} tickFormatter={value => value === 100 ? 'High' : value === 50 ? 'Mid' : 'Low'}/>
        <Tooltip cursor={false} content={({ active, payload }) => {
          const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
          if (!active || !point) return null;
          return <div className="practice-chart-tooltip">{showReference && point.referenceHz !== null && <div>原声 {Math.round(point.referenceHz)} Hz</div>}{showRecording && point.recordingHz !== null && <div>录音 {Math.round(point.recordingHz)} Hz</div>}</div>;
        }}/>
        {amplitude && showReference && <Area className="practice-amplitude-reference" dataKey="referenceAmplitude" type="monotone" fill={`url(#${id}-reference)`} stroke="var(--practice-reference-amplitude)" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={.7} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false}/>}
        {amplitude && showRecording && <Area className="practice-amplitude-recording" dataKey="recordingAmplitude" type="monotone" fill={`url(#${id}-recording)`} stroke="var(--practice-recording)" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={.7} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false}/>}
        {showReference && <Line className="practice-pitch-reference" dataKey="reference" type="monotone" stroke="var(--practice-reference)" strokeWidth={2.5} dot={{ r: 1.5, fill: 'var(--practice-reference)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/>}
        {showRecording && <Line className="practice-pitch-recording" dataKey="recording" type="monotone" stroke="var(--practice-recording)" strokeWidth={2.5} dot={{ r: 1.5, fill: 'var(--practice-recording)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/>}
        {playbackProgress !== null && <ReferenceLine className="practice-progress" x={playbackProgress} stroke="var(--echo-text)" strokeOpacity={.5} strokeWidth={1.5}/>}
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
