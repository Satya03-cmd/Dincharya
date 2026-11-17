// DinCharya - plans your day from a plain list of tasks.
// Everything is saved in localStorage, no server needed.

const KEY = 'dincharya-data';
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let state = loadData();
let plan = { blocks: [], left: [] };
let reminded = {};

// ---------- storage ----------

function loadData() {
  const fresh = {
    tasks: [],
    settings: {
      start: '07:00',
      end: '23:00',
      gap: 10,
      busy: [{ from: '10:00', to: '16:00', label: 'College' }]
    },
    history: {},      // date -> number of tasks finished that day
    lastOpen: null
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) return Object.assign(fresh, saved);
  } catch (e) {}
  return fresh;
}

function saveData() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

// ---------- date / time helpers ----------

function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return String(n).padStart(2, '0'); }
function today() { return ymd(new Date()); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }

function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00') - new Date(from + 'T00:00')) / 86400000);
}
function daysLeft(due) { return due ? daysBetween(today(), due) : null; }

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

function clock(min) {
  let h = Math.floor(min / 60), m = min % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + pad(m) + ' ' + ampm;
}

function prettyMins(m) {
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}

// ---------- the text parser ----------
// Pulls time, deadline, priority and repeat out of a normal sentence.
// Whatever is left over becomes the task title.

function parseTask(text) {
  let t = ' ' + text.trim() + ' ';
  const task = { mins: 30, pri: 2, due: null, repeat: 'none' };
  let hrs = 0, mins = 0, gotTime = false;

  t = t.replace(/\s(\d+(?:\.\d+)?)\s?(h|hr|hrs|hour|hours)(?=\s)/i, (_, n) => { hrs = parseFloat(n); gotTime = true; return ' '; });
  t = t.replace(/\s(\d+)\s?(m|min|mins|minute|minutes)(?=\s)/i, (_, n) => { mins = parseInt(n); gotTime = true; return ' '; });
  if (gotTime) task.mins = Math.max(5, Math.round(hrs * 60 + mins));

  t = t.replace(/\s!(high|h|urgent|imp)(?=\s)/i, () => { task.pri = 3; return ' '; });
  t = t.replace(/\s!(low|l)(?=\s)/i, () => { task.pri = 1; return ' '; });

  t = t.replace(/\s(daily|everyday|every day|roz)(?=\s)/i, () => { task.repeat = 'daily'; return ' '; });
  t = t.replace(/\s(weekly|every week)(?=\s)/i, () => { task.repeat = 'weekly'; return ' '; });

  t = t.replace(/\s(?:by |till |before |on )?(today|aaj|tonight)(?=\s)/i, () => { task.due = today(); return ' '; });
  t = t.replace(/\s(?:by |till |before |on )?(tomorrow|tmrw|kal)(?=\s)/i, () => { task.due = addDays(1); return ' '; });

  // weekday needs "by/on" in front so words like "sat" in a title don't get eaten
  t = t.replace(/\s(?:by|till|before|on)\s(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?=\s)/i, (_, d) => {
    const target = WEEKDAYS.indexOf(d.toLowerCase());
    const diff = (target - new Date().getDay() + 7) % 7;
    task.due = addDays(diff);
    return ' ';
  });

  // dates like 20/11 or by 5/12
  t = t.replace(/\s(?:by |till |before |on )?(\d{1,2})\/(\d{1,2})(?=\s)/, (_, dd, mm) => {
    const now = new Date();
    let d = new Date(now.getFullYear(), mm - 1, dd);
    if (ymd(d) < today()) d = new Date(now.getFullYear() + 1, mm - 1, dd);
    task.due = ymd(d);
    return ' ';
  });

  task.title = t.replace(/\s+/g, ' ').trim() || text.trim();
  return task;
}

// ---------- scoring ----------
// Higher score = should happen earlier in the day.

function score(task) {
  let s = task.pri * 10;
  const d = daysLeft(task.due);
  if (d !== null) {
    if (d < 0) s += 40;          // already late
    else if (d === 0) s += 30;
    else if (d === 1) s += 20;
    else if (d <= 3) s += 10;
  }
  if (task.repeat === 'daily') s += 15;
  s += (task.skipped || 0) * 5;  // pushed from earlier days, stop dodging it
  if (task.mins <= 20) s += 3;   // quick wins go first on a tie
  return s;
}

// ---------- the scheduler ----------
// 1. take the day (start -> end), cut out busy hours and time already gone
// 2. sort pending tasks by score
// 3. drop each task into the first free gap that is big enough

function freeSlots() {
  const st = state.settings;
  const start = Math.max(toMin(st.start), Math.ceil(nowMin() / 5) * 5);
  let slots = [[start, toMin(st.end)]];

  for (const b of st.busy) {
    const bf = toMin(b.from), bt = toMin(b.to);
    const next = [];
    for (const [a, z] of slots) {
      if (bt <= a || bf >= z) { next.push([a, z]); continue; }
      if (bf > a) next.push([a, bf]);
      if (bt < z) next.push([bt, z]);
    }
    slots = next;
  }
  return slots.filter(([a, z]) => z - a >= 5);
}

function buildPlan() {
  const slots = freeSlots();
  const gap = Number(state.settings.gap) || 0;
  const pending = state.tasks.filter(t => !t.done).sort((a, b) => score(b) - score(a));
  const blocks = [], left = [];

  for (const task of pending) {
    const slot = slots.find(s => s[1] - s[0] >= task.mins);
    if (slot) {
      blocks.push({ id: task.id, start: slot[0], end: slot[0] + task.mins });
      slot[0] += task.mins + gap;
    } else {
      left.push(task);
    }
  }
  blocks.sort((a, b) => a.start - b.start);
  plan = { blocks, left };
}

// ---------- new day handling ----------

function startOfDayCheck() {
  const t = today();
  if (state.lastOpen === t) return;

  let carried = 0;
  // finished one-time tasks are cleared, history already counted them
  state.tasks = state.tasks.filter(task => !(task.done && task.repeat === 'none'));

  for (const task of state.tasks) {
    if (task.done && task.repeat === 'daily') task.done = false;
    else if (task.done && task.repeat === 'weekly' && daysBetween(task.doneOn, t) >= 7) task.done = false;
    else if (!task.done && state.lastOpen) { task.skipped = (task.skipped || 0) + 1; carried++; }
  }

  if (carried) {
    showNotice(carried + ' unfinished task' + (carried > 1 ? 's' : '') +
      ' moved to today and given a bit more priority.');
  }
  state.lastOpen = t;
  saveData();
}

// ---------- actions ----------

function addTask(text) {
  if (!text.trim()) return;
  const parsed = parseTask(text);
  parsed.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  parsed.done = false;
  parsed.created = today();
  state.tasks.push(parsed);
  saveData();
  refresh();
}

function toggleDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const d = today();
  task.done = !task.done;
  task.doneOn = task.done ? d : null;
  state.history[d] = Math.max(0, (state.history[d] || 0) + (task.done ? 1 : -1));
  saveData();
  refresh();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveData();
  refresh();
}

// ---------- rendering ----------

const $ = id => document.getElementById(id);

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dueChip(due) {
  const d = daysLeft(due);
  if (d === null) return '';
  if (d < 0) return `<span class="chip hot">late by ${-d}d</span>`;
  if (d === 0) return '<span class="chip hot">due today</span>';
  if (d === 1) return '<span class="chip hot">due tomorrow</span>';
  const label = new Date(due + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `<span class="chip">due ${label}</span>`;
}

function chips(task) {
  let h = `<span class="chip">${prettyMins(task.mins)}</span>`;
  h += dueChip(task.due);
  if (task.pri === 3) h += '<span class="chip hot">high</span>';
  if (task.pri === 1) h += '<span class="chip">low</span>';
  if (task.repeat !== 'none') h += `<span class="chip ok">${task.repeat}</span>`;
  if (task.skipped) h += `<span class="chip">skipped ${task.skipped}x</span>`;
  return h;
}

function renderTasks() {
  const list = [...state.tasks].sort((a, b) => (a.done - b.done) || (score(b) - score(a)));
  $('taskList').innerHTML = list.map(t => `
    <li class="${t.done ? 'done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}" aria-label="Mark done">
      <div class="task-body">
        <div class="title">${esc(t.title)}</div>
        <div>${chips(t)}</div>
      </div>
      <button class="del" data-del="${t.id}" title="Delete">&times;</button>
    </li>`).join('');

  const open = state.tasks.filter(t => !t.done).length;
  $('taskCount').textContent = state.tasks.length ? `${open} left` : '';
  $('noTasks').style.display = state.tasks.length ? 'none' : 'block';
}

function renderTimeline() {
  const now = nowMin();
  const items = plan.blocks.map(b => {
    const task = state.tasks.find(t => t.id === b.id);
    return { ...b, title: task.title, urgent: daysLeft(task.due) !== null && daysLeft(task.due) <= 0 };
  });
  for (const b of state.settings.busy) {
    items.push({ start: toMin(b.from), end: toMin(b.to), title: b.label, busy: true });
  }
  items.sort((a, b) => a.start - b.start);

  if (!plan.blocks.length) {
    const msg = state.tasks.some(t => !t.done)
      ? 'No free time left today. Change your day timings in Settings.'
      : 'Add some tasks and your day plan shows up here.';
    $('timeline').innerHTML = `<p class="empty">${msg}</p>`;
  } else {
    $('timeline').innerHTML = items.map(i => {
      let cls = 'block';
      if (i.busy) cls += ' busy';
      if (i.urgent) cls += ' urgent';
      if (i.end <= now) cls += ' past';
      else if (i.start <= now) cls += ' now';
      return `<div class="${cls}">
        <span class="time">${clock(i.start)} - ${clock(i.end)}</span>
        <span>${esc(i.title)}</span>
      </div>`;
    }).join('');
  }

  if (plan.left.length) {
    const lateOnes = plan.left.filter(t => daysLeft(t.due) !== null && daysLeft(t.due) <= 0);
    let h = `<p class="muted">Didn't fit today: ${plan.left.map(t => esc(t.title)).join(', ')}</p>`;
    if (lateOnes.length) h += `<p class="warn">Heads up: ${lateOnes.length} of these is due today or late. Drop something less important.</p>`;
    $('overflow').innerHTML = h;
  } else {
    $('overflow').innerHTML = '';
  }
}

function streak() {
  let n = 0;
  const d = new Date();
  // today counts only if something is done, otherwise start from yesterday
  if (!state.history[ymd(d)]) d.setDate(d.getDate() - 1);
  while (state.history[ymd(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderStats() {
  const doneToday = state.history[today()] || 0;
  const plannedMins = plan.blocks.reduce((s, b) => s + (b.end - b.start), 0);
  const freeMins = freeSlots().reduce((s, [a, z]) => s + (z - a), 0);
  const late = state.tasks.filter(t => !t.done && daysLeft(t.due) !== null && daysLeft(t.due) < 0).length;

  const stat = (num, lbl) => `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
  $('stats').innerHTML =
    stat(doneToday, 'done today') +
    stat(streak() + (streak() === 1 ? ' day' : ' days'), 'streak') +
    stat(prettyMins(plannedMins), 'planned of ' + prettyMins(freeMins) + ' free') +
    stat(late, 'late tasks');
}

function refresh() {
  buildPlan();
  renderTasks();
  renderTimeline();
  renderStats();
}

function showNotice(msg) {
  const n = $('notice');
  n.textContent = msg;
  n.classList.remove('hidden');
  setTimeout(() => n.classList.add('hidden'), 9000);
}

// live preview of what the parser understood
function updatePreview() {
  const text = $('quickInput').value;
  if (!text.trim()) {
    $('preview').innerHTML = $('preview').dataset.help;
    return;
  }
  const p = parseTask(text);
  $('preview').innerHTML = `Will add: <b>${esc(p.title)}</b> ${chips(p)}`;
}

// ---------- reminders ----------

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = nowMin();
  for (const b of plan.blocks) {
    const key = today() + b.id;
    if (!reminded[key] && b.start - now <= 5 && b.start - now >= 0) {
      const task = state.tasks.find(t => t.id === b.id);
      new Notification('Up next: ' + task.title, { body: clock(b.start) + ' - ' + clock(b.end) });
      reminded[key] = true;
    }
  }
}

// ---------- calendar export (.ics) ----------

function exportIcs() {
  if (!plan.blocks.length) { showNotice('Nothing planned yet.'); return; }
  const day = today().replace(/-/g, '');
  const stamp = (m) => day + 'T' + pad(Math.floor(m / 60)) + pad(m % 60) + '00';
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DinCharya//EN\r\n';
  for (const b of plan.blocks) {
    const task = state.tasks.find(t => t.id === b.id);
    ics += 'BEGIN:VEVENT\r\n' +
      'UID:' + b.id + '-' + day + '@dincharya\r\n' +
      'DTSTAMP:' + stamp(nowMin()) + '\r\n' +
      'DTSTART:' + stamp(b.start) + '\r\n' +
      'DTEND:' + stamp(b.end) + '\r\n' +
      'SUMMARY:' + task.title.replace(/[,;]/g, ' ') + '\r\n' +
      'BEGIN:VALARM\r\nTRIGGER:-PT5M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n' +
      'END:VEVENT\r\n';
  }
  ics += 'END:VCALENDAR\r\n';
  download('dincharya-' + today() + '.ics', ics, 'text/calendar');
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- settings ----------

function openSettings() {
  const s = state.settings;
  $('setStart').value = s.start;
  $('setEnd').value = s.end;
  $('setGap').value = s.gap;
  $('setBusy').value = s.busy.map(b => `${b.from}-${b.to} ${b.label}`).join('\n');
  $('settings').showModal();
}

function saveSettings() {
  const busy = [];
  for (const line of $('setBusy').value.split('\n')) {
    const m = line.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(.*)$/);
    if (m) busy.push({ from: m[1].padStart(5, '0'), to: m[2].padStart(5, '0'), label: m[3] || 'Busy' });
  }
  state.settings = {
    start: $('setStart').value || '07:00',
    end: $('setEnd').value || '23:00',
    gap: Math.max(0, Number($('setGap').value) || 0),
    busy
  };
  saveData();
  refresh();
}

// ---------- events ----------

$('preview').dataset.help = $('preview').innerHTML;
$('todayLabel').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

$('addBtn').onclick = () => { addTask($('quickInput').value); $('quickInput').value = ''; updatePreview(); };
$('quickInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('addBtn').click(); });
$('quickInput').addEventListener('input', updatePreview);

$('taskList').addEventListener('click', e => {
  if (e.target.dataset.id) toggleDone(e.target.dataset.id);
  if (e.target.dataset.del) deleteTask(e.target.dataset.del);
});

$('icsBtn').onclick = exportIcs;
$('settingsBtn').onclick = openSettings;
$('settingsForm').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value === 'save') saveSettings();
});

$('exportBtn').onclick = () => download('dincharya-backup.json', JSON.stringify(state, null, 2), 'application/json');
$('importFile').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(txt => {
    try {
      const data = JSON.parse(txt);
      if (!Array.isArray(data.tasks)) throw new Error();
      state = Object.assign(loadData(), data);
      saveData();
      refresh();
      $('settings').close();
      showNotice('Backup restored.');
    } catch (err) {
      alert('That file is not a DinCharya backup.');
    }
  });
};
$('resetBtn').onclick = () => {
  if (confirm('Delete all tasks and history? This cannot be undone.')) {
    localStorage.removeItem(KEY);
    state = loadData();
    refresh();
    $('settings').close();
  }
};

$('notifyBtn').onclick = () => {
  if (!('Notification' in window)) { alert('This browser does not support notifications.'); return; }
  Notification.requestPermission().then(p => {
    $('notifyBtn').textContent = p === 'granted' ? 'Reminders on' : 'Reminders blocked';
  });
};
if ('Notification' in window && Notification.permission === 'granted') $('notifyBtn').textContent = 'Reminders on';

// ---------- start ----------

startOfDayCheck();
refresh();
setInterval(() => { renderTimeline(); renderStats(); checkReminders(); }, 30000);
