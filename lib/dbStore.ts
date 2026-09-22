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
} from './types';

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
  async upsertCustomer(name: string, phone: string, address?: string | null): Promise<Customer> {
    const id = uid();
    const rows = await sql`
      INSERT INTO customers (id, name, phone, address)
      VALUES (${id}, ${name}, ${phone}, ${address || null})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
      RETURNING *
    `;
    return rows[0] as Customer;
  },

  // ORDERS
  async orderIdExists(id: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM orders WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  },

  async listOrdersWithRelations(): Promise<OrderWithRelations[]> {
    const orders = await sql`
      SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC
    `;

    if (orders.length === 0) return [];

    const orderIds = orders.map((o: any) => o.id);
    const items = await sql`
      SELECT * FROM order_items
      WHERE order_id = ANY(${orderIds})
    `;

    return orders.map((o: any) => ({
      ...o,
      items: items.filter((i: any) => i.order_id === o.id) as OrderItemRow[],
    })) as OrderWithRelations[];
  },

  async getOrderWithRelations(id: string): Promise<OrderWithRelations | null> {
    const orders = await sql`
      SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${id}
    `;
    if (orders.length === 0) return null;

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${id}`;

    return {
      ...(orders[0] as any),
      items: items as OrderItemRow[],
    } as OrderWithRelations;
  },

  async deleteOrder(id: string): Promise<void> {
    // The order's OUT stock movements are kept as an audit trail; their order_id
    // is set to NULL automatically via ON DELETE SET NULL.
    await sql`DELETE FROM orders WHERE id = ${id}`;
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
  async submitOrder(payload: {
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
    paymentMode: PaymentMode;
  }): Promise<{ orderId: string }> {
    // Neon HTTP doesn't natively support full interactive transactions in the simple API,
    // but we can execute them sequentially or use multiple statements.
    // For simplicity, we'll do sequential awaits which is fine for this scale,
    // or batch them if possible. Let's do sequential for clarity.

    const productIds = Array.from(
      new Set(
        payload.items
          .filter((i) => i.product_id)
          .map((i) => i.product_id as string)
      )
    );

    // Concurrently upsert customer and fetch batches for all products in 1 roundtrip
    const [customer, allBatches] = await Promise.all([
      this.upsertCustomer(payload.customerName, payload.customerPhone, payload.customerAddress),
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

    // Subtotal is GST-inclusive (sum of line prices × qty).
    // grand_total = subtotal - discount + delivery  (GST is embedded in subtotal).
    const subtotalInclusive = payload.grandTotal + payload.discountAmount - payload.deliveryFee;

    // Insert order & execute all batch stock deductions concurrently
    await Promise.all([
      sql`
        INSERT INTO orders (
          id, customer_id, source, status, is_gst, subtotal, discount_type, discount_value,
          discount_amount, gst_percentage, gst_amount, delivery_fee, grand_total,
          cash_received, payment_mode, bill_date, created_at
        ) VALUES (
          ${payload.orderId}, ${customer.id}, ${payload.source}, 'COMPLETED', ${payload.isGst},
          ${subtotalInclusive},
          ${payload.discountType}, ${payload.discountValue}, ${payload.discountAmount},
          ${payload.gstPercentage}, ${payload.gstAmount}, ${payload.deliveryFee},
          ${payload.grandTotal}, ${payload.cashReceived}, ${payload.paymentMode},
          ${payload.billDate}, now()
        )
      `,
      ...batchUpdates.map((u) =>
        sql`UPDATE product_batches SET stock_quantity = stock_quantity - ${u.deduction} WHERE id = ${u.id}`
      ),
    ]);

    // Insert order items and log OUT stock movements concurrently.
    // Both reference the order row, which the previous await has already inserted.
    await Promise.all([
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
    ]);

    return { orderId: payload.orderId };
  },

  // ADVANCE ORDERS — partial-payment holds. Stock is NOT deducted here; that
  // happens only when the balance is collected and finalizeAdvanceOrder runs.
  async listAdvanceOrders(): Promise<AdvanceOrderWithRelations[]> {
    const rows = await sql`
      SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM advance_orders a
      JOIN customers c ON c.id = a.customer_id
      ORDER BY a.created_at DESC
    `;
    if (rows.length === 0) return [];

    const ids = rows.map((r: any) => r.id);
    const items = await sql`
      SELECT * FROM advance_order_items WHERE advance_order_id = ANY(${ids})
    `;

    return rows.map((r: any) => ({
      ...r,
      items: (items as AdvanceOrderItemRow[]).filter((i) => i.advance_order_id === r.id),
    })) as AdvanceOrderWithRelations[];
  },

  async getAdvanceOrder(id: string): Promise<AdvanceOrderWithRelations | null> {
    const rows = await sql`
      SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM advance_orders a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ${id}
    `;
    if (rows.length === 0) return null;
    const items = await sql`SELECT * FROM advance_order_items WHERE advance_order_id = ${id}`;
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
    const customer = await this.upsertCustomer(
      payload.customerName,
      payload.customerPhone,
      payload.customerAddress,
    );

    await sql`
      INSERT INTO advance_orders (
        id, customer_id, status, subtotal, total_amount, deposit_amount,
        deposit_payment_mode, delivery_date, notes
      ) VALUES (
        ${payload.advanceOrderId}, ${customer.id}, 'PENDING',
        ${payload.subtotal}, ${payload.totalAmount}, ${payload.depositAmount},
        ${payload.depositPaymentMode}, ${payload.deliveryDate}, ${payload.notes}
      )
    `;

    await Promise.all(
      payload.items.map((it) =>
        sql`
          INSERT INTO advance_order_items (
            id, advance_order_id, product_id, snapshot_name, snapshot_desc, snapshot_price, quantity
          ) VALUES (
            ${uid()}, ${payload.advanceOrderId}, ${it.product_id},
            ${it.snapshot_name}, ${it.snapshot_desc}, ${it.snapshot_price}, ${it.quantity}
          )
        `,
      ),
    );

    return { advanceOrderId: payload.advanceOrderId };
  },

  async updateAdvanceOrderStatus(id: string, status: AdvanceOrderStatus): Promise<void> {
    await sql`UPDATE advance_orders SET status = ${status} WHERE id = ${id}`;
  },

  async cancelAdvanceOrder(id: string): Promise<void> {
    await sql`
      UPDATE advance_orders
      SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = ${id}
    `;
  },

  async deleteAdvanceOrder(id: string): Promise<void> {
    await sql`DELETE FROM advance_orders WHERE id = ${id}`;
  },

  // Collect the remaining balance and turn the hold into a real invoice.
  // Reuses submitOrder for FIFO stock deduction and revenue recognition.
  async finalizeAdvanceOrder(payload: {
    advanceOrderId: string;
    invoiceId: string;
    isGst: boolean;
    gstPercentage: number;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    discountAmount: number;
    deliveryFee: number;
    paymentMode: PaymentMode;
    billDate: string;
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

    // Grand total math mirrors POSBilling.completeSale (GST-inclusive subtotal).
    const rawSubtotal = cart.reduce((acc, i) => acc + i.price * i.qty, 0);
    const netInclusive = Math.max(0, rawSubtotal - payload.discountAmount);
    const gstAmount =
      payload.isGst && payload.gstPercentage > 0
        ? netInclusive - netInclusive / (1 + payload.gstPercentage / 100)
        : 0;
    const grandTotal = netInclusive + payload.deliveryFee;

    const { orderId } = await this.submitOrder({
      orderId: payload.invoiceId,
      customerName: advance.customer_name,
      customerPhone: advance.customer_phone,
      customerAddress: advance.customer_address,
      source: 'OFFLINE',
      isGst: payload.isGst,
      billDate: payload.billDate,
      items: cart,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      discountAmount: payload.discountAmount,
      gstPercentage: payload.isGst ? payload.gstPercentage : 0,
      gstAmount,
      deliveryFee: payload.deliveryFee,
      grandTotal,
      cashReceived: grandTotal,
      paymentMode: payload.paymentMode,
    });

    await sql`
      UPDATE advance_orders
      SET status = 'COMPLETED', finalized_order_id = ${orderId}, finalized_at = now()
      WHERE id = ${payload.advanceOrderId}
    `;

    return { orderId };
  },
};
