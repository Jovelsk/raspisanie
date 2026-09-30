(function () {
    "use strict";

    var DATA = window.MPTData;
    if (!DATA) return;

    var DAYS = DATA.DAYS;
    var DAYS_INFO = DATA.DAYS_INFO;
    var WEEK_W1 = DATA.WEEK_W1;
    var WEEK_W2 = DATA.WEEK_W2;
    var PAIR_TIMES = DATA.PAIR_TIMES;
    var SCHEDULE = DATA.SCHEDULE;

    var SHORT_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    var MONTHS_GEN = [
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря"
    ];
    var MONTHS_NOM = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];

    var STORE_KEY = "mpt-diary-grades-v2";
    var OLD_KEY = "mpt-diary-grades-v1";
    var MODE_KEY = "mpt-diary-mode";

    var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // Оценки: { "2026-09-14": { "ПН": { "1": "5", "3": "н" } } }
    var grades = {};

    var viewMonday = null;      // понедельник недели-якоря
    var viewMode = "week";      // "week" | "month" | "year"
    var yearSem = 1;            // выбранный семестр в режиме "year" (1 | 2)

    var monthSubjW = null;      // ширина колонки «Предмет» в месяце (px), эталон для года

    // ——————————————————————————————————
    // РАБОТА С ДАТАМИ
    // ——————————————————————————————————

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function fmtDay(d) {
        return pad(d.getDate()) + "." + pad(d.getMonth() + 1);
    }

    // Полная дата: «Чт, 17.09.2026»
    function fmtLong(d) {
        return DAYS[d.getDay() - 1] + ", " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
    }

    // Английский не разбиваем по преподавателям
    function isEnglishSubj(s) {
        return /\bИностран\b/i.test(s);
    }

    var GROUP_LETTERS = ["а", "б", "в", "г", "д", "е"];

    function groupLetter(i) {
        return GROUP_LETTERS[i] !== undefined ? GROUP_LETTERS[i] : "";
    }

    // Ключ группы предмет+преподаватель (английский — единая группа)
    function groupKey(subj, teacher) {
        return subj + "|" + (isEnglishSubj(subj) ? "" : teacher);
    }

    // Дата, которую показывает поле-календарь для текущего вида:
    // сегодня — если оно в отображаемом периоде, иначе начало периода
    function viewPickDate() {
        var n = new Date();
        if (viewMode === "week") {
            var mon = isoWeekMonday(viewMonday);
            return (n >= mon && n < addDays(mon, 7)) ? n : mon;
        }
        if (viewMode === "month") {
            var s = new Date(viewMonday.getFullYear(), viewMonday.getMonth(), 1);
            return (n >= s && n < new Date(viewMonday.getFullYear(), viewMonday.getMonth() + 1, 1)) ? n : s;
        }
        // год: начало выбранного семестра (1-й — 1 сентября, 2-й — 1 января)
        return (yearSem === 2)
            ? new Date(viewMonday.getFullYear(), 0, 1)
            : new Date(viewMonday.getFullYear() - 1, 8, 1);
    }

    function syncPicker() {
        var picker = document.getElementById("diary-picker");
        if (picker) picker.value = mondayIso(viewPickDate());
    }

    // Подсказка с датой оценки (в году); клик по ней открывает неделю на этой дате
    var dateTip = null;
    function showDateTip(el, iso) {
        hideDateTip();
        var d = parseIso(iso);
        if (!d) return;
        dateTip = document.createElement("button");
        dateTip.type = "button";
        dateTip.className = "grade-pop ytip";
        dateTip.textContent = fmtLong(d) + " \u2192";
        dateTip.addEventListener("click", function () {
            viewMonday = isoWeekMonday(d);
            hideDateTip();
            setMode("week");
        });
        document.body.appendChild(dateTip);
        var r = el.getBoundingClientRect();
        var left = r.left + r.width / 2 - dateTip.offsetWidth / 2;
        var top = r.bottom + 6;
        if (left < 8) left = 8;
        if (left + dateTip.offsetWidth > window.innerWidth) left = window.innerWidth - dateTip.offsetWidth - 8;
        dateTip.style.left = left + "px";
        dateTip.style.top = top + "px";
    }
    function hideDateTip() {
        if (dateTip) { dateTip.remove(); dateTip = null; }
    }

    // Своё окно подтверждения вместо window.confirm
    var confirmOverlay = null;
    function confirmPopup(message, okText, cb) {
        if (confirmOverlay) { confirmOverlay.remove(); confirmOverlay = null; }
        var overlay = document.createElement("div");
        overlay.className = "c-overlay";
        var box = document.createElement("div");
        box.className = "c-box";
        box.innerHTML =
            '<p class="c-msg"></p>' +
            '<div class="c-btns">' +
            '<button type="button" class="c-ok"></button>' +
            '<button type="button" class="c-no">Отмена</button>' +
            "</div>";
        box.querySelector(".c-msg").textContent = message;
        box.querySelector(".c-ok").textContent = okText;
        var okBtn = box.querySelector(".c-ok");
        var noBtn = box.querySelector(".c-no");
        function close() {
            overlay.remove();
            confirmOverlay = null;
        }
        okBtn.addEventListener("click", function () { close(); cb(true); });
        noBtn.addEventListener("click", function () { close(); cb(false); });
        overlay.addEventListener("click", function (ev) {
            if (ev.target === overlay) { close(); cb(false); }
        });
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        confirmOverlay = overlay;
        okBtn.focus();
    }

    function mondayIso(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function parseIso(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3]);
    }

    function addDays(d, n) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    }

    function isSameDate(a, b) {
        return a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();
    }

    function isoWeekMonday(date) {
        var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var day = d.getDay() || 7;
        var thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 4 - day);
        return new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate() - 3);
    }

    // Понедельник, гарантированно лежащий внутри месяца (якорь — 15-е число)
    function monthMonday(y, m) {
        return isoWeekMonday(new Date(y, m, 15));
    }

    function weekDiff(a, b) {
        return Math.round((b - a) / WEEK_MS);
    }

    // ——————————————————————————————————
    // УЧЕБНЫЙ ГОД: 1 сентября, летом каникулы
    // ——————————————————————————————————

    function schoolYearStart(date) {
        var year = date.getFullYear();
        if (date.getMonth() < 8) year -= 1;
        return new Date(year, 8, 1);
    }

    function firstWeekMonday(date) {
        return isoWeekMonday(schoolYearStart(date));
    }

    function weekNoFromYear(monday) {
        var ref = addDays(monday, 3);
        return weekDiff(firstWeekMonday(ref), monday) + 1;
    }

    // Первая неделя учебного года — числитель, дальше чередуются
    function viewParity() {
        var w = weekNoFromYear(viewMonday);
        return (w % 2 === 1) ? WEEK_W1 : WEEK_W2;
    }

    function isSummerMonday(monday) {
        var m = monday.getMonth();
        if (m !== 6 && m !== 7) return false;
        var sep = new Date(monday.getFullYear(), 8, 1);
        var end = addDays(monday, 6);
        return !(sep >= monday && sep <= end);
    }

    function isSummerMonth(m) {
        return (m === 6 || m === 7);
    }

    // Учёба идёт с 1 сентября по июнь
    function dayActive(d) {
        return !isSummerMonth(d.getMonth());
    }

    // Год окончания текущего учебного года: с 1 сентября — следующий календарный год
    function schoolYearEnd(d) {
        return d.getFullYear() + (d.getMonth() >= 8 ? 1 : 0);
    }

    function weekKey(monday) {
        return mondayIso(monday);
    }

    function fmtShort(d) {
        return d.getDate() + " " + MONTHS_GEN[d.getMonth()];
    }

    // ——————————————————————————————————
    // ХРАНИЛИЩЕ
    // ——————————————————————————————————

    function load() {
        viewMonday = isoWeekMonday(new Date());
        try {
            grades = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        } catch (e) {
            grades = {};
        }
        migrateOld();
    }

    function migrateOld() {
        if (Object.keys(grades).length > 0) return;
        try {
            var raw = localStorage.getItem(OLD_KEY);
            if (!raw) return;
            var old = JSON.parse(raw);
            var curKey = weekKey(viewMonday);
            var nextKey = weekKey(addDays(viewMonday, 7));
            var curParity = viewParity();
            var otherParity = (curParity === WEEK_W1) ? WEEK_W2 : WEEK_W1;
            var cur = old[curParity];
            var other = old[otherParity];
            if (cur && Object.keys(cur).length) grades[curKey] = cur;
            if (other && Object.keys(other).length) grades[nextKey] = other;
            saveGrades();
        } catch (e) { /* ignore */ }
    }

    function saveGrades() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(grades));
        } catch (e) { /* ignore */ }
    }

    function getGrade(day, pair) {
        var w = grades[weekKey(viewMonday)];
        return w && w[day] ? (w[day][pair] || "") : "";
    }

    function setGrade(day, pair, val) {
        var key = weekKey(viewMonday);
        var w = grades[key] || (grades[key] = {});
        var d = w[day] || (w[day] = {});
        if (val) d[pair] = val;
        else delete d[pair];
        saveGrades();
    }

    function setGradeForDate(date, pair, val) {
        var key = weekKey(isoWeekMonday(date));
        var dayKey = DAYS[date.getDay() - 1];
        var w = grades[key] || (grades[key] = {});
        var d = w[dayKey] || (w[dayKey] = {});
        if (val) d[pair] = val;
        else delete d[pair];
        saveGrades();
    }

    // Все отметки за дату (по всем парам), отсортированные по номеру пары
    function gradesForDay(date) {
        var ws = grades[weekKey(isoWeekMonday(date))];
        if (!ws) return [];
        var dayKey = DAYS[date.getDay() - 1];
        if (!dayKey || !ws[dayKey]) return [];
        var pairs = ws[dayKey];
        var keys = Object.keys(pairs).sort(function (a, b) { return +a - +b; });
        var out = [];
        for (var i = 0; i < keys.length; i++) out.push(pairs[keys[i]]);
        return out;
    }

    function markCls(grade) {
        if (grade === "н") return "gn";
        if (grade === "б") return "gb";
        if (grade === "2" || grade === "3" || grade === "4" || grade === "5") return "g" + grade;
        return "empty";
    }

    // ——————————————————————————————————
    // РЕНДЕРИНГ
    // ——————————————————————————————————

    function renderWeekTable() {
        var table = document.getElementById("diary-table");
        if (!table) return;

        var now = new Date();
        var parity = viewParity();
        var fillWeek = (parity === WEEK_W1) ? "w1" : "w2";
        var html = "";

        html += "<thead><tr><th class=\"pair-th\">Пара<br>время</th>";
        for (var di = 0; di < DAYS.length; di++) {
            var d = addDays(viewMonday, di);
            var isToday = isSameDate(d, now);
            html += '<th class="day-th' + (isToday ? " today" : "") + '">' +
                '<span class="day-name">' + SHORT_DAYS[di] + '</span>' +
                '<span class="day-date' + (isToday ? " today" : "") + '">' + fmtDay(d) + "</span></th>";
        }
        html += "</tr></thead><tbody>";

        for (var p = 1; p <= 5; p++) {
            html += "<tr><td class=\"pair-th\">" +
                '<span class="pair-num">' + p + '</span><span class="pair-time">' +
                (PAIR_TIMES[p] || "") + "</span></td>";

            for (var dIdx = 0; dIdx < DAYS.length; dIdx++) {
                var key = DAYS[dIdx];
                var lessons = SCHEDULE[key] || [];
                var td = addDays(viewMonday, dIdx);
                var isTodayCol = isSameDate(td, now);
                var tdClass = isTodayCol ? "d-cell today" : "d-cell";

                if (!dayActive(td)) {
                    html += '<td class="' + tdClass + '"><span class="d-none">—</span></td>';
                    continue;
                }

                if (lessons.length === 0) {
                    html += '<td class="' + tdClass + ' d-off"><span class="d-none">—</span></td>';
                    continue;
                }

                var lesson = null;
                var absent = false;

                for (var i = 0; i < lessons.length; i++) {
                    var it = lessons[i];
                    if (it.pair !== p) continue;
                    if (it.absent) {
                        if (it.absent === parity) absent = true;
                    } else if (!it.week || it.week === parity) {
                        lesson = it;
                    }
                }

                if (absent) {
                    html += '<td class="' + tdClass + ' ' + fillWeek + '"><span class="d-none ' + fillWeek + '">нет пары</span></td>';
                } else if (!lesson) {
                    html += '<td class="' + tdClass + '"><span class="d-none">—</span></td>';
                } else {
                    var weekCls = lesson.week ? (lesson.week === WEEK_W1 ? "w1" : "w2") : "";
                    var grade = getGrade(key, p);
                    html += '<td class="' + tdClass + (weekCls ? " " + weekCls : "") + '">';
                    html += '<span class="d-subj">' + lesson.subj + "</span>";
                    html += '<span class="d-teacher">' + (lesson.teacher || "—") + "</span>";
                    html += '<button type="button" class="d-mark ' + markCls(grade) + '"' +
                        ' data-day="' + key + '" data-pair="' + p + '" data-g="' + grade + '">' +
                        (grade || "+") + "</button>";
                    html += "</td>";
                }
            }

            html += "</tr>";
        }

        html += "</tbody>";
        table.innerHTML = html;
    }

    // Чётность недели конкретной даты
    function dateParity(d) {
        var w = weekNoFromYear(isoWeekMonday(d));
        return (w % 2 === 1) ? WEEK_W1 : WEEK_W2;
    }

    // Расписание конкретной даты (с учётом чётности её недели):
    // [{ pair, subj, weekCls }] + "нет пары" как subj === null
    function lessonsForDate(d) {
        var key = DAYS[d.getDay() - 1];
        if (!key) return [];
        var lessons = SCHEDULE[key] || [];
        if (lessons.length === 0) return [];
        var parity = dateParity(d);
        var out = [];
        for (var p = 1; p <= 5; p++) {
            var lesson = null;
            var absent = false;
            for (var i = 0; i < lessons.length; i++) {
                var it = lessons[i];
                if (it.pair !== p) continue;
                if (it.absent) {
                    if (it.absent === parity) absent = true;
                } else if (!it.week || it.week === parity) {
                    lesson = it;
                }
            }
            if (lesson) {
                out.push({
                    pair: p,
                    subj: lesson.subj,
                    weekCls: lesson.week ? (lesson.week === WEEK_W1 ? "w1" : "w2") : "",
                    teacher: lesson.teacher || ""
                });
            } else if (absent) {
                out.push({ pair: p, subj: null });
            }
        }
        return out;
    }

    // Отметки за дату по номерам пар: { "1": "5", ... }
    function gradesMapForDate(date) {
        var ws = grades[weekKey(isoWeekMonday(date))];
        var dayKey = DAYS[date.getDay() - 1];
        if (!ws || !dayKey || !ws[dayKey]) return {};
        return ws[dayKey];
    }

    // Сколько «н» и «б» за диапазон дат
    function countMarksRange(start, end) {
        var out = { absent: 0, ill: 0 };
        for (var d = start; d <= end; d = addDays(d, 1)) {
            var lessons = lessonsForDate(d);
            if (lessons.length === 0) continue;
            var gm = gradesMapForDate(d);
            for (var i = 0; i < lessons.length; i++) {
                if (!lessons[i].subj) continue;
                var g = gm[lessons[i].pair];
                if (g === "н") out.absent++;
                else if (g === "б") out.ill++;
            }
        }
        return out;
    }

    function renderMonthTable() {
        var table = document.getElementById("diary-month-table");
        if (!table) return;

        var y = viewMonday.getFullYear();
        var m = viewMonday.getMonth();
        var last = new Date(y, m + 1, 0).getDate();
        var now = new Date();

        // Дни месяца с занятиями (или хотя бы с отметкой)
        var days = [];
        var groups = [];
        var cellMarks = {};   // день -> { groupKey: [ {pair, grade} ] }

        for (var day = 1; day <= last; day++) {
            var date = new Date(y, m, day);
            var lessons = lessonsForDate(date);
            var gmap = gradesMapForDate(date);
            var gCount = 0;
            for (var gk in gmap) if (gmap.hasOwnProperty(gk)) gCount++;

            if (lessons.length === 0 && gCount === 0) continue;

            var marks = {};
            for (var li = 0; li < lessons.length; li++) {
                var ls = lessons[li];
                if (!ls.subj) continue;
                var key = groupKey(ls.subj, ls.teacher);
                if (groups.indexOf(key) === -1) groups.push(key);
                (marks[key] = marks[key] || []).push({
                    pair: ls.pair,
                    grade: gmap[ls.pair] || ""
                });
            }
            cellMarks[day] = marks;
            days.push({ day: day, date: date, lessons: lessons });
        }

        // Сортировка групп: предмет, затем преподаватель
        groups.sort(function (a, b) {
            var sa = a.slice(0, a.lastIndexOf("|")), sb = b.slice(0, b.lastIndexOf("|"));
            var ta = a.slice(a.lastIndexOf("|") + 1), tb = b.slice(b.lastIndexOf("|") + 1);
            if (sa !== sb) return sa < sb ? -1 : 1;
            return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        var groupInfo = [];
        for (var gi = 0; gi < groups.length; gi++) {
            var cut = groups[gi].lastIndexOf("|");
            groupInfo.push({ subj: groups[gi].slice(0, cut), teacher: groups[gi].slice(cut + 1) });
        }
        var numInfo = numbering(groupInfo);
        var nums = numInfo.nums;
        var multi = numInfo.multi;

        var html = "<thead><tr><th class=\"ms-num-th\">№</th><th class=\"ms-subj-th\">Предмет</th>";
        for (var di = 0; di < days.length; di++) {
            var dayInfo = days[di];
            var isToday = isSameDate(dayInfo.date, now);
            html += '<th' + ' class="ms-day-th' + (isToday ? " today" : "") + '"' +
                ' data-jump-day="' + mondayIso(dayInfo.date) + '">';
            html += '<span class="ms-day-num">' + dayInfo.day + "</span>" +
                '<span class="ms-day-wd">' + SHORT_DAYS[dayInfo.date.getDay() - 1] + "</span>";
            html += "</th>";
        }
        html += "</tr></thead><tbody>";

        for (var ri = 0; ri < groups.length; ri++) {
            var key = groups[ri];
            var info = groupInfo[ri];
            html += '<tr><td class="ms-num">' + nums[ri] + "</td>" +
                '<td class="ms-subj-th">' + (multi[ri] ? info.subj + " (" + info.teacher + ")" : info.subj) + "</td>";
            for (var dj = 0; dj < days.length; dj++) {
                var day2 = days[dj];
                var marks2 = cellMarks[day2.day] && cellMarks[day2.day][key];
                var isTodayCol = isSameDate(day2.date, now);
                html += '<td class="ms-cell' + (isTodayCol ? " today" : "") + '">';
                if (marks2 && marks2.length) {
                    html += '<span class="ms-marks">';
                    for (var mj = 0; mj < marks2.length; mj++) {
                        var g = marks2[mj].grade;
                        html += '<button type="button" class="d-mark ' + markCls(g) + '"' +
                            ' data-date="' + mondayIso(day2.date) + '" data-pair="' + marks2[mj].pair + '">' +
                            (g || "+") + "</button>";
                    }
                    html += "</span>";
                }
                html += "</td>";
            }
            html += "</tr>";
        }

        html += "</tbody>";
        table.innerHTML = html;
        if (!monthSubjW) measureMonthSubjW();
        pinSubjWidth(table, monthSubjW);
    }

    // Оценки предметов за диапазон дат, сгруппированные по преподавателям
    function subjectGradesForRange(start, end) {
        var gradesByKey = {};
        var datesByKey = {};
        var subjKeys = {};
        for (var d = start; d <= end; d = addDays(d, 1)) {
            var lessons = lessonsForDate(d);
            if (lessons.length === 0) continue;
            var gmap = gradesMapForDate(d);
            for (var i = 0; i < lessons.length; i++) {
                var ls = lessons[i];
                if (!ls.subj) continue;
                var key = groupKey(ls.subj, ls.teacher);
                if (subjKeys[ls.subj] === undefined) subjKeys[ls.subj] = [];
                if (subjKeys[ls.subj].indexOf(key) === -1) subjKeys[ls.subj].push(key);
                if (gradesByKey[key] === undefined) {
                    gradesByKey[key] = [];
                    datesByKey[key] = [];
                }
                var g = gmap[ls.pair];
                if (g) {
                    gradesByKey[key].push(g);
                    datesByKey[key].push(d);
                }
            }
        }
        var groups = [];
        for (var subj in subjKeys) {
            var ks = subjKeys[subj].sort();
            for (var ki = 0; ki < ks.length; ki++) {
                groups.push({
                    subj: subj,
                    teacher: ks[ki].slice(subj.length + 1),
                    grades: gradesByKey[ks[ki]],
                    dates: datesByKey[ks[ki]]
                });
            }
        }
        groups.sort(function (a, b) {
            if (a.subj !== b.subj) return a.subj < b.subj ? -1 : 1;
            return (a.teacher || "") < (b.teacher || "") ? -1 : (a.teacher || "") > (b.teacher || "") ? 1 : 0;
        });
        return { groups: groups };
    }

    // Нумерование групп: предмет целиком — №, разбитый — «1а», «1б» и т.д.
    function numbering(groups) {
        var nums = [];
        var multi = [];
        var i = 0;
        var subjNo = 0;
        while (i < groups.length) {
            var subj = groups[i].subj;
            var j = i;
            while (j < groups.length && groups[j].subj === subj) j++;
            subjNo++;
            var isMulti = (j - i) > 1;
            if (!isMulti) {
                nums.push(String(subjNo));
            } else {
                for (var k = i; k < j; k++) nums.push(String(subjNo) + groupLetter(k - i));
            }
            for (var z = i; z < j; z++) multi.push(isMulti);
            i = j;
        }
        return { nums: nums, multi: multi };
    }

    function avgOf(grades) {
        var sum = 0, n = 0;
        for (var i = 0; i < grades.length; i++) {
            var v = +grades[i];
            if (v >= 2 && v <= 5) { sum += v; n++; }
        }
        return n ? sum / n : null;
    }

    function countGrade(grades, v) {
        var c = 0;
        for (var i = 0; i < grades.length; i++) if (grades[i] === v) c++;
        return c;
    }

    function absenceCount(grades) {
        return countGrade(grades, "н");
    }

    function illnessCount(grades) {
        return countGrade(grades, "б");
    }

    // Пиксельная ширина колонки «Предмет» из месячной таблицы (год должен совпадать 1:1).
    // max-width на ячейках таблицы браузер игнорирует, поэтому замеряем реальное значение.
    function measureMonthSubjW() {
        var table = document.getElementById("diary-month-table");
        if (!table) return;
        var el = table.querySelector(".ms-subj-th");
        if (!el) {
            renderMonthTable();
            el = table.querySelector(".ms-subj-th");
        }
        if (!el) return;
        var card = document.getElementById("diary-month-card");
        var rehide = !!(card && card.classList.contains("hidden"));
        if (rehide) card.classList.remove("hidden");
        var r = el.getBoundingClientRect();
        if (r.width > 0) monthSubjW = r.width;
        if (rehide) card.classList.add("hidden");
    }
        function pinSubjWidth(tableEl, w) {
        if (!tableEl || !w) return;
        var cells = tableEl.querySelectorAll(".ms-subj-th");
        for (var i = 0; i < cells.length; i++) {
            cells[i].style.width = w + "px";
            cells[i].style.maxWidth = w + "px";
            cells[i].style.minWidth = w + "px";
        }
    }

    function renderYearTable() {
        measureMonthSubjW();

        var table = document.getElementById("diary-year-table");
        if (!table) return;

        var y = viewMonday.getFullYear();
        // Семестр 1: сентябрь (y-1) — декабрь (y-1); семестр 2: январь y — июнь y
        var rng = (yearSem === 1)
            ? subjectGradesForRange(new Date(y - 1, 8, 1), new Date(y - 1, 11, 31))
            : subjectGradesForRange(new Date(y, 0, 1), new Date(y, 5, 30));
        var groups = rng.groups;
        var numInfo = numbering(groups);
        var nums = numInfo.nums;
        var multi = numInfo.multi;

        var html = "<thead><tr>" +
            '<th class="ms-num-th">№</th>' +
            '<th class="ms-subj-th">Предмет</th>' +
            '<th class="ys-grades-th">Оценки</th>' +
            '<th class="ys-stat-th">Средний балл</th>' +
            '<th class="ys-stat-th">Пропуски</th>' +
            '<th class="ys-stat-th">По болезни</th>' +
            "</tr></thead><tbody>";

        for (var i = 0; i < groups.length; i++) {
            var gr = groups[i];
            var gs = gr.grades;
            var avg = avgOf(gs);
            html += '<tr><td class="ms-num">' + nums[i] + "</td>" +
                '<td class="ms-subj-th">' + (multi[i] ? gr.subj + " (" + gr.teacher + ")" : gr.subj) + "</td>" +
                '<td class="ys-grades"><span class="ms-marks">';
            for (var j = 0; j < gs.length; j++) {
                var dj = gr.dates[j];
                html += '<span class="d-mark ' + markCls(gs[j]) + '"' +
                    ' data-date="' + (dj ? mondayIso(dj) : "") + '">' + gs[j] + "</span>";
            }
            html += "</span></td>" +
                '<td class="ys-stat">' + (avg === null ? "—" : avg.toFixed(2).replace(".", ",")) + "</td>" +
                '<td class="ys-stat">' + absenceCount(gs) + "</td>" +
                '<td class="ys-stat">' + illnessCount(gs) + "</td></tr>";
        }

        html += "</tbody>";
        table.innerHTML = html;

        // Зафиксировать ширину предмета как в месяце (иначе авто-layout растянет её)
        pinSubjWidth(table, monthSubjW || 200);
    }

    function render() {
        var summerWeek = isSummerMonday(viewMonday);
        var summerMonth = (viewMode === "month") && !summerWeek && isSummerMonth(viewMonday.getMonth());
        var showSummer = (viewMode === "week" && summerWeek) || summerMonth;

        var titleEl = document.getElementById("diary-week-no");
        if (titleEl) {
            if (viewMode === "week") {
                titleEl.textContent = summerWeek ? "Летние каникулы" : "Неделя " + pad(weekNoFromYear(viewMonday));
            } else if (viewMode === "month") {
                titleEl.textContent = showSummer ? "Летние каникулы" :
                    MONTHS_NOM[viewMonday.getMonth()] + " " + viewMonday.getFullYear();
            } else {
                var yEnd = viewMonday.getFullYear();
                titleEl.textContent = (yEnd - 1) + "-" + yEnd + " уч. год";
            }
        }

        var parityEl = document.getElementById("diary-parity");
        if (parityEl) {
            if (viewMode === "week" && !summerWeek) {
                parityEl.style.display = "";
                var parity = viewParity();
                parityEl.textContent = parity;
                parityEl.className = "parity-chip " + (parity === WEEK_W1 ? "w1" : "w2");
            } else {
                parityEl.style.display = "none";
            }
        }

        var rangeEl = document.getElementById("diary-week-range");
        if (rangeEl) {
            if (viewMode === "week") {
                rangeEl.style.display = "";
                var d0 = viewMonday;
                var d5 = addDays(viewMonday, 5);
                rangeEl.textContent = (d0.getMonth() === d5.getMonth())
                    ? d0.getDate() + " – " + fmtShort(d5) + " " + d5.getFullYear()
                    : fmtShort(d0) + " – " + fmtShort(d5) + " " + d5.getFullYear();
            } else {
                rangeEl.style.display = "none";
                rangeEl.textContent = "";
            }
        }

        // Итоги по пропускам и болезням за отображаемый период
        var stAbs = document.getElementById("stat-absent");
        var stIll = document.getElementById("stat-ill");
        if (stAbs || stIll) {
            var st;
            if (viewMode === "week") {
                st = countMarksRange(viewMonday, addDays(viewMonday, 6));
            } else if (viewMode === "month") {
                st = countMarksRange(new Date(viewMonday.getFullYear(), viewMonday.getMonth(), 1),
                    new Date(viewMonday.getFullYear(), viewMonday.getMonth() + 1, 0));
            } else {
                var sy = viewMonday.getFullYear();
                var sr = (yearSem === 1)
                    ? countMarksRange(new Date(sy - 1, 8, 1), new Date(sy - 1, 11, 31))
                    : countMarksRange(new Date(sy, 0, 1), new Date(sy, 5, 30));
                st = sr;
            }
            if (stAbs) stAbs.textContent = st.absent;
            if (stIll) stIll.textContent = st.ill;
        }

        var weekCard = document.getElementById("diary-week-card");
        var monthCard = document.getElementById("diary-month-card");
        var yearCard = document.getElementById("diary-year-card");
        var summerCard = document.getElementById("diary-summer");
        if (weekCard) weekCard.classList.toggle("hidden", !(viewMode === "week") || showSummer);
        if (monthCard) monthCard.classList.toggle("hidden", !(viewMode === "month") || showSummer);
        if (yearCard) yearCard.classList.toggle("hidden", viewMode !== "year");
        if (summerCard) summerCard.classList.toggle("hidden", !showSummer);

        if (viewMode === "week" && !showSummer) renderWeekTable();
        if (viewMode === "month" && !showSummer) { renderMonthTable(); measureMonthSubjW(); }
        if (viewMode === "year") renderYearTable();
    }

    // ——————————————————————————————————
    // ПЛАВАЮЩИЙ ВЫБОР ОЦЕНКИ
    // ——————————————————————————————————
    var popover = document.createElement("div");
    popover.className = "grade-pop hidden";

    var gradeOpts = ["5", "4", "3", "2", "н", "б"];
    for (var gi = 0; gi < gradeOpts.length; gi++) {
        var gb = document.createElement("button");
        gb.type = "button";
        gb.className = "grade-opt";
        gb.setAttribute("data-grade", gradeOpts[gi]);
        gb.textContent = gradeOpts[gi];
        popover.appendChild(gb);
    }
    var clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "grade-opt grade-clear";
    clearBtn.setAttribute("data-grade", "");
    clearBtn.textContent = "×";
    popover.appendChild(clearBtn);

    var pickDate = null;
    var pickDay = null;
    var pickPair = null;

    function hidePicker() {
        pickDate = null;
        pickDay = null;
        pickPair = null;
        popover.classList.add("hidden");
    }

    function showPicker(btn) {
        popover.classList.remove("hidden");
        var rect = btn.getBoundingClientRect();
        var w = popover.offsetWidth;
        var h = popover.offsetHeight;
        var left = rect.left + rect.width / 2 - w / 2;
        var top = rect.bottom + 6;
        if (top + h > window.innerHeight - 6) top = rect.top - h - 6;
        left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
        popover.style.left = left + "px";
        popover.style.top = top + "px";
    }

    function onPopoverClick(ev) {
        var target = ev.target;
        if (!target.classList || !target.classList.contains("grade-opt")) return;
        if (pickDate) {
            setGradeForDate(pickDate, pickPair, target.getAttribute("data-grade"));
        } else if (pickDay) {
            setGrade(pickDay, pickPair, target.getAttribute("data-grade"));
        }
        hidePicker();
        render();
    }

    function setMode(mode) {
        viewMode = mode;
        try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
        var btns = document.querySelectorAll(".view-mode .mode-btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle("selected", btns[i].getAttribute("data-mode") === mode);
        }
        hidePicker();
        syncPicker();
        render();
    }

    // ——————————————————————————————————
    // УПРАВЛЕНИЕ ПЕРИОДОМ
    // ——————————————————————————————————

    function shiftAnchor(delta) {
        if (viewMode === "week") {
            viewMonday = addDays(viewMonday, 7 * delta);
        } else if (viewMode === "month") {
            viewMonday = monthMonday(viewMonday.getFullYear(), viewMonday.getMonth() + delta);
        } else {
            viewMonday = isoWeekMonday(new Date(viewMonday.getFullYear() + delta, 6, 1));
        }
        hidePicker();
        syncPicker();
        render();
    }

    function goToday() {
        var n = new Date();
        if (viewMode === "month") {
            viewMonday = monthMonday(n.getFullYear(), n.getMonth());
        } else if (viewMode === "year") {
            viewMonday = isoWeekMonday(new Date(schoolYearEnd(n), 6, 1));
            yearSem = (n.getMonth() >= 8) ? 1 : 2;
            syncSemButtons();
        } else {
            viewMonday = isoWeekMonday(n);
        }
        hidePicker();
        syncPicker();
        render();
    }

    // Надпись «1 семестр»/«2 семестр» в переключателе года
    function syncSemButtons() {
        var label = document.getElementById("sem-label");
        if (label) label.textContent = yearSem + " семестр";
    }

    function init() {
        load();

        // Восстановить вкладку неделя/месяц/год, но с сегодняшней датой
        var saved = "week";
        try { saved = localStorage.getItem(MODE_KEY) || "week"; } catch (e) {}
        if (saved !== "week" && saved !== "month" && saved !== "year") saved = "week";
        var n = new Date();
        if (saved === "month") {
            viewMonday = monthMonday(n.getFullYear(), n.getMonth());
        } else if (saved === "year") {
            viewMonday = isoWeekMonday(new Date(schoolYearEnd(n), 6, 1));
            yearSem = (n.getMonth() >= 8) ? 1 : 2;
            syncSemButtons();
        }
        viewMode = saved;
        var initBtns = document.querySelectorAll(".view-mode .mode-btn");
        for (var i = 0; i < initBtns.length; i++) {
            initBtns[i].classList.toggle("selected", initBtns[i].getAttribute("data-mode") === saved);
        }

        document.body.appendChild(popover);

        // Переход по клику в календарях (день → неделя, месяц → месяц)
        document.addEventListener("click", function (ev) {
            var t = ev.target;
            if (!t || !t.closest) return;

            var yMark = t.closest("#diary-year-table .d-mark");
            if (yMark) { showDateTip(yMark, yMark.getAttribute("data-date")); return; }
            hideDateTip();

            var dayEl = t.closest("[data-jump-day]");
            if (dayEl) {
                var d = parseIso(dayEl.getAttribute("data-jump-day"));
                if (d) {
                    viewMonday = isoWeekMonday(d);
                    setMode("week");
                }
                return;
            }

            var monEl = t.closest("[data-jump-month]");
            if (monEl) {
                var parts = monEl.getAttribute("data-jump-month").split("-");
                if (parts.length === 2) {
                    viewMonday = monthMonday(+parts[0], +parts[1] - 1);
                    setMode("month");
                }
                return;
            }
        });

        document.addEventListener("click", function (ev) {
            var t = ev.target;
            if (!popover.classList.contains("hidden") &&
                !popover.contains(t) &&
                !(t.classList && t.classList.contains("d-mark"))) {
                hidePicker();
            }
        });
        document.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape") hidePicker();
        });
        window.addEventListener("resize", hidePicker);
        document.addEventListener("scroll", hidePicker, true);

        var table = document.getElementById("diary-table");
        if (table) {
            table.addEventListener("click", function (ev) {
                var target = ev.target;
                if (target.classList && target.classList.contains("d-mark")) {
                    pickDate = null;
                    pickDay = target.getAttribute("data-day");
                    pickPair = target.getAttribute("data-pair");
                    showPicker(target);
                }
            });
        }

        var monthTable = document.getElementById("diary-month-table");
        if (monthTable) {
            monthTable.addEventListener("click", function (ev) {
                var target = ev.target;
                if (target.classList && target.classList.contains("d-mark")) {
                    var iso = target.getAttribute("data-date");
                    var pair = target.getAttribute("data-pair");
                    if (iso && pair) {
                        pickDate = parseIso(iso);
                        pickDay = DAYS[pickDate.getDay() - 1];
                        pickPair = pair;
                        showPicker(target);
                    }
                }
            });
        }

        popover.addEventListener("click", onPopoverClick);

        var modeBox = document.getElementById("view-mode");
        if (modeBox) {
            modeBox.addEventListener("click", function (ev) {
                var btn = ev.target.closest ? ev.target.closest(".mode-btn") : null;
                if (!btn) return;
                var m = btn.getAttribute("data-mode");
                if (m !== viewMode) {
                    // при переключении вкладки открываем текущий день/месяц/учебный год
                    var n = new Date();
                    if (m === "month") viewMonday = monthMonday(n.getFullYear(), n.getMonth());
                    else if (m === "year") {
                        viewMonday = isoWeekMonday(new Date(schoolYearEnd(n), 6, 1));
                        yearSem = (n.getMonth() >= 8) ? 1 : 2;
                        syncSemButtons();
                    }
                    else viewMonday = isoWeekMonday(n);
                }
                setMode(m);
            });
        }

        var prevBtn = document.getElementById("diary-prev");
        if (prevBtn) prevBtn.addEventListener("click", function () { shiftAnchor(-1); });

        var nextBtn = document.getElementById("diary-next");
        if (nextBtn) nextBtn.addEventListener("click", function () { shiftAnchor(1); });

        var todayBtn = document.getElementById("diary-today");
        if (todayBtn) todayBtn.addEventListener("click", goToday);

        var semPrev = document.getElementById("sem-prev");
        if (semPrev) semPrev.addEventListener("click", function () {
            yearSem = (yearSem === 1) ? 2 : 1;
            syncSemButtons();
            syncPicker();
            render();
        });

        var semNext = document.getElementById("sem-next");
        if (semNext) semNext.addEventListener("click", function () {
            yearSem = (yearSem === 1) ? 2 : 1;
            syncSemButtons();
            syncPicker();
            render();
        });

        var picker = document.getElementById("diary-picker");
        if (picker) {
            picker.addEventListener("change", function () {
                var d = parseIso(picker.value);
                if (!d) return;
                if (viewMode === "week") {
                    viewMonday = isoWeekMonday(d);
                } else if (viewMode === "month") {
                    viewMonday = monthMonday(d.getFullYear(), d.getMonth());
                } else {
                    viewMonday = isoWeekMonday(new Date(schoolYearEnd(d), 6, 1));
                }
                hidePicker();
                render();
            });
        }

        var resetBtn = document.getElementById("diary-reset");
        if (resetBtn) {
            resetBtn.addEventListener("click", function () {
                confirmPopup("Удалить все отметки за текущую неделю?", "Удалить", function (doReset) {
                    if (!doReset) return;
                    delete grades[weekKey(viewMonday)];
                    saveGrades();
                    render();
                });
            });
        }

        var picker0 = document.getElementById("diary-picker");
        if (picker0) picker0.value = mondayIso(new Date());
        render();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();