// Вкладка «Дневник» в настройках: правка расписания по периодам
// и выгрузка/загрузка настроек дневника.
//
// Правка живёт отдельным слоем поверх данных сайта: страница «Расписание»
// продолжает показывать расписание с mpt.ru, а в дневнике до первого снимка
// с сайта расписание можно переписать своими периодами. Начиная с первого
// снимка всё берётся исключительно с сайта.
(function () {
    "use strict";

    // Заполняется при регистрации вкладки: и data.js, и theme.js, и diary.js
    // поднимаются раньше, но инициализируются по DOMContentLoaded.
    var DATA = null;
    var SETTINGS = null;
    var DAYS = null;
    var PAIR_TIMES = null;
    var W1 = null;
    var W2 = null;

    var PAIR_MAX = 5;
    var BOX_WIDTH = 495;  // окно вкладки чуть шире, чем у «Оформления»
    var editing = false;
    var draft = null;      // правки выбранного периода, ещё не сохранённые
    var base = null;       // сетка, с которой открыли редактор
    var drafts = {};       // черновики всех вкладок: переключение не теряет правки
    var active = "";       // ключ выбранного периода
    var adding = false;    // показана форма нового периода
    var addFrom = "";
    var addTo = "";
    var problem = "";      // текст ошибки под формой нового периода
    var pane = null;
    var lastGroup = "";    // на какой группе открыт редактор

    // ——————————————————————————————————
    // Разбор и сборка сетки
    //——————————————————————————————————-

    // Числитель показываем перед знаменателем — так же, как на сайте
    function weekRank(week) {
        if (week === W1) return 0;
        if (week === W2) return 1;
        return 2;
    }

    // Раскладываем сетку в плоские строки: одна строка = одна пара в одной неделе
    function gridToRows(grid) {
        var rows = [];
        for (var d = 0; d < DAYS.length; d++) {
            var day = DAYS[d];
            var list = grid[day] || [];
            for (var i = 0; i < list.length; i++) {
                var it = list[i];
                if (!it || it.absent) continue;
                if (!it.subj) continue;
                rows.push({
                    day: day,
                    pair: +it.pair || 1,
                    both: !it.week,                       // пара одна и та же обе недели
                    week: it.week === W1 ? W1 : (it.week === W2 ? W2 : W1),
                    subj: it.subj,
                    teacher: it.teacher || ""
                });
            }
        }
        rows.sort(function (a, b) {
            var da = DAYS.indexOf(a.day), db = DAYS.indexOf(b.day);
            if (da !== db) return da - db;
            if (a.pair !== b.pair) return a.pair - b.pair;
            if (a.both !== b.both) return a.both ? 1 : -1;
            return weekRank(a.week) - weekRank(b.week);
        });
        return rows;
    }

    // Обратно в сетку. Часть перечисленных пар можно было не заполнить —
    // пустые строки в сетку не попадают, значит «нет пары».
    // base — та сетка, с которой редактор открылся: её пометки «нет пары»
    // сохраняются, если в этой неделе пользователь так и не добавил пару.
    function rowsToGrid(rows, base) {
        var grid = {};
        var i;
        for (i = 0; i < DAYS.length; i++) grid[DAYS[i]] = [];

        for (i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (DAYS.indexOf(r.day) === -1) continue;
            var subj = String(r.subj || "").trim();
            if (!subj) continue;
            var pair = +r.pair;
            if (!(pair >= 1 && pair <= PAIR_MAX)) continue;
            var row = { pair: pair, subj: subj, teacher: String(r.teacher || "").trim() };
            if (!r.both) row.week = r.week === W2 ? W2 : W1;
            grid[r.day].push(row);
        }

        if (base) {
            for (i = 0; i < DAYS.length; i++) {
                var day = DAYS[i];
                var old = base[day] || [];
                for (var b = 0; b < old.length; b++) {
                    var mark = old[b];
                    if (!mark || !mark.absent) continue;
                    if (hasLesson(grid[day], mark.pair, mark.absent)) continue;
                    grid[day].push({ pair: mark.pair, absent: mark.absent });
                }
            }
        }

        // Порядок внутри дня — по номеру пары, как показывает расписание
        for (i = 0; i < DAYS.length; i++) {
            grid[DAYS[i]].sort(function (a, b) {
                if (a.pair !== b.pair) return a.pair - b.pair;
                // у пометки «нет пары» неделя лежит в absent
                return weekRank(a.week || a.absent) - weekRank(b.week || b.absent);
            });
        }
        return grid;
    }

    // Есть ли в дне пара для этой недели
    function hasLesson(list, pair, week) {
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (it.absent || it.pair !== pair) continue;
            if (!it.week || it.week === week) return true;
        }
        return false;
    }

    // ——————————————————————————————————
    // Отрисовка редактора
    //——————————————————————————————————-

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ——————————————————————————————————
// Периоды: ручная правка живёт до первого снимка с сайта
//——————————————————————————————————-

// Вкладка «весь срок»: от начала и до последнего дня правки
    function wholePeriod() {
        return { from: null, to: DATA.manualLimitDate(), whole: true };
    }

    function periodKey(p) {
        return (p.from || "") + "|" + (p.to || "");
    }

    // Подпись вкладки: «1 сент — 30 сент 2026» или «Всё до 30.09.2026»
    function periodLabel(p) {
        if (p.whole) return "Всё до " + dayRu(p.to);
        return dayRu(p.from) + " — " + dayRu(p.to);
    }

    function dayRu(iso) {
        if (!iso) return "?";
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
        if (!m) return iso;
        return +m[3] + "." + m[2] + "." + m[1];
    }

    // Все вкладки: сперва весь срок, потом созданные периоды
    function periods() {
        var list = [wholePeriod()];
        var saved = DATA.manualPeriods();
        var whole = wholePeriod();
        for (var i = 0; i < saved.length; i++) {
            // период на весь срок — это уже первая вкладка, второй не делаем
            if (saved[i].from === null && saved[i].to === whole.to) continue;
            list.push({
                from: saved[i].from,
                to: saved[i].to,
                whole: false,
                schedule: saved[i].schedule
            });
        }
        return list;
    }

    function findPeriod(from, to) {
        var list = periods();
        for (var i = 0; i < list.length; i++) {
            if ((list[i].from || null) === (from || null) && list[i].to === to) return list[i];
        }
        return list[0];
    }

    // Сетка вкладки: своя правка, если она есть, иначе то, что показывает дневник
    function periodSchedule(p) {
        if (p.schedule) return p.schedule;
        if (p.whole) {
            var saved = DATA.manualPeriods();
            for (var i = 0; i < saved.length; i++) {
                if (saved[i].from === null && saved[i].to === p.to) return saved[i].schedule;
            }
        }
        return DATA.SCHEDULE;
    }

    function selectPeriod(p) {
        // уходя с вкладки, запоминаем её черновик: переключение не теряет правки
        if (active && draft) drafts[active] = draft;
        active = periodKey(p);
        base = periodSchedule(p);
        var rows = drafts[active];
        draft = rows ? rows : gridToRows(base);
        if (!draft.length) draft.push(blankRow());
        editing = true;
        adding = false;
        problem = "";
        render();
    }

    // Открыть период на правку: незакрытая правка остаётся в drafts
    function startEditing(p) {
        if (p) {
            selectPeriod(p);
            return;
        }
        selectPeriod(periods()[0]);
    }

    function forgetDraft() {
        delete drafts[active];
    }

    // Возврат к исходному виду вкладки «Дневник»: список периодов, ни одна
    // правка не открыта. Черновик закрытой правки не сохраняем — он уже не
    // к чему привязать, а вернуться к нему можно через сам период.
    function closeEditor() {
        forgetDraft();
        editing = false;
        adding = false;
        problem = "";
        draft = null;
        base = null;
        active = "";
        render();
    }

    function render() {
        if (!pane) return;
        var limit = DATA.manualLimitDate();
        var list = periods();
        var h = "";

        h += '<div class="settings-section">';
        h += '<span class="settings-section-title">Ручное расписание</span>';
        h += statusNote();
        h += "</div>";

        // ————————————————————
        // Вкладки периодов
        //————————————————————
        h += '<div class="settings-section">';
        h += '<span class="settings-section-title">Периоды</span>';
        h += '<div class="ed-tabs">';
        for (var pi = 0; pi < list.length; pi++) {
            var p = list[pi];
            var on = editing && periodKey(p) === active;
            h += '<button type="button" class="ed-tab' + (on ? " selected" : "") + '" data-from="' +
                esc(p.from || "") + '" data-to="' + esc(p.to || "") + '" title="' +
                esc((p.from ? dayRu(p.from) : "с самого начала") + " — " + dayRu(p.to)) + '">' +
                esc(periodLabel(p)) + "</button>";
        }
        h += "</div>";

        if (!editing) {
            h += '<div class="ed-actions">';
            h += '<button type="button" class="week-btn" id="ed-add-period">+ Добавить период</button>';
            if (DATA.isManual()) {
                h += '<button type="button" class="week-btn ed-drop" id="ed-drop">Вернуть расписание с сайта</button>';
            }
            h += "</div>";
        } else {
            h += periodForm(limit);
        }
        h += "</div>";

        if (editing && !adding) {
            var cur = findPeriodByKey(active) || list[0];
            h += '<div class="settings-section">';
            h += '<span class="settings-section-title">Пары: ' +
                esc(periodLabel(cur)) +
                '<span class="ed-count" id="ed-count"></span></span>';
            h += '<div class="ed-legend">' +
                '<span>Ползунок «обе недели» — пара не меняется от недели к неделе. ' +
                'Выключишь — выбери неделю: выбранный вариант обведён рамкой.</span></div>';
            h += '<div class="ed-list">';
            h += '<div class="ed-head"><span>День</span><span>Пара</span><span>Обе недели</span>' +
                '<span>Неделя</span><span>Предмет</span><span>Преподаватель</span><span></span></div>';
            h += '<div class="ed-rows" id="ed-rows"></div>';
            h += "</div>";
            // отступ от рамки, чтобы кнопки к ней не прилипали
            h += '<div class="ed-actions ed-under">' +
                '<button type="button" class="week-btn" id="ed-add">+ Добавить пару</button>' +
                '<div class="ed-actions-end">';
            if (!cur.whole) {
                h += '<button type="button" class="week-btn ed-drop" id="ed-del-period">Удалить период</button>';
            }
            h += '<button type="button" class="week-btn" id="ed-cancel">Отменить</button>' +
                '<button type="button" class="week-btn ed-save" id="ed-save">Сохранить изменения</button>' +
                "</div></div>";
            h += "</div>";
        }

        h += '<div class="settings-section">';
        h += '<span class="settings-section-title">Настройки дневника</span>';
        h += exportNote();
        h += '<div class="ed-sub">Отметки, ручное расписание и выбранная группа — одним файлом.</div>';
        h += '<div class="ed-actions">' +
            '<button type="button" class="week-btn io" id="ed-export">Экспорт</button>' +
            '<button type="button" class="week-btn io" id="ed-import">Импорт</button>' +
            '<input type="file" id="ed-import-file" accept="application/json,.json" hidden>';
        h += "</div></div>";

        pane.innerHTML = h;

        // ширина окна зависит от режима: пока правка не открыта, окно шире обычного,
        // а во время правки — совсем широкое
        if (window.MPTSettings && window.MPTSettings.setWide) {
            window.MPTSettings.setWide("diary", !!editing);
        }
        if (window.MPTSettings && window.MPTSettings.setBoxWidth) {
            window.MPTSettings.setBoxWidth("diary", BOX_WIDTH);
        }

        if (editing) {
            renderRows();
            bindRows();
        }
        bind();
    }

    function blankRow() {
        return { day: DAYS[0], pair: 1, both: true, week: W1, subj: "", teacher: "" };
    }

    // Пометка: правки живут только в этом браузере, пока их не выгрузили,
    // плюс дата последней выгрузки — чтобы было видно, «свежее» ли сохранение.
    // Общая врезка-подсказка: слева текст, справа короткая метка (дата)
    function note(text, mark, id) {
        return '<div class="ed-note"' + (id ? ' id="' + id + '"' : "") + '><span>' + text + "</span>" +
            (mark ? '<span class="ed-note-date">' + esc(mark) + "</span>" : "") + "</div>";
    }

function findPeriodByKey(key) {
        var list = periods();
        for (var i = 0; i < list.length; i++) {
            if (periodKey(list[i]) === key) return list[i];
        }
        return null;
    }

    // Форма нового периода: две даты, обе строго до первого снимка с сайта
    function periodForm(limit) {
        var h = "";
        if (adding) {
            h += '<div class="ed-period-form">';
            h += '<label class="ed-period-field"><span>Начало</span>' +
                '<input type="date" id="ed-from" value="' + esc(addFrom) + '" max="' + esc(limit) + '"></label>';
            h += '<label class="ed-period-field"><span>Конец</span>' +
                '<input type="date" id="ed-to" value="' + esc(addTo) + '" max="' + esc(limit) + '"></label>';
            h += '<div class="ed-actions ed-period-actions">' +
                '<button type="button" class="week-btn ed-save" id="ed-create-period">Создать период</button>' +
                '<button type="button" class="week-btn" id="ed-cancel-period">Отмена</button>' +
                "</div>";
            h += "</div>";
        }
        if (problem) h += '<div class="ed-error">' + esc(problem) + "</div>";
        return h;
    }

    // Что сейчас с расписанием: правим период, правки сохранены или всё с сайта.
    // Оформление то же, что у пометки о выгрузке. Дату снимка пишем
    // в тексте после двоеточия — так по-русски и читается сразу.
    function statusNote() {
        if (adding) {
            return note("<b>Новый период.</b> Правка будет действовать только на выбранные даты — " +
                "и только если они раньше первого снимка с сайта.", dayRu(DATA.manualLimitDate()));
        }
        if (editing) {
            var cur = findPeriodByKey(active);
            return note("<b>Правим период " + esc(periodLabel(cur || wholePeriod())) + ".</b> " +
                "После сохранения он будет действовать на эти даты, а всё остальное " +
                "останется как есть.", "до " + dayRu(DATA.manualLimitDate()));
        }
        if (DATA.isManual()) {
            return note("<b>Расписание исправлено вручную.</b> Ручных периодов: " +
                periodsWord(DATA.manualPeriods().length) + ". Начиная со снимка с сайта: " +
                esc(dayRu(DATA.firstFetchDate())) + " расписание берётся только с сайта.");
        }
        return note("<b>Дневник берёт расписание с mpt.ru.</b> Снимок с сайта: " +
            esc(dayRu(DATA.firstFetchDate())) + ". Расписание можно переписать вручную " +
            "только до этого дня.");
    }

    function periodsWord(n) {
        if (n % 10 === 1 && n % 100 !== 11) return n + " период";
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return n + " периода";
        return n + " периодов";
    }

    // Пометка: правки живут только в этом браузере, пока их не выгрузили,
    // плюс дата последней выгрузки — чтобы было видно, «свежее» ли сохранение.
    // Время московское, как и в подписях расписания и замен: пояс того,
    // кто открыл страницу, тут ни при чём.
    function exportNote() {
        var iso = "";
        if (window.MPTDiary) iso = window.MPTDiary.lastExportAt();
        var when = "Выгрузки ещё не было";
        if (iso) {
            var stamp = window.MPTData && window.MPTData.fmtMoscow(iso);
            if (stamp) when = "Выгружено " + stamp + " МСК";
        }
        // о невыгруженных изменениях говорит общий блок под окном — здесь
        // только про хранилище и дату последней выгрузки
        return note("<b>Отметки и правки хранятся только в этом браузере</b> — " +
            "до первой выгрузки их негде взять при очистке данных или смене устройства. " +
            "Выгружай настройки после каждой правки.", when, "ed-note-export");
    }

    function renderRows() {
        var box = pane.querySelector("#ed-rows");
        if (!box) return;
        var h = "";
        for (var i = 0; i < draft.length; i++) {
            var r = draft[i];
            h += '<div class="ed-row" data-i="' + i + '">';

            h += '<select class="ed-day" data-f="day">';
            for (var d = 0; d < DAYS.length; d++) {
                h += '<option value="' + DAYS[d] + '"' + (DAYS[d] === r.day ? " selected" : "") + ">" +
                    esc(DATA.DAY_NAMES[DAYS[d]] || DAYS[d]) + "</option>";
            }
            h += "</select>";

            h += '<select class="ed-pair" data-f="pair">';
            for (var p = 1; p <= PAIR_MAX; p++) {
                h += '<option value="' + p + '"' + (p === +r.pair ? " selected" : "") + ">" +
                    p + " · " + esc(PAIR_TIMES[p] || "") + "</option>";
            }
            h += "</select>";

            h += '<label class="ed-both" title="Пара одинакова в числитель и знаменатель">' +
                '<input type="checkbox" data-f="both"' + (r.both ? " checked" : "") + ">" +
                '<span class="ed-slider"></span></label>';

            if (!r.both) {
                h += '<span class="ed-weeks">' +
                    weekBtn(W1, r.week === W1) + weekBtn(W2, r.week === W2) + "</span>";
            } else {
                h += '<span class="ed-weeks ed-weeks-off">—</span>';
            }

            h += '<input class="ed-subj" type="text" data-f="subj" value="' + esc(r.subj) + '" placeholder="Предмет">';
            h += '<input class="ed-teacher" type="text" data-f="teacher" value="' + esc(r.teacher) + '" placeholder="Преподаватель">';
            h += '<button type="button" class="ed-del" title="Убрать пару">&times;</button>';

            h += "</div>";
        }
        box.innerHTML = h;

        var counter = pane.querySelector("#ed-count");
        if (counter) counter.textContent = draft.length + " " + rowsWord(draft.length);
    }

    // «1 пара», «3 пары», «20 пар»
    function rowsWord(n) {
        if (n % 10 === 1 && n % 100 !== 11) return "пара";
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "пары";
        return "пар";
    }

    function weekBtn(week, on) {
        return '<button type="button" class="ed-week' + (on ? " selected" : "") +
            '" data-week="' + week + '">' + (week === W1 ? "Числитель" : "Знаменатель") + "</button>";
    }

    // Перерисовываем строку целиком: ползунок меняет набор полей
    function bindRows() {
        var box = pane.querySelector("#ed-rows");
        if (!box) return;
        var nodes = box.querySelectorAll(".ed-row");

        for (var n = 0; n < nodes.length; n++) {
            (function (row) {
                var i = +row.getAttribute("data-i");

                row.querySelectorAll("select, input[type=text]").forEach(function (el) {
                    el.addEventListener("change", function () {
                        var f = this.getAttribute("data-f");
                        if (f === "subj") { draft[i].subj = this.value; return; }
                        if (f === "teacher") { draft[i].teacher = this.value; return; }
                        // остальное меняет вид строки — перерисовываем
                        if (f === "pair") draft[i].pair = +this.value;
                        else if (f === "day") draft[i].day = this.value;
                        renderRows();
                        bindRows();
                    });
                });

                var both = row.querySelector('input[data-f="both"]');
                if (both) {
                    both.addEventListener("change", function () {
                        draft[i].both = this.checked;
                        renderRows();
                        bindRows();
                    });
                }

                row.querySelectorAll(".ed-week").forEach(function (b) {
                    b.addEventListener("click", function () {
                        draft[i].week = this.getAttribute("data-week");
                        renderRows();
                        bindRows();
                    });
                });

                var del = row.querySelector(".ed-del");
                if (del) {
                    del.addEventListener("click", function () {
                        draft.splice(i, 1);
                        renderRows();
                        bindRows();
                    });
                }
            })(nodes[n]);
        }
    }

    function bind() {
        // вкладки периодов: клик открывает период на правку
        Array.prototype.forEach.call(pane.querySelectorAll(".ed-tab"), function (btn) {
            btn.addEventListener("click", function () {
                var from = this.getAttribute("data-from") || null;
                var to = this.getAttribute("data-to");
                startEditing(findPeriod(from, to));
            });
        });

        var cancel = pane.querySelector("#ed-cancel");
        if (cancel) {
            cancel.addEventListener("click", function () {
                closeEditor();
            });
        }

        var save = pane.querySelector("#ed-save");
        if (save) {
            save.addEventListener("click", function () {
                var cur = findPeriodByKey(active);
                if (!cur) return;
                var grid = rowsToGrid(draft, base);
                var rows = Object.keys(grid).reduce(function (n, day) { return n + grid[day].length; }, 0);
                var ask = window.MPTDiary && window.MPTDiary.confirm;
                function apply() {
                    if (window.MPTDiary) window.MPTDiary.applyPeriod(cur.from, cur.to, grid);
                    forgetDraft();
                    editing = false;
                    adding = false;
                    draft = null;
                    base = null;
                    render();
                }
                if (!ask) { apply(); return; }
                // Правка живёт в конкретном периоде — спросим лишний раз.
                // Окно зовёт колбэк с true при согласии и с false при отмене.
                ask("Сохранить изменения?\n\n" +
                    "Период: " + periodLabel(cur) + ".\n" +
                    "Пар в сетке: " + rows + ".\n" +
                    "Остальные даты останутся как были.",
                    "Сохранить", function (agreed) {
                        if (!agreed) return;
                        apply();
                    });
            });
        }

        var delp = pane.querySelector("#ed-del-period");
        if (delp) {
            delp.addEventListener("click", function () {
                var cur = findPeriodByKey(active);
                if (!cur || cur.whole) return;
                var ask = window.MPTDiary && window.MPTDiary.confirm;
                function drop() {
                    if (window.MPTDiary) window.MPTDiary.dropPeriod(cur.from, cur.to);
                    forgetDraft();
                    editing = false;
                    draft = null;
                    base = null;
                    render();
                }
                if (!ask) { drop(); return; }
                ask("Удалить период " + periodLabel(cur) + "?\n\n" +
                    "Расписание на эти даты вернётся к тому, что было до правки.",
                    "Удалить", function (agreed) {
                        if (!agreed) return;
                        drop();
                    });
            });
        }

        var drop = pane.querySelector("#ed-drop");
        if (drop) {
            drop.addEventListener("click", function () {
                var ask = window.MPTDiary && window.MPTDiary.confirm;
                function clearAll() {
                    if (window.MPTDiary) window.MPTDiary.dropManual();
                    drafts = {};
                    editing = false;
                    draft = null;
                    base = null;
                    render();
                }
                if (!ask) { clearAll(); return; }
                ask("Вернуть расписание с сайта?\n\n" +
                    "Все ручные периоды этой группы будут удалены.",
                    "Вернуть с сайта", function (agreed) {
                        if (!agreed) return;
                        clearAll();
                    });
            });
        }

        var add = pane.querySelector("#ed-add");
        if (add) {
            add.addEventListener("click", function () {
                if (!draft) draft = [];
                var last = draft[draft.length - 1];
                var row = blankRow();
                if (last) {
                    row.day = last.day;
                    row.pair = Math.min(PAIR_MAX, +last.pair + 1);
                }
                draft.push(row);
                renderRows();
                bindRows();
                var inputs = pane.querySelectorAll(".ed-row .ed-subj");
                if (inputs.length) inputs[inputs.length - 1].focus();
            });
        }

        var addp = pane.querySelector("#ed-add-period");
        if (addp) {
            addp.addEventListener("click", function () {
                var limit = DATA.manualLimitDate();
                addFrom = "";
                addTo = limit || "";
                problem = "";
                adding = true;
                editing = true;
                // правим новый период: за основу берём то, что показывает дневник
                active = "";
                draft = gridToRows(DATA.SCHEDULE);
                if (!draft.length) draft.push(blankRow());
                base = DATA.SCHEDULE;
                render();
                var from = pane.querySelector("#ed-from");
                if (from) from.focus();
            });
        }

        var create = pane.querySelector("#ed-create-period");
        if (create) {
            create.addEventListener("click", function () {
                var fromInput = pane.querySelector("#ed-from");
                var toInput = pane.querySelector("#ed-to");
                var from = fromInput ? fromInput.value : "";
                var to = toInput ? toInput.value : "";
                var bad = DATA.checkManualPeriod(from || null, to || null);
                if (!from) bad = bad || "укажи начало периода";
                if (!to) bad = bad || "укажи конец периода";
                if (bad) {
                    problem = "Не получилось создать период: " + bad + ".";
                    render();
                    return;
                }
                // период появляется сразу: за основу берём то, что он сейчас
                // показывает, иначе дыра в датах показала бы пустую сетку
                var grid = periodSchedule(wholePeriod());
                var problem2 = DATA.setManualPeriod(from, to, grid);
                if (problem2) {
                    problem = "Не получилось создать период: " + problem2 + ".";
                    render();
                    return;
                }
                problem = "";
                // созданный период не открываем: сразу исходный вид вкладки,
                // со списком периодов. Ничего не выбрано и не редактируется
                closeEditor();
            });
        }

        var cancelp = pane.querySelector("#ed-cancel-period");
        if (cancelp) {
            cancelp.addEventListener("click", function () {
                // форма добавления открывалась поверх вкладок: отмена
                // возвращает исходный вид, ничего не создав
                closeEditor();
            });
        }

        var exp = pane.querySelector("#ed-export");
        if (exp && window.MPTDiary) {
            exp.addEventListener("click", function () { window.MPTDiary.exportSettings(); });
        }

        var imp = pane.querySelector("#ed-import");
        var impFile = pane.querySelector("#ed-import-file");
        if (imp && impFile && window.MPTDiary) {
            imp.addEventListener("click", function () { impFile.click(); });
            impFile.addEventListener("change", function () {
                window.MPTDiary.importSettings(impFile.files && impFile.files[0]);
                impFile.value = "";
            });
        }
    }

// Вызывается при сборке вкладки и каждый раз, когда её снова показали:
// группу могли сменить, а сетка пар должна быть свежей.
    function open(paneEl) {
        if (paneEl) pane = paneEl;
        var now = (DATA.otdel || "") + "|" + (DATA.grupa || "");
        if (now !== lastGroup) {
            // сменили группу — открытая правка к ней уже не относится
            lastGroup = now;
            editing = false;
            adding = false;
            problem = "";
            draft = null;
            base = null;
            drafts = {};
            active = "";
        }
        if (editing && draft) return;
        render();
    }

    function register() {
        DATA = window.MPTData;
        SETTINGS = window.MPTSettings;
        // вкладка нужна только в дневнике: на «Расписании» дневных отметок нет
        if (!DATA || !SETTINGS || !window.MPTDiary || !window.MPTDiary.isDiaryPage) return;
        DAYS = window.MPTDiary.DAYS;
        PAIR_TIMES = DATA.PAIR_TIMES;
        W1 = DATA.WEEK_W1;
        W2 = DATA.WEEK_W2;
        // узкое окно по умолчанию; широким оно становится только на время правки
        SETTINGS.addTab("diary", "Дневник", open, false, open);
    }

    if (document.readyState === "complete") register();
    else document.addEventListener("DOMContentLoaded", register);
})();
