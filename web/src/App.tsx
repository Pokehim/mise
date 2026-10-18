import { Link, Route, Switch } from 'wouter';
import { Home } from './pages/Home';
import { Landing } from './pages/Landing';
import { EditorPage } from './scene/EditorPage';
import { RoomSetupPage } from './setup/RoomSetupPage';

// Routes only. Each page lives in the folder of the feature that builds it.
export function App() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/scans" component={Home} />
      <Route path="/setup/:scanId" component={RoomSetupPage} />
      <Route path="/d/:designId" component={EditorPage} />
      <Route>
        <main>Page not found. <Link href="/scans">Back to Scans</Link></main>
      </Route>
    </Switch>
  );
}
