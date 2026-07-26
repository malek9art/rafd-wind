/**
 * مخطط SQLite للمرحلة 0 — بالضبط كما نصّت خارطة الطريق (الوثيقة §15):
 * الجداول products و sales و sale_items فقط، بلا tenant_id (§3/§6).
 * التواريخ TEXT بصيغة ISO 8601 (§6 ملاحظة التصميم).
 *
 * جدول schema_version يُضاف في المرحلة 1 مع نظام الترقيات (§9) — غير موجود عمدًا هنا.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  cost REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  total REAL NOT NULL,
  paid REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
`
