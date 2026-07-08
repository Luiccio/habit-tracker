'use strict';

/* ==================== Данные ==================== */

const STORAGE_KEY = 'habitTrackerData';

// Структура данных:
// data.habits = [{ id, name, emoji, color, days: [0..6] (0=Вс, как в JS), createdAt: 'YYYY-MM-DD' }]
// data.checks = { 'YYYY-MM-DD': [habitId, ...] }
// data.moods  = { 'YYYY-MM-DD': { level: 1..5, note: '' } }
let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.habits) && typeof parsed.checks === 'object') {
        if (!parsed.moods || typeof parsed.moods !== 'object') parsed.moods = {};
        return parsed;
      }
    }
  } catch (e) {
    console.error('Не удалось прочитать данные:', e);
  }
  return { habits: [], checks: {}, moods: {} };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ==================== Даты ==================== */

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return dateStr(new Date());
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
// Порядок отображения Пн..Вс -> значения getDay(): Пн=1 ... Сб=6, Вс=0
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function formatDayTitle(ds) {
  const d = parseDate(ds);
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return `${d.getDate()} ${d.toLocaleDateString('ru-RU', { month: 'long' })}, ${weekday}`;
}

function mondayOf(d) {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  res.setDate(res.getDate() - (res.getDay() + 6) % 7);
  return res;
}

function daysLabel(days) {
  if (days.length === 7) return 'каждый день';
  return DAY_ORDER.filter(d => days.includes(d)).map(d => DAY_LABELS[DAY_ORDER.indexOf(d)]).join(', ');
}

/* ==================== Логика привычек ==================== */

function isScheduled(habit, ds) {
  if (ds < habit.createdAt) return false;
  return habit.days.includes(parseDate(ds).getDay());
}

function habitsForDate(ds) {
  return data.habits.filter(h => isScheduled(h, ds));
}

function isChecked(habitId, ds) {
  return (data.checks[ds] || []).includes(habitId);
}

function toggleCheck(habitId, ds) {
  const list = data.checks[ds] || [];
  if (list.includes(habitId)) {
    data.checks[ds] = list.filter(id => id !== habitId);
    if (data.checks[ds].length === 0) delete data.checks[ds];
  } else {
    data.checks[ds] = [...list, habitId];
  }
  saveData();
}

// Серия: сколько запланированных дней подряд привычка выполнялась.
// Если сегодня ещё не отмечено — серия не обнуляется, считаем со вчерашнего дня.
function getStreak(habit) {
  let streak = 0;
  const d = new Date();
  const today = todayStr();
  for (let i = 0; i < 3660; i++) {
    const ds = dateStr(d);
    if (ds < habit.createdAt) break;
    if (isScheduled(habit, ds)) {
      if (isChecked(habit.id, ds)) {
        streak++;
      } else if (ds !== today) {
        break;
      }
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Процент выполнения привычки за месяц (только прошедшие/сегодняшние запланированные дни)
function monthPercent(habit, year, month) {
  const today = todayStr();
  let scheduled = 0, done = 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = dateStr(new Date(year, month, day));
    if (ds > today) break;
    if (isScheduled(habit, ds)) {
      scheduled++;
      if (isChecked(habit.id, ds)) done++;
    }
  }
  return scheduled === 0 ? null : Math.round(done / scheduled * 100);
}

/* ==================== Настроение ==================== */

const MOOD_EMOJIS = ['😢', '🙁', '😐', '🙂', '😄']; // уровни 1..5

function getMood(ds) {
  return data.moods[ds] || null;
}

// Обновить настроение дня; пустая запись (без уровня и текста) удаляется
function updateMood(ds, patch) {
  const m = { ...(data.moods[ds] || {}), ...patch };
  if (!m.level && !(m.note && m.note.trim())) {
    delete data.moods[ds];
  } else {
    data.moods[ds] = m;
  }
  saveData();
}

// Отрисовать 5 смайликов в контейнер; повторный тап по выбранному — снять отметку
function renderMoodOptions(container, ds, afterChange) {
  const mood = getMood(ds);
  container.innerHTML = '';
  MOOD_EMOJIS.forEach((emoji, i) => {
    const level = i + 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mood-option' + (mood && mood.level === level ? ' selected' : '');
    btn.textContent = emoji;
    btn.setAttribute('aria-label', 'Настроение ' + level + ' из 5');
    btn.addEventListener('click', () => {
      updateMood(ds, { level: mood && mood.level === level ? null : level });
      if (afterChange) afterChange();
    });
    container.appendChild(btn);
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ==================== Состояние интерфейса ==================== */

const EMOJIS = [
  // спорт и активность
  '🏃', '🚶', '🏋️', '🧘', '🚴', '🏊', '⚽', '🏀', '🎾', '🏐', '🏓', '🥊', '🤸', '🧗', '🛹', '⛷️', '🥋', '🏸', '💪', '🤾',
  // здоровье
  '💧', '💊', '🦷', '😴', '🛌', '🧴', '🧼', '🚿', '🛁', '❤️', '🩺', '🧠', '💆', '💅', '🧖', '🚭', '🌡️', '🧬',
  // еда
  '🥗', '🍎', '🍌', '🥦', '🥕', '🍊', '🍋', '🍓', '🫐', '🥑', '🍅', '🥒', '🌽', '🍞', '🥛', '🍵', '☕', '🥤', '🍽️', '🍳',
  // учёба и работа
  '📖', '📚', '✍️', '📝', '💻', '⌨️', '🖥️', '📊', '📈', '🧮', '🔬', '🔭', '🎓', '🗣️', '💼', '📅', '⏰', '⏱️', '📋', '🧑‍🏫',
  // музыка и хобби
  '🎸', '🎹', '🎻', '🥁', '🎤', '🎧', '🎨', '🖌️', '📷', '🎬', '🎮', '♟️', '🧩', '🪴', '🌻', '🌱', '🐕', '🐈', '🎣', '🧶',
  // дом и быт
  '🧹', '🧺', '🗑️', '🛒', '🔧', '🚗', '🏠', '🛏️', '🪞', '🌊',
  // осознанность и настроение
  '🙏', '🕯️', '📿', '☀️', '🌅', '🌙', '⭐', '🍃', '🔥', '😊',
  // финансы
  '💰', '💵', '🏦', '📉', '🪙',
  // общение
  '📞', '💬', '👨‍👩‍👧', '🤝', '💌', '🎁',
  // разное
  '✅', '🍀', '🎯', '🏆', '💡', '🔑', '✈️', '🗺️', '📵', '🎲',
];
const COLORS = ['#4f46e5', '#0ea5e9', '#16a34a', '#eab308', '#ea580c', '#dc2626', '#db2777', '#7c3aed'];

let currentScreen = 'today';
let selectedDate = todayStr();    // день, выбранный в полоске недели
let weekStart = mondayOf(new Date()); // понедельник отображаемой недели
let calYear, calMonth;           // отображаемый месяц календаря
let calFilter = 'all';           // фильтр календаря: 'all' или id привычки
let editingHabitId = null;       // id редактируемой привычки (null = новая)
let deletingHabitId = null;
let dayModalDate = null;

// Форма привычки
let formEmoji = EMOJIS[0];
let formColor = COLORS[0];
let formDays = [0, 1, 2, 3, 4, 5, 6];

const $ = id => document.getElementById(id);

/* ==================== Навигация ==================== */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchScreen(tab.dataset.screen));
});

function switchScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.screen === name));
  applyTrackPosition(true);
  render();
}

/* ==================== Экран «Сегодня» ==================== */

function renderToday() {
  const ds = selectedDate;
  const today = todayStr();
  const isFuture = ds > today;

  $('today-title').textContent = ds === today ? 'Сегодня' : formatDayTitle(ds).split(',')[0];
  $('today-date').textContent = formatDayTitle(ds);

  renderWeekStrip();

  // настроение: для будущих дней скрываем
  $('mood-card').classList.toggle('hidden', isFuture);
  if (!isFuture) {
    renderMoodOptions($('mood-options'), ds, renderToday);
    const mood = getMood(ds);
    if (document.activeElement !== $('mood-note')) {
      $('mood-note').value = mood && mood.note ? mood.note : '';
    }
  }

  const habits = habitsForDate(ds);
  const list = $('today-list');
  list.innerHTML = '';
  $('today-empty').classList.toggle('hidden', habits.length > 0);
  $('today-progress').classList.toggle('hidden', habits.length === 0 || isFuture);

  let done = 0;
  habits.forEach(h => {
    const checked = isChecked(h.id, ds);
    if (checked) done++;
    const streak = getStreak(h);
    const card = document.createElement('div');
    card.className = 'habit-card' + (checked ? ' done' : '');
    card.innerHTML = `
      <div class="habit-emoji" style="background:${h.color}22">${h.emoji}</div>
      <div class="habit-info">
        <div class="habit-name"></div>
        <div class="habit-meta">${streak > 0 ? `<span class="streak">🔥 ${streak} дн. подряд</span>` : 'начните серию сегодня'}</div>
      </div>
      <button class="check-btn${checked ? ' checked' : ''}" aria-label="Отметить" ${isFuture ? 'disabled' : ''}></button>
    `;
    card.querySelector('.habit-name').textContent = h.name;
    card.querySelector('.check-btn').textContent = '✓';
    if (!isFuture) {
      card.querySelector('.check-btn').addEventListener('click', () => {
        toggleCheck(h.id, ds);
        render();
      });
    }
    list.appendChild(card);
  });

  if (habits.length > 0 && !isFuture) {
    const pct = Math.round(done / habits.length * 100);
    $('progress-label').textContent = `Выполнено ${done} из ${habits.length}`;
    $('progress-percent').textContent = pct + '%';
    $('progress-fill').style.width = pct + '%';
  }
}

/* ---------- Полоска недели ---------- */

function renderWeekStrip() {
  const today = todayStr();
  const box = $('week-days');
  box.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    const ds = dateStr(d);
    const isFuture = ds > today;

    // индикатор выполнения дня
    let level = 0;
    if (!isFuture) {
      const habits = habitsForDate(ds);
      const done = habits.filter(h => isChecked(h.id, ds)).length;
      if (habits.length > 0 && done > 0) {
        const ratio = done / habits.length;
        level = ratio === 1 ? 3 : (ratio >= 0.5 ? 2 : 1);
      }
    }

    const btn = document.createElement('button');
    btn.className = 'week-day level-' + level +
      (ds === selectedDate ? ' selected' : '') +
      (ds === today ? ' today' : '') +
      (isFuture ? ' future' : '');
    btn.innerHTML = `
      <span class="wd-label">${DAY_LABELS[i]}</span>
      <span class="wd-num">${d.getDate()}</span>
      <span class="wd-dot"></span>
    `;
    btn.addEventListener('click', () => {
      selectedDate = ds;
      renderToday();
    });
    box.appendChild(btn);
  }

  // подпись месяца: по середине недели (четвергу)
  const mid = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3);
  $('week-month-label').textContent = `${MONTH_NAMES[mid.getMonth()]} ${mid.getFullYear()}`;
}

$('week-prev').addEventListener('click', () => { shiftWeek(-7); });
$('week-next').addEventListener('click', () => { shiftWeek(7); });

function shiftWeek(deltaDays) {
  weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + deltaDays);
  renderToday();
}

$('week-today').addEventListener('click', () => {
  selectedDate = todayStr();
  weekStart = mondayOf(new Date());
  renderToday();
});

// Комментарий к настроению: сохраняем через полсекунды после окончания ввода
$('mood-note').addEventListener('input', debounce(() => {
  if (selectedDate <= todayStr()) {
    updateMood(selectedDate, { note: $('mood-note').value });
  }
}, 500));

$('day-mood-note').addEventListener('input', debounce(() => {
  if (dayModalDate) {
    updateMood(dayModalDate, { note: $('day-mood-note').value });
  }
}, 500));

/* ==================== Экран «Календарь» ==================== */

function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

$('cal-prev').addEventListener('click', () => { shiftMonth(-1); });
$('cal-next').addEventListener('click', () => { shiftMonth(1); });

function shiftMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

$('cal-habit-filter').addEventListener('change', e => {
  calFilter = e.target.value;
  renderCalendar();
});

function renderCalendar() {
  // фильтр по привычке
  const filterSel = $('cal-habit-filter');
  filterSel.innerHTML = '<option value="all">Все привычки</option>' +
    data.habits.map(h => `<option value="${h.id}">${h.emoji} ${escapeHtml(h.name)}</option>`).join('');
  filterSel.value = data.habits.some(h => h.id === calFilter) ? calFilter : 'all';
  calFilter = filterSel.value;

  $('cal-month-label').textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;

  const grid = $('cal-grid');
  grid.innerHTML = '';
  const today = todayStr();

  const firstDay = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  // сдвиг для сетки с понедельника: getDay() 0=Вс -> 6 пустых, 1=Пн -> 0
  const offset = (firstDay.getDay() + 6) % 7;

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day other-month';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = dateStr(new Date(calYear, calMonth, day));
    const isFuture = ds > today;
    const habits = calFilter === 'all'
      ? habitsForDate(ds)
      : data.habits.filter(h => h.id === calFilter && isScheduled(h, ds));
    const done = habits.filter(h => isChecked(h.id, ds)).length;

    let level = 0;
    if (!isFuture && habits.length > 0 && done > 0) {
      const ratio = done / habits.length;
      level = ratio === 1 ? 3 : (ratio >= 0.5 ? 2 : 1);
    }

    const btn = document.createElement('button');
    btn.className = 'cal-day level-' + level +
      (ds === today ? ' today' : '') + (isFuture ? ' future' : '');
    btn.innerHTML = `<span>${day}</span><span class="dot"></span>`;
    if (!isFuture) {
      btn.addEventListener('click', () => openDayModal(ds));
    }
    grid.appendChild(btn);
  }

  renderMonthStats();
  renderMoodChart();
}

/* ---------- График настроения ---------- */

function renderMoodChart() {
  const wrap = $('mood-chart-wrap');
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // точки: дни месяца, где отмечено настроение
  const points = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = dateStr(new Date(calYear, calMonth, day));
    const mood = getMood(ds);
    if (mood && mood.level) points.push({ day, ds, level: mood.level, note: mood.note || '' });
  }

  $('mood-chart-empty').classList.toggle('hidden', points.length > 0);
  if (points.length === 0) {
    wrap.innerHTML = '';
    return;
  }

  // геометрия графика
  const W = 360, H = 140;
  const padL = 34, padR = 12, padT = 10, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = day => padL + (daysInMonth === 1 ? plotW / 2 : (day - 1) / (daysInMonth - 1) * plotW);
  const y = level => padT + (5 - level) / 4 * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // горизонтальные линии уровней со смайликами слева
  for (let lvl = 1; lvl <= 5; lvl++) {
    svg += `<line x1="${padL}" y1="${y(lvl)}" x2="${W - padR}" y2="${y(lvl)}" stroke="#e5e7eb" stroke-width="1"/>`;
    svg += `<text x="6" y="${y(lvl) + 5}" font-size="13">${MOOD_EMOJIS[lvl - 1]}</text>`;
  }

  // подписи дней по оси X
  const step = daysInMonth > 20 ? 5 : (daysInMonth > 10 ? 3 : 1);
  for (let day = 1; day <= daysInMonth; day += step) {
    svg += `<text x="${x(day)}" y="${H - 6}" font-size="9" fill="#6b7280" text-anchor="middle">${day}</text>`;
  }

  // линия
  if (points.length > 1) {
    const path = points.map(p => `${x(p.day).toFixed(1)},${y(p.level).toFixed(1)}`).join(' ');
    svg += `<polyline points="${path}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // точки (+ невидимая зона побольше для удобного тапа)
  points.forEach(p => {
    svg += `<circle cx="${x(p.day)}" cy="${y(p.level)}" r="4.5" fill="#4f46e5" stroke="#fff" stroke-width="1.5"/>`;
    svg += `<circle class="chart-dot" data-ds="${p.ds}" cx="${x(p.day)}" cy="${y(p.level)}" r="13" fill="transparent"/>`;
  });

  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('click', () => openDayModal(dot.dataset.ds));
  });
}

function renderMonthStats() {
  const box = $('cal-month-stats');
  box.innerHTML = '';
  const habits = calFilter === 'all' ? data.habits : data.habits.filter(h => h.id === calFilter);
  habits.forEach(h => {
    const pct = monthPercent(h, calYear, calMonth);
    if (pct === null) return;
    const row = document.createElement('div');
    row.className = 'month-stat-row';
    row.innerHTML = `<span>${h.emoji}</span><span class="stat-name"></span><span class="pct">${pct}%</span>`;
    row.querySelector('.stat-name').textContent = h.name;
    box.appendChild(row);
  });
}

/* ---------- Модалка дня ---------- */

function openDayModal(ds) {
  dayModalDate = ds;
  $('day-modal-title').textContent = formatDayTitle(ds);
  renderDayModal();
  $('day-modal').classList.remove('hidden');
}

function renderDayModal() {
  const ds = dayModalDate;

  renderMoodOptions($('day-mood-options'), ds, renderDayModal);
  const mood = getMood(ds);
  if (document.activeElement !== $('day-mood-note')) {
    $('day-mood-note').value = mood && mood.note ? mood.note : '';
  }

  const list = $('day-modal-list');
  list.innerHTML = '';
  const habits = habitsForDate(ds);
  if (habits.length === 0) {
    list.innerHTML = '<p class="confirm-text">В этот день привычек не запланировано.</p>';
    return;
  }
  habits.forEach(h => {
    const checked = isChecked(h.id, ds);
    const card = document.createElement('div');
    card.className = 'habit-card' + (checked ? ' done' : '');
    card.innerHTML = `
      <div class="habit-emoji" style="background:${h.color}22">${h.emoji}</div>
      <div class="habit-info"><div class="habit-name"></div></div>
      <button class="check-btn${checked ? ' checked' : ''}" aria-label="Отметить">✓</button>
    `;
    card.querySelector('.habit-name').textContent = h.name;
    card.querySelector('.check-btn').addEventListener('click', () => {
      toggleCheck(h.id, ds);
      renderDayModal();
      renderCalendar();
    });
    list.appendChild(card);
  });
}

$('day-close').addEventListener('click', () => {
  $('day-modal').classList.add('hidden');
  render();
});

/* ==================== Экран «Привычки» ==================== */

function renderHabits() {
  const list = $('habits-list');
  list.innerHTML = '';
  $('habits-empty').classList.toggle('hidden', data.habits.length > 0);

  data.habits.forEach(h => {
    const card = document.createElement('div');
    card.className = 'habit-card';
    card.innerHTML = `
      <div class="habit-emoji" style="background:${h.color}22">${h.emoji}</div>
      <div class="habit-info">
        <div class="habit-name"></div>
        <div class="habit-meta">${daysLabel(h.days)} · 🔥 ${getStreak(h)} дн.</div>
      </div>
      <button class="icon-btn edit-btn" aria-label="Редактировать">✏️</button>
      <button class="icon-btn del-btn" aria-label="Удалить">🗑️</button>
    `;
    card.querySelector('.habit-name').textContent = h.name;
    card.querySelector('.edit-btn').addEventListener('click', () => openHabitModal(h.id));
    card.querySelector('.del-btn').addEventListener('click', () => openConfirmModal(h.id));
    list.appendChild(card);
  });
}

/* ---------- Модалка привычки ---------- */

$('fab').addEventListener('click', () => openHabitModal(null));

function openHabitModal(habitId) {
  editingHabitId = habitId;
  const habit = habitId ? data.habits.find(h => h.id === habitId) : null;

  $('habit-modal-title').textContent = habit ? 'Редактировать привычку' : 'Новая привычка';
  $('habit-name').value = habit ? habit.name : '';
  formEmoji = habit ? habit.emoji : EMOJIS[0];
  formColor = habit ? habit.color : COLORS[data.habits.length % COLORS.length];
  formDays = habit ? [...habit.days] : [0, 1, 2, 3, 4, 5, 6];

  renderEmojiPicker();
  renderColorPicker();
  renderDaysPicker();
  $('habit-modal').classList.remove('hidden');
  $('habit-name').focus();
}

function renderEmojiPicker() {
  const box = $('emoji-picker');
  box.innerHTML = '';
  EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-option' + (e === formEmoji ? ' selected' : '');
    btn.textContent = e;
    btn.addEventListener('click', () => { formEmoji = e; renderEmojiPicker(); });
    box.appendChild(btn);
  });
}

function renderColorPicker() {
  const box = $('color-picker');
  box.innerHTML = '';
  COLORS.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-option' + (c === formColor ? ' selected' : '');
    btn.style.background = c;
    btn.addEventListener('click', () => { formColor = c; renderColorPicker(); });
    box.appendChild(btn);
  });
}

function renderDaysPicker() {
  const box = $('days-picker');
  box.innerHTML = '';
  DAY_ORDER.forEach((dayVal, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-option' + (formDays.includes(dayVal) ? ' selected' : '');
    btn.textContent = DAY_LABELS[i];
    btn.addEventListener('click', () => {
      if (formDays.includes(dayVal)) {
        formDays = formDays.filter(d => d !== dayVal);
      } else {
        formDays.push(dayVal);
      }
      renderDaysPicker();
    });
    box.appendChild(btn);
  });
}

$('btn-all-days').addEventListener('click', () => {
  formDays = [0, 1, 2, 3, 4, 5, 6];
  renderDaysPicker();
});

$('habit-cancel').addEventListener('click', () => $('habit-modal').classList.add('hidden'));

$('habit-save').addEventListener('click', () => {
  const name = $('habit-name').value.trim();
  if (!name) {
    $('habit-name').focus();
    $('habit-name').placeholder = 'Введите название!';
    return;
  }
  if (formDays.length === 0) {
    alert('Выберите хотя бы один день недели');
    return;
  }

  if (editingHabitId) {
    const habit = data.habits.find(h => h.id === editingHabitId);
    habit.name = name;
    habit.emoji = formEmoji;
    habit.color = formColor;
    habit.days = [...formDays];
  } else {
    data.habits.push({
      id: 'h' + Date.now() + Math.random().toString(36).slice(2, 7),
      name,
      emoji: formEmoji,
      color: formColor,
      days: [...formDays],
      createdAt: todayStr(),
    });
  }
  saveData();
  $('habit-modal').classList.add('hidden');
  render();
});

/* ---------- Удаление ---------- */

function openConfirmModal(habitId) {
  deletingHabitId = habitId;
  const habit = data.habits.find(h => h.id === habitId);
  $('confirm-text').textContent =
    `«${habit.name}» и вся история её выполнения будут удалены безвозвратно.`;
  $('confirm-modal').classList.remove('hidden');
}

$('confirm-cancel').addEventListener('click', () => $('confirm-modal').classList.add('hidden'));

$('confirm-delete').addEventListener('click', () => {
  data.habits = data.habits.filter(h => h.id !== deletingHabitId);
  for (const ds of Object.keys(data.checks)) {
    data.checks[ds] = data.checks[ds].filter(id => id !== deletingHabitId);
    if (data.checks[ds].length === 0) delete data.checks[ds];
  }
  saveData();
  $('confirm-modal').classList.add('hidden');
  render();
});

/* ==================== Экспорт / импорт ==================== */

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `habits-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('btn-import').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || !Array.isArray(imported.habits) || typeof imported.checks !== 'object') {
        throw new Error('неверный формат');
      }
      if (!imported.moods || typeof imported.moods !== 'object') imported.moods = {};
      if (!confirm(`Заменить текущие данные? Будет загружено привычек: ${imported.habits.length}.`)) return;
      data = imported;
      saveData();
      render();
      alert('Данные импортированы!');
    } catch (err) {
      alert('Не удалось импортировать файл: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ==================== Вспомогательное ==================== */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Закрытие модалок по клику на фон
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

/* ==================== Свайпы между вкладками ==================== */

const SCREEN_ORDER = ['today', 'calendar', 'habits'];
const contentEl = document.querySelector('.content');
const trackEl = $('screens-track');

// Поставить ленту экранов на текущую вкладку (animate = с плавным доездом)
function applyTrackPosition(animate) {
  trackEl.style.transition = animate ? '' : 'none';
  const idx = SCREEN_ORDER.indexOf(currentScreen);
  trackEl.style.transform = `translateX(${-idx * 100 / 3}%)`;
}

let swipe = null; // { x, y, dir: null|'h'|'v', t }

contentEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || e.target.closest('textarea, input, select')) {
    swipe = null;
    return;
  }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, dir: null, t: performance.now() };
}, { passive: true });

contentEl.addEventListener('touchmove', e => {
  if (!swipe) return;
  const dx = e.touches[0].clientX - swipe.x;
  const dy = e.touches[0].clientY - swipe.y;

  // определяем направление жеста по первым миллиметрам движения
  if (!swipe.dir) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swipe.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (swipe.dir === 'h') trackEl.style.transition = 'none';
  }
  if (swipe.dir !== 'h') return;

  e.preventDefault(); // не даём странице скроллиться, пока тянем экраны
  const idx = SCREEN_ORDER.indexOf(currentScreen);
  let offset = dx;
  // на крайних вкладках тянем с сопротивлением
  if ((idx === 0 && dx > 0) || (idx === SCREEN_ORDER.length - 1 && dx < 0)) offset = dx / 3;
  const pct = offset / contentEl.clientWidth * (100 / 3);
  trackEl.style.transform = `translateX(${-idx * 100 / 3 + pct}%)`;
}, { passive: false });

contentEl.addEventListener('touchend', e => {
  if (!swipe) return;
  const wasHorizontal = swipe.dir === 'h';
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dt = performance.now() - swipe.t;
  swipe = null;
  if (!wasHorizontal) return;

  const idx = SCREEN_ORDER.indexOf(currentScreen);
  const flick = dt < 250 && Math.abs(dx) > 40;          // быстрый короткий свайп
  const far = Math.abs(dx) > contentEl.clientWidth / 3; // или протянули далеко
  let next = idx;
  if (flick || far) next = dx < 0 ? idx + 1 : idx - 1;
  next = Math.max(0, Math.min(SCREEN_ORDER.length - 1, next));

  if (next !== idx) {
    switchScreen(SCREEN_ORDER[next]);
  } else {
    applyTrackPosition(true); // плавно вернуть на место
  }
}, { passive: true });

contentEl.addEventListener('touchcancel', () => {
  swipe = null;
  applyTrackPosition(true);
}, { passive: true });

/* ==================== Блокировка зума ==================== */

// пинч-зум в Safari на iOS (не отключается через meta viewport);
// двойной тап блокируется через CSS touch-action: pan-x pan-y
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

/* ==================== Запуск ==================== */

// Рисуем все три экрана: при свайпе соседние вкладки видны заранее
function render() {
  renderToday();
  renderCalendar();
  renderHabits();
}

initCalendar();
applyTrackPosition(false);
render();

// Обновление экрана при смене даты (если вкладка открыта долго)
let lastKnownDate = todayStr();
setInterval(() => {
  const now = todayStr();
  if (now !== lastKnownDate) {
    // наступил новый день — переходим на него
    if (selectedDate === lastKnownDate) selectedDate = now;
    weekStart = mondayOf(new Date());
    lastKnownDate = now;
    render();
  }
}, 60000);

// Регистрация service worker для офлайн-режима (PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err =>
    console.warn('Service worker не зарегистрирован:', err));
}
