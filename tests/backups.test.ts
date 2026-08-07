import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb, type Db } from '../src/main/db'
import { createProduct, listProducts } from '../src/main/repos/products'
import { createBackup, deleteBackup, listBackups, restoreBackup, validateBackup } from '../src/main/backups'

let dir: string
let dbPath: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-backups-'))
  dbPath = join(dir, 'rafd.db')
  db = openDb(dbPath)
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* restoreBackup closes the handle deliberately */
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('مدير النسخ الاحتياطية المحلية', () => {
  it('ينشئ metadata وchecksum ويمرر integrity_check', async () => {
    createProduct(db, { name: 'قبل النسخة', price: 10, stock: 3 })
    const info = await createBackup(db, dir, '0.1.0')
    expect(info.file_name).toBe(`${info.id}.db`)
    expect(info.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(info.size_bytes).toBeGreaterThan(0)
    expect(listBackups(dir).map((item) => item.id)).toEqual([info.id])
    expect(validateBackup(dir, info.id).sha256).toBe(info.sha256)
  })

  it('يستعيد النسخة ويحتفظ بنسخة أمان من الحالة الحالية', async () => {
    const first = createProduct(db, { name: 'بيانات أصلية', price: 10, stock: 3 })
    const backup = await createBackup(db, dir, '0.1.0')
    createProduct(db, { name: 'بيانات لاحقة', price: 20, stock: 2 })

    const result = await restoreBackup(db, dir, dbPath, backup.id, '0.1.0')
    expect(result.safety_backup.id).not.toBe(backup.id)

    db = openDb(dbPath)
    expect(listProducts(db).map((product) => product.name)).toEqual([first.name])
    expect(listBackups(dir)).toHaveLength(2)
  })

  it('حذف النسخة يتطلب معرفًا موجودًا ويحذف الملف والmetadata', async () => {
    const info = await createBackup(db, dir, '0.1.0')
    deleteBackup(dir, info.id)
    expect(listBackups(dir)).toHaveLength(0)
    expect(() => deleteBackup(dir, info.id)).toThrow()
  })
})
