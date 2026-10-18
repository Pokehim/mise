import { lazy, Suspense } from 'react';
import { Link, Route, Switch } from 'wouter';
import { Landing } from './pages/Landing';

// The editor and Room Setup bring three.js and the splat renderer, megabytes the landing page and Scans don't need.
// The Scans bring Import and the plan library, which the landing page doesn't need either; it fetches them ahead.
const Home = lazy(() => import('./pages/Home').then(({ Home }) => ({ default: Home })));
const EditorPage = lazy(() => import('./scene/EditorPage').then(({ EditorPage }) => ({ default: EditorPage })));
const RoomSetupPage = lazy(() => import('./setup/RoomSetupPage').then(({ RoomSetupPage }) => ({ default: RoomSetupPage })));

// Routes only. Each page lives in the folder of the feature that builds it.
export function App() {
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/scans" component={Home} />
        <Route path="/setup/:scanId" component={RoomSetupPage} />
        <Route path="/d/:designId" component={EditorPage} />
        <Route>
          <main>Page not found. <Link href="/scans">Back to Scans</Link></main>
        </Route>
      </Switch>
    </Suspense>
  );
}
