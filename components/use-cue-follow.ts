import { useLayoutEffect } from 'react';

/** Follow highlight changes, not every media-clock tick or a user's manual scroll. */
export function useCueFollow(highlightKey: string) {
  useLayoutEffect(() => {
    if (!highlightKey) return;
    const list = document.querySelector<HTMLOListElement>('.echo-list');
    const selected = list?.querySelectorAll<HTMLElement>('.echo-cue.selected');
    if (!list || !selected?.length) return;
    const anchor = selected[0]!.closest('li');
    if (!anchor) return;
    const previous = { top: list.style.paddingTop, bottom: list.style.paddingBottom, anchor: anchor.style.paddingTop };
    const toolbar = document.querySelector<HTMLElement>('.echo-toolbar');
    const banner = document.querySelector<HTMLElement>('.echo-toast');
    const footer = document.querySelector<HTMLElement>('.echo-player');
    let following = true, frame = 0;
    const align = () => {
      if (!following || !list.isConnected) return;
      const top = (toolbar?.getBoundingClientRect().height ?? 0) + (banner?.getBoundingClientRect().height ?? 0);
      const bottom = innerHeight - (footer?.getBoundingClientRect().height ?? 0);
      // One or two lines of breathing room; keep long ranges anchored by their first row.
      const gap = 32;
      const trailing = `${Math.max(gap, bottom - top - gap)}px`;
      // Put the space before the selected range, not above the entire list:
      // otherwise the previous sentence's tail occupies the supposed blank gap.
      if (anchor.style.paddingTop !== `${gap}px`) anchor.style.paddingTop = `${gap}px`;
      if (list.style.paddingTop !== '0px') list.style.paddingTop = '0px';
      if (list.style.paddingBottom !== trailing) list.style.paddingBottom = trailing;
      const delta = selected[0]!.getBoundingClientRect().top - top - gap;
      if (Math.abs(delta) > 1) window.scrollTo({ top: scrollY + delta, behavior: 'instant' });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); };
    const stopFollowing = () => { following = false; cancelAnimationFrame(frame); };
    const resized = () => { following = true; schedule(); };
    align();
    // Text wrapping, translated lines and a lazily mounted practice card change geometry.
    const observer = new ResizeObserver(schedule);
    for (const element of [list, toolbar, banner, footer, ...selected]) if (element) observer.observe(element);
    addEventListener('resize', resized);
    addEventListener('wheel', stopFollowing, { passive: true }); addEventListener('touchmove', stopFollowing, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener('resize', resized);
      removeEventListener('wheel', stopFollowing); removeEventListener('touchmove', stopFollowing);
      list.style.paddingTop = previous.top; list.style.paddingBottom = previous.bottom; anchor.style.paddingTop = previous.anchor; };
  }, [highlightKey]);
}
