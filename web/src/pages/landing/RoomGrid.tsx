import { type RefObject, useEffect, useRef, useState } from 'react';
import { clipOf, EMPTY, ROOMS, stillOf } from './rooms';
import scanClip from './scan/scan.webm';
import scanClipSmall from './scan/scan-small.webm';
import scanCounts from './scan/counts.json';

/** The grid's columns, for the wave. */
const COLUMNS = 4;
/** The wave: each diagonal of the grid starts this long after the one before it. */
const WAVE_MS = 230;
/** The clips are recorded at the reveal's own pace; the grid plays them a little faster. */
const RATE = 1.6;
/** The scan plays a little faster than it was rendered, so the rooms aren't kept waiting. */
const SCAN_RATE = 1.25;
/** Below this many device pixels across the grid, the 800×600 scan is as sharp as the 1200×900 one. */
const SHARP_PX = 1000;
/** The 1200×900 scan needs about 3.3 Mb/s to play through at SCAN_RATE; below this, it's the 800×600 one. */
const SHARP_MBPS = 8;
/** How many rooms' clips load at once. */
const LOADING = 2;
/** Each room's place in the wave, which is the order their clips load in. */
const diagonalOf = (i: number) => Math.floor(i / COLUMNS) + (i % COLUMNS);
const WAVE_ORDER = ROOMS.map((_, i) => i).sort((a, b) => diagonalOf(a) - diagonalOf(b));

/** Whether the rooms should assemble: not under reduced motion, and only where the WebM clips play. */
function useAnimate() {
  const [animate] = useState(() =>
    !matchMedia('(prefers-reduced-motion: reduce)').matches && !!document.createElement('video').canPlayType('video/webm; codecs="vp9"'));
  return animate;
}

/**
 * The 16 rooms, 4 by 4. Once the grid is in view, the lounge's scan builds over it first: its point
 * cloud, captured from the door to the window, which the camera follows down to the door, where the
 * furniture clears and the points turn into the Empty Room (docs/landing/README.md). That is the first
 * frame of every room, so the scan fades to the 16 of them, which assemble in a wave from the top left, each playing its
 * reveal once and stopping on the finished room. Pointing at a finished room plays it again. Without
 * motion, there's no scan, and each room shows its finished still.
 *
 * The scan loads first, by itself: the rooms' clips start loading once all of it has come, while it
 * plays, two at a time in the wave's order, so the first rooms are ready when it ends. Where the grid is
 * small, the screen isn't sharp, or the connection is slow (where the browser says), the scan comes at 800×600.
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
    // The rooms' clips wait for the scan, so it gets the connection to itself, then load in the wave's
    // order. A room whose turn in the wave comes before its clip has started loading plays once it does.
    const due = new Set<HTMLVideoElement>();
    let next = 0;
    const loadNext = () => {
      const video = videos.current[WAVE_ORDER[next++]];
      if (!video) return;
      video.addEventListener('canplaythrough', loadNext, { once: true });
      video.addEventListener('error', loadNext, { once: true });
      video.src = video.dataset.src!;
      if (due.has(video)) void play(video);
    };
    let loading = false;
    const loadRooms = () => {
      if (loading) return;
      loading = true;
      for (let i = 0; i < LOADING; i++) loadNext();
    };
    let assembled = false;
    const assemble = () => {
      if (assembled) return;
      assembled = true;
      loadRooms();
      setScanning(false);
      videos.current.forEach((video, i) => {
        timers.push(window.setTimeout(() => {
          if (!video) return;
          if (video.getAttribute('src')) void play(video);
          else due.add(video);
        }, diagonalOf(i) * WAVE_MS));
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const video = scan.current!;
      video.onended = assemble;
      video.onerror = assemble;
      video.playbackRate = SCAN_RATE;
      // A browser that refuses to play the scan goes straight to the rooms.
      video.play().catch(assemble);
    }, { threshold: 0.35 });
    const video = scan.current!;
    video.src = sharpScan(grid.current!) ? scanClip : scanClipSmall;
    const whenLoaded = () => {
      const { buffered, duration } = video;
      if (buffered.length && buffered.end(buffered.length - 1) >= duration - 0.1) loadRooms();
    };
    video.addEventListener('progress', whenLoaded);
    video.addEventListener('canplaythrough', whenLoaded);
    observer.observe(grid.current!);
    return () => {
      video.removeEventListener('progress', whenLoaded);
      video.removeEventListener('canplaythrough', whenLoaded);
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
              <video ref={(video) => void (videos.current[i] = video)} data-src={clipOf(id)} poster={EMPTY} width={640} height={480} muted playsInline preload="auto" />
            ) : (
              <img src={stillOf(id)} width={640} height={480} alt="" />
            )}
            <span className="room-label"><b>{room}</b>{name}</span>
          </li>
        ))}
      </ul>
      {animate && (
        <div className="room-scan" data-done={!scanning || undefined} aria-hidden="true">
          <video ref={scan} width={1200} height={900} muted playsInline preload="auto" />
          <PointCount video={scan} />
        </div>
      )}
    </div>
  );
}

/** The scan's slip: how many of its points the scan has passed, counting with the clip, then the Empty Room. */
function PointCount({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setT(video.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [video]);
  const { counts, total, empty } = scanCounts;
  const count = counts[Math.min(counts.length - 1, Math.round(t * 10))];
  if (t >= empty) return <span className="room-label scan-label"><b>The Empty Room</b>Furniture out, ready to design</span>;
  return (
    <span className="room-label scan-label">
      <b>{count < total ? 'Scanning the real room' : 'The real room, scanned'}</b>
      {count.toLocaleString('en-US')} points
    </span>
  );
}

/** Whether the 1200×900 scan is worth its bytes here: a big, sharp grid, on a connection that can play it. */
function sharpScan(grid: HTMLElement) {
  const connection = (navigator as Navigator & { connection?: { downlink?: number; saveData?: boolean } }).connection;
  if (connection?.saveData || (connection?.downlink !== undefined && connection.downlink < SHARP_MBPS)) return false;
  return grid.clientWidth * devicePixelRatio >= SHARP_PX;
}

/** Plays a room's reveal from the empty lounge. A browser that refuses to play it keeps the poster. */
function play(video: HTMLVideoElement | null) {
  if (!video) return;
  // Only a replay seeks: a seek on a clip that hasn't played yet fetches it again.
  if (video.currentTime > 0) video.currentTime = 0;
  video.playbackRate = RATE;
  return video.play().catch(() => {});
}
