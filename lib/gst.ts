// GST is EXCLUSIVE: product prices are pre-tax and GST is added on top.
//   taxable   = subtotal - discount
//   gst       = taxable × gst% / 100          (rounded to paise)
//   grand     = taxable + gst + delivery      (delivery is not taxed)

export const roundMoney = (n: number): number => Math.round(n * 100) / 100;

export function calcExclusiveGst(taxable: number, gstPercentage: number): number {
  if (!(taxable > 0) || !(gstPercentage > 0)) return 0;
  return roundMoney(taxable * (gstPercentage / 100));
}

// CGST + SGST split of a GST amount. SGST takes the remainder so the two
// halves always add back up to the exact GST amount.
export function splitGst(gstAmount: number): { cgst: number; sgst: number } {
  const cgst = roundMoney(gstAmount / 2);
  return { cgst, sgst: roundMoney(gstAmount - cgst) };
}

// Orders saved before the switch to exclusive GST stored the GST *inside*
// grand_total (grand = subtotal - discount + delivery). New orders have it
// added on top. Tell them apart by checking whether the GST adds up in the total.
export function isExclusiveGstOrder(o: {
  subtotal: number;
  discount: number;
  gstAmount?: number;
  deliveryFee: number;
  grandTotal: number;
}): boolean {
  const gst = Number(o.gstAmount) || 0;
  if (!(gst > 0)) return true; // no GST — nothing to disambiguate
  const withGstOnTop = o.subtotal - o.discount + gst + o.deliveryFee;
  return Math.abs(withGstOnTop - o.grandTotal) < 0.05;
}

// Full money breakdown of an advance order, read from the columns saved at
// deposit time. `total` (total_amount) is the agreed amount the customer owes:
//   total = subtotal - discount + gst + delivery
export function resolveAdvanceTotals(a: {
  subtotal: number;
  total_amount: number;
  deposit_amount: number;
  is_gst?: boolean;
  gst_percentage?: number;
  gst_amount?: number;
  discount_amount?: number;
  delivery_fee?: number;
}) {
  const subtotal = Number(a.subtotal) || 0;
  const discountAmount = Number(a.discount_amount) || 0;
  const gstAmount = Number(a.gst_amount) || 0;
  const deliveryFee = Number(a.delivery_fee) || 0;
  const total = Number(a.total_amount) || 0;
  const deposit = Number(a.deposit_amount) || 0;
  return {
    isGst: Boolean(a.is_gst),
    gstPercentage: Number(a.gst_percentage) || 0,
    subtotal,
    discountAmount,
    taxable: Math.max(0, subtotal - discountAmount),
    gstAmount,
    deliveryFee,
    total,
    deposit,
    balance: Math.max(0, total - deposit),
  };
}

// Sales figure for analytics: what the shop actually earned, i.e. the invoice
// total minus the GST collected on behalf of the government. Works for both
// legacy (GST inside the total) and new (GST on top) orders.
export const netSales = (o: { grandTotal: number; gstAmount?: number }): number =>
  o.grandTotal - (Number(o.gstAmount) || 0);

// What it costs to collect an advance's balance and turn it into an invoice.
// Shared by the receive dialog (live preview) and finalizeAdvanceOrder (the real
// write) so the two can never disagree.
//   - `baseDiscount` is the discount already agreed when the advance was booked
//   - `isGst` / `gstPercentage` may differ from the booking (receive-dialog toggle)
//   - the optional extra discount is entered against the balance due (GST
//     included), so GST is taken out of it and recomputed on the smaller taxable value
export function computeAdvanceFinalization(i: {
  subtotal: number;
  baseDiscount: number;
  deliveryFee: number;
  deposit: number;
  isGst: boolean;
  gstPercentage: number;
  extraDiscountType: 'PERCENT' | 'FIXED';
  extraDiscountValue: number;
}) {
  const isGst = i.isGst && i.gstPercentage > 0;
  const gstPercentage = isGst ? i.gstPercentage : 0;

  const taxableBefore = Math.max(0, i.subtotal - i.baseDiscount);
  const gstBefore = isGst ? calcExclusiveGst(taxableBefore, gstPercentage) : 0;
  const totalBefore = taxableBefore + gstBefore + i.deliveryFee;
  const balanceBefore = Math.max(0, totalBefore - i.deposit);

  const extraValue = Math.max(0, Number(i.extraDiscountValue) || 0);
  const extraOffBalance = roundMoney(
    Math.min(
      balanceBefore,
      i.extraDiscountType === 'PERCENT' ? balanceBefore * (extraValue / 100) : extraValue,
    ),
  );
  const extraPreTax = isGst ? extraOffBalance / (1 + gstPercentage / 100) : extraOffBalance;

  const discountAmount = roundMoney(i.baseDiscount + extraPreTax);
  const taxable = roundMoney(Math.max(0, i.subtotal - discountAmount));
  const gstAmount = isGst ? calcExclusiveGst(taxable, gstPercentage) : 0;
  const grandTotal = roundMoney(taxable + gstAmount + i.deliveryFee);

  return {
    isGst,
    gstPercentage,
    balanceBefore,
    extraOffBalance,
    discountAmount,
    taxable,
    gstAmount,
    grandTotal,
    balanceDue: Math.max(0, grandTotal - i.deposit),
  };
}
