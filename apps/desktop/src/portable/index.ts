/**
 * Portable-edition surface of the desktop shell.
 * The desktop entry point consumes these exports before Electron is ready;
 * keeping them behind one module makes the redirect order explicit and lets
 * tests exercise the layout without loading Electron.
 * @module
 */

export {
  initializePortableDesktop,
  describePortableStartupProblem,
  PORTABLE_LOW_SPACE_BYTES,
  type PortableAppPort,
  type PortableBootstrapOptions,
  type PortableCommandLinePort,
  type PortableStartup,
  type PortableStartupProblem,
} from './bootstrap.ts'
export {
  createPortableSnapshot,
  findPortableSnapshot,
  listPortableSnapshots,
  PORTABLE_SNAPSHOTS_RETAINED,
  PORTABLE_SNAPSHOT_VERSION,
  PortableSnapshotError,
  prunePortableSnapshots,
  restorePortableSnapshot,
  type PortableSnapshot,
} from './backup.ts'
export {
  DEFAULT_PORTABLE_CONFIG,
  PORTABLE_CONFIG_FILE,
  PORTABLE_PATH_VERSION,
  parsePortableConfig,
  parsePortableConfigValue,
  portableDirectoryProblem,
  serializePortableConfig,
  type PortableConfig,
  type PortableConfigParse,
  type PortableConfigProblem,
  type PortableDirectoryField,
  type PortableDirectoryProblem,
} from './config.ts'
export {
  findPortableInstaller,
  portableApplyScript,
  portableApplyScriptPath,
  portableInstallerPlan,
  relativeToPortableRoot,
  schedulePortableUpdate,
  type PortableApplySpawn,
  type PortableInstallerPlan,
} from './apply.ts'
export {
  createPortableUpdater,
  PortableNsisUpdater,
  portableUpdaterAdapter,
  type PortableAppAdapter,
  type PortableUpdaterAdapter,
  type PortableUpdaterOptions,
} from './updater.ts'
export {
  applyPortableEnvironment,
  portableEnvironment,
} from './environment.ts'
export {
  isInside,
  PortableLayoutError,
  portableApplicationLogs,
  portableDiagnosticLogs,
  portableDirectories,
  portableDownloads,
  portableSnapshotDirectory,
  portableSnapshotsRoot,
  portableUpdateBackup,
  portableUpdateDownloads,
  portableUpdateRecord,
  portableUpdateStaging,
  portableUserData,
  portableVersionBackups,
  resolvePortableLayout,
  type PortableLayout,
} from './layout.ts'
export {
  migrationCandidates,
  migrateIntoPortable,
  type PortableMigration,
  type PortableMigrationSource,
} from './migration.ts'
export {
  PORTABLE_ROOT_HISTORY_LIMIT,
  recordPortableRoot,
  relocatePortableState,
  replacePortableRoots,
  stalePortableRoots,
  type PortableRelocation,
  type SessionGroupRelocation,
} from './relocation.ts'
export {
  describePortableVolume,
  listPortableVolumes,
  parsePortableInstallArguments,
  parseVolumeList,
  volumeKind,
  type PortableInstallArguments,
} from './install-cli.ts'
export {
  checkPortableInstallTarget,
  installPortableEdition,
  measurePortablePayload,
  PORTABLE_INSTALL_SPACE_MARGIN,
  readInstalledManifest,
  type PortableInstallProblem,
  type PortableInstallResult,
  type PortablePayloadFacts,
  type PortableVolume,
} from './install.ts'
export {
  parsePortableBackupArguments,
  PortableBackupUsageError,
  runPortableBackupCommand,
} from './snapshot-cli.ts'
export {
  firstSessionFrame,
  projectSessionDirectory,
  readSessionHeaderLine,
  rewriteSessionHeader,
  type SessionFrameRange,
} from './session-log.ts'
export { findPortableRoot, PORTABLE_MARKER_FILE, PORTABLE_ROOT_ENV, type PortableRootDiscovery, type PortableRootProblem } from './root.ts'
export {
  appendPortableLog,
  loadPortableConfig,
  NODE_PORTABLE_FILE_SYSTEM,
  PortableConfigError,
  writePortableConfig,
  type PortableConfigLoad,
  type PortableConfigWrite,
  type PortableFileSystem,
} from './store.ts'
export {
  classifyPortableUpdate,
  clearPortableUpdateRecord,
  PORTABLE_UPDATE_RECORD_VERSION,
  PORTABLE_VERSION_BACKUPS_RETAINED,
  PortableUpdateError,
  pruneVersionBackups,
  readPortableUpdateRecord,
  settlePortableUpdate,
  writePortableUpdateRecord,
  type PortableUpdateOutcome,
  type PortableUpdateRecord,
} from './update.ts'
