/**
 * Updater instance that keeps every update artifact on the removable volume.
 * `electron-updater` derives its download cache from the Electron app adapter,
 * whose default is `app.getPath('userData')`. Redirecting `userData` already
 * keeps downloads off the system drive, but the portable layout gives updates a
 * directory of their own next to the transaction record, so the adapter here
 * supplies that path and hands the replacement to the portable apply step
 * instead of the NSIS in-place installer.
 * @module
 */

import { NsisUpdater, type AppUpdater } from 'electron-updater'
import { portableUpdateDownloads, type PortableLayout } from './layout.ts'

/** Electron capabilities the updater adapter reads. */
export interface PortableUpdaterAdapter {
  /** Running application version. */
  readonly version: string
  /** Application name. */
  readonly name: string
  /** Whether the application runs from a packaged directory. */
  readonly isPackaged: boolean
  /** Absolute `app-update.yml` path shipped beside the application. */
  readonly appUpdateConfigPath: string
  /** Absolute Electron user-data directory. */
  readonly userDataPath: string
  /** Resolve when the application is ready. */
  whenReady(): Promise<void>
  /** Restart the application. */
  relaunch(): void
  /** Quit the application. */
  quit(): void
  /** Observe the quit, including the process exit code. */
  onQuit(handler: (exitCode: number) => void): void
}

/** Portable adapter, expressed in the shape `electron-updater` consumes. */
export interface PortableAppAdapter extends PortableUpdaterAdapter {
  /** Base directory the updater creates its download cache under. */
  readonly baseCachePath: string
}

/**
 * Point an adapter's download cache at the portable update directory.
 * @param adapter - Electron-derived adapter values.
 * @param baseCachePath - Absolute download cache directory.
 * @returns Adapter with the redirected cache directory.
 */
export function portableUpdaterAdapter(adapter: PortableUpdaterAdapter, baseCachePath: string): PortableAppAdapter {
  return { ...adapter, baseCachePath }
}

/** Arguments for {@link createPortableUpdater}. */
export interface PortableUpdaterOptions {
  /** Absolute portable layout. */
  readonly layout: PortableLayout
  /** Electron-derived adapter values. */
  readonly adapter: PortableUpdaterAdapter
  /** Replace the application directory instead of installing in place. */
  readonly install: () => void
}

/**
 * `electron-updater` NSIS updater whose install step is the portable swap.
 * Downloads still go through the standard NSIS path, so the feed format and
 * channel selection stay identical to the installed edition.
 */
export class PortableNsisUpdater extends NsisUpdater {
  /**
   * Opt in to the desktop HTTP transport the update coordinator installs: the
   * portable updater downloads through the same executor as the installed build,
   * so idle timeouts and login forwarding stay identical.
   */
  readonly desktopTransport = true

  readonly #install: () => void

  /**
   * @param adapter - Adapter carrying the portable download cache.
   * @param install - Replacement step, invoked when the user installs.
   */
  constructor(adapter: PortableAppAdapter, install: () => void) {
    super(null, adapter)
    this.#install = install
  }

  /**
   * Hand the downloaded update to the portable replacement step.
   * @param _isSilent - Ignored: the portable installer always runs silently.
   * @param _isForceRunAfter - Ignored: the portable build relaunches itself.
   */
  override quitAndInstall(_isSilent?: boolean, _isForceRunAfter?: boolean): void {
    this.#install()
  }
}

/**
 * Create the updater the desktop update coordinator drives in portable mode.
 * @param options - Layout, Electron adapter values, and replacement step.
 * @returns An updater whose cache lives under `<root>\updates\downloads`.
 */
export function createPortableUpdater(options: PortableUpdaterOptions): AppUpdater {
  const adapter = portableUpdaterAdapter(options.adapter, portableUpdateDownloads(options.layout))
  return new PortableNsisUpdater(adapter, options.install)
}
