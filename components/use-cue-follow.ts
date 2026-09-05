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
    const shell = document.querySelector<HTMLElement>('.echo-shell');
    let following = true, frame = 0;
    const align = () => {
      if (!following || !list.isConnected) return;
      const top = (toolbar?.getBoundingClientRect().height ?? 0) + (banner?.getBoundingClientRect().height ?? 0);
      const bottom = innerHeight - (footer?.getBoundingClientRect().height ?? 0);
      const gap = 24, usableTop = top + gap, usableBottom = bottom - gap;
      let first = selected[0]!.getBoundingClientRect(), last = selected[selected.length - 1]!.getBoundingClientRect();
      const blockHeight = last.bottom - first.top, available = Math.max(1, usableBottom - usableTop);
      const rowIndex = Number(selected[0]!.dataset.rowIndex ?? 0);
      const forceCenter = shell?.dataset.playMode === 'practice' || selected.length > 1 || rowIndex >= 3;
      const trailing = `${Math.max(72, available)}px`;
      if (list.style.paddingBottom !== trailing) list.style.paddingBottom = trailing;

      // Let the opening sentences move down through the viewport without
      // shifting the whole transcript. Once the fourth row (or a later row)
      // becomes active, keep it centered. Practice/dictation ranges center
      // immediately, including a one-sentence range.
      if (!forceCenter) {
        if (list.style.paddingTop) {
          list.style.paddingTop = '';
          first = selected[0]!.getBoundingClientRect();
          last = selected[selected.length - 1]!.getBoundingClientRect();
        }
        const blockCenter = (first.top + last.bottom) / 2;
        const usableCenter = (usableTop + usableBottom) / 2;
        const delta = first.top < usableTop ? first.top - usableTop
          : last.bottom > usableBottom ? blockCenter - usableCenter : 0;
        if (Math.abs(delta) > 1) window.scrollTo({ top: Math.max(0, scrollY + delta), behavior: 'instant' });
        return;
      }

      const targetTop = blockHeight >= available ? usableTop : usableTop + (available - blockHeight) / 2;
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
