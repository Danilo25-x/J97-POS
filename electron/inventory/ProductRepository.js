// electron/inventory/ProductRepository.js

class ProductRepository {
  constructor(db) {
    this.db = db
  }

  // ─── Productos ────────────────────────────────────────────

  findAll({ search, categoryId, brandId, gender, lowStock, page = 1, pageSize = 20 } = {}) {
    let sql = `
      SELECT p.*,
             c.name  AS category_name,
             b.name  AS brand_name,
             s.name AS supplier_name,
             COALESCE(SUM(v.stock), 0) AS total_stock,
             COUNT(v.id) AS variant_count
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b     ON b.id = p.brand_id
      LEFT JOIN suppliers s  ON s.id = p.supplier_id
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE p.is_active = 1
    `
    const params = []

    if (search) {
      sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`
      const q = `%${search}%`
      params.push(q, q, q)
    }
    if (categoryId) { sql += ' AND p.category_id = ?'; params.push(categoryId) }
    if (brandId)    { sql += ' AND p.brand_id = ?';     params.push(brandId) }
    

    sql += ' GROUP BY p.id'

    if (lowStock) {
      sql += ' HAVING total_stock <= (SELECT CAST(value AS INTEGER) FROM settings WHERE key = "low_stock_threshold")'
    }

    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?'
    params.push(pageSize, (page - 1) * pageSize)

    const items = this.db.all(sql, params)

    let countSql = `SELECT COUNT(*) AS total FROM products p WHERE p.is_active = 1`
    const countParams = []
    if (search) {
      countSql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`
      const q = `%${search}%`
      countParams.push(q, q, q)
    }
    if (categoryId) { countSql += ' AND p.category_id = ?'; countParams.push(categoryId) }
    if (brandId)    { countSql += ' AND p.brand_id = ?';    countParams.push(brandId) }
    

    const { total } = this.db.get(countSql, countParams)

    return { items, total, page, pageSize }
  }

  findById(id) {
    const product = this.db.get(
      `SELECT p.*, c.name AS category_name, b.name AS brand_name, s.name AS supplier_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b     ON b.id = p.brand_id
       LEFT JOIN suppliers s  ON s.id = p.supplier_id
       WHERE p.id = ?`,
      [id]
    )
    if (!product) return null

    product.variants = this.db.all(
      `SELECT v.*, COALESCE(v.image_path, p.image_path) AS display_image_path
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.product_id = ? AND v.is_active = 1 ORDER BY v.size, v.color`,
      [id]
    )
    return product
  }

  findBySku(sku) {
    return this.db.get('SELECT id FROM products WHERE sku = ?', [sku])
  }

  findByBarcode(barcode) {
    const variant = this.db.get(
      `SELECT v.*, p.name AS product_name, p.sku, p.sale_price AS product_price
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.barcode = ? AND v.is_active = 1`,
      [barcode]
    )
    if (variant) return { type: 'variant', data: variant }

    const product = this.db.get('SELECT * FROM products WHERE barcode = ? AND is_active = 1', [barcode])
    if (product) return { type: 'product', data: product }

    return null
  }

  create(data) {
    const result = this.db.run(
      `INSERT INTO products
        (sku, name, description, category_id, brand_id, supplier_id,
         cost_price, sale_price, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.sku, data.name, data.description || null,
        data.categoryId || null, data.brandId || null, data.supplierId || null,
        data.costPrice ?? 0, data.salePrice ?? 0,
        data.imagePath || null
      ]
    )
    return result.lastInsertRowid
  }

  update(id, data) {
    this.db.run(
      `UPDATE products SET
         sku = ?, name = ?, description = ?,
         category_id = ?, brand_id = ?, supplier_id = ?,
         cost_price = ?, sale_price = ?, image_path = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        data.sku, data.name, data.description || null,
        data.categoryId || null, data.brandId || null, data.supplierId || null,
        data.costPrice ?? 0, data.salePrice ?? 0,
        data.imagePath || null, id
      ]
    )
  }

  softDelete(id) {
    this.db.run(`UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`, [id])
  }

  // ─── Variantes ────────────────────────────────────────────

  findVariantsByProduct(productId) {
    return this.db.all(
      `SELECT v.*, COALESCE(v.image_path, p.image_path) AS display_image_path
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.product_id = ? AND v.is_active = 1 ORDER BY v.size, v.color`,
      [productId]
    )
  }

  findVariantById(id) {
    return this.db.get('SELECT * FROM product_variants WHERE id = ?', [id])
  }

  findVariantBySku(skuVariant) {
    return this.db.get('SELECT id FROM product_variants WHERE sku_variant = ?', [skuVariant])
  }

  createVariant(data) {
    const result = this.db.run(
      `INSERT INTO product_variants (product_id, sku_variant, size, color, stock, price_override, barcode, image_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.productId, data.skuVariant, data.size, data.color,
        data.stock ?? 0, data.priceOverride ?? null, data.barcode || null, data.imagePath || null
      ]
    )
    return result.lastInsertRowid
  }

  updateVariant(id, data) {
    this.db.run(
      `UPDATE product_variants SET
         size = ?, color = ?, price_override = ?, barcode = ?, image_path = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [data.size, data.color, data.priceOverride ?? null, data.barcode || null, data.imagePath || null, id]
    )
  }

  softDeleteVariant(id) {
    this.db.run(`UPDATE product_variants SET is_active = 0, updated_at = datetime('now') WHERE id = ?`, [id])
  }

  setVariantStock(variantId, newStock) {
    this.db.run(
      `UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
      [newStock, variantId]
    )
  }

  // ─── Movimientos de inventario ──────────────────────────────

  recordMovement({ variantId, userId, type, qty, stockBefore, stockAfter, reference, notes }) {
    this.db.run(
      `INSERT INTO inventory_movements
        (variant_id, user_id, type, qty, stock_before, stock_after, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [variantId, userId, type, qty, stockBefore, stockAfter, reference || null, notes || null]
    )
  }

  getMovements(variantId, limit = 50) {
    return this.db.all(
      `SELECT m.*, u.name AS user_name
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.variant_id = ?
       ORDER BY m.created_at DESC LIMIT ?`,
      [variantId, limit]
    )
  }

  // ─── Catálogos auxiliares ───────────────────────────────────

  getCategories() {
    return this.db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY name')
  }

  getBrands() {
    return this.db.all('SELECT * FROM brands WHERE is_active = 1 ORDER BY name')
  }

  getSuppliers() {
    return this.db.all('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name')
  }

  createCategory(name) {
    const r = this.db.run('INSERT INTO categories (name) VALUES (?)', [name])
    return r.lastInsertRowid
  }

  createBrand(name) {
    const r = this.db.run('INSERT INTO brands (name) VALUES (?)', [name])
    return r.lastInsertRowid
  }

  // ─── Alertas de stock bajo ───────────────────────────────────

  getLowStockVariants() {
    const row = this.db.get(`SELECT value FROM settings WHERE key = 'low_stock_threshold'`)
    const threshold = row ? Number(row.value) : 5

    return this.db.all(
      `SELECT v.*, p.name AS product_name, p.sku
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock <= ?
       ORDER BY v.stock ASC`,
      [threshold]
    )
  }

  // ─── Estadísticas para KPIs del Inventario ───────────────────

  getStats() {
    const totalProducts = this.db.get(
      `SELECT COUNT(*) AS n FROM products WHERE is_active = 1`
    ).n

    const threshold = (() => {
      const row = this.db.get(`SELECT value FROM settings WHERE key = 'low_stock_threshold'`)
      return row ? Number(row.value) : 5
    })()

    const lowStock = this.db.get(
      `SELECT COUNT(*) AS n FROM (
         SELECT v.id, v.stock FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock > 0 AND v.stock <= ?
       )`,
      [threshold]
    ).n

    const outOfStock = this.db.get(
      `SELECT COUNT(*) AS n FROM (
         SELECT v.id FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.is_active = 1 AND p.is_active = 1 AND v.stock = 0
       )`
    ).n

    const inventoryValue = this.db.get(
      `SELECT COALESCE(SUM(v.stock * p.cost_price), 0) AS total
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.is_active = 1 AND p.is_active = 1`
    ).total

    return { totalProducts, lowStock, outOfStock, inventoryValue, threshold }
  }
}

module.exports = ProductRepository
