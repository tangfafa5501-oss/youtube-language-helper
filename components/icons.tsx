import type { ReactNode } from 'react';
import './icons.css';

// Lucide 0.479.0 source assets, distributed under public/licenses/lucide.txt.
// Only the icons used by this UI are shipped; no full icon package or font.
function Svg({ children }: { children: ReactNode }) {
  return <svg className="ylh-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>;
}

export function Play() {
  return <Svg><polygon points="6 3 20 12 6 21 6 3"/></Svg>;
}
export function Pause() {
  return <Svg><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></Svg>;
}
export function SkipBack() {
  return <Svg><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/></Svg>;
}
export function SkipForward() {
  return <Svg><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></Svg>;
}
export function Settings() {
  return <Svg><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></Svg>;
}

function AssetIcon({ name }: { name: string }) {
  return <span className="ylh-icon ylh-icon-source" aria-hidden="true" style={{ maskImage: `url("/icons/${name}.svg")`, WebkitMaskImage: `url("/icons/${name}.svg")` }}/>;
}
export const ArrowLeft = () => <AssetIcon name="arrow-left"/>;
export const BookOpen = () => <AssetIcon name="book-open"/>;
export const Check = () => <AssetIcon name="check"/>;
export const ChevronDown = () => <AssetIcon name="chevron-down"/>;
export const CircleHelp = () => <AssetIcon name="circle-help"/>;
export const CircleSlash2 = () => <AssetIcon name="circle-slash-2"/>;
export const Database = () => <AssetIcon name="database"/>;
export const Keyboard = () => <AssetIcon name="keyboard"/>;
export const Languages = () => <AssetIcon name="languages"/>;
export const Mic = () => <AssetIcon name="mic"/>;
export const MoreVertical = () => <AssetIcon name="ellipsis-vertical"/>;
export const Palette = () => <AssetIcon name="palette"/>;
export const RefreshCw = () => <AssetIcon name="refresh-cw"/>;
export const RotateCcw = () => <AssetIcon name="rotate-ccw"/>;
export const Sparkles = () => <AssetIcon name="sparkles"/>;
export const X = () => <AssetIcon name="x"/>;
export const Clock = () => <AssetIcon name="clock"/>;
export const AudioLines = () => <AssetIcon name="audio-lines"/>;
export const Activity = () => <AssetIcon name="activity"/>;
export const Ear = () => <AssetIcon name="ear"/>;
export const ArrowUp = () => <AssetIcon name="arrow-up"/>;
export const ArrowDown = () => <AssetIcon name="arrow-down"/>;
export const Minus = () => <AssetIcon name="minus"/>;
export const Plus = () => <AssetIcon name="plus"/>;
export const Square = () => <AssetIcon name="square"/>;
export const Circle = () => <AssetIcon name="circle"/>;
