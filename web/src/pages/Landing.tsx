import { Link } from 'wouter';
import { ArrowRight } from '../ui/icons';
import { Credits } from './Credits';
import { RoomGrid } from './landing/RoomGrid';
import realRoom from './landing/real-room.webp';
import './home.css';

/** Where "Try the demo" goes: the Scans, with the study lounge. */
const DEMO = '/scans';

/**
 * `/`: what Mise is, and the demo: a photo of the real study lounge, then the 16 rooms Claude made of
 * its Scan, assembling themselves as the page opens, which open the Scans like the button beside it.
 */
export function Landing() {
  return (
    <div className="home landing">
      <main className="landing-main">
        <div className="landing-side">
          <header className="home-intro">
            <hgroup>
              <h1>Mise</h1>
              <p className="tagline">A sketchbook for your real room.</p>
            </hgroup>
            <p>Redesign your real room before you buy a thing. Try Catalog furniture at true size in your Scan, then shop the Design.</p>
            <Link href={DEMO} className="cta">Try the demo<ArrowRight /></Link>
          </header>
          {/* The room as it really is, a print on the sheet, with an arrow to what was made of it. */}
          <figure className="landing-real">
            <img src={realRoom} width={800} height={800}
              alt="A photo of the real study lounge: rows of white tables and chairs on dark carpet, teal walls, a long whiteboard" />
            <figcaption>
              <span className="landing-title">The real room</span>
              <span className="note">Scanned once, redesigned sixteen ways</span>
              <HandArrow />
            </figcaption>
          </figure>
        </div>
        <figure className="landing-demo">
          <Link href={DEMO} className="landing-rooms" aria-label="Try the demo: 16 rooms AI made of the Oliver Hall 6th Floor Study Lounge">
            <RoomGrid />
          </Link>
          {/* Labeled like a drawing, lettered under it. */}
          <figcaption>
            <span className="landing-title">One real room, endless possibilities</span>
          </figcaption>
        </figure>
      </main>
      <Credits />
    </div>
  );
}

/** A pencil arrow from the photo to the rooms: to the right beside them, down above them on a phone. */
const HandArrow = () => (
  <svg className="hand-arrow" width="56" height="28" viewBox="0 0 56 28" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21c9-9 25-14 46-11" />
    <path d="M42 4.5 50 10l-7 6" />
  </svg>
);
