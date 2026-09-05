import { useLayoutEffect } from 'react';

/** Follow highlight changes, not every media-clock tick or a user's manual scroll. */
export function useCueFollow(highlightKey: string) {
  useLayoutEffect(() => {
    if (!highlightKey) return;
    const list = document.querySelector<HTMLOListElement>('.echo-list');
    const selected = list?.querySelectorAll<HTMLElement>('.echo-cue.selected');
    if (!list || !selected?.length) return;
    const anchor = selected[0]!.closest('li'), tail = selected[selected.length - 1]!.closest('li');
    if (!anchor || !tail) return;
    const previous = { top: list.style.paddingTop, bottom: list.style.paddingBottom };
    const toolbar = document.querySelector<HTMLElement>('.echo-toolbar');
    const banner = document.querySelector<HTMLElement>('.echo-toast');
    const footer = document.querySelector<HTMLElement>('.echo-player');
    let following = true, frame = 0;
    const align = () => {
      if (!following || !list.isConnected) return;
      const top = (toolbar?.getBoundingClientRect().height ?? 0) + (banner?.getBoundingClientRect().height ?? 0);
      const bottom = innerHeight - (footer?.getBoundingClientRect().height ?? 0);
      const gap = 24, usableTop = top + gap, usableBottom = bottom - gap;
      let first = selected[0]!.getBoundingClientRect(), last = selected[selected.length - 1]!.getBoundingClientRect();
      const blockHeight = last.bottom - first.top, available = Math.max(1, usableBottom - usableTop);
      // The first few single rows stay naturally near the top. Later rows and
      // multi-row ranges are centered as a block when they fit in the safe area.
      const rowIndex = Number(selected[0]!.dataset.rowIndex ?? 0);
      const keepNearTop = selected.length === 1 && rowIndex < 2;
      const targetTop = keepNearTop || blockHeight >= available
        ? usableTop : usableTop + (available - blockHeight) / 2;
      const trailing = `${Math.max(72, available)}px`;
      // A short transcript may not have enough document height above a later row
      // to scroll it down to the center. Add only the missing top space in that
      // case; long transcripts continue to use normal document scrolling.
      const currentTopPadding = Number.parseFloat(list.style.paddingTop) || 0;
      const naturalTop = first.top - currentTopPadding;
      const leading = `${Math.max(0, targetTop - naturalTop)}px`;
      if (list.style.paddingTop !== leading) {
        list.style.paddingTop = leading;
        first = selected[0]!.getBoundingClientRect();
        last = selected[selected.length - 1]!.getBoundingClientRect();
      }
      if (list.style.paddingBottom !== trailing) list.style.paddingBottom = trailing;
      const delta = first.top - targetTop;
      if (Math.abs(delta) > 1) window.scrollTo({ top: scrollY + delta, behavior: 'instant' });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); };
    const stopFollowing = () => { following = false; cancelAnimationFrame(frame); };
    const resized = () => { following = true; schedule(); };
    align();
    // Text wrapping, translated lines and a lazily mounted practice card change geometry.
    const observer = new ResizeObserver(schedule);
    for (const element of [list, toolbar, banner, footer, anchor, tail, ...selected]) if (element) observer.observe(element);
    addEventListener('resize', resized);
    addEventListener('wheel', stopFollowing, { passive: true }); addEventListener('touchmove', stopFollowing, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener('resize', resized);
      removeEventListener('wheel', stopFollowing); removeEventListener('touchmove', stopFollowing);
      list.style.paddingTop = previous.top; list.style.paddingBottom = previous.bottom; };
  }, [highlightKey]);
}
