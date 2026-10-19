# SplitUp (Expense Splitter): the code, step by step

This app has one extra file compared to the others: `split.js`, which holds the maths.

## 1. The golden rule: money is whole cents

Computers store decimals imprecisely (`0.1 + 0.2` is `0.30000000000000004`). So we never store `12.50`; we store **1250** cents and only turn it back into `12.50` when showing it. Everything in `db.js`, `split.js` and `server.js` uses integer cents (`amount_cents`, `share_cents`).

## 2. `db.js` - tables

| Table | Holds |
|-------|-------|
| `groups` | `id` (random string used in the share link), `name`, `currency` |
| `members` | people in a group; `UNIQUE (group_id, name)` stops duplicate names |
| `expenses` | description, `amount_cents`, `paid_by` (a member id), date |
| `expense_shares` | **one row per person per expense**: how many cents of it they owe |
| `settlements` | "A paid B this much" repayments |

Storing the shares (instead of recalculating later) means history never changes even if the splitting rules change. `ON DELETE CASCADE` on `expense_shares` removes the shares automatically when an expense is deleted.

## 3. `split.js` - the maths (read this one carefully)

**`splitEvenly(totalCents, memberIds)`**
`1000` cents between 3 people: `base = floor(1000/3) = 333`, `leftover = 1000 - 333*3 = 1`. The first `leftover` people get one extra cent: `[334, 333, 333]`. The shares **always add up to the total**, so no cents vanish.

**`calculateBalances(...)`** gives each person one number:
- when you **pay** an expense: `+ amount` (the group owes you that money back)
- for every expense you **share**: `- your share`
- settlements: paying someone back moves your number up and theirs down

Positive = the group owes you. Negative = you owe the group. All balances always add up to **0**.

**`suggestPayments(balance)`** turns balances into "who pays whom":
1. Split people into *creditors* (positive) and *debtors* (negative).
2. Sort both lists, biggest first.
3. Take the biggest debtor and the biggest creditor; the payment is the smaller of the two amounts.
4. Subtract it from both. Anyone who reaches 0 is finished. Repeat.

This produces few payments, though not always the mathematically minimum number (that problem is NP-hard); for friend groups it is more than good enough.

## 4. `server.js`

- **`toCents(value)`** turns `"12.50"` into `1250` with `Math.round(number * 100)`, rejecting zero, negatives, `NaN` and absurdly large amounts.
- **Group ids:** `crypto.randomBytes(6).toString('base64url')` makes an 8-character unguessable id. The link *is* the password for the group.
- **`POST /api/groups`:** cleans names (trim, collapse spaces, drop duplicates ignoring case), needs at least 2 people, then uses `db.transaction(() => {...})()`. A **transaction** means "all or nothing": the group and all its members are inserted together, or none are. Never half a group.
- **`POST .../expenses`:** checks the payer and every participant really belong to this group (never trust ids from the browser), sorts participants (so leftover cents go to the same people predictably), calls `splitEvenly`, then inserts the expense and its shares in one transaction.
- **`buildGroupPayload`:** loads everything, does the calculation on the server, and returns balances plus suggested payments. Doing the maths on the server keeps one trusted answer for every person looking at the group.
- **Rate limit** on creating groups prevents a bot from filling the database.

## 5. `public/index.html`

Two views in one file, `#home-view` and `#group-view`; JavaScript shows one and hides the other. The member input on the home page is a "tag input": a `div` that looks like an input and contains chips plus a real `<input>`.

## 6. `public/app.js`

**Routing with the URL hash.** `#/` is the home page, `#/g/AbC123xy` is a group. `window.addEventListener('hashchange', route)` runs `route()` whenever it changes. Copying the address bar gives a working invite link, and Back/Forward just work, with no router library.

**Home page.** Typing a name + Enter (or comma) calls `addNewMember()`, which pushes into `state.newMembers` and redraws chips. Backspace on an empty box removes the last one. Submitting posts the group and then sets `location.hash` to the new group.

**Group page.**
- `loadGroup()` fetches the payload, compares it to the last snapshot, and only redraws when something changed. It polls every 10 s so a friend's new expense appears on your screen.
- `renderForm()` is deliberately **not** called on every refresh. It rebuilds the "paid by" menu and checkboxes only when the *list of people* changes. Otherwise a background refresh would wipe what you were typing.
- `updatePreview()` shows "Each person pays ..." live, using the same rounding idea as the server.
- `money(cents)` uses `Intl.NumberFormat` with the group's currency, so `GHS`, `USD` etc. format correctly for the viewer's locale.
- `renderPayments()` draws the "Esi owes Ama GHS 118.33" cards. **Mark as paid** posts a settlement; the balances recalculate and the card disappears.
- `renderBalances()` draws a bar per person scaled against the largest balance.
- `renderHistory()` merges expenses and repayments into one list sorted by date. Clicking an expense toggles the `open` class that reveals each person's share.

**localStorage** keeps a list of groups you've opened (`splitup-recent`), wrapped in `try/catch` because some browsers block storage.

## 7. Ideas to extend

Unequal splits (percentages / exact amounts), expense categories, a pie chart per category, export to CSV, multi-currency.
