// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for site-wide identity. The React app and the
// post-build prerender script (scripts/postbuild.mjs) both read
// routes.json, so the HTML a crawler sees and the HTML a browser renders
// never drift apart.

import data from './routes.json';

export const SITE_NAME = data.siteName;
export const SITE_URL  = ((import.meta.env.VITE_SITE_URL as string | undefined) || data.defaultSiteUrl)
  .replace(/\/+$/, '');
export const REPO      = 'https://github.com/novaai0401-ui/quantum-vault';
export const VERSION: string = __QV_VERSION__;   // injected by vite.config.ts from qv-sdk/package.json
export const DEFAULT_DESCRIPTION = data.defaultDescription;

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
  priority: number;
}

export const ROUTES: RouteMeta[] = data.routes;

export function routeMeta(path: string): RouteMeta | undefined {
  return ROUTES.find((r) => r.path === path);
}
