/**
 * Operator commands for portable snapshots.
 * Kept beside the snapshot module so the commands can be tested without a
 * process launch; `scripts/portable-backup.ts` is only the command-line wrapper.
 * @module
 */

import { join } from 'node:path'
import {
  createPortableSnapshot,
  findPortableSnapshot,
  listPortableSnapshots,
  restorePortableSnapshot,
} from './backup.ts'
import { PORTABLE_CONFIG_FILE } from './config.ts'
import { resolvePortableLayout } from './layout.ts'
import { loadPortableConfig, NODE_PORTABLE_FILE_SYSTEM } from './store.ts'

/** A command line that cannot be carried out. */
export class PortableBackupUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortableBackupUsageError'
  }
}

/**
 * Parse the command line.
 * @param argv - Arguments after the script path: root, action, operand.
 * @returns The root, the action, and its operand.
 */
export function parsePortableBackupArguments(argv: readonly string[]): { root: string; action: string; operand?: string } {
  const [root, action, operand] = argv
  if (root === undefined || action === undefined) {
    throw new PortableBackupUsageError('usage: portable-backup <portable-root> <list|create|restore> [operand]')
  }
  if (!['list', 'create', 'restore'].includes(action)) {
    throw new PortableBackupUsageError(`portable-backup: unknown action ${action}`)
  }
  if (action === 'restore' && operand === undefined) {
    throw new PortableBackupUsageError('portable-backup: restore needs a snapshot name or "latest"')
  }
  return { root, action, ...(operand === undefined ? {} : { operand }) }
}

/**
 * Resolve the layout of a portable root.
 * @param root - Directory holding `portable.json`.
 * @returns The layout described by the manifest.
 */
function openRoot(root: string) {
  const configFile = join(root, PORTABLE_CONFIG_FILE)
  const loaded = loadPortableConfig({ configFile, quarantineDirectory: join(root, 'backup'), fileSystem: NODE_PORTABLE_FILE_SYSTEM })
  if (loaded.kind !== 'loaded') {
    throw new PortableBackupUsageError(`portable-backup: ${configFile} cannot be read: ${loaded.problem.kind}`)
  }
  return resolvePortableLayout(root, loaded.config)
}

/**
 * Run one snapshot command.
 * @param argv - Arguments after the script path.
 * @returns Text to print.
 */
export async function runPortableBackupCommand(argv: readonly string[]): Promise<string> {
  const { root, action, operand } = parsePortableBackupArguments(argv)
  const layout = openRoot(root)
  if (action === 'list') {
    const snapshots = await listPortableSnapshots(layout)
    if (snapshots.length === 0) return 'no snapshots'
    return snapshots
      .map(snapshot => `${snapshot.createdAt}  ${snapshot.files} files  ${snapshot.reason}  ${snapshot.directory}`)
      .join('\n')
  }
  if (action === 'create') {
    const snapshot = await createPortableSnapshot({ layout, reason: operand ?? 'manual' })
    return `created ${snapshot.directory} (${snapshot.files} files)`
  }
  const snapshot = await findPortableSnapshot(layout, operand ?? 'latest')
  await restorePortableSnapshot({ layout, snapshot })
  return `restored ${snapshot.directory}`
}
