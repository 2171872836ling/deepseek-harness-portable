/**
 * Environment variables that keep caches and temporary files on the portable
 * volume. Plugin installation runs pnpm from a scrubbed child environment that
 * drops every `DSH_`-prefixed variable, so the cache redirections must use the
 * conventional npm/pnpm/Python names they replace; `DSH_HOME` is added
 * separately for the shell and the host process.
 * @module
 */

import { joinPortable, type PortableLayout } from './layout.ts'

/**
 * Environment overrides for this process and every child it starts.
 * @param layout - Absolute portable layout.
 * @returns Variable names mapped to absolute directories on the portable volume.
 */
export function portableEnvironment(layout: PortableLayout): Record<string, string> {
  const python = joinPortable(layout.cache, 'python')
  return {
    DSH_HOME: layout.data,
    DSH_PORTABLE_ROOT: layout.root,
    TEMP: layout.temp,
    TMP: layout.temp,
    npm_config_cache: joinPortable(layout.cache, 'npm'),
    npm_config_cache_dir: joinPortable(layout.cache, 'npm'),
    npm_config_store_dir: joinPortable(layout.cache, 'pnpm-store'),
    pnpm_config_store_dir: joinPortable(layout.cache, 'pnpm-store'),
    PYTHONPYCACHEPREFIX: joinPortable(python, 'pycache'),
    PIP_CACHE_DIR: joinPortable(python, 'pip'),
    UV_CACHE_DIR: joinPortable(python, 'uv'),
  }
}

/**
 * Apply portable environment overrides to a live environment object.
 * @param environment - Environment to mutate.
 * @param layout - Absolute portable layout.
 */
export function applyPortableEnvironment(environment: NodeJS.ProcessEnv, layout: PortableLayout): void {
  Object.assign(environment, portableEnvironment(layout))
}
