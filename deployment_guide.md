# Noir Deployment Guide

This guide explains how to host your customer ordering website and staff fulfillment dashboard, and how they behave together in production.

---

## 1. The Architecture (How it Works)

Although both apps live in the same workspace directory right now, they are built as **two separate, independent frontend websites** that connect to the same Supabase database.

```
                  ┌────────────────────────┐
                  │   Supabase Database    │
                  └───────────┬────────────┘
                              │ (Realtime Sync)
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│     Customer Site     │           │    Staff Dashboard    │
│  (e.g. noir.menu)     │           │ (e.g. noir.dashboard) │
├───────────────────────┤           ├───────────────────────┤
│ • Table Confirmation  │           │ •Speakeasy Lock Screen│
│ • Elegant Menu        │           │ •Kitchen Kanban Board │
│ • Receipt Cart & Tip  │           │ •Waiter Delivery Panel│
│ • Places Orders       │           │ •Ledger Sales History │
└───────────────────────┘           └───────────────────────┘
```

---

## 2. Where to Host Them (Free & Fast)

You can host both frontends for free using modern static hosting providers like **Vercel** or **Netlify**.

### Option A: Vercel (Recommended)
1. Sign up for a free account at [Vercel](https://vercel.com).
2. Install the Vercel CLI (or connect your GitHub repository).
3. **Deploy Customer Site**:
   - Create a project pointing to the `customer/` subfolder.
   - Add your Environment Variables under Settings -> Environment Variables:
     - `VITE_SUPABASE_URL` = (Your Supabase URL)
     - `VITE_SUPABASE_ANON_KEY` = (Your Anon Key)
   - Vercel will give you a free domain like `noir-menu.vercel.app`.
4. **Deploy Staff Dashboard**:
   - Create a separate project pointing to the `staff/` subfolder.
   - Add your Environment Variables:
     - `VITE_SUPABASE_URL` = (Your Supabase URL)
     - `VITE_SUPABASE_ANON_KEY` = (Your Anon Key)
     - `VITE_STAFF_PASSCODE` = `800877`
   - Vercel will give you a free domain like `noir-dashboard.vercel.app`.

---

## 3. Turning the Staff Dashboard into a Tablet/Mobile App

Since the staff dashboard is a web page, you do not need to submit it to the Apple App Store or Google Play Store.

To install it as an app on a staff tablet (iPad/Android):
1. Open the Safari or Chrome browser on the tablet.
2. Visit your deployed staff dashboard URL (e.g., `https://noir-dashboard.vercel.app`).
3. Tap the **Share** button (Safari) or the **Menu** button (Chrome).
4. Select **"Add to Home Screen"**.
5. An icon called **Noir** will appear on the tablet's home screen.
6. Opening it from the home screen launches it in **Full-Screen App Mode** (without the browser address bar or search bar), making it behave exactly like a native tablet application!

---

## 4. How the QR Codes Connect

To print QR codes for your tables:
1. Generate QR codes that point to your customer site URL with the table query parameter.
   - **Table 1 QR code points to**: `https://noir-menu.vercel.app/?table=1`
   - **Table 5 QR code points to**: `https://noir-menu.vercel.app/?table=5`
   - **Table 12 QR code points to**: `https://noir-menu.vercel.app/?table=12`
2. When a guest scans their table's code, they land on the welcome screen with their table number pre-entered!
