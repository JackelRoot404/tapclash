import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

// React Navigation's native-screens optimization (new architecture / Fabric)
// ghosts a faint copy of the bottom tab bar onto the Play screen's static
// overlay states (idle/finished) on the Seeker. Disabling native screens fixes
// it with no practical cost for this simple 4-tab navigator.
import { enableScreens } from 'react-native-screens';
enableScreens(false);

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
