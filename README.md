# SplitUp - Expense Splitter

Add what everyone spent, and SplitUp works out exactly who owes whom.

**Live demo:** _add your Render link here_

## Features

- Create a group with names and a currency (GHS, USD, EUR, GBP, NGN, KES, ZAR, CAD, INR)
- Add expenses with a payer, an amount, a date and the people sharing it
- **Auto-calculated balances** and a short list of "A owes B" payments
- "Mark as paid" records a repayment and updates everyone's balance
- Full history with per-person shares (tap an expense), delete anything added by mistake
- Share the group link with friends, no accounts needed; recent groups are remembered on your device
- Money is stored in whole cents, and odd cents are shared out fairly (100.00 / 3 -> 33.34, 33.33, 33.33)

## Run it

```bash
npm install
npm start        # http://localhost:3003  (port comes from .env)
```

> **Settings:** the app reads `.env` (private, ignored by Git). `.env.example` is the safe template. On a new computer run `copy .env.example .env`.

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | port to listen on | `3000` (this folder's `.env` sets `3003`) |
| `DATA_DIR` | folder for `splitter.db` | the app folder |

Anyone with a group's link can view and edit it (the link is a random, hard-to-guess id). That suits friends splitting a trip, but it isn't suitable for sensitive data.

## API

| Method & path | Does |
|---------------|------|
| `POST /api/groups` | create group `{ name, currency, members: [...] }` |
| `GET /api/groups/:id` | everything: members, expenses, balances, suggested payments |
| `POST /api/groups/:id/members` | add a person |
| `POST /api/groups/:id/expenses` | add expense `{ description, amount, paid_by, participants, date }` |
| `DELETE /api/groups/:id/expenses/:expenseId` | delete expense |
| `POST /api/groups/:id/settlements` | record a repayment `{ from, to, amount }` |
| `DELETE /api/groups/:id/settlements/:settlementId` | delete a repayment |

Step-by-step code walkthrough: [EXPLAINED.md](EXPLAINED.md)
