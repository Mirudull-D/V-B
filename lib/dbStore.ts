import { sql } from './db';
import {
  Product,
  ProductBatch,
  ProductWithBatches,
  StockMovement,
  Category,
  Customer,
  OrderRow,
  OrderItemRow,
  OrderWithRelations,
  CartItem,
  Expense,
  PaymentMode,
  AdvanceOrderRow,
  AdvanceOrderItemRow,
  AdvanceOrderStatus,
  AdvanceOrderWithRelations,
  Service,
} from './types';
import { computeAdvanceFinalization, resolveAdvanceTotals, roundMoney } from './gst';

// Utility to generate a unique ID
const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

// Builds a ProductWithBatches, computing stock and active price.
// Stock is the sum of remaining batch quantities (FIFO); the active selling
// price comes from the oldest batch that still has stock.
function enrichProduct(
  product: Product,
  batches: ProductBatch[],
): ProductWithBatches {
  let active_selling_price = 0;
  let foundActiveBatch = false;
  let batchStock = 0;

  for (const batch of batches) {
    batchStock += batch.stock_quantity;
    if (batch.stock_quantity > 0 && !foundActiveBatch) {
      active_selling_price = Number(batch.selling_price);
      foundActiveBatch = true;
    }
  }

  return {
    ...product,
    batches,
    total_stock: batchStock,
    active_selling_price,
  };
}

async function upsertCustomer(name: string, phone: string, address?: string | null): Promise<Customer> {
  const id = uid();
  const rows = await sql`
    INSERT INTO customers (id, name, phone, address)
    VALUES (${id}, ${name}, ${phone}, ${address || null})
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
    RETURNING *
  `;
  return rows[0] as Customer;
}

// A batch can never go below zero stock (see migrate_stock_guard.mjs). When two
// sales race for the last units, the loser's transaction is rolled back by that
// constraint; we then rebuild its statements from the fresh stock and retry, so
// it simply takes what is left (any remainder is sold off-batch as before).
const STOCK_CONSTRAINT = 'product_batches_stock_nonneg';
const MAX_STOCK_RETRIES = 3;

function isStockViolation(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; message?: string };
  return (
    err?.code === '23514' &&
    (err.constraint === STOCK_CONSTRAINT || String(err.message).includes(STOCK_CONSTRAINT))
  );
}

async function runWithStockRetry(build: () => Promise<ReturnType<typeof sql>[]>) {
  for (let attempt = 1; ; attempt++) {
    const statements = await build();
    try {
      await sql.transaction(statements);
      return;
    } catch (e) {
      if (isStockViolation(e) && attempt < MAX_STOCK_RETRIES) continue;
      throw e;
    }
  }
}

type SubmitOrderPayload = {
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  source: 'ONLINE' | 'OFFLINE';
  isGst: boolean;
  billDate: string;
  items: CartItem[];
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
  discountAmount: number;
  gstPercentage: number;
  gstAmount: number;
  deliveryFee: number;
  grandTotal: number;
  cashReceived: number;
  splitCash?: number;
  splitGpay?: number;
  paymentMode: PaymentMode;
};

// Builds every write needed to record a sale — the order row, its items, the
// FIFO stock deductions and the OUT stock movements — as un-awaited queries.
// Callers run them through sql.transaction() so an order is saved completely or
// not at all (and finalizeAdvanceOrder can add its own statements to the same
// transaction). Only the customer upsert and the batch read happen up front.
async function buildOrderStatements(payload: SubmitOrderPayload) {
  const productIds = Array.from(
    new Set(
      payload.items
        .filter((i) => i.product_id)
        .map((i) => i.product_id as string)
    )
  );

  // Concurrently upsert customer and fetch batches for all products in 1 roundtrip
  const [customer, allBatches] = await Promise.all([
    upsertCustomer(payload.customerName, payload.customerPhone, payload.customerAddress),
    productIds.length > 0
      ? sql`
          SELECT * FROM product_batches
          WHERE product_id = ANY(${productIds}) AND stock_quantity > 0
          ORDER BY arrived_at ASC
        `
      : Promise.resolve([]),
  ]);

  // FIFO Stock Deduction and split items in memory
  const batchList = [...(allBatches as ProductBatch[])];
  const finalOrderItems: Omit<OrderItemRow, 'id'>[] = [];
  const batchUpdates: { id: string; deduction: number }[] = [];
  // OUT stock movements to log for the stock report (one per batch consumed).
  const outMovements: {
    product_id: string;
    batch_id: string;
    quantity: number;
    unit_cost: number;
    snapshot_name: string;
  }[] = [];

  for (const item of payload.items) {
    if (!item.product_id) {
      finalOrderItems.push({
        order_id: payload.orderId,
        product_id: null,
        batch_id: null,
        snapshot_name: item.name,
        snapshot_price: item.price,
        quantity: item.qty,
      });
      continue;
    }

    let remaining = item.qty;
    const matchingBatches = batchList.filter(
      (b) => b.product_id === item.product_id && b.stock_quantity > 0
    );

    for (const batch of matchingBatches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.stock_quantity);
      batch.stock_quantity -= take;
      batchUpdates.push({ id: batch.id, deduction: take });
      outMovements.push({
        product_id: item.product_id,
        batch_id: batch.id,
        quantity: take,
        unit_cost: Number(batch.cost_price) || 0,
        snapshot_name: item.name,
      });

      finalOrderItems.push({
        order_id: payload.orderId,
        product_id: item.product_id,
        batch_id: batch.id,
        snapshot_name: item.name,
        snapshot_price: Number(batch.selling_price),
        quantity: take,
      });

      remaining -= take;
    }

    if (remaining > 0) {
      finalOrderItems.push({
        order_id: payload.orderId,
        product_id: item.product_id,
        batch_id: null,
        snapshot_name: item.name,
        snapshot_price: item.price,
        quantity: remaining,
      });
    }
  }

  // Subtotal is GST-exclusive (sum of line prices × qty).
  // grand_total = subtotal - discount + gst_amount + delivery  (GST is added on top).
  // The money columns are plain NUMERIC (no fixed scale), so round to paise
  // here or float noise like 1030.8000000000002 would be stored as-is.
  const discountAmount = roundMoney(payload.discountAmount);
  const gstAmount = roundMoney(payload.gstAmount);
  const deliveryFee = roundMoney(payload.deliveryFee);
  const grandTotal = roundMoney(payload.grandTotal);
  const subtotalExclusive = roundMoney(grandTotal + discountAmount - gstAmount - deliveryFee);

  // The customer's name is frozen onto the order so renaming the customer later
  // does not rewrite old bills.
  return [
    sql`
      INSERT INTO orders (
        id, customer_id, customer_name_snapshot, source, status, is_gst, subtotal, discount_type, discount_value,
        discount_amount, gst_percentage, gst_amount, delivery_fee, grand_total,
        cash_received, split_cash, split_gpay, payment_mode, bill_date, created_at
      ) VALUES (
        ${payload.orderId}, ${customer.id}, ${payload.customerName}, ${payload.source}, 'COMPLETED', ${payload.isGst},
        ${subtotalExclusive},
        ${payload.discountType}, ${payload.discountValue}, ${discountAmount},
        ${payload.gstPercentage}, ${gstAmount}, ${deliveryFee},
        ${grandTotal}, ${roundMoney(payload.cashReceived)},
        ${payload.splitCash ?? 0}, ${payload.splitGpay ?? 0},
        ${payload.paymentMode}, ${payload.billDate}, now()
      )
    `,
    ...finalOrderItems.map((oi) =>
      sql`
        INSERT INTO order_items (
          id, order_id, product_id, batch_id, snapshot_name, snapshot_price, quantity
        ) VALUES (
          ${uid()}, ${oi.order_id}, ${oi.product_id}, ${oi.batch_id},
          ${oi.snapshot_name}, ${oi.snapshot_price}, ${oi.quantity}
        )
      `
    ),
    ...batchUpdates.map((u) =>
      sql`UPDATE product_batches SET stock_quantity = stock_quantity - ${u.deduction} WHERE id = ${u.id}`
    ),
    ...outMovements.map((m) =>
      sql`
        INSERT INTO stock_movements (
          id, product_id, batch_id, order_id, movement_type, quantity,
          unit_cost, snapshot_name, supplier_name, reason, moved_at
        ) VALUES (
          ${uid()}, ${m.product_id}, ${m.batch_id}, ${payload.orderId}, 'OUT', ${m.quantity},
          ${m.unit_cost}, ${m.snapshot_name}, NULL, ${'Sale ' + payload.orderId}, ${payload.billDate}
        )
      `
    ),
  ];
}

export const dbStore = {
  // CATEGORIES
  async listCategories(): Promise<Category[]> {
    const rows = await sql`SELECT * FROM categories ORDER BY name ASC`;
    return rows as Category[];
  },

  async addCategory(name: string): Promise<Category> {
    const id = uid();
    const rows = await sql`
      INSERT INTO categories (id, name)
      VALUES (${id}, ${name})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `;
    return rows[0] as Category;
  },

  async updateCategory(id: string, name: string): Promise<Category | null> {
    const existing = await sql`SELECT * FROM categories WHERE id = ${id}`;
    if (existing.length === 0) return null;
    const oldName = (existing[0] as Category).name;
    const newName = name.trim();
    if (!newName || newName === oldName) return existing[0] as Category;

    const rows = await sql`
      UPDATE categories SET name = ${newName} WHERE id = ${id} RETURNING *
    `;
    // Keep products in sync — their category is stored as the name string.
    await sql`UPDATE products SET category = ${newName} WHERE category = ${oldName}`;
    return rows[0] as Category;
  },

  async deleteCategory(id: string): Promise<void> {
    await sql`DELETE FROM categories WHERE id = ${id}`;
  },

  // PRODUCTS
  async listProducts(): Promise<Product[]> {
    const rows = await sql`SELECT * FROM products ORDER BY name ASC`;
    return rows as Product[];
  },

  async getProductWithBatches(id: string): Promise<ProductWithBatches | null> {
    const products = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (products.length === 0) return null;

    const batches = await sql`SELECT * FROM product_batches WHERE product_id = ${id} ORDER BY arrived_at ASC`;

    return enrichProduct(
      products[0] as Product,
      batches as ProductBatch[],
    );
  },

  async listProductsWithBatches(): Promise<ProductWithBatches[]> {
    const [products, allBatches] = await Promise.all([
      sql`SELECT * FROM products ORDER BY name ASC`,
      sql`SELECT * FROM product_batches ORDER BY arrived_at ASC`,
    ]);

    return products.map((p: any) =>
      enrichProduct(
        p as Product,
        (allBatches as ProductBatch[]).filter((b) => b.product_id === p.id),
      ),
    );
  },

  async addProduct(input: { name: string; description: string | null; category: string; gst_rate: number; low_stock_threshold: number }): Promise<Product> {
    const id = uid();
    const rows = await sql`
      INSERT INTO products (id, name, description, category, gst_rate, low_stock_threshold)
      VALUES (${id}, ${input.name}, ${input.description}, ${input.category}, ${input.gst_rate}, ${input.low_stock_threshold})
      RETURNING *
    `;
    return rows[0] as Product;
  },

  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | null> {
    if (Object.keys(patch).length === 0) return this.getProductWithBatches(id);

    // We update fields individually since dynamic SET with Neon SQL template tag is tricky
    if (patch.name !== undefined) await sql`UPDATE products SET name = ${patch.name} WHERE id = ${id}`;
    if (patch.description !== undefined) await sql`UPDATE products SET description = ${patch.description} WHERE id = ${id}`;
    if (patch.category !== undefined) await sql`UPDATE products SET category = ${patch.category} WHERE id = ${id}`;
    if (patch.gst_rate !== undefined) await sql`UPDATE products SET gst_rate = ${patch.gst_rate} WHERE id = ${id}`;
    if (patch.low_stock_threshold !== undefined) await sql`UPDATE products SET low_stock_threshold = ${patch.low_stock_threshold} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as Product) : null;
  },

  async deleteProduct(id: string): Promise<void> {
    await sql`DELETE FROM products WHERE id = ${id}`;
  },

  // BATCHES
  async addBatch(input: {
    product_id: string;
    batch_no: string | null;
    manufacturer: string | null;
    supplier_name?: string | null;
    supplier_phone?: string | null;
    supplier_invoice_no?: string | null;
    supplier_invoice_date?: string | null;
    hsn_code: string | null;
    cost_price: number;
    selling_price: number;
    stock_quantity: number;
  }): Promise<ProductBatch> {
    const id = uid();
    const stockQty = Math.max(0, Math.trunc(Number(input.stock_quantity) || 0));

    const rows = await sql`
      INSERT INTO product_batches (
        id, product_id, batch_no, manufacturer,
        supplier_name, supplier_phone, supplier_invoice_no, supplier_invoice_date,
        hsn_code, cost_price, selling_price, stock_quantity
      ) VALUES (
        ${id}, ${input.product_id}, ${input.batch_no}, ${input.manufacturer},
        ${input.supplier_name ?? null}, ${input.supplier_phone ?? null},
        ${input.supplier_invoice_no ?? null}, ${input.supplier_invoice_date ?? null},
        ${input.hsn_code}, ${input.cost_price}, ${input.selling_price}, ${stockQty}
      )
      RETURNING *
    `;

    // Log the incoming stock as an IN movement for the stock report.
    if (stockQty > 0) {
      const nameRows = await sql`SELECT name FROM products WHERE id = ${input.product_id}`;
      const snapshotName = (nameRows[0] as { name?: string })?.name ?? '';
      await sql`
        INSERT INTO stock_movements (
          id, product_id, batch_id, order_id, movement_type, quantity,
          unit_cost, snapshot_name, supplier_name, reason
        ) VALUES (
          ${uid()}, ${input.product_id}, ${id}, NULL, 'IN', ${stockQty},
          ${input.cost_price}, ${snapshotName}, ${input.supplier_name ?? null},
          ${input.batch_no ? `Batch ${input.batch_no}` : null}
        )
      `;
    }

    return rows[0] as ProductBatch;
  },

  async updateBatch(id: string, patch: Partial<ProductBatch>): Promise<ProductBatch | null> {
    if (Object.keys(patch).length === 0) return null;

    if (patch.batch_no !== undefined) await sql`UPDATE product_batches SET batch_no = ${patch.batch_no} WHERE id = ${id}`;
    if (patch.manufacturer !== undefined) await sql`UPDATE product_batches SET manufacturer = ${patch.manufacturer} WHERE id = ${id}`;
    if (patch.supplier_name !== undefined) await sql`UPDATE product_batches SET supplier_name = ${patch.supplier_name} WHERE id = ${id}`;
    if (patch.supplier_phone !== undefined) await sql`UPDATE product_batches SET supplier_phone = ${patch.supplier_phone} WHERE id = ${id}`;
    if (patch.supplier_invoice_no !== undefined) await sql`UPDATE product_batches SET supplier_invoice_no = ${patch.supplier_invoice_no} WHERE id = ${id}`;
    if (patch.supplier_invoice_date !== undefined) await sql`UPDATE product_batches SET supplier_invoice_date = ${patch.supplier_invoice_date} WHERE id = ${id}`;
    if (patch.hsn_code !== undefined) await sql`UPDATE product_batches SET hsn_code = ${patch.hsn_code} WHERE id = ${id}`;
    if (patch.cost_price !== undefined) await sql`UPDATE product_batches SET cost_price = ${patch.cost_price} WHERE id = ${id}`;
    if (patch.selling_price !== undefined) await sql`UPDATE product_batches SET selling_price = ${patch.selling_price} WHERE id = ${id}`;
    if (patch.stock_quantity !== undefined) await sql`UPDATE product_batches SET stock_quantity = ${patch.stock_quantity} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM product_batches WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as ProductBatch) : null;
  },

  async deleteBatch(id: string): Promise<void> {
    await sql`DELETE FROM product_batches WHERE id = ${id}`;
  },

  // STOCK MOVEMENTS (downloadable stock report ledger)
  async listStockMovements(): Promise<StockMovement[]> {
    const rows = await sql`
      SELECT * FROM stock_movements
      ORDER BY moved_at DESC, created_at DESC
    `;
    return rows as StockMovement[];
  },

  // CUSTOMERS
  upsertCustomer,

  // ORDERS
  async orderIdExists(id: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM orders WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  },

  async listOrdersWithRelations(): Promise<OrderWithRelations[]> {
    // Name comes from the snapshot taken at billing time; COALESCE covers rows
    // that predate the snapshot column.
    const [orders, items] = await Promise.all([
      sql`
        SELECT o.*, COALESCE(o.customer_name_snapshot, c.name) as customer_name,
               c.phone as customer_phone, c.address as customer_address
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        ORDER BY o.created_at DESC
      `,
      sql`
        SELECT oi.*, b.hsn_code
        FROM order_items oi
        LEFT JOIN product_batches b ON b.id = oi.batch_id
      `,
    ]);

    if (orders.length === 0) return [];

    return orders.map((o: any) => ({
      ...o,
      items: items.filter((i: any) => i.order_id === o.id) as OrderItemRow[],
    })) as OrderWithRelations[];
  },

  async getOrderWithRelations(id: string): Promise<OrderWithRelations | null> {
    const [orders, items] = await Promise.all([
      sql`
        SELECT o.*, COALESCE(o.customer_name_snapshot, c.name) as customer_name,
               c.phone as customer_phone, c.address as customer_address
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${id}
      `,
      sql`
        SELECT oi.*, b.hsn_code
        FROM order_items oi
        LEFT JOIN product_batches b ON b.id = oi.batch_id
        WHERE oi.order_id = ${id}
      `,
    ]);
    if (orders.length === 0) return null;

    return {
      ...(orders[0] as any),
      items: items as OrderItemRow[],
    } as OrderWithRelations;
  },

  async deleteOrder(id: string): Promise<void> {
    // One transaction: lock the order, put its stock back, reopen the advance it
    // came from (if any), then delete it. The first statement takes the row lock,
    // so a concurrent second delete waits, then finds nothing and restocks nothing.
    // The order's OUT stock movements are kept as an audit trail (their order_id
    // becomes NULL via ON DELETE SET NULL); the restock is logged as an ADJUST.
    await sql.transaction([
      sql`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`,
      sql`
        INSERT INTO stock_movements (
          id, product_id, batch_id, order_id, movement_type, quantity,
          unit_cost, snapshot_name, supplier_name, reason, moved_at
        )
        SELECT gen_random_uuid()::text, oi.product_id, oi.batch_id, NULL, 'ADJUST', SUM(oi.quantity),
               b.cost_price, MAX(oi.snapshot_name), NULL, ${'Order ' + id + ' deleted - stock restored'}, CURRENT_DATE
        FROM order_items oi
        JOIN product_batches b ON b.id = oi.batch_id
        WHERE oi.order_id = ${id} AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id, oi.batch_id, b.cost_price
      `,
      sql`
        UPDATE product_batches b
        SET stock_quantity = b.stock_quantity + s.q
        FROM (
          SELECT batch_id, SUM(quantity) AS q
          FROM order_items
          WHERE order_id = ${id} AND batch_id IS NOT NULL
          GROUP BY batch_id
        ) s
        WHERE b.id = s.batch_id
      `,
      sql`
        UPDATE advance_orders
        SET status = 'PENDING', finalized_order_id = NULL, finalized_at = NULL
        WHERE finalized_order_id = ${id}
      `,
      sql`DELETE FROM orders WHERE id = ${id}`,
    ]);
  },

  // EXPENSES
  async listExpenses(): Promise<Expense[]> {
    const rows = await sql`
      SELECT * FROM expenses
      ORDER BY expense_date DESC, created_at DESC
    `;
    return rows as Expense[];
  },

  async addExpense(input: {
    title: string;
    category: string;
    amount: number;
    payment_mode: string;
    notes: string | null;
    expense_date: string;
  }): Promise<Expense> {
    const id = uid();
    const rows = await sql`
      INSERT INTO expenses (id, title, category, amount, payment_mode, notes, expense_date)
      VALUES (
        ${id}, ${input.title}, ${input.category}, ${input.amount},
        ${input.payment_mode}, ${input.notes}, ${input.expense_date}
      )
      RETURNING *
    `;
    return rows[0] as Expense;
  },

  async updateExpense(id: string, patch: Partial<Expense>): Promise<Expense | null> {
    if (Object.keys(patch).length === 0) {
      const rows = await sql`SELECT * FROM expenses WHERE id = ${id}`;
      return rows.length > 0 ? (rows[0] as Expense) : null;
    }

    if (patch.title !== undefined) await sql`UPDATE expenses SET title = ${patch.title} WHERE id = ${id}`;
    if (patch.category !== undefined) await sql`UPDATE expenses SET category = ${patch.category} WHERE id = ${id}`;
    if (patch.amount !== undefined) await sql`UPDATE expenses SET amount = ${patch.amount} WHERE id = ${id}`;
    if (patch.payment_mode !== undefined) await sql`UPDATE expenses SET payment_mode = ${patch.payment_mode} WHERE id = ${id}`;
    if (patch.notes !== undefined) await sql`UPDATE expenses SET notes = ${patch.notes} WHERE id = ${id}`;
    if (patch.expense_date !== undefined) await sql`UPDATE expenses SET expense_date = ${patch.expense_date} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM expenses WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as Expense) : null;
  },

  async deleteExpense(id: string): Promise<void> {
    await sql`DELETE FROM expenses WHERE id = ${id}`;
  },

  // FIFO DEDUCTION & ORDER SUBMISSION
  async submitOrder(payload: SubmitOrderPayload): Promise<{ orderId: string }> {
    await runWithStockRetry(() => buildOrderStatements(payload));
    return { orderId: payload.orderId };
  },

  // ADVANCE ORDERS — partial-payment holds. Stock is NOT deducted here; that
  // happens only when the balance is collected and finalizeAdvanceOrder runs.
  async listAdvanceOrders(): Promise<AdvanceOrderWithRelations[]> {
    const [rows, items] = await Promise.all([
      sql`
        SELECT a.*, COALESCE(a.customer_name_snapshot, c.name) AS customer_name,
               c.phone AS customer_phone, c.address AS customer_address
        FROM advance_orders a
        JOIN customers c ON c.id = a.customer_id
        ORDER BY a.created_at DESC
      `,
      sql`SELECT * FROM advance_order_items`,
    ]);
    if (rows.length === 0) return [];

    return rows.map((r: any) => ({
      ...r,
      items: (items as AdvanceOrderItemRow[]).filter((i) => i.advance_order_id === r.id),
    })) as AdvanceOrderWithRelations[];
  },

  async getAdvanceOrder(id: string): Promise<AdvanceOrderWithRelations | null> {
    const [rows, items] = await Promise.all([
      sql`
        SELECT a.*, COALESCE(a.customer_name_snapshot, c.name) AS customer_name,
               c.phone AS customer_phone, c.address AS customer_address
        FROM advance_orders a
        JOIN customers c ON c.id = a.customer_id
        WHERE a.id = ${id}
      `,
      sql`SELECT * FROM advance_order_items WHERE advance_order_id = ${id}`,
    ]);
    if (rows.length === 0) return null;
    return { ...(rows[0] as any), items: items as AdvanceOrderItemRow[] } as AdvanceOrderWithRelations;
  },

  async advanceOrderIdExists(id: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM advance_orders WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  },

  async createAdvanceOrder(payload: {
    advanceOrderId: string;
    customerName: string;
    customerPhone: string;
    customerAddress?: string | null;
    subtotal: number;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    discountAmount: number;
    isGst: boolean;
    gstPercentage: number;
    gstAmount: number;
    deliveryFee: number;
    totalAmount: number;
    depositAmount: number;
    depositPaymentMode: PaymentMode;
    deliveryDate: string | null;
    notes: string | null;
    items: {
      product_id: string | null;
      snapshot_name: string;
      snapshot_desc: string | null;
      snapshot_price: number;
      quantity: number;
    }[];
  }): Promise<{ advanceOrderId: string }> {
    const customer = await upsertCustomer(
      payload.customerName,
      payload.customerPhone,
      payload.customerAddress,
    );

    // The full bill breakdown is saved (not just subtotal/total) so the discount,
    // GST and delivery survive until the balance is collected.
    // Header + items go in one transaction so an advance is never left without
    // its items. The customer name is snapshotted so a later rename does not
    // change this receipt.
    await sql.transaction([
      sql`
        INSERT INTO advance_orders (
          id, customer_id, customer_name_snapshot, status, subtotal, discount_type, discount_value,
          discount_amount, is_gst, gst_percentage, gst_amount, delivery_fee, total_amount,
          deposit_amount, deposit_payment_mode, delivery_date, notes
        ) VALUES (
          ${payload.advanceOrderId}, ${customer.id}, ${payload.customerName}, 'PENDING',
          ${roundMoney(payload.subtotal)}, ${payload.discountType}, ${payload.discountValue}, ${roundMoney(payload.discountAmount)},
          ${payload.isGst}, ${payload.isGst ? payload.gstPercentage : 0}, ${payload.isGst ? roundMoney(payload.gstAmount) : 0},
          ${roundMoney(payload.deliveryFee)}, ${roundMoney(payload.totalAmount)}, ${roundMoney(payload.depositAmount)},
          ${payload.depositPaymentMode}, ${payload.deliveryDate}, ${payload.notes}
        )
      `,
      ...payload.items.map((it) =>
        sql`
          INSERT INTO advance_order_items (
            id, advance_order_id, product_id, snapshot_name, snapshot_desc, snapshot_price, quantity
          ) VALUES (
            ${uid()}, ${payload.advanceOrderId}, ${it.product_id},
            ${it.snapshot_name}, ${it.snapshot_desc}, ${it.snapshot_price}, ${it.quantity}
          )
        `,
      ),
    ]);

    return { advanceOrderId: payload.advanceOrderId };
  },

  async updateAdvanceOrderStatus(id: string, status: AdvanceOrderStatus): Promise<void> {
    await sql`UPDATE advance_orders SET status = ${status} WHERE id = ${id}`;
  },

  async cancelAdvanceOrder(id: string): Promise<void> {
    await sql`
      UPDATE advance_orders
      SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = ${id} AND status IN ('PENDING', 'READY')
    `;
  },

  async deleteAdvanceOrder(id: string): Promise<void> {
    await sql`DELETE FROM advance_orders WHERE id = ${id}`;
  },

  // Collect the remaining balance and turn the hold into a real invoice.
  // Shares buildOrderStatements with submitOrder for FIFO stock deduction and
  // revenue recognition; the invoice and the "advance completed" update commit
  // together in one transaction.
  async finalizeAdvanceOrder(payload: {
    advanceOrderId: string;
    invoiceId: string;
    // Optional EXTRA discount given when the balance is collected. It is entered
    // against the balance due (GST included) and stacks on top of the discount
    // already agreed when the advance was saved.
    extraDiscountType: 'PERCENT' | 'FIXED';
    extraDiscountValue: number;
    paymentMode: PaymentMode;
    billDate: string;
    // Optional invoice-type override chosen in the receive dialog. Defaults to
    // what was picked when the advance was booked.
    isGst?: boolean;
    gstPercentage?: number;
  }): Promise<{ orderId: string }> {
    const advance = await this.getAdvanceOrder(payload.advanceOrderId);
    if (!advance) throw new Error('Advance order not found');
    if (advance.status === 'COMPLETED') throw new Error('Advance order already finalized');
    if (advance.status === 'CANCELLED') throw new Error('Advance order was cancelled');

    // Rebuild cart from the stored snapshot items.
    const cart: CartItem[] = advance.items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      batch_id: null,
      name: it.snapshot_name,
      desc: it.snapshot_desc || '',
      price: Number(it.snapshot_price),
      qty: it.quantity,
    }));

    // Discount, GST and delivery come from what was saved with the advance (the
    // invoice must match the total the customer was quoted) unless the receive
    // dialog switched the invoice type.
    const t = resolveAdvanceTotals(advance);
    const f = computeAdvanceFinalization({
      subtotal: cart.reduce((acc, i) => acc + i.price * i.qty, 0),
      baseDiscount: t.discountAmount,
      deliveryFee: t.deliveryFee,
      deposit: t.deposit,
      isGst: payload.isGst ?? t.isGst,
      gstPercentage: payload.gstPercentage ?? t.gstPercentage,
      extraDiscountType: payload.extraDiscountType,
      extraDiscountValue: payload.extraDiscountValue,
    });

    const hasExtra = f.extraOffBalance > 0;

    const orderPayload: SubmitOrderPayload = {
      orderId: payload.invoiceId,
      customerName: advance.customer_name,
      customerPhone: advance.customer_phone,
      customerAddress: advance.customer_address,
      source: 'OFFLINE',
      isGst: f.isGst,
      billDate: payload.billDate,
      items: cart,
      // With an extra discount the two are combined into one fixed amount;
      // otherwise keep how the original discount was entered (e.g. 10%).
      discountType: hasExtra ? 'FIXED' : advance.discount_type,
      discountValue: hasExtra ? f.discountAmount : Number(advance.discount_value) || 0,
      discountAmount: f.discountAmount,
      gstPercentage: f.gstPercentage,
      gstAmount: f.gstAmount,
      deliveryFee: t.deliveryFee,
      grandTotal: f.grandTotal,
      cashReceived: f.grandTotal,
      paymentMode: payload.paymentMode,
    };

    // The status read above is not enough to stop two clicks / two tabs from
    // both finalizing. So the transaction first "claims" the advance (the UPDATE
    // takes its row lock; a concurrent finalize waits here), then a guard aborts
    // the whole transaction if the advance is no longer open. The invoice, stock
    // deduction and "completed" flag therefore commit together, exactly once.
    try {
      await runWithStockRetry(async () => [
        sql`
          UPDATE advance_orders SET status = status
          WHERE id = ${payload.advanceOrderId} AND status IN ('PENDING', 'READY')
        `,
        sql`
          SELECT 1 / (c.n - c.n)
          FROM (
            SELECT count(*) AS n FROM advance_orders
            WHERE id = ${payload.advanceOrderId} AND status IN ('PENDING', 'READY')
          ) c
          WHERE c.n = 0
        `,
        ...(await buildOrderStatements(orderPayload)),
        sql`
          UPDATE advance_orders
          SET status = 'COMPLETED', finalized_order_id = ${payload.invoiceId}, finalized_at = now()
          WHERE id = ${payload.advanceOrderId}
        `,
      ]);
    } catch (e) {
      // The guard's deliberate division-by-zero means someone else got there first.
      if ((e as { code?: string })?.code === '22012') {
        throw new Error('Advance order already finalized or cancelled');
      }
      throw e;
    }

    return { orderId: payload.invoiceId };
  },

  // SERVICES
  async listServices(): Promise<Service[]> {
    const rows = await sql`SELECT * FROM services ORDER BY name ASC`;
    return rows as Service[];
  },

  async addService(input: { name: string; price: number }): Promise<Service> {
    const id = uid();
    const rows = await sql`
      INSERT INTO services (id, name, price)
      VALUES (${id}, ${input.name}, ${input.price})
      RETURNING *
    `;
    return rows[0] as Service;
  },

  async updateService(id: string, patch: Partial<Service>): Promise<Service | null> {
    if (patch.name !== undefined && patch.price !== undefined) {
      const rows = await sql`UPDATE services SET name = ${patch.name}, price = ${patch.price} WHERE id = ${id} RETURNING *`;
      return rows[0] as Service;
    }
    if (patch.name !== undefined) {
      const rows = await sql`UPDATE services SET name = ${patch.name} WHERE id = ${id} RETURNING *`;
      return rows[0] as Service;
    }
    if (patch.price !== undefined) {
      const rows = await sql`UPDATE services SET price = ${patch.price} WHERE id = ${id} RETURNING *`;
      return rows[0] as Service;
    }
    return null;
  },

  async deleteService(id: string): Promise<void> {
    await sql`DELETE FROM services WHERE id = ${id}`;
  },
};
