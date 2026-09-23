// Vite config. base './' = relative paths, so the build works in any sub-folder
// (e.g. https://<user>.github.io/fit-me-prototype/).
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  // three.js alone is ~570 kB (145 kB gzipped); MediaPipe is split off and loaded on demand
  build: { chunkSizeWarningLimit: 700 }, // also reachable from a phone in the same Wi-Fi (camera needs HTTPS there)
});
