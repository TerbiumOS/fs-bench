import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { BackendName } from './types.js';

const require = createRequire(import.meta.url);

export const BACKEND_NAMES: BackendName[] = ['filer', 'lightningfs', 'tfs'];

export const BACKEND_DISPLAY_NAMES: Record<BackendName, string> = {
  filer: 'Filer',
  lightningfs: 'LightningFS',
  tfs: 'TFS',
};

function resolveBundle(modulePath: string, fallbackSegments: string[]): string {
  try {
    return require.resolve(modulePath);
  } catch {
    return join(process.cwd(), 'node_modules', ...fallbackSegments);
  }
}

export const BROWSER_BACKEND_BUNDLES: Record<BackendName, string> = {
  filer: resolveBundle('filer/dist/filer.min.js', ['filer', 'dist', 'filer.min.js']),
  lightningfs: resolveBundle('@isomorphic-git/lightning-fs/dist/lightning-fs.min.js', ['@isomorphic-git', 'lightning-fs', 'dist', 'lightning-fs.min.js']),
  tfs: resolveBundle('@terbiumos/tfs/dist/web/tfs.js', ['@terbiumos', 'tfs', 'dist', 'web', 'tfs.js']),
};