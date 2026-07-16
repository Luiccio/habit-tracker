'use strict';

/* ==================== Данные ==================== */

const STORAGE_KEY = 'habitTrackerData';

// Структура данных:
// data.habits = [{ id, name, emoji, color, days: [0..6] (0=Вс, как в JS), createdAt: 'YYYY-MM-DD' }]
// data.checks = { 'YYYY-MM-DD': [habitId, ...] }
// data.moods  = { 'YYYY-MM-DD': { level: 1..10, note: '' } }
// data.moodScale = 10 — маркер миграции старой шкалы 1..5
// data.notifs = { bedtime: { time: 'HH:MM' }, custom: [{ id, title, time, days: [0..6] }] }
let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.habits) && typeof parsed.checks === 'object') {
        if (!parsed.moods || typeof parsed.moods !== 'object') parsed.moods = {};
        migrateNotifs(parsed);
        return migrateMoodScale(parsed);
      }
    }
  } catch (e) {
    console.error('Не удалось прочитать данные:', e);
  }
  return { habits: [], checks: {}, moods: {}, moodScale: 10, notifs: { bedtime: { time: '20:00' }, custom: [] } };
}

// Back-fill настроек уведомлений для старых сохранений
function migrateNotifs(obj) {
  if (!obj.notifs || typeof obj.notifs !== 'object') obj.notifs = {};
  if (!obj.notifs.bedtime || !/^\d{2}:\d{2}$/.test(obj.notifs.bedtime.time || '')) {
    obj.notifs.bedtime = { time: '20:00' };
  }
  if (!Array.isArray(obj.notifs.custom)) obj.notifs.custom = [];
  return obj;
}

// Старые сохранения хранили настроение по шкале 1..5 — переводим в 1..10
function migrateMoodScale(obj) {
  if (obj.moodScale === 10) return obj;
  for (const ds of Object.keys(obj.moods)) {
    const m = obj.moods[ds];
    if (m && m.level) m.level = Math.min(10, Math.max(1, m.level * 2));
  }
  obj.moodScale = 10;
  return obj;
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

const MOOD_EMOJIS = ['😭', '😢', '🙁', '😕', '😐', '🙂', '😊', '😄', '😁', '🤩']; // уровни 1..10

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
  schedulePushSync(); // сервер должен знать, что настроение сегодня уже отмечено
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
    btn.setAttribute('aria-label', 'Настроение ' + level + ' из ' + MOOD_EMOJIS.length);
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
let moodRange = 'month';         // период графика настроения: 'week' | 'month' | 'year'
// собственный период графика (не зависит от месяца календаря)
let chartWeekStart = mondayOf(new Date());
let chartMonthY = new Date().getFullYear();
let chartMonthM = new Date().getMonth();
let chartYear = new Date().getFullYear();
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

// Строит плавную SVG-кривую через точки (Catmull-Rom, переведённая в кубические Bezier)
function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function renderMoodChart() {
  const wrap = $('mood-chart-wrap');

  // слоты оси X и точки — в зависимости от периода (неделя/месяц/год)
  const slots = [];  // { label, ds } для дней или { label, month } для года
  const fmtDM = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  let periodLabel = '';

  if (moodRange === 'week') {
    for (let i = 0; i < 7; i++) {
      const d = new Date(chartWeekStart.getFullYear(), chartWeekStart.getMonth(), chartWeekStart.getDate() + i);
      slots.push({ label: String(d.getDate()), ds: dateStr(d) });
    }
    const weekEnd = new Date(chartWeekStart.getFullYear(), chartWeekStart.getMonth(), chartWeekStart.getDate() + 6);
    periodLabel = `${fmtDM(chartWeekStart)} – ${fmtDM(weekEnd)}`;
  } else if (moodRange === 'month') {
    const daysInMonth = new Date(chartMonthY, chartMonthM + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      slots.push({ label: String(day), ds: dateStr(new Date(chartMonthY, chartMonthM, day)) });
    }
    periodLabel = `${MONTH_NAMES[chartMonthM]} ${chartMonthY}`;
  } else {
    // год: 12 месяцев, точка — среднее настроение месяца
    const monthShort = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    for (let m = 0; m < 12; m++) slots.push({ label: monthShort[m], month: m });
    periodLabel = String(chartYear);
  }

  $('chart-period-label').textContent = periodLabel;

  const points = []; // { i, level, ds? , month? }
  slots.forEach((s, i) => {
    if (s.ds !== undefined) {
      const mood = getMood(s.ds);
      if (mood && mood.level) points.push({ i, level: mood.level, ds: s.ds });
    } else {
      const daysInMonth = new Date(chartYear, s.month + 1, 0).getDate();
      let sum = 0, n = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const mood = getMood(dateStr(new Date(chartYear, s.month, day)));
        if (mood && mood.level) { sum += mood.level; n++; }
      }
      if (n > 0) points.push({ i, level: sum / n, month: s.month });
    }
  });

  $('mood-chart-empty').classList.toggle('hidden', points.length > 0);
  if (points.length === 0) {
    wrap.innerHTML = '';
    return;
  }

  // цвета из текущей темы
  const css = getComputedStyle(document.documentElement);
  const cGrid = css.getPropertyValue('--border').trim();
  const cLabel = css.getPropertyValue('--text-muted').trim();
  const cLine = css.getPropertyValue('--primary').trim();
  const cCard = css.getPropertyValue('--card').trim();

  // дни, когда выполнены все запланированные привычки, — их точки станут огоньками
  const fireDays = new Set();
  if (moodRange !== 'year') {
    slots.forEach((s, i) => {
      const habits = habitsForDate(s.ds);
      if (habits.length > 0 && habits.every(h => isChecked(h.id, s.ds))) fireDays.add(i);
    });
  }

  // геометрия: высокий график, чтобы читались все 10 уровней
  const W = 360, H = 300;
  const padL = 34, padR = 12, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = i => padL + (slots.length === 1 ? plotW / 2 : i / (slots.length - 1) * plotW);
  // ось Y — 10 линий, уровень настроения 1..10 ложится на свою линию
  const y = level => padT + (10 - level) / 9 * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // все 10 уровней с подписью-смайликом
  for (let v = 1; v <= 10; v++) {
    svg += `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="${cGrid}" stroke-width="1" opacity="${v % 2 === 0 ? '1' : '.55'}"/>`;
    svg += `<text x="6" y="${y(v) + 4.5}" font-size="13">${MOOD_EMOJIS[v - 1]}</text>`;
  }

  // подписи по оси X
  const step = slots.length > 20 ? 5 : (slots.length > 12 ? 3 : 1);
  slots.forEach((s, i) => {
    if (i % step === 0) {
      svg += `<text x="${x(i)}" y="${H - 8}" font-size="9" fill="${cLabel}" text-anchor="middle">${s.label}</text>`;
    }
  });

  // плавная линия через точки (Catmull-Rom -> Bezier), без острых углов
  if (points.length > 1) {
    const coords = points.map(p => ({ x: x(p.i), y: y(p.level) }));
    svg += `<path d="${smoothPath(coords)}" fill="none" stroke="${cLine}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // точки; в день, когда выполнены все привычки, вместо точки — огонёк
  points.forEach(p => {
    const attr = p.ds !== undefined ? `data-ds="${p.ds}"` : `data-month="${p.month}"`;
    if (fireDays.has(p.i)) {
      svg += `<circle cx="${x(p.i)}" cy="${y(p.level)}" r="8" fill="${cCard}"/>`;
      svg += `<text x="${x(p.i)}" y="${y(p.level) + 5}" font-size="14" text-anchor="middle">🔥</text>`;
    } else {
      svg += `<circle cx="${x(p.i)}" cy="${y(p.level)}" r="4.5" fill="${cLine}" stroke="${cCard}" stroke-width="1.5"/>`;
    }
    svg += `<circle class="chart-dot" ${attr} cx="${x(p.i)}" cy="${y(p.level)}" r="13" fill="transparent"/>`;
  });

  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      if (dot.dataset.ds !== undefined) {
        openDayModal(dot.dataset.ds);
      } else {
        // точка года ведёт в месячный вид этого месяца
        chartMonthY = chartYear;
        chartMonthM = Number(dot.dataset.month);
        setMoodRange('month');
      }
    });
  });
}

/* ---------- Переключатель периода графика ---------- */

function setMoodRange(range) {
  moodRange = range;
  document.querySelectorAll('#chart-range button').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  renderMoodChart();
}

document.querySelectorAll('#chart-range button').forEach(btn => {
  btn.addEventListener('click', () => setMoodRange(btn.dataset.range));
});

// листание периода: неделя ±7 дней, месяц ±1, год ±1
function shiftChartPeriod(dir) {
  if (moodRange === 'week') {
    chartWeekStart = new Date(chartWeekStart.getFullYear(), chartWeekStart.getMonth(), chartWeekStart.getDate() + dir * 7);
  } else if (moodRange === 'month') {
    chartMonthM += dir;
    if (chartMonthM < 0) { chartMonthM = 11; chartMonthY--; }
    if (chartMonthM > 11) { chartMonthM = 0; chartMonthY++; }
  } else {
    chartYear += dir;
  }
  renderMoodChart();
}

$('chart-prev').addEventListener('click', () => shiftChartPeriod(-1));
$('chart-next').addEventListener('click', () => shiftChartPeriod(1));

$('chart-today').addEventListener('click', () => {
  const now = new Date();
  chartWeekStart = mondayOf(now);
  chartMonthY = now.getFullYear();
  chartMonthM = now.getMonth();
  chartYear = now.getFullYear();
  renderMoodChart();
});

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

  renderNotifs();
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

/* ==================== Напоминания ==================== */

let editingNotifId = null;
let formNotifDays = [0, 1, 2, 3, 4, 5, 6];

function renderNotifs() {
  // баннер запроса разрешения
  const supported = 'Notification' in window;
  $('notif-permission').classList.toggle('hidden', !supported || Notification.permission === 'granted');

  // предустановленное: время отхода ко сну
  if (document.activeElement !== $('bedtime-input')) {
    $('bedtime-input').value = data.notifs.bedtime.time;
  }

  // свои напоминания
  const list = $('notif-list');
  list.innerHTML = '';
  data.notifs.custom.forEach(n => {
    const card = document.createElement('div');
    card.className = 'habit-card';
    card.innerHTML = `
      <div class="habit-emoji" style="background:#0ea5e922">⏰</div>
      <div class="habit-info">
        <div class="habit-name"></div>
        <div class="habit-meta">${n.time} · ${daysLabel(n.days)}</div>
      </div>
      <button class="icon-btn edit-btn" aria-label="Редактировать">✏️</button>
      <button class="icon-btn del-btn" aria-label="Удалить">🗑️</button>
    `;
    card.querySelector('.habit-name').textContent = n.title;
    card.querySelector('.edit-btn').addEventListener('click', () => openNotifModal(n.id));
    card.querySelector('.del-btn').addEventListener('click', () => {
      if (confirm(`Удалить напоминание «${n.title}»?`)) {
        data.notifs.custom = data.notifs.custom.filter(x => x.id !== n.id);
        saveData();
        renderNotifs();
        schedulePushSync();
      }
    });
    list.appendChild(card);
  });
}

$('bedtime-input').addEventListener('change', () => {
  const v = $('bedtime-input').value;
  if (/^\d{2}:\d{2}$/.test(v)) {
    data.notifs.bedtime.time = v;
    saveData();
    schedulePushSync();
  }
});

$('btn-notif-permission').addEventListener('click', () => {
  Notification.requestPermission().then(() => {
    renderNotifs();
    syncPushSubscription();
  });
});

/* ---------- Модалка своего напоминания ---------- */

$('btn-add-notif').addEventListener('click', () => openNotifModal(null));

function openNotifModal(notifId) {
  editingNotifId = notifId;
  const n = notifId ? data.notifs.custom.find(x => x.id === notifId) : null;
  $('notif-modal-title').textContent = n ? 'Редактировать напоминание' : 'Новое напоминание';
  $('notif-text').value = n ? n.title : '';
  $('notif-time').value = n ? n.time : '09:00';
  formNotifDays = n ? [...n.days] : [0, 1, 2, 3, 4, 5, 6];
  renderNotifDaysPicker();
  $('notif-modal').classList.remove('hidden');
  if (!n) $('notif-text').focus();
}

function renderNotifDaysPicker() {
  const box = $('notif-days-picker');
  box.innerHTML = '';
  DAY_ORDER.forEach((dayVal, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-option' + (formNotifDays.includes(dayVal) ? ' selected' : '');
    btn.textContent = DAY_LABELS[i];
    btn.addEventListener('click', () => {
      if (formNotifDays.includes(dayVal)) {
        formNotifDays = formNotifDays.filter(d => d !== dayVal);
      } else {
        formNotifDays.push(dayVal);
      }
      renderNotifDaysPicker();
    });
    box.appendChild(btn);
  });
}

$('notif-all-days').addEventListener('click', () => {
  formNotifDays = [0, 1, 2, 3, 4, 5, 6];
  renderNotifDaysPicker();
});

$('notif-cancel').addEventListener('click', () => $('notif-modal').classList.add('hidden'));

$('notif-save').addEventListener('click', () => {
  const title = $('notif-text').value.trim();
  const time = $('notif-time').value;
  if (!title) {
    $('notif-text').focus();
    $('notif-text').placeholder = 'Введите текст!';
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    alert('Укажите время напоминания');
    return;
  }
  if (formNotifDays.length === 0) {
    alert('Выберите хотя бы один день недели');
    return;
  }

  if (editingNotifId) {
    const n = data.notifs.custom.find(x => x.id === editingNotifId);
    n.title = title;
    n.time = time;
    n.days = [...formNotifDays];
  } else {
    data.notifs.custom.push({
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 7),
      title,
      time,
      days: [...formNotifDays],
    });
  }
  saveData();
  $('notif-modal').classList.add('hidden');
  renderNotifs();
  schedulePushSync();
});

/* ---------- Планировщик уведомлений ---------- */

const NOTIF_SHOWN_KEY = 'habitNotifShown'; // { ключ: 'YYYY-MM-DD' } — показано в этот день

function showAppNotification(title, body, tag) {
  const opts = { body, icon: 'icon-push.png', badge: 'icon-push.png', tag };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(() => { try { new Notification(title, opts); } catch (e) {} });
  } else {
    try { new Notification(title, opts); } catch (e) {}
  }
}

function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ds = todayStr();
  let shown = {};
  try { shown = JSON.parse(localStorage.getItem(NOTIF_SHOWN_KEY) || '{}'); } catch (e) {}

  const fire = (key, title, body) => {
    if (shown[key] === ds) return; // уже показывали сегодня
    shown[key] = ds;
    localStorage.setItem(NOTIF_SHOWN_KEY, JSON.stringify(shown));
    showAppNotification(title, body, key);
  };

  // вопрос о настроении в час отхода ко сну — если настроение ещё не отмечено
  const mood = getMood(ds);
  if (hm >= data.notifs.bedtime.time && !(mood && mood.level)) {
    fire('mood', 'Какое у тебя сегодня настроение?', 'Отметь настроение перед сном 🌙');
  }

  // свои напоминания — в выбранные дни недели
  data.notifs.custom.forEach(n => {
    if (n.days.includes(now.getDay()) && hm >= n.time) {
      fire(n.id, n.title, `Запланировано на ${n.time}`);
    }
  });
}

setInterval(checkNotifications, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkNotifications();
});

/* ---------- Web Push: настоящие уведомления при закрытом приложении ---------- */

const PUSH_SERVER = 'https://habit-push.luiccio.workers.dev';
const VAPID_PUBLIC_KEY = 'BDYWJKt4wjCuG6fGMe750v9FYKGLPhKwrpbHp9KQgOUY4zzkIrWw8lMWq-BELk-rItBFZB6OyRJp93Gs3t98Qt4';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Подписывается на push и отправляет серверу расписание напоминаний.
// Вызывается при любом изменении настроек и раз при запуске.
async function syncPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const mood = getMood(todayStr());
    await fetch(PUSH_SERVER + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        schedule: { bedtime: data.notifs.bedtime.time, custom: data.notifs.custom },
        tz: new Date().getTimezoneOffset(),
        moodDate: mood && mood.level ? todayStr() : null, // чтобы сервер не спрашивал зря
      }),
    });
  } catch (e) {
    console.warn('Не удалось синхронизировать push-подписку:', e);
  }
}

const schedulePushSync = debounce(syncPushSubscription, 1500);

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
      migrateNotifs(imported);
      migrateMoodScale(imported); // старые бэкапы со шкалой 1..5
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

/* ==================== Тема ==================== */

const THEME_KEY = 'habitTheme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0e0d14' : '#f4f5f7';
}

$('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  render(); // график перерисовывается в цветах новой темы
});

// тема уже применена инлайн-скриптом в <head>; синхронизируем иконку и статус-бар
applyTheme(document.documentElement.dataset.theme || 'light');

initCalendar();
applyTrackPosition(false);
render();
checkNotifications();
syncPushSubscription();

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

// Регистрация service worker для офлайн-режима (PWA);
// updateViaCache: 'none' — проверять обновления sw.js всегда с сервера
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err =>
    console.warn('Service worker не зарегистрирован:', err));
}
