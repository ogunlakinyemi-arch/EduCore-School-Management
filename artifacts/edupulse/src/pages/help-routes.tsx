import { Route, Switch } from 'wouter';
import { HelpCentrePage } from './help-centre';
import { HelpManualPage } from './help-manual';

/** Public documentation; operational pages retain their existing role guards. */
export function HelpRoutes() {
  return <Switch>
    <Route path="/help" component={HelpCentrePage} />
    <Route path="/help/manuals/:audience">{params => <HelpManualPage audience={params.audience} />}</Route>
    <Route><HelpManualPage /></Route>
  </Switch>;
}
