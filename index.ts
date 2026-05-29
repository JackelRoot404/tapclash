// Polyfills first — installs global.Buffer before the SDK / web3.js load.
import './globals';

// React Navigation's native-screens optimization (new architecture / Fabric)
// ghosts a faint copy of the bottom tab bar onto the Play screen's static
// overlay states (idle/finished) on the Seeker. Disabling native screens fixes
// it with no practical cost for this simple 4-tab navigator.
import { enableScreens } from 'react-native-screens';
enableScreens(false);

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
