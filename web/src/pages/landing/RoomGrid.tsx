import { useEffect, useRef, useState } from 'react';
import { clipOf, EMPTY, ROOMS, stillOf } from './rooms';

/** The grid's columns, for the wave. */
const COLUMNS = 4;
/** The wave: each diagonal of the grid starts this long after the one before it. */
const WAVE_MS = 260;
/** The clips are recorded at the reveal's own pace; the grid plays them a little faster. */
const RATE = 1.4;

/** Whether the rooms should assemble: not under reduced motion, and only where the WebM clips play. */
function useAnimate() {
  const [animate] = useState(() =>
    !matchMedia('(prefers-reduced-motion: reduce)').matches && !!document.createElement('video').canPlayType('video/webm; codecs="vp9"'));
  return animate;
}

/**
 * The 16 rooms, 4 by 4. Each starts as the empty lounge, and once the grid is in view they assemble
 * themselves in a wave from the top left, each playing its reveal once and stopping on the finished
 * room. Pointing at a finished room plays it again. Without motion, each shows its finished still.
 */
export function RoomGrid() {
  const animate = useAnimate();
  const grid = useRef<HTMLUListElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (!animate) return;
    const timers: number[] = [];
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      videos.current.forEach((video, i) => {
        const diagonal = Math.floor(i / COLUMNS) + (i % COLUMNS);
        timers.push(window.setTimeout(() => void play(video), diagonal * WAVE_MS));
      });
    }, { threshold: 0.35 });
    observer.observe(grid.current!);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [animate]);

  return (
    <ul ref={grid}>
      {ROOMS.map(({ id, room, name }, i) => (
        <li key={id} onPointerEnter={() => animate && videos.current[i]?.ended && void play(videos.current[i])}>
          {animate ? (
            <video ref={(video) => void (videos.current[i] = video)} src={clipOf(id)} poster={EMPTY} width={640} height={480} muted playsInline preload="auto" />
          ) : (
            <img src={stillOf(id)} width={640} height={480} alt="" />
          )}
          <span className="room-label"><b>{room}</b>{name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Plays a room's reveal from the empty lounge. A browser that refuses to play it keeps the poster. */
function play(video: HTMLVideoElement | null) {
  if (!video) return;
  video.currentTime = 0;
  video.playbackRate = RATE;
  return video.play().catch(() => {});
}
