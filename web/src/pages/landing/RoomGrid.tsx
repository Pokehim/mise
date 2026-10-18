import { type RefObject, useEffect, useRef, useState } from 'react';
import { clipOf, EMPTY, ROOMS, stillOf } from './rooms';
import scanClip from './scan/scan.webm';
import scanCounts from './scan/counts.json';

/** The grid's columns, for the wave. */
const COLUMNS = 4;
/** The wave: each diagonal of the grid starts this long after the one before it. */
const WAVE_MS = 230;
/** The clips are recorded at the reveal's own pace; the grid plays them a little faster. */
const RATE = 1.6;
/** The scan plays a little faster than it was rendered, so the rooms aren't kept waiting. */
const SCAN_RATE = 1.25;

/** Whether the rooms should assemble: not under reduced motion, and only where the WebM clips play. */
function useAnimate() {
  const [animate] = useState(() =>
    !matchMedia('(prefers-reduced-motion: reduce)').matches && !!document.createElement('video').canPlayType('video/webm; codecs="vp9"'));
  return animate;
}

/**
 * The 16 rooms, 4 by 4. Once the grid is in view, the lounge's scan builds over it first: its point
 * cloud, captured from the door to the window, then in true color (docs/landing/README.md). The scan
 * fades to the 16 empty lounges, which assemble themselves in a wave from the top left, each playing its
 * reveal once and stopping on the finished room. Pointing at a finished room plays it again. Without
 * motion, there's no scan, and each room shows its finished still.
 */
export function RoomGrid() {
  const animate = useAnimate();
  const grid = useRef<HTMLUListElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const scan = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(animate);

  useEffect(() => {
    if (!animate) return;
    const timers: number[] = [];
    const assemble = () => {
      setScanning(false);
      videos.current.forEach((video, i) => {
        const diagonal = Math.floor(i / COLUMNS) + (i % COLUMNS);
        timers.push(window.setTimeout(() => void play(video), diagonal * WAVE_MS));
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const video = scan.current!;
      video.onended = assemble;
      video.playbackRate = SCAN_RATE;
      // A browser that refuses to play the scan goes straight to the rooms.
      video.play().catch(assemble);
    }, { threshold: 0.35 });
    observer.observe(grid.current!);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [animate]);

  return (
    <div className="room-stage">
      <ul ref={grid}>
        {ROOMS.map(({ id, room, name }, i) => (
          <li key={id} onPointerEnter={() => animate && !scanning && videos.current[i]?.ended && void play(videos.current[i])}>
            {animate ? (
              <video ref={(video) => void (videos.current[i] = video)} src={clipOf(id)} poster={EMPTY} width={640} height={480} muted playsInline preload="auto" />
            ) : (
              <img src={stillOf(id)} width={640} height={480} alt="" />
            )}
            <span className="room-label"><b>{room}</b>{name}</span>
          </li>
        ))}
      </ul>
      {animate && (
        <div className="room-scan" data-done={!scanning || undefined} aria-hidden="true">
          <video ref={scan} src={scanClip} width={1200} height={900} muted playsInline preload="auto" />
          <PointCount video={scan} />
        </div>
      )}
    </div>
  );
}

/** The scan's slip: how many of its points the scan has passed, counting with the clip. */
function PointCount({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const t = video.current?.currentTime ?? 0;
      const { counts } = scanCounts;
      setCount(counts[Math.min(counts.length - 1, Math.round(t * 10))]);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [video]);
  return (
    <span className="room-label scan-label">
      <b>{count < scanCounts.total ? 'Scanning the real room' : 'The real room, scanned'}</b>
      {count.toLocaleString('en-US')} points
    </span>
  );
}

/** Plays a room's reveal from the empty lounge. A browser that refuses to play it keeps the poster. */
function play(video: HTMLVideoElement | null) {
  if (!video) return;
  video.currentTime = 0;
  video.playbackRate = RATE;
  return video.play().catch(() => {});
}
