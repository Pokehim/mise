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
        <Link href={DEMO} className="landing-rooms" aria-label="Try the demo: 16 rooms AI made of the Oliver Hall 6th Floor Study Lounge">
          <RoomGrid />
        </Link>
        {/* Labeled like a drawing, lettered under it. */}
        <figcaption>
          <span className="landing-title">One study lounge, sixteen rooms</span>
        </figcaption>
      </figure>
      <Credits />
    </div>
  );
}
