import { Link } from 'wouter';
import { ArrowRight } from '../ui/icons';
import { Credits } from './Credits';
import demo from './landing-demo.webp';
import './home.css';

/** Where "Try the demo" goes: the Scans, with the study lounge. */
const DEMO = '/scans';

/**
 * `/`: what Mise is, and the demo: a still of the study lounge in the editor, which opens the Scans
 * like the button beside it.
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
        <Link href={DEMO} className="landing-shot" aria-label="Try the demo: the Oliver Hall 6th Floor Study Lounge">
          <img src={demo} width={1440} height={900} alt="" />
        </Link>
        {/* Labeled like a drawing: the Design's name lettered, then what it is. */}
        <figcaption>
          <span className="landing-title">Quiet Window Nook <span className="price">≈ $380 (est.)</span></span>
          <span className="muted">Oliver Hall 6th Floor Study Lounge · a Design Claude made from “cozy Japandi, under $400, I need a reading corner”</span>
        </figcaption>
      </figure>
      <Credits />
    </div>
  );
}
