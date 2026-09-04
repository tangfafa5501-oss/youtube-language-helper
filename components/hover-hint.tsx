import React, { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './hover-hint.css';

type Props = { children: React.ReactElement<{ 'aria-describedby'?: string }>; content: React.ReactNode;
  variant?: 'help' | 'control'; align?: 'center' | 'end' };

/** Non-modal help: hover or keyboard focus, no change to the button's action. */
export function HoverHint({ children, content, variant = 'control', align = 'center' }: Props) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), bubble = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const show = () => { cancelClose(); setOpen(true); };
  const hide = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 100); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      if (!anchor.current || !bubble.current) return;
      const a = anchor.current.getBoundingClientRect(), b = bubble.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(innerWidth - b.width - 8, align === 'end' ? a.right - b.width : a.left + (a.width - b.width) / 2));
      const below = a.top - b.height - 8 < 8;
      const next = { left, top: Math.max(8, Math.min(innerHeight - b.height - 8, below ? a.bottom + 8 : a.top - b.height - 8)),
        arrow: Math.max(12, Math.min(b.width - 12, a.left + a.width / 2 - left)), below };
      setPosition(previous => previous && Object.entries(next).every(([key, value]) => previous[key as keyof typeof next] === value) ? previous : next);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelClose(); setOpen(false); event.preventDefault(); event.stopPropagation();
    };
    place();
    const observer = new ResizeObserver(place);
    if (bubble.current) observer.observe(bubble.current);
    addEventListener('resize', place); addEventListener('scroll', place, true); addEventListener('keydown', escape, true);
    return () => { observer.disconnect(); removeEventListener('resize', place); removeEventListener('scroll', place, true); removeEventListener('keydown', escape, true); };
  }, [open, align]);
  return <span className="ylh-hint-anchor" ref={anchor} onPointerEnter={show} onPointerLeave={hide} onFocus={show}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hide(); }}>
    {cloneElement(children, { 'aria-describedby': open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })}
    {open && createPortal(<div id={id} ref={bubble} role="tooltip" className={`ylh-tooltip ylh-tooltip-${variant}`}
      data-side={position?.below ? 'bottom' : 'top'} onPointerEnter={cancelClose} onPointerLeave={hide}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden',
        '--hint-arrow': `${position?.arrow ?? 12}px` } as React.CSSProperties}>{content}</div>, document.body)}
  </span>;
}
