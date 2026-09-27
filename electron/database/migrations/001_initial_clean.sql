-- J97 POS - esquema inicial canónico
-- Este archivo es la única migración base del proyecto actual.
-- Futuras modificaciones deben agregarse como 002_xxx.sql, 003_xxx.sql, etc.
-- No contiene roles múltiples ni métodos QR/tarjeta.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin' CHECK(role = 'admin'),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  locked_until    TEXT,
  last_login      TEXT,
  created_at      TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
INSERT OR IGNORE INTO settings(key,value) VALUES
 ('store_name','J''97'),('store_nit',''),('store_address',''),('store_phone',''),('store_email',''),
 ('currency','COP'),('tax_rate','0'),('invoice_prefix','J97'),('invoice_next','1'),
 ('low_stock_threshold','5'),('backup_enabled','1'),('backup_days','7'),('tax_enabled','0'),
 ('logo_path',''),('theme','light');

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(trim(name) <> ''),
  document TEXT NOT NULL CHECK(length(document) BETWEEN 5 AND 15 AND document NOT GLOB '*[^0-9]*'),
  phone TEXT NOT NULL CHECK(length(phone) BETWEEN 7 AND 15 AND phone NOT GLOB '*[^0-9]*'),
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_document ON customers(document);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  brand_id INTEGER REFERENCES brands(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
  sale_price REAL NOT NULL DEFAULT 0 CHECK(sale_price >= 0),
  stock_min INTEGER NOT NULL DEFAULT 0 CHECK(stock_min >= 0),
  image_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_image_path ON products(image_path);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku_variant TEXT NOT NULL UNIQUE,
  size TEXT NOT NULL CHECK(trim(size) <> ''),
  color TEXT NOT NULL CHECK(trim(color) <> ''),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  price_override REAL CHECK(price_override IS NULL OR price_override >= 0),
  barcode TEXT UNIQUE,
  image_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(product_id, size, color)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variant_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variant_image_path ON product_variants(image_path);

CREATE TABLE IF NOT EXISTS cash_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  opening_amount REAL NOT NULL DEFAULT 0 CHECK(opening_amount >= 0),
  opened_at TEXT NOT NULL DEFAULT(datetime('now')),
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),
  closing_amount REAL,
  expected_amount REAL,
  difference REAL,
  total_sales REAL NOT NULL DEFAULT 0,
  total_expenses REAL NOT NULL DEFAULT 0,
  cash_sales REAL NOT NULL DEFAULT 0,
  transfer_sales REAL NOT NULL DEFAULT 0,
  credit_sales REAL NOT NULL DEFAULT 0,
  sistecredito_sales REAL NOT NULL DEFAULT 0,
  credit_collection_cash REAL NOT NULL DEFAULT 0,
  credit_collection_transfer REAL NOT NULL DEFAULT 0,
  total_credit_collections REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_register ON cash_registers(status) WHERE status='open';

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  cash_register_id INTEGER NOT NULL REFERENCES cash_registers(id),
  customer_id INTEGER REFERENCES customers(id),
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  tax_amt REAL NOT NULL DEFAULT 0 CHECK(tax_amt >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN('completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  financing_method TEXT NOT NULL DEFAULT 'none' CHECK(financing_method IN('none','credito','sistecredito')),
  financing_pct REAL NOT NULL DEFAULT 0 CHECK(financing_pct >= 0 AND financing_pct <= 100),
  financing_base REAL NOT NULL DEFAULT 0 CHECK(financing_base >= 0),
  financing_total REAL NOT NULL DEFAULT 0 CHECK(financing_total >= 0),
  installment_count INTEGER NOT NULL DEFAULT 1 CHECK(installment_count >= 1 AND installment_count <= 120),
  installment_amount REAL NOT NULL DEFAULT 0 CHECK(installment_amount >= 0),
  final_installment REAL NOT NULL DEFAULT 0 CHECK(final_installment >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_cash ON sales(cash_register_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_financing_method ON sales(financing_method);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  variant_id INTEGER REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  size TEXT,
  color TEXT,
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  discount_pct REAL NOT NULL DEFAULT 0 CHECK(discount_pct >= 0 AND discount_pct <= 100),
  line_total REAL NOT NULL CHECK(line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK(method IN('efectivo','transferencia','credito','sistecredito')),
  amount REAL NOT NULL CHECK(amount > 0),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_register_id INTEGER NOT NULL REFERENCES cash_registers(id),
  user_id INTEGER REFERENCES users(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Otros',
  amount REAL NOT NULL CHECK(amount > 0),
  observation TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN('entrada','venta','devolucion','ajuste','salida')),
  qty INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL CHECK(stock_after >= 0),
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_variant_date ON inventory_movements(variant_id,created_at);

CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  total_amount REAL NOT NULL CHECK(total_amount > 0),
  installment_count INTEGER NOT NULL CHECK(installment_count > 0),
  installment_amount REAL NOT NULL CHECK(installment_amount > 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
  balance REAL NOT NULL CHECK(balance >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid','cancelled')),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credits_customer_status ON credits(customer_id,status);

CREATE TABLE IF NOT EXISTS credit_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id INTEGER NOT NULL REFERENCES credits(id),
  user_id INTEGER REFERENCES users(id),
  amount REAL NOT NULL CHECK(amount > 0),
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'efectivo' CHECK(payment_method IN('efectivo','transferencia')),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_payments_credit_date ON credit_payments(credit_id,created_at);

CREATE TABLE IF NOT EXISTS cash_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_register_id INTEGER NOT NULL REFERENCES cash_registers(id),
  user_id INTEGER REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'credit_payment',
  reference_id INTEGER,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN('efectivo','transferencia')),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_income_register_date ON cash_income(cash_register_id,created_at);
CREATE INDEX IF NOT EXISTS idx_cash_income_reference ON cash_income(reference_id);

CREATE TRIGGER IF NOT EXISTS trg_customers_required_contact_insert
BEFORE INSERT ON customers
FOR EACH ROW
WHEN trim(COALESCE(NEW.name,'')) = ''
  OR trim(COALESCE(NEW.document,'')) = ''
  OR trim(COALESCE(NEW.phone,'')) = ''
BEGIN
  SELECT RAISE(ABORT,'Nombre, documento y teléfono son obligatorios');
END;

CREATE TRIGGER IF NOT EXISTS trg_customers_required_contact_update
BEFORE UPDATE OF name, document, phone ON customers
FOR EACH ROW
WHEN trim(COALESCE(NEW.name,'')) = ''
  OR trim(COALESCE(NEW.document,'')) = ''
  OR trim(COALESCE(NEW.phone,'')) = ''
BEGIN
  SELECT RAISE(ABORT,'Nombre, documento y teléfono son obligatorios');
END;
