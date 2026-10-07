(function () {
    "use strict";

    var DATA = window.MPTData;
    if (!DATA) return;

    var DAYS = DATA.DAYS;
    var WEEK_W1 = DATA.WEEK_W1;
    var WEEK_W2 = DATA.WEEK_W2;
    var PAIR_TIMES = DATA.PAIR_TIMES;
    // Сетку пар не копируем: всегда читаем через DATA.scheduleForDate(date),
    // иначе снова получим пустую копию, если раскладка едет позже нас.

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
    var EXPORT_KEY = "mpt-diary-exported-at";
    var EXPORT_SNAP_KEY = "mpt-diary-exported-snapshot";

    var storageProblem = null;   // куда жаловаться, если запись не вышла
    var lastProblemText = ""; // одно и то же предупреждение повторяем не дважды

    function storageSay(text) {
        if (!storageProblem || text === lastProblemText) return;
        lastProblemText = text;
        storageProblem(text);
    }

    // Хранилище с резервной копией: та же схема, что в data.js, но свои данные
    function readStore() {
        var out = null;
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") out = parsed;
            }
        } catch (e) { /* нечитаемо — попробуем копию */ }
        if (out) return out;
        try {
            var rawB = window.localStorage.getItem(STORE_KEY + "-backup");
            if (rawB) {
                var parsedB = JSON.parse(rawB);
                if (parsedB && typeof parsedB === "object") {
                    storageSay("Отметки в основном хранилище не читаются — взяты из запасной копии.");
                    return parsedB;
                }
            }
        } catch (e) { /* копии нет */ }
        return null;
    }

    // Хранилище с резервной копией: та же схема, что в data.js, но свои данные
    function writeStore(value) {
        var json = JSON.stringify(value);
        try {
            localStorage.setItem(STORE_KEY, json);
        } catch (e) {
            storageSay("Браузер не смог сохранить отметки: хранилище переполнено или недоступно. Выгрузите настройки.");
            return false;
        }
        try {
            localStorage.setItem(STORE_KEY + "-backup", json);
        } catch (e) { /* на копию места не хватило — не беда */ }
        return true;
    }

    // ——————————————————————————————————
    // ОТМЕТКИ ПРИНАДЛЕЖАТ ГРУППЕ
    // В хранилище лежит выгрузка по всем группам:
    //     store["отделение|группа"][неделя][день][пара]
    // grades — отметки текущей группы, ссылка внутрь store. Поэтому весь
    // остальной код работает с ними как раньше, а переключение группы просто
    // переставляет эту ссылку.
    //——————————————————————————————————-

    var store = {};
    var grades = {};

    function groupKeyOf() {
        if (DATA.groupKeyOf) return DATA.groupKeyOf(DATA.otdel, DATA.grupa);
        return (DATA.otdel || "") + "|" + (DATA.grupa || "");
    }

    // Старый формат держал недели прямо в корне — переносим их под текущую
    // группу. Пока группа неизвестна (данные с сайта ещё не пришли), ничего не
    // трогаем: иначе отметки уехали бы в «пустую» группу и пропали бы с глаз.
    function migrateToGroups() {
        var key = groupKeyOf();
        if (key === "|") return false;
        var weeks = {};
        var moved = false;
        for (var k in store) {
            if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
            if (/^\d{4}-\d{2}-\d{2}$/.test(k)) { weeks[k] = store[k]; delete store[k]; moved = true; }
        }
        if (!moved) return false;
        var own = store[key] || {};
        for (var w in weeks) {
            if (Object.prototype.hasOwnProperty.call(weeks, w)) own[w] = weeks[w];
        }
        store[key] = own;
        return true;
    }

    // Переставить grades на текущую группу
    function useGroup() {
        var key = groupKeyOf();
        // Пока группа не выбрана, работать не с чем: даём пустую заготовку, но в
        // хранилище её не кладём — иначе туда уезжает пустая запись «|»
        if (key === "|") { grades = {}; return; }
        if (!store[key]) store[key] = {};
        grades = store[key];
    }

    // Отпечаток текущих данных: если он не совпадает с тем, что уехало
    // в файл при последней выгрузке, значит изменения ещё не выгружены.
    // Считаем по отметкам текущей группы — их же и выгружаем.
    function dataSnapshot() {
        var periods = DATA.manualPeriods();
        return JSON.stringify({
            otdel: DATA.otdel,
            grupa: DATA.grupa,
            grades: grades,
            periods: periods
        });
    }

    function markExported() {
        var snap = dataSnapshot();
        try {
            localStorage.setItem(EXPORT_SNAP_KEY, snap);
        } catch (e) { /* без этого просто не покажем пометку */ }
    }

    // Есть ли невыгруженные изменения. После выгрузки файла с тем же
    // содержимым — уже нет, даже если страницу перезагрузили.
    // Если выгрузки не было никогда, невыгружено всё, что есть.
    function hasUnexported() {
        var snap = null;
        try {
            snap = localStorage.getItem(EXPORT_SNAP_KEY);
        } catch (e) { return false; }
        if (snap == null) {
            return countWeeks(grades) > 0 || DATA.isManual();
        }
        return snap !== dataSnapshot();
    }

    // Точка у шестерёнки и предупреждение в окне настроек — одно и то же
    // состояние: после выгрузки что-то менялось, файл устарел
    function refreshExportMark() {
        var dirty = hasUnexported();
        var btn = document.getElementById("settings-btn");
        if (btn) btn.classList.toggle("has-changes", dirty);
        if (window.MPTSettings && window.MPTSettings.setNotice) {
            window.MPTSettings.setNotice(dirty
                ? "<b>Есть несохранённые изменения.</b> Отметки и правки дневника лежат " +
                  "только в этом браузере — нажми «Экспорт» во вкладке «Дневник», " +
                  "иначе при очистке данных их негде будет взять."
                : "");
        }
    }

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
    function subjectKey(subj, teacher) {
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

    // Своё окно уведомления (alert)
    var alertOverlay = null;
    function alertPopup(message) {
        if (alertOverlay) { alertOverlay.remove(); alertOverlay = null; }
        var overlay = document.createElement("div");
        overlay.className = "c-overlay";
        var box = document.createElement("div");
        box.className = "c-box";
        box.innerHTML =
            '<p class="c-msg"></p>' +
            '<div class="c-btns"><button type="button" class="c-ok">ОК</button></div>';
        box.querySelector(".c-msg").textContent = message;
        var okBtn = box.querySelector(".c-ok");
        function close() {
            overlay.remove();
            alertOverlay = null;
        }
        okBtn.addEventListener("click", close);
        overlay.addEventListener("click", function (ev) {
            if (ev.target === overlay) close();
        });
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        alertOverlay = overlay;
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

    // Чётность просматриваемой недели — тоже от якоря mpt.ru
    function viewParity() {
        return DATA.parityOfMonday(viewMonday);
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
        // основное хранилище, при нечитаемом — запасная копия
        store = readStore() || {};
        var movedToGroups = migrateToGroups();
        useGroup();
        migrateOld();
        if (movedToGroups) saveGrades();
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
        // Заодно убираем пустую запись «|», которую накопили прежние версии:
        // она не значит ничего, а в выгрузку попадала
        if (store["|"] && !Object.keys(store["|"]).length) delete store["|"];
        if (!writeStore(store)) return false;
        refreshExportMark();
        return true;
    }

    // Другая вкладка изменила отметки — показываем их, а не старые
    function watchOtherTabs() {
        if (!window.addEventListener) return;
        window.addEventListener("storage", function (ev) {
            if (!ev || ev.key !== STORE_KEY) return;
            var fresh = readStore();
            if (!fresh) return;
            grades = fresh;
            refreshExportMark();
            render();
        });
    }

    // ——————————————————————————————————
    // ВЫГРУЗКА / ЗАГРУЗКА ФАЙЛА (только на устройство)
    // В файле — не только оценки, а всё, из чего живёт дневник: отметки,
    // ручное расписание и выбранная группа.
    // ——————————————————————————————————

    function countWeeks(obj) {
        var n = 0;
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
        return n;
    }

    var lastDownloadAt = 0;

    function downloadJson(payload, name) {
        // страховка от двух файлов на один клик: повтор подряд игнорируем
        var now = Date.now();
        if (now - lastDownloadAt < 1000) return false;
        lastDownloadAt = now;
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return true;
    }

    // Приводит чужую сетку к нашей форме: { "ПН": [ {pair, subj, teacher, week} ] }
    // week === null означает «пара одна и та же обе недели», absent — «нет пары».
    function normalizeSchedule(src) {
        if (!src || typeof src !== "object") return null;
        var out = {};
        for (var di = 0; di < DAYS.length; di++) {
            var day = DAYS[di];
            var list = Object.prototype.toString.call(src[day]) === "[object Array]" ? src[day] : [];
            var clean = [];
            for (var i = 0; i < list.length; i++) {
                var it = list[i];
                if (!it || typeof it !== "object") continue;
                var pair = +it.pair;
                if (!(pair >= 1 && pair <= 5)) continue;
                if (it.absent) {
                    // у пометки «нет пары» неделя лежит в absent, а не в week
                    var mark = (it.absent === WEEK_W1 || it.absent === WEEK_W2) ? it.absent : WEEK_W1;
                    clean.push({ pair: pair, absent: mark });
                    continue;
                }
                var week = (it.week === WEEK_W1 || it.week === WEEK_W2) ? it.week : null;
                var subj = String(it.subj == null ? "" : it.subj).trim();
                if (!subj) continue;
                var row = { pair: pair, subj: subj, teacher: String(it.teacher == null ? "" : it.teacher).trim() };
                if (week) row.week = week;
                clean.push(row);
            }
            out[day] = clean;
        }
        return out;
    }

    // Ручные периоды в понятном виде: [{from, to, schedule}].
    // from === null означает «с самого начала». Всё, что не влезло
    // (мусор, периоды за последним днём правки), отбрасываем.
    function normalizePeriods(src) {
        var list = [];
        if (!src || Object.prototype.toString.call(src) !== "[object Array]") return list;
        var limit = DATA.manualLimitDate();
        for (var i = 0; i < src.length; i++) {
            var p = src[i];
            if (!p || typeof p !== "object") continue;
            var from = p.from == null ? null : String(p.from);
            var to = p.to == null ? null : String(p.to);
            if (!isIsoDay(to)) continue;
            if (from !== null && !isIsoDay(from)) continue;
            if (from && from > to) continue;
            if (limit && to > limit) continue;
            var grid = normalizeSchedule(p.schedule || p.grid);
            if (!grid) continue;
            list.push({ from: from, to: to, schedule: grid });
        }
        return list;
    }

    function isIsoDay(s) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
    }

    // 1 период, 2 периода, 5 периодов — для подтверждений и подписей
    function periodsWord(n) {
        if (n % 10 === 1 && n % 100 !== 11) return n + " период";
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return n + " периода";
        return n + " периодов";
    }

    function exportSettings() {
        var weeks = countWeeks(grades);
        var periods = DATA.manualPeriods();
        var history = DATA.versions ? DATA.versions() : [];
        var payload = {
            app: "mpt-diary",
            kind: "settings",
            version: 6,
            exportedAt: new Date().toISOString(),
            group: { otdel: DATA.otdel, grupa: DATA.grupa },
            mode: viewMode,
            grades: grades
        };
        // История версий расписания: без неё на другом устройстве прошлые
        // недели показались бы по нынешнему расписанию
        if (history && history.length) payload.versions = history;
        if (periods.length) {
            payload.schedule = {
                manual: true,
                firstFetchDate: DATA.firstFetchDate(),
                periods: periods
            };
        }
        var safe = String(DATA.grupa).replace(/[^\w.-]+/g, "-");
        var saved = downloadJson(payload, "mpt-" + safe + "-" + mondayIso(new Date()) + ".json");
        // запоминаем, когда последний раз выгружали: показываем дату в настройках
        try {
            localStorage.setItem(EXPORT_KEY, payload.exportedAt);
        } catch (e) { /* приватный режим — просто не покажем дату */ }
        if (saved) {
            // файл ушёл с тем же содержимым — невыгруженных правок больше нет
            markExported();
            refreshExportMark();
        } else {
            alertPopup("Файл не сохранился. Нажми «Экспорт» ещё раз.");
            return;
        }
        if (weeks === 0 && !periods.length) {
            alertPopup("Файл сохранён, но в нём пока пусто: ни отметок, ни ручных правок.");
        }
    }

    function lastExportAt() {
        try {
            return localStorage.getItem(EXPORT_KEY) || "";
        } catch (e) {
            return "";
        }
    }

    function normalizeImported(parsed) {
        if (!parsed || typeof parsed !== "object") return null;
        var src = (parsed.grades && typeof parsed.grades === "object") ? parsed.grades : parsed;
        var out = {};
        for (var week in src) {
            if (!Object.prototype.hasOwnProperty.call(src, week)) continue;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) continue;
            var days = src[week];
            if (!days || typeof days !== "object") continue;
            var cleanWeek = {};
            for (var day in days) {
                if (!Object.prototype.hasOwnProperty.call(days, day)) continue;
                if (DAYS.indexOf(day) === -1) continue;
                var pairs = days[day];
                if (!pairs || typeof pairs !== "object") continue;
                var cleanDay = {};
                for (var pair in pairs) {
                    if (!Object.prototype.hasOwnProperty.call(pairs, pair)) continue;
                    if (!/^[1-5]$/.test(pair)) continue;
                    // Принимаем и старую строку, и новый массив оценок
                    var marks = toMarks(pairs[pair]);
                    if (marks.length) cleanDay[pair] = marks;
                }
                if (Object.keys(cleanDay).length) cleanWeek[day] = cleanDay;
            }
            if (Object.keys(cleanWeek).length) out[week] = cleanWeek;
        }
        return out;
    }

    // История версий расписания из файла: [{from: "ГГГГ-ММ-ДД"|null, schedule}].
    // Непонятные записи отбрасываем: лучше без истории, чем с мусором.
    function normalizeVersions(src) {
        if (Object.prototype.toString.call(src) !== "[object Array]") return null;
        var out = [];
        for (var i = 0; i < src.length; i++) {
            var v = src[i];
            if (!v || typeof v !== "object") continue;
            if (!v.schedule || typeof v.schedule !== "object") continue;
            var from = (typeof v.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.from)) ? v.from : null;
            out.push({ from: from, schedule: v.schedule });
        }
        return out.length ? out : null;
    }

    // Разбирает файл: и новый (настройки), и старый (только оценки)
    function readSettingsFile(parsed) {
        if (!parsed || typeof parsed !== "object") return null;
        var isSettings = parsed.kind === "settings";
        var weeks = normalizeImported(parsed);
        // старый файл обязан хоть что-то содержать, иначе это не он
        if (!isSettings && (!weeks || countWeeks(weeks) === 0)) return null;
        var out = { settings: isSettings, grades: weeks || {}, versions: normalizeVersions(parsed.versions) };
        if (isSettings) {
            if (parsed.group && typeof parsed.group === "object") {
                out.otdel = parsed.group.otdel || null;
                out.grupa = parsed.group.grupa || null;
            }
            out.mode = (parsed.mode === "month" || parsed.mode === "year") ? parsed.mode : null;
            if (parsed.schedule && typeof parsed.schedule === "object") {
                // новый формат: список периодов; старый: одна сетка на весь срок
                if (Object.prototype.toString.call(parsed.schedule.periods) === "[object Array]") {
                    var periods = normalizePeriods(parsed.schedule.periods);
                    if (periods.length) out.periods = periods;
                } else {
                    var grid = normalizeSchedule(parsed.schedule.grid);
                    if (grid) {
                        out.periods = [{ from: null, to: DATA.manualLimitDate(), schedule: grid }];
                    }
                }
            }
        }
        return out;
    }

    function applyImport(data) {
        var weeks = countWeeks(data.grades);
        // ту же группу ищем заранее: ею же потом переключимся
        var targetDep = data.otdel ? DATA.findDepartment(data.otdel) : null;
        var targetGrp = (targetDep && data.grupa) ? DATA.findGroup(targetDep, data.grupa) : null;
        var lines = [];
        lines.push("Группа: " + (targetGrp ? targetDep + ", " + targetGrp : "как сейчас"));
        lines.push("Отметок: " + (weeks ? weeks + " нед." : "нет"));
        lines.push("Расписание: " + (data.periods
            ? "ручное, " + periodsWord(data.periods.length)
            : "как сейчас"));
        lines.push("История расписания: " + (data.versions
            ? data.versions.length + " вер."
            : "как сейчас"));

        confirmPopup("Загрузить настройки дневника?\n\n" + lines.join("\n"), "Загрузить", function (ok) {
            if (!ok) return;
            var moved = false;
            if (targetDep && targetGrp) {
                try {
                    localStorage.setItem(DATA.OTDEL_KEY, targetDep);
                    localStorage.setItem(DATA.GRUPA_KEY, targetGrp);
                } catch (e) { /* не влезло — живём без запоминания выбора */ }
                DATA.selectGroup(targetDep, targetGrp);
                moved = true;
            }
            if (data.periods) {
                // Ручные периоды из файла заменяют прежние целиком
                DATA.clearManual();
                for (var pi = 0; pi < data.periods.length; pi++) {
                    DATA.setManualPeriod(data.periods[pi].from, data.periods[pi].to, data.periods[pi].schedule);
                }
            }
            // Отметки из файла относим к той группе, что записана в самом файле:
            // иначе при импорте до прихода расписания они уехали бы в «пустую»
            // группу и пропали бы с глаз. Отметки других групп не трогаем.
            var fileGroup = (data.otdel && data.grupa && DATA.groupKeyOf)
                ? DATA.groupKeyOf(data.otdel, data.grupa)
                : groupKeyOf();
            store[fileGroup] = data.grades || {};
            useGroup();
            saveGrades();
            // История версий: без неё в прошлых неделях показалось бы нынешнее
            // расписание, то есть с неправильными предметами
            if (data.versions && data.versions.length) DATA.setVersions(data.versions, fileGroup);
            if (data.mode && data.mode !== viewMode) {
                setMode(data.mode);
            } else {
                render();
            }
            var extra = moved ? "\nГруппа переключена на " + DATA.otdel + ", " + DATA.grupa + "." : "";
            alertPopup("Настройки загружены." + extra);
        });
    }

    function importSettings(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            var parsed;
            try {
                parsed = JSON.parse(String(reader.result));
            } catch (e) {
                alertPopup("Не удалось прочитать файл: это не корректный JSON.");
                return;
            }
            var data = readSettingsFile(parsed);
            if (!data) {
                alertPopup("Не удалось прочитать файл: неожиданный формат.");
                return;
            }
            applyImport(data);
        };
        reader.onerror = function () { alertPopup("Не удалось прочитать файл."); };
        reader.readAsText(file);
    }

    // В клетке может быть несколько оценок за пару: ["5"] или ["5","4"].
    // Раньше там лежала строка, поэтому старое значение приводим к массиву на лету.
    function toMarks(val) {
        var out = [];
        if (val === null || val === undefined || val === "") return out;
        if (Object.prototype.toString.call(val) === "[object Array]") {
            for (var i = 0; i < val.length; i++) {
                var v = "" + val[i];
                if (v) out.push(v);
            }
        } else {
            out.push("" + val);
        }
        return out;
    }

    function dayStore(date) {
        var w = grades[weekKey(isoWeekMonday(date))];
        return w ? w[DAYS[date.getDay() - 1]] : null;
    }

    // Все оценки за пару в указанный день
    function getMarks(date, pair) {
        var d = dayStore(date);
        return d ? toMarks(d[pair]) : [];
    }

    function saveMarks(date, pair, list) {
        var key = weekKey(isoWeekMonday(date));
        var w = grades[key] || (grades[key] = {});
        var dayKey = DAYS[date.getDay() - 1];
        var d = w[dayKey] || (w[dayKey] = {});
        var clean = toMarks(list);
        if (clean.length) d[pair] = clean;
        else delete d[pair];
        if (!Object.keys(d).length) delete w[dayKey];
        if (!Object.keys(w).length) delete grades[key];
        saveGrades();
    }

    // Дописать оценку в конец (кнопка «+»)
    function addMark(date, pair, val) {
        if (!val) return;
        var list = getMarks(date, pair);
        if (list.indexOf(val) === -1) list.push(val);
        saveMarks(date, pair, list);
    }

    // Переписать оценку по индексу или удалить её (пустое значение)
    function setMarkAt(date, pair, index, val) {
        var list = getMarks(date, pair);
        if (index < 0 || index >= list.length) return;
        if (val) list[index] = val;
        else list.splice(index, 1);
        saveMarks(date, pair, list);
    }

    // Все отметки за дату (по всем парам и всем слотам), по порядку пар
    function gradesForDay(date) {
        var d = dayStore(date);
        if (!d) return [];
        var keys = Object.keys(d).sort(function (a, b) { return +a - +b; });
        var out = [];
        for (var i = 0; i < keys.length; i++) {
            var m = toMarks(d[keys[i]]);
            for (var j = 0; j < m.length; j++) out.push(m[j]);
        }
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

    // Дни недели: ПН…СБ, без воскресенья
    function weekDates() {
        var out = [];
        for (var i = 0; i < 6; i++) out.push(addDays(viewMonday, i));
        return out;
    }

    // Последний день периода, показанный по старой версии расписания
    // Последний день, когда ещё действовало старое расписание. Считаем по всему
    // сроку, а не по показанному окну: раньше поиск обрывался на конце недели
    // или месяца, и подпись называла не ту дату
    function lastStaleDay(from) {
        var last = null;
        for (var i = 0; i < 400; i++) {
            var d = addDays(from, i);
            if (DATA.isStaleDate(d)) {
                last = d;
            } else if (last) {
                break;   // старые дни идут подряд: после первого нового — конец
            }
        }
        return last;
    }

    // Плашка в подвале таблицы: одна, растянута вдоль всех дней со старым
    // расписанием и обрывается на последнем из них. С какого дня действует
    // новое — не пишем, и так видно по таблице.
    // baseCols — колонки слева, не являющиеся днями (номер пары, «Предмет»).
    function staleBand(baseCols, oldCols, until) {
        if (!oldCols || !until) return "";
        var label = pad(until.getDate()) + "." + pad(until.getMonth() + 1) + "." + until.getFullYear();
        // Дней после плашки не добавляем: таблица сама дорисует пустые колонки
        return '<tfoot><tr class="stale-row">' +
            '<td class="stale-lead" colspan="' + baseCols + '"></td>' +
            '<td class="stale-cell" colspan="' + oldCols + '">' +
            '<span class="stale-band">старое расписание до ' + label + "</span></td>" +
            "</tr></tfoot>";
    }

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
                var td = addDays(viewMonday, dIdx);
                var lessons = DATA.scheduleForDate(td)[key] || [];
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
                    html += '<td class="' + tdClass + (weekCls ? " " + weekCls : "") + '">';
                    html += '<span class="d-subj">' + lesson.subj + "</span>";
                    html += '<span class="d-teacher">' + (lesson.teacher || "—") + "</span>";
                    var marks = getMarks(td, p);
                    var tdIso = mondayIso(td);
                    html += '<span class="d-marks">';
                    for (var mi = 0; mi < marks.length; mi++) {
                        html += '<button type="button" class="d-mark ' + markCls(marks[mi]) + '"' +
                            ' data-date="' + tdIso + '" data-pair="' + p +
                            '" data-slot="' + mi + '" title="Изменить">' + marks[mi] + "</button>";
                    }
                    html += '<button type="button" class="d-mark d-mark-add"' +
                        ' data-date="' + tdIso + '" data-pair="' + p + '" data-slot="-1"' +
                        ' title="Добавить оценку">+</button>';
                    html += "</span></td>";
                }
            }

            html += "</tr>";
        }

        html += "</tbody>";

        // Плашка старой версии расписания — вдоль тех дней недели,
        // которые ещё показываются по ней.
        var wDates = weekDates();
        var wOld = 0;
        for (var wi = 0; wi < wDates.length; wi++) {
            if (DATA.isStaleDate(wDates[wi])) wOld++;
        }
        html += staleBand(1, wOld, lastStaleDay(viewMonday));

        table.innerHTML = html;
    }

    // Чётность недели конкретной даты.
    // Считается от недели, которую mpt.ru отдал как текущую, — так дневник
    // и расписание всегда показывают одну и ту же чётность.
    function dateParity(d) {
        return DATA.parityOfDate(d);
    }

    // Расписание конкретной даты (с учётом чётности её недели):
    // [{ pair, subj, weekCls }] + "нет пары" как subj === null
    function lessonsForDate(d) {
        var key = DAYS[d.getDay() - 1];
        if (!key) return [];
        var lessons = DATA.scheduleForDate(d)[key] || [];
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
    // пара -> массив оценок за эту пару в этот день
    function gradesMapForDate(date) {
        var d = dayStore(date);
        var out = {};
        if (!d) return out;
        for (var pair in d) {
            if (!Object.prototype.hasOwnProperty.call(d, pair)) continue;
            out[pair] = toMarks(d[pair]);
        }
        return out;
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
                var list = gm[lessons[i].pair] || [];
                for (var j = 0; j < list.length; j++) {
                    if (list[j] === "н") out.absent++;
                    else if (list[j] === "б") out.ill++;
                }
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
                var key = subjectKey(ls.subj, ls.teacher);
                if (groups.indexOf(key) === -1) groups.push(key);
                (marks[key] = marks[key] || []).push({
                    pair: ls.pair,
                    marks: gmap[ls.pair] || []
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
                        var list2 = marks2[mj].marks;
                        var dateIso = mondayIso(day2.date);
                        for (var mk = 0; mk < list2.length; mk++) {
                            html += '<button type="button" class="d-mark ' + markCls(list2[mk]) + '"' +
                                ' data-date="' + dateIso + '" data-pair="' + marks2[mj].pair +
                                '" data-slot="' + mk + '">' + list2[mk] + "</button>";
                        }
                        html += '<button type="button" class="d-mark d-mark-add"' +
                            ' data-date="' + dateIso + '" data-pair="' + marks2[mj].pair +
                            '" data-slot="-1" title="Добавить оценку">+</button>';
                    }
                    html += "</span>";
                }
                html += "</td>";
            }
            html += "</tr>";
        }

        html += "</tbody>";

        // Плашка старой версии: колонки старых дней подряд с левого края,
        // подпись — про последний старый день месяца, даже если он без пар
        var mOld = 0;
        for (var mi2 = 0; mi2 < days.length; mi2++) {
            if (DATA.isStaleDate(days[mi2].date)) mOld++;
        }
        html += staleBand(2, mOld, lastStaleDay(new Date(y, m, 1)));

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
                var key = subjectKey(ls.subj, ls.teacher);
                if (subjKeys[ls.subj] === undefined) subjKeys[ls.subj] = [];
                if (subjKeys[ls.subj].indexOf(key) === -1) subjKeys[ls.subj].push(key);
                if (gradesByKey[key] === undefined) {
                    gradesByKey[key] = [];
                    datesByKey[key] = [];
                }
                var list = gmap[ls.pair];
                if (list && list.length) {
                    // Несколько оценок за пару — каждая со своей датой
                    for (var mi = 0; mi < list.length; mi++) {
                        gradesByKey[key].push(list[mi]);
                        datesByKey[key].push(d);
                    }
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
    var pickPair = null;
    var pickSlot = -1;   // -1 = добавить новую, иначе индекс правящейся оценки

    function hidePicker() {
        pickDate = null;
        pickPair = null;
        pickSlot = -1;
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
        if (!pickDate) return;
        var val = target.getAttribute("data-grade");
        if (pickSlot < 0) addMark(pickDate, pickPair, val);
        else setMarkAt(pickDate, pickPair, pickSlot, val);
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
        watchOtherTabs();
        // Ошибку записи показываем сразу: хранилище может быть переполнено
        // или недоступно, и молчать об этом нельзя
        storageProblem = function (text) { alertPopup(text); };
        if (DATA.onStorageProblem) DATA.onStorageProblem(storageProblem);
        refreshExportMark();

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
                    pickDate = parseIso(target.getAttribute("data-date"));
                    pickPair = target.getAttribute("data-pair");
                    pickSlot = +target.getAttribute("data-slot");
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
                        pickPair = pair;
                        pickSlot = +target.getAttribute("data-slot");
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

        var exportBtn = document.getElementById("diary-export");
        if (exportBtn) {
            exportBtn.addEventListener("click", exportSettings);
        }

        var importBtn = document.getElementById("diary-import");
        var importFile = document.getElementById("diary-import-file");
        if (importBtn && importFile) {
            importBtn.addEventListener("click", function () { importFile.click(); });
            importFile.addEventListener("change", function () {
                importSettings(importFile.files && importFile.files[0]);
                importFile.value = "";
            });
        }

        // Вкладка «Дневник» в настройках: режим редактирования расписания
        // и выгрузка/загрузка настроек живут там.
        // isDiaryPage — подсказка другим страницам: вкладку показывать
        // только в дневнике, на «Расписании» её быть не должно.
        window.MPTDiary = {
            DAYS: DAYS,
            PAIR_TIMES: PAIR_TIMES,
            exportSettings: exportSettings,
            importSettings: importSettings,
            isDiaryPage: true,
            isManual: function () { return DATA.isManual(); },
            editableSchedule: function (d) { return DATA.editableSchedule(d); },
            manualPeriods: function () { return DATA.manualPeriods(); },
            manualLimitDate: function () { return DATA.manualLimitDate(); },
            firstFetchDate: function () { return DATA.firstFetchDate(); },
            lastExportAt: lastExportAt,
            hasUnexported: hasUnexported,
            // Отметки наружу — их ставит окошко расширения. Группа берётся та же,
            // что и в дневнике: ключ группы общий, поэтому отметки не разъедутся.
            marksFor: function (date, pair) { return getMarks(date, pair); },
            setMarks: function (date, pair, list) { saveMarks(date, pair, list); },
            addOneMark: function (date, pair, val) { addMark(date, pair, val); },
            // окно подтверждения/уведомления — тем же стилем, что и в дневнике
            confirm: confirmPopup,
            notify: alertPopup,
            // applyManual — короткий путь для всего срока правки
            applyManual: function (grid) {
                var limit = DATA.manualLimitDate();
                DATA.setManualPeriod(null, limit, grid);
                render();
            },
            applyPeriod: function (from, to, grid) {
                var problem = DATA.setManualPeriod(from, to, grid);
                if (problem) {
                    alertPopup("Не получилось сохранить период: " + problem + ".");
                    return problem;
                }
                render();
                return null;
            },
            dropPeriod: function (from, to) {
                DATA.removeManualPeriod(from, to);
                render();
            },
            dropManual: function () {
                DATA.clearManual();
                render();
            }
        };

        var picker0 = document.getElementById("diary-picker");
        if (picker0) picker0.value = mondayIso(new Date());

        // Смена отделения/группы в настройках: сетка пар должна совпасть с расписанием
        DATA.onChange(function () {
            if (document.body.getAttribute("data-page") === "diary") {
                if (window.MPTSettings) window.MPTSettings.show("diary");
            }
            // Группа могла смениться — отметки теперь у каждой свои
            useGroup();
            refreshExportMark();
            render();
        });

        render();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();