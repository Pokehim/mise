import { Link } from 'wouter';
import { ArrowRight } from '../ui/icons';
import { Credits } from './Credits';
import { RoomGrid } from './landing/RoomGrid';
import './home.css';

/** Where "Try the demo" goes: the Scans, with the study lounge. */
const DEMO = '/scans';

/**
 * `/`: what Mise is, and the demo: the study lounge as 16 rooms Claude made of it, assembling themselves
 * as the page opens, which open the Scans like the button beside it.
 */
export function Landing() {
  return (
    <div className="home landing">
      <header className="home-intro">
        <hgroup>
          <h1>Mise</h1>
          <p className="tagline">A sketchbook for your real room.</p>
        </hgroup>
        <p>Redesign your real room before you buy a thing. Try Catalog furniture at true size in your Scan, then shop the Design.</p>
        <Link href={DEMO} className="cta">Try the demo<ArrowRight /></Link>
      </header>
      <figure className="landing-demo">
        <Link href={DEMO} className="landing-rooms" aria-label="Try the demo: 16 rooms Claude made of the Oliver Hall 6th Floor Study Lounge">
          <RoomGrid />
        </Link>
        {/* Labeled like a drawing: what it shows lettered, then how it was made. */}
        <figcaption>
          <span className="landing-title">One study lounge, sixteen rooms</span>
          <span className="muted">
            Each is a Design Claude made of the Oliver Hall 6th Floor Study Lounge from a one-line Brief: a dorm bedroom, a game room, a library, a place to play records.
          </span>
        </figcaption>
      </figure>
      <Credits />
    </div>
  );
}
