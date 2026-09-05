import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import './hover-hint.css';

type Props = { children: React.ReactElement; content: React.ReactNode;
  variant?: 'help' | 'control'; align?: 'center' | 'end' };

/** Collision-aware, non-modal help for pointer and keyboard users. */
export function HoverHint({ children, content, variant = 'control', align = 'center' }: Props) {
  return <Tooltip.Provider delayDuration={280} skipDelayDuration={120} disableHoverableContent={false}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={`ylh-tooltip ylh-tooltip-${variant}`} side="top" sideOffset={10} align={align}
          collisionPadding={{ top: 10, right: 10, bottom: 96, left: 10 }} sticky="always" avoidCollisions>
          {content}<Tooltip.Arrow className="ylh-tooltip-arrow" width={12} height={6}/>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>;
}
