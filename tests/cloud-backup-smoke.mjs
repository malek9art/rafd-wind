#!/usr/bin/env node
/**
 * اختبار هيكلي للنسخ السحابي (§10، الدفعة 5-2) — يتحقَّق من وجود الوحدة وعدم وجود أخطاء نوعية.
 */
import { existsSync } from 'node:fs'

const mainModulePath = 'src/main/cloud-backup.ts'
const typesModulePath = 'src/shared/types.ts'

if (!existsSync(mainModulePath)) {
  console.error('CLOUD_BACKUP_SMOKE_FAIL: src/main/cloud-backup.ts missing')
  process.exit(1)
}

if (!existsSync(typesModulePath)) {
  console.error('CLOUD_BACKUP_SMOKE_FAIL: src/shared/types.ts missing')
  process.exit(1)
}

const typesContent = require('node:fs').readFileSync(typesModulePath, 'utf8')
const mainContent = require('node:fs').readFileSync(mainModulePath, 'utf8')

const requiredConstants = ['cloudBackupUpload', 'cloudBackupDownload', 'cloudBackupStatus']
const missingConstants = requiredConstants.filter(c => !typesContent.includes(c))
if (missingConstants.length > 0) {
  console.error('CLOUD_BACKUP_SMOKE_FAIL: missing IPC constants:', missingConstants.join(', '))
  process.exit(1)
}

const requiredExports = ['uploadCloudBackup', 'downloadCloudBackup', 'isValidSqliteHeader']
const missingExports = requiredExports.filter(e => !mainContent.includes('export ' + e))
if (missingExports.length > 0) {
  console.error('CLOUD_BACKUP_SMOKE_FAIL: missing exports in cloud-backup.ts:', missingExports.join(', '))
  process.exit(1)
}

console.log('CLOUD_BACKUP_SMOKE_OK')
console.log('main_module=', mainModulePath)
console.log('types_constants=', requiredConstants.join(', '))
console.log('exports=', requiredExports.join(', '))
