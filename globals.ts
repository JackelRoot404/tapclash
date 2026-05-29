// Global polyfills — MUST be imported before any module that touches Buffer or
// crypto at load time (e.g. @solana/web3.js and the tapclash_pools SDK, which
// build constant Buffers for PDA seeds / discriminators during module eval).
//
// This lives in its own module on purpose. ES import statements are hoisted
// above body statements, so assigning `global.Buffer` in the entry file's body
// runs *after* `import App` has already pulled in the SDK — too late. By doing
// the assignment as a side effect of this module and importing it first, the
// polyfill is in place before anything else evaluates.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

if (typeof (global as { Buffer?: typeof Buffer }).Buffer === 'undefined') {
  (global as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
