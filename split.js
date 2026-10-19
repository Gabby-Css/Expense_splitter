// split.js - the maths of the app, kept apart from the web server so it is easy to read and test.

// Splits `totalCents` between `memberIds` as evenly as possible.
// 1000 cents between 3 people can't be 333.33 each, so the leftover cent(s) go to the
// first people in the list: 334, 333, 333. The shares always add back up to the total.
function splitEvenly(totalCents, memberIds) {
  const count = memberIds.length;
  const base = Math.floor(totalCents / count);
  const leftover = totalCents - base * count;
  return memberIds.map((memberId, index) => ({
    memberId,
    cents: base + (index < leftover ? 1 : 0),
  }));
}

// Works out each person's net position:
//   positive -> the group owes them money
//   negative -> they owe the group money
function calculateBalances(memberIds, expenses, settlements) {
  const balance = new Map(memberIds.map((id) => [id, 0]));

  for (const expense of expenses) {
    balance.set(expense.paid_by, balance.get(expense.paid_by) + expense.amount_cents); // they fronted the money
    for (const share of expense.shares) {
      balance.set(share.member_id, balance.get(share.member_id) - share.share_cents);   // but they only owe their share
    }
  }

  // Paying someone back moves your balance up and theirs down.
  for (const s of settlements) {
    balance.set(s.from_member, balance.get(s.from_member) + s.amount_cents);
    balance.set(s.to_member, balance.get(s.to_member) - s.amount_cents);
  }
  return balance;
}

// Turns balances into the smallest practical list of "A pays B" transfers.
// Idea: repeatedly make the person who owes the most pay the person who is owed the most.
function suggestPayments(balance) {
  const creditors = [];
  const debtors = [];
  for (const [id, cents] of balance) {
    if (cents > 0) creditors.push({ id, cents });
    else if (cents < 0) debtors.push({ id, cents: -cents });
  }
  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const payments = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amount = Math.min(creditors[c].cents, debtors[d].cents);
    payments.push({ from: debtors[d].id, to: creditors[c].id, cents: amount });
    creditors[c].cents -= amount;
    debtors[d].cents -= amount;
    if (creditors[c].cents === 0) c += 1;
    if (debtors[d].cents === 0) d += 1;
  }
  return payments;
}

module.exports = { splitEvenly, calculateBalances, suggestPayments };
