# Venue Diary — Owner App (MVP)

Owner-side booking app for event venues (wedding halls, marquees), per the technical brief.
Replaces the paper register: calendar, bookings, advance/baqaya, WhatsApp confirmation.

This is the **running MVP skeleton** (Milestone M1 core). Zero-install: pure Node 26 +
built-in SQLite. Production target is NestJS + PostgreSQL (see `TECHNICAL_PLAN.md`).

## Chalana (run)

```bash
node server.js
```

Phir browser mein kholein: **http://localhost:4000**

Database (`venue.db`) pehli baar khud ban jaata hai, demo data ke saath (Shalimar Grand venue,
2 halls, kuch bookings + payments). Reset karne ke liye:

```bash
node db.js --reseed
```

## Abhi kya kaam karta hai

- **Home** — total baqaya (dark focal card), aaj ke events, baqaya reminders.
- **Calendar** — month view, hall filter, rang se status (confirmed / tentative / blocked / khali);
  din par click → us din ke slots.
- **Nayi booking** — form with live slot-availability check; **double-booking** confirm par
  database-level roki jaati hai (409 conflict), tentative par sirf warning.
- **Booking detail** — payments, baqaya auto-calc, confirm / cancel, WhatsApp reminder (demo).
- **Payments** — saari outstanding bookings ek jagah.

## Double-booking rule (core)

Slots half-open ranges hain (Lunch `[1,2)`, Dinner `[2,3)`, Full Day `[1,3)`), is liye Full Day
Lunch aur Dinner dono se clash karta hai. Confirm karte waqt ek transaction mein overlap check hota
hai + ek partial unique index backstop hai. Postgres par ye `EXCLUDE` constraint banega.

## API (REST)

```
GET  /api/venue                       GET  /api/dashboard
GET  /api/calendar?month=&hall=       GET  /api/day?date=&hall=
GET  /api/bookings?status=&q=         GET  /api/bookings/:id
POST /api/check                       POST /api/bookings
POST /api/bookings/:id/confirm        POST /api/bookings/:id/cancel
POST /api/bookings/:id/payments
```

## Aage (next)

OTP login, venue setup screens, diary import, admin panel, WhatsApp Cloud API integration,
Postgres migration. In sab ki tafseel `TECHNICAL_PLAN.md` mein hai.
