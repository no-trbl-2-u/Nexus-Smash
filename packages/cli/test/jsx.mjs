// Import this first in a test that renders .jsx: it registers test/jsx-hooks.mjs for the rest of the process.
import { register } from 'node:module';
import { uiKit } from '../shared/kit.mjs';

// What vite.config.mjs defines at build time (src/data/kit.js): the fork's identity from kit.json.
globalThis.__NEXUS_KIT__ ||= uiKit();

register('./jsx-hooks.mjs', import.meta.url);
