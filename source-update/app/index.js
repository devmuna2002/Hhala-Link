import 'react-native-gesture-handler';
import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

// Video compression is optional: dev builds made before the compressor
// plugin was linked throw "Failed to get NitroModules" when a video
// uploads — uploads still succeed uncompressed, so hide that noise.
// (Same for expo-video probing tracks of a slow/large clip.)
LogBox.ignoreLogs([
  'Failed to get NitroModules',
  'Failed to load available audio tracks',
  'Failed to load available subtitle tracks',
]);

// Web: feed clips autoplay muted, and browsers reject video.play() with an
// AbortError when a clip is backgrounded / paused to save power. Benign, but
// it surfaces as a red unhandled-rejection ERROR — swallow just that case at
// the source. Anything else still rejects normally.
if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype?.play) {
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const result = origPlay.apply(this, args);
    if (result && typeof result.catch === 'function') {
      return result.catch((err) => {
        const name = err?.name || '';
        const msg = String(err?.message || '');
        if (name === 'AbortError' || /play\(\) request was interrupted/i.test(msg)) {
          return undefined;
        }
        throw err;
      });
    }
    return result;
  };
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

