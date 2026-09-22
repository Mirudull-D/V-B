export type Category = {
  id: string;
  name: string;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  gst_rate: number; // Default GST % for this product (editable at billing)
  low_stock_threshold: number;
  created_at: string;
};

export type ProductBatch = {
  id: string;
  product_id: string;
  batch_no: string | null;
  manufacturer: string | null; // Brand / make of the product
  supplier_name: string | null; // Vendor this lot was bought from
  supplier_phone: string | null; // Vendor contact (optional)
  supplier_invoice_no: string | null; // Vendor's bill / invoice number
  supplier_invoice_date: string | null; // Date on the vendor's bill
  hsn_code: string | null;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  arrived_at: string;
};

export type ProductWithBatches = Product & {
  batches: ProductBatch[];
  total_stock: number;
  active_selling_price: number;
};

// One row in the stock movement ledger (downloadable stock report).
export type StockMovementType = 'IN' | 'OUT' | 'ADJUST';

export type StockMovement = {
  id: string;
  product_id: string;
  batch_id: string | null;
  order_id: string | null;
  movement_type: StockMovementType;
  quantity: number;
  unit_cost: number;
  snapshot_name: string;
  supplier_name: string | null;
  reason: string | null;
  moved_at: string;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  created_at: string;
};

export type PaymentMode = 'CASH' | 'TVS' | 'BAJAJ' | 'HDP' | 'DMI';

export type OrderRow = {
  id: string;
  customer_id: string;
  source: 'ONLINE' | 'OFFLINE';
  status: 'COMPLETED' | 'PENDING';
  is_gst: boolean; // true = GST invoice, false = non-GST bill
  subtotal: number; // GST-inclusive (line price × qty)
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: number;
  discount_amount: number;
  gst_percentage: number;
  gst_amount: number; // GST inside subtotal-discount (derived)
  delivery_fee: number;
  grand_total: number; // = subtotal - discount + delivery
  cash_received: number;
  payment_mode: PaymentMode;
  bill_date: string;
  created_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  batch_id: string | null;
  snapshot_name: string;
  snapshot_price: number;
  quantity: number;
};

export type OrderWithRelations = OrderRow & {
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  items: OrderItemRow[];
};

export type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  payment_mode: string; // CASH | UPI | CARD | BANK | OTHER
  notes: string | null;
  expense_date: string;
  created_at: string;
};

export type AdvanceOrderStatus = 'PENDING' | 'READY' | 'COMPLETED' | 'CANCELLED';

export type AdvanceOrderRow = {
  id: string;
  customer_id: string;
  status: AdvanceOrderStatus;
  subtotal: number;
  total_amount: number;
  deposit_amount: number;
  deposit_payment_mode: PaymentMode;
  delivery_date: string | null;
  notes: string | null;
  finalized_order_id: string | null;
  finalized_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type AdvanceOrderItemRow = {
  id: string;
  advance_order_id: string;
  product_id: string | null;
  snapshot_name: string;
  snapshot_desc: string | null;
  snapshot_price: number;
  quantity: number;
};

export type AdvanceOrderWithRelations = AdvanceOrderRow & {
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  items: AdvanceOrderItemRow[];
};

export type CartItem = {
  id: string;
  product_id: string | null;
  batch_id: string | null;
  name: string;
  desc: string;
  price: number;
  qty: number;
};
