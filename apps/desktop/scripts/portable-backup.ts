/**
 * Command-line wrapper for portable snapshot maintenance.
 * Usage:
 *   tsx scripts/portable-backup.ts <portable-root> list
 *   tsx scripts/portable-backup.ts <portable-root> create [reason]
 *   tsx scripts/portable-backup.ts <portable-root> restore <snapshot|latest>
 * @module
 */

import { runPortableBackupCommand } from '../src/portable/snapshot-cli.ts'

try {
  console.log(await runPortableBackupCommand(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
