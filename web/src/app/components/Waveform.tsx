"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Status } from "./useVoiceSession";

const BARS = 41;
const SAMPLE_MS = 55;

// Edges taper so the strip reads as a single shape instead of a box of bars.
const taper = (i: number) => {
  const d = Math.min(i, BARS - 1 - i);
  return d >= 6 ? 1 : 0.35 + (d / 6) * 0.65;
};

/*
  Scrolling level history: each bar is one past sample of the live audio
  level (mic while listening, Gabriela while speaking), newest on the right.
  Bars are written straight to the DOM from requestAnimationFrame so React
  never re-renders per frame.
*/
export default function Waveform({ status, levelRef }: { status: Status; levelRef: RefObject<() => number> }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const live = status === "listening" || status === "speaking";
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const bars = Array.from(barsRef.current?.children ?? []) as HTMLElement[];
    const history = new Array<number>(BARS).fill(0);
    let frame = 0;
    let level = 0;
    let last = 0;
    const tick = (now: number) => {
      const target = liveRef.current ? Math.sqrt(levelRef.current?.() ?? 0) : 0;
      level += (target - level) * (target > level ? 0.6 : 0.18);
      if (now - last >= SAMPLE_MS) {
        last = now;
        history.shift();
        history.push(level);
        for (let i = 0; i < BARS; i++) {
          const scale = 0.1 + history[i] * 0.9 * taper(i);
          bars[i].style.transform = `scaleY(${scale.toFixed(3)})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [levelRef]);

  return (
    <div ref={barsRef} className="wave" data-state={status} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="wave-bar" style={{ ["--i" as string]: i }} />
      ))}
    </div>
  );
}
