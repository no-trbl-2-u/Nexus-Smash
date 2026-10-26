// The fork's identity for the UI (spec 60): the repo, the package, where the kit's docs live and how a person starts
// nexus. vite.config.mjs defines __NEXUS_KIT__ at build time from shared/kit.mjs uiKit() (kit.json at the root); a
// test sets globalThis.__NEXUS_KIT__ the same way (test/jsx.mjs). Nothing here reads a file or the network.
/* global __NEXUS_KIT__ */
const BUILT = typeof __NEXUS_KIT__ === 'object' && __NEXUS_KIT__ ? __NEXUS_KIT__ : {};

export const KIT = Object.freeze({
  repo: BUILT.repo || '',
  package: BUILT.package || 'nexus',
  docs: (BUILT.docs || '').replace(/\/+$/, ''),
  launch: BUILT.launch || 'nexus',
});

/** A kit doc's URL from its repo path (customization/secrets.md); '' when the build named no docs. */
export const kitDoc = (rel) => (KIT.docs ? `${KIT.docs}/${String(rel).replace(/^\/+/, '')}` : '');
