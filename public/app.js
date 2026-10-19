// app.js - browser code for SplitUp.
// Two "pages" live in one HTML file: the home page (#/) and a group page (#/g/<id>).
// The part of the URL after "#" decides which one we show.

const $ = (selector) => document.querySelector(selector);

const state = {
  currencies: [],
  newMembers: [],     // names typed on the home page before the group exists
  groupId: null,
  data: null,         // the latest group payload from the server
  snapshot: '',       // JSON of the last payload we drew
  formKey: '',        // which members the expense form was built for
  pollTimer: null,
  requestId: 0,       // counts group requests so a slow, older answer can't overwrite a newer one
};

// ---------- helpers ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : '');
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Format whole cents as money in the group's currency.
function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.data.group.currency }).format(cents / 100);
}

function avatarColor(name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 55% 42%)`;
}
const avatar = (name, extra = '') =>
  `<span class="avatar ${extra}" style="--av: ${avatarColor(name)}">${esc(name[0].toUpperCase())}</span>`;

const memberName = (id) => state.data.members.find((m) => m.id === id)?.name ?? 'Someone';

// A tiny list of groups this browser has opened, so people can find them again.
function getRecent() {
  try { return JSON.parse(localStorage.getItem('splitup-recent')) || []; } catch { return []; }
}
function rememberGroup(id, name) {
  const list = getRecent().filter((g) => g.id !== id);
  list.unshift({ id, name });
  try { localStorage.setItem('splitup-recent', JSON.stringify(list.slice(0, 8))); } catch { /* storage full or blocked */ }
}

// ---------- routing ----------

function route() {
  clearInterval(state.pollTimer);
  const match = location.hash.match(/^#\/g\/([\w-]+)/);
  if (match) showGroup(match[1]);
  else showHome();
}

function showHome() {
  state.groupId = null;
  $('#group-view').hidden = true;
  $('#home-view').hidden = false;
  $('#copy-link').hidden = true;
  document.title = 'SplitUp - Expense Splitter';

  const recent = getRecent();
  $('#recent').hidden = recent.length === 0;
  $('#recent-list').innerHTML = recent
    .map((g) => `<li><a href="#/g/${esc(g.id)}">${esc(g.name)} <span class="muted">→</span></a></li>`).join('');
}

// ---------- home page: creating a group ----------

function renderTags() {
  $('#tags').innerHTML = state.newMembers.map((name, i) =>
    `<span class="tag">${avatar(name)}${esc(name)}<button type="button" data-remove="${i}" aria-label="Remove ${esc(name)}">✕</button></span>`).join('');
}

function addNewMember() {
  const input = $('#member-input');
  const name = input.value.replace(/,/g, '').trim().replace(/\s+/g, ' ');
  input.value = '';
  if (!name) return;
  if (state.newMembers.some((n) => n.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on the list`, 'error');
  state.newMembers.push(name);
  renderTags();
}

async function handleCreate(event) {
  event.preventDefault();
  addNewMember(); // in case someone typed a name but didn't press Enter
  const form = event.target;
  const error = $('#create-error');
  showError(error, '');
  try {
    const { id } = await api('/groups', {
      method: 'POST',
      body: { name: form.elements.name.value, currency: form.elements.currency.value, members: state.newMembers },
    });
    rememberGroup(id, form.elements.name.value.trim());
    form.reset();
    state.newMembers = [];
    renderTags();
    location.hash = `#/g/${id}`;
  } catch (err) {
    showError(error, err.message);
  }
}

// ---------- group page ----------

async function showGroup(id) {
  state.groupId = id;
  state.snapshot = '';
  state.formKey = '';
  $('#home-view').hidden = true;
  $('#group-view').hidden = false;
  $('#copy-link').hidden = false;
  $('#expense-form').elements.date.value = todayISO();

  try {
    await loadGroup();
    rememberGroup(id, state.data.group.name);
    // refresh every 10 seconds so other people's changes show up
    state.pollTimer = setInterval(() => { if (!document.hidden) loadGroup(); }, 10000);
  } catch (err) {
    toast(err.message, 'error');
    location.hash = '#/';
  }
}

async function loadGroup() {
  const myRequest = ++state.requestId;
  const data = await api(`/groups/${state.groupId}`);
  if (myRequest !== state.requestId) return; // a newer request has been sent since, ignore this stale answer
  const snapshot = JSON.stringify(data);
  if (snapshot === state.snapshot) return;
  state.snapshot = snapshot;
  state.data = data;
  renderGroup();
}

function renderGroup() {
  const { group, members, totalSpent } = state.data;
  document.title = `${group.name} - SplitUp`;
  $('#group-name').textContent = group.name;
  $('#group-sub').textContent = `${members.length} people · ${group.currency}`;
  $('#total-spent').textContent = money(totalSpent);

  renderForm();
  renderPayments();
  renderBalances();
  renderHistory();
  $('#people').innerHTML = members.map((m) => `<span class="tag">${avatar(m.name)}${esc(m.name)}</span>`).join('');
}

// The expense form is only rebuilt when the list of people changes,
// otherwise a background refresh would wipe out what someone is typing.
function renderForm() {
  const { members } = state.data;
  const key = members.map((m) => m.id).join(',');
  if (key === state.formKey) return;
  state.formKey = key;

  const previousPayer = $('#paid-by').value;
  $('#paid-by').innerHTML = members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if (previousPayer) $('#paid-by').value = previousPayer;

  $('#participants').innerHTML = members.map((m) => `
    <label class="check-chip"><input type="checkbox" value="${m.id}" checked><span>${avatar(m.name)}${esc(m.name)}</span></label>`).join('');
  updatePreview();
}

function selectedParticipants() {
  return [...document.querySelectorAll('#participants input:checked')].map((box) => Number(box.value));
}

// Shows "Each pays ..." while the user types, using the same rounding idea as the server.
function updatePreview() {
  const amount = Number($('#expense-form').elements.amount.value);
  const count = selectedParticipants().length;
  const preview = $('#preview');
  if (!amount || amount <= 0 || !count) { preview.textContent = ''; return; }
  const cents = Math.round(amount * 100);
  const each = cents / count;
  preview.textContent = Number.isInteger(each)
    ? `Each person pays ${money(each)}`
    : `About ${money(Math.round(each))} each (the odd cent is shared out fairly)`;
}

function renderPayments() {
  const { payments } = state.data;
  if (!payments.length) {
    $('#payments').innerHTML = '<li class="settled"><big>🎉</big>All settled up. Nobody owes anything.</li>';
    return;
  }
  $('#payments').innerHTML = payments.map((p, i) => `
    <li class="payment">
      ${avatar(memberName(p.from), 'lg')}
      <span class="text"><b>${esc(memberName(p.from))}</b> owes <b>${esc(memberName(p.to))}</b> <b class="amt">${money(p.cents)}</b></span>
      <button class="btn ghost small" data-settle="${i}">Mark as paid</button>
    </li>`).join('');
}

function renderBalances() {
  const { members, balances } = state.data;
  const biggest = Math.max(1, ...Object.values(balances).map(Math.abs));
  $('#balances').innerHTML = members.map((m) => {
    const cents = balances[m.id];
    const cls = cents > 0 ? 'pos' : cents < 0 ? 'neg' : '';
    const label = cents > 0 ? `gets back ${money(cents)}` : cents < 0 ? `owes ${money(-cents)}` : 'settled up';
    return `
      <li class="balance ${cls}">
        ${avatar(m.name)}
        <span class="name">${esc(m.name)}</span>
        <span class="amount">${label}</span>
        <div class="bar"><i style="width: ${Math.round((Math.abs(cents) / biggest) * 100)}%"></i></div>
      </li>`;
  }).join('');
}

function renderHistory() {
  const { expenses, settlements } = state.data;
  // expenses and repayments share one timeline, newest first
  const items = [
    ...expenses.map((e) => ({ kind: 'expense', ...e })),
    ...settlements.map((s) => ({ kind: 'settlement', ...s })),
  ].sort((a, b) => (b.date + String(b.created_at)).localeCompare(a.date + String(a.created_at)));

  if (!items.length) {
    $('#history').innerHTML = '<li class="empty">No expenses yet. Add the first one!</li>';
    return;
  }

  $('#history').innerHTML = items.map((item) => {
    if (item.kind === 'settlement') {
      return `
        <li class="entry settle">
          <div class="entry-icon">🤝</div>
          <div class="entry-main"><b>${esc(memberName(item.from_member))} paid ${esc(memberName(item.to_member))}</b><small>${prettyDate(item.date)} · repayment</small></div>
          <span class="entry-amount">${money(item.amount_cents)}</span>
          <button class="icon-btn" data-del-settlement="${item.id}" aria-label="Delete repayment" title="Delete">✕</button>
        </li>`;
    }
    const shares = item.shares.map((s) => `${esc(memberName(s.member_id))}: ${money(s.share_cents)}`).join(' · ');
    return `
      <li class="entry" data-entry>
        <div class="entry-icon">🧾</div>
        <div class="entry-main"><b>${esc(item.description)}</b><small>${esc(memberName(item.paid_by))} paid · ${prettyDate(item.date)} · ${item.shares.length} ${item.shares.length === 1 ? 'person' : 'people'}</small></div>
        <span class="entry-amount">${money(item.amount_cents)}</span>
        <button class="icon-btn" data-del-expense="${item.id}" aria-label="Delete expense" title="Delete">✕</button>
        <div class="entry-detail">Split: ${shares}</div>
      </li>`;
  }).join('');
}

// ---------- group page actions ----------

async function handleAddExpense(event) {
  event.preventDefault();
  const form = event.target;
  const f = form.elements;
  const error = $('#expense-error');
  showError(error, '');
  try {
    await api(`/groups/${state.groupId}/expenses`, {
      method: 'POST',
      body: {
        description: f.description.value,
        amount: f.amount.value,
        paid_by: Number(f.paid_by.value),
        date: f.date.value,
        participants: selectedParticipants(),
      },
    });
    toast('Expense added ✓');
    f.description.value = '';
    f.amount.value = '';
    updatePreview();
    f.description.focus();
    await refresh();
  } catch (err) {
    showError(error, err.message);
  }
}

async function handleAddMember(event) {
  event.preventDefault();
  const input = event.target.elements.name;
  try {
    await api(`/groups/${state.groupId}/members`, { method: 'POST', body: { name: input.value } });
    toast(`${input.value.trim()} joined the group`);
    input.value = '';
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function settle(index) {
  const payment = state.data.payments[index];
  if (!payment) return;
  try {
    await api(`/groups/${state.groupId}/settlements`, {
      method: 'POST',
      body: { from: payment.from, to: payment.to, amount: (payment.cents / 100).toFixed(2), date: todayISO() },
    });
    toast('Payment recorded 🤝');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function remove(kind, id) {
  const label = kind === 'expenses' ? 'this expense' : 'this repayment';
  if (!confirm(`Delete ${label}? Everyone's balances will update.`)) return;
  try {
    await api(`/groups/${state.groupId}/${kind}/${id}`, { method: 'DELETE' });
    toast('Deleted');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function refresh() {
  state.snapshot = '';
  await loadGroup();
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied. Send it to your group!');
  } catch {
    prompt('Copy this link and share it:', location.href);
  }
}

// ---------- start-up ----------

function wireUpEvents() {
  window.addEventListener('hashchange', route);
  $('#copy-link').addEventListener('click', copyInviteLink);

  // home page
  $('#create-form').addEventListener('submit', handleCreate);
  $('#tag-input').addEventListener('click', () => $('#member-input').focus());
  $('#member-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addNewMember(); }
    if (e.key === 'Backspace' && !e.target.value && state.newMembers.length) { state.newMembers.pop(); renderTags(); }
  });
  $('#tags').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) { state.newMembers.splice(Number(btn.dataset.remove), 1); renderTags(); }
  });

  // group page
  $('#expense-form').addEventListener('submit', handleAddExpense);
  $('#expense-form').addEventListener('input', updatePreview);
  $('#add-member-form').addEventListener('submit', handleAddMember);
  $('#toggle-all').addEventListener('click', (e) => {
    const boxes = document.querySelectorAll('#participants input');
    const selectAll = [...boxes].some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = selectAll; });
    e.target.textContent = selectAll ? 'select none' : 'select all';
    updatePreview();
  });
  $('#payments').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settle]');
    if (btn) settle(Number(btn.dataset.settle));
  });
  $('#history').addEventListener('click', (e) => {
    const delExpense = e.target.closest('[data-del-expense]');
    const delSettlement = e.target.closest('[data-del-settlement]');
    if (delExpense) return remove('expenses', delExpense.dataset.delExpense);
    if (delSettlement) return remove('settlements', delSettlement.dataset.delSettlement);
    const entry = e.target.closest('[data-entry]');
    if (entry) entry.classList.toggle('open'); // tap an expense to see how it was split
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.groupId) loadGroup(); });
}

async function init() {
  wireUpEvents();
  const { currencies } = await api('/config');
  state.currencies = currencies;
  $('#currency-select').innerHTML = currencies.map((c) => `<option>${c}</option>`).join('');
  route();
}

init();
