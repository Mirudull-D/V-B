# VIJAYA LAKSHMI INDUSTRIES — POS & Inventory Billing System

A PWA-enabled Point of Sale (POS), billing, and inventory management system for **VIJAYA LAKSHMI INDUSTRIES**, Kadambur. It handles quick invoice generation, WhatsApp delivery of digital receipts, order history, GST / non-GST billing with two revenue dashboards, and stock management with low-stock alerts.

## Features

### 🧾 POS Billing Panel
- Quick invoice generator with a searchable product catalog
- Add custom items with price and quantity controls
- Manual discounts (fixed ₹ or percent %)
- **GST Invoice / Non-GST Bill toggle** at the point of billing
- **Changeable GST %** — pre-filled from each product's default GST rate, editable per sale
- Optional delivery fee
- Cash payment tracking with auto-calculated change return
- Backdate support (custom / past bill dates)
- Online / Offline (POS) order source toggle
- Send the bill directly to the customer via WhatsApp with a digital invoice link

### 📦 Inventory (Admin only)
- Full CRUD on products
- Per-product **default GST rate** (used to pre-fill GST at billing)
- Track stock quantity, low-stock threshold, batch/lot number, brand/manufacturer, HSN code
- FIFO batch (purchase-lot) tracking for cost and selling price
- Export the complete product catalog to CSV

### 🔔 Stock Alerts (Staff & Admin)
- Read-only view of items at or below their low-stock threshold
- Audible alert when new low-stock items are detected

### 📜 Order History
- Search orders by ID, customer name, or phone number
- Filter by source (Online / Offline) and status
- Period filters (All Time, Today, Week, Month, Year, Custom range)
- View detailed order modal
- Print / download invoice as PDF
- Resend invoice via WhatsApp
- Export filtered orders to CSV (admin only)
- Delete invoices (admin only)

### 📊 Analytics — GST & Non-GST Dashboards (Admin only)
- Switch the whole dashboard between **All Bills / GST Invoices / Non-GST Bills**
- KPIs: total revenue, completed bills, online/offline split, items sold, avg order value
- Today's Sales, monthly & weekly revenue trends
- Product sales leaderboard with market share
- Coupon / promo campaign performance tracking
- Custom period filters and contact/invoice search

### 📱 PWA & Mobile
- Installable as a standalone app
- Offline-first service worker with network-first caching
- Responsive mobile-friendly UI

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- Neon Serverless PostgreSQL (`@neondatabase/serverless`)
- lucide-react (icons)

## Getting Started

### 1. Install

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
ADMIN_PASSCODE=your-admin-passcode
STAFF_PASSCODE=your-staff-passcode
DATABASE_URL=postgresql://user:password@hostname/dbname?sslmode=require
```

### 3. Set up the database

Run `schema.sql` once in your Neon SQL Editor (or `psql`) to create a clean, empty database. Optionally run `seed.sql` afterwards to load some sample mobile-shop data.

### 4. Run the Development Server

```bash
npm run dev
```

Open http://localhost:3000.

- Public store page: `/`
- POS terminal: `/pos/admin/secure/control-panel/raja-mobiles`
- Digital invoice: `/invoice/[invoice-id]`

## Data Model

- **products** — master catalog. Each product has a `gst_rate` (default GST %, editable at billing) and a `low_stock_threshold`.
- **product_batches** — FIFO purchase lots (cost/selling price, stock).
- **customers**, **orders**, **order_items** — sales records. `orders.is_gst` flags GST invoices vs non-GST bills, which powers the two revenue dashboards.

See `schema.sql` for the full schema.

## Roles

- **Staff** — Billing Panel, Order History, Stock Alerts (view-only).
- **Admin** — Full access, including Inventory CRUD, Analytics, and delete permissions.

The role is determined by which passcode is used to log in.

## License

© 2026 VIJAYA LAKSHMI INDUSTRIES. All Rights Reserved.

Powered by [Cenexa Systems](https://www.cenexasystems.com/).
