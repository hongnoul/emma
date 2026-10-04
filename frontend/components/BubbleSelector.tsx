'use client';
// BubbleSelector: client-facing flow selector for the apex landing page.
// Big bubble pill buttons that pop in with a GSAP back.out stagger, hold a
// slight playful rotation on desktop, and flood with their accent color on
// hover (styling lifted from the ReactBits bubble-menu pills).
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';

export type BubbleItem = {
  label: string;
  sub?: string;
  href: string;
  ariaLabel?: string;
  rotation?: number;
  hoverStyles?: { bgColor?: string; textColor?: string };
};

type Props = {
  items: BubbleItem[];
  animationEase?: string;
  animationDuration?: number;
  staggerDelay?: number;
};

export default function BubbleSelector({
  items,
  animationEase = 'back.out(1.5)',
  animationDuration = 0.5,
  staggerDelay = 0.12
}: Props) {
  const bubblesRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const bubbles = bubblesRef.current.filter(Boolean) as HTMLAnchorElement[];
    const labels = labelRefs.current.filter(Boolean) as HTMLSpanElement[];
    if (!bubbles.length) return;

    // bake the per-item rotation into the tween from frame one so the pill
    // pops in already tilted (no orientation snap when CSS takes over)
    const isDesktop = window.innerWidth >= 900;
    bubbles.forEach((bubble, i) => {
      const rot = isDesktop ? (items[i]?.rotation ?? 0) : 0;
      gsap.set(bubble, { scale: 0, rotation: rot, transformOrigin: '50% 50%' });
    });
    gsap.set(labels, { y: 24, autoAlpha: 0 });

    bubbles.forEach((bubble, i) => {
      const delay = i * staggerDelay + gsap.utils.random(-0.05, 0.05);
      const tl = gsap.timeline({ delay });
      tl.to(bubble, {
        scale: 1,
        duration: animationDuration,
        ease: animationEase,
        // hand transform control back to CSS (rotation + hover scale)
        onComplete: () => gsap.set(bubble, { clearProps: 'transform' })
      });
      if (labels[i]) {
        tl.to(
          labels[i],
          { y: 0, autoAlpha: 1, duration: animationDuration, ease: 'power3.out' },
          '-=' + animationDuration * 0.9
        );
      }
    });

    return () => {
      gsap.killTweensOf([...bubbles, ...labels]);
    };
  }, [animationEase, animationDuration, staggerDelay, items]);

  return (
    <>
      <style>{`
        @media (min-width: 900px) {
          .bubble-selector .bubble-btn {
            transform: rotate(var(--item-rot));
          }
          .bubble-selector .bubble-btn:hover {
            transform: rotate(var(--item-rot)) scale(1.06);
            background: var(--hover-bg) !important;
            color: var(--hover-color) !important;
          }
          .bubble-selector .bubble-btn:active {
            transform: rotate(var(--item-rot)) scale(.94);
          }
        }
        @media (max-width: 899px) {
          .bubble-selector .bubble-btn:hover {
            transform: scale(1.06);
            background: var(--hover-bg) !important;
            color: var(--hover-color) !important;
          }
          .bubble-selector .bubble-btn:active {
            transform: scale(.94);
          }
        }
        .bubble-selector .bubble-btn:hover .bubble-sub {
          color: inherit;
          opacity: 0.85;
        }
      `}</style>

      <div className="bubble-selector flex w-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
        {items.map((item, idx) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.ariaLabel || item.label}
            className={[
              'bubble-btn',
              'flex flex-col items-center justify-center',
              'rounded-full',
              'bg-white',
              'no-underline',
              'shadow-[0_4px_16px_rgba(0,0,0,0.12)]',
              'transition-[background,color] duration-300 ease-in-out',
              'whitespace-nowrap',
              'will-change-transform',
              'w-full max-w-xs px-10 py-6 sm:w-auto md:px-14 md:py-8'
            ].join(' ')}
            style={
              {
                // start hidden so the GSAP pop-in plays cleanly on every load
                // (no SSR flash of the final state before hydration)
                transform: 'scale(0)',
                ['--item-rot']: `${item.rotation ?? 0}deg`,
                ['--hover-bg']: item.hoverStyles?.bgColor || '#f3f4f6',
                ['--hover-color']: item.hoverStyles?.textColor || '#111'
              } as CSSProperties
            }
            ref={el => {
              bubblesRef.current[idx] = el;
            }}
          >
            <span
              className="bubble-label inline-flex flex-col items-center will-change-[transform,opacity]"
              style={{ opacity: 0, transform: 'translateY(24px)' }}
              ref={el => {
                labelRefs.current[idx] = el;
              }}
            >
              <span className="text-xl font-semibold md:text-2xl">{item.label}</span>
              {item.sub && (
                <span className="bubble-sub mt-1 text-[11px] font-normal text-muted-foreground md:text-xs">
                  {item.sub}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
