(function () {
    "use strict";

    // Общие данные для расписания и дневника
    var DATA = window.MPTData = {};

    DATA.DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
    DATA.DAY_NAMES = {
        ПН: "Понедельник",
        ВТ: "Вторник",
        СР: "Среда",
        ЧТ: "Четверг",
        ПТ: "Пятница",
        СБ: "Суббота"
    };
    DATA.WEEK_W1 = "Числитель";
    DATA.WEEK_W2 = "Знаменатель";

    // Время пар
    DATA.PAIR_TIMES = {
        1: "08:30 – 10:00",
        2: "10:10 – 11:40",
        3: "12:00 – 13:30",
        4: "13:50 – 15:20",
        5: "15:30 – 17:00"
    };

    var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // ——————————————————————————————————
    // БЕЗ ДАННЫХ С САЙТА
    // Раньше здесь лежало расписание, переписанное руками: запасной вариант на
    // случай, когда файл данных ещё не забран. Теперь данных в проекте нет
    // вовсе — страница сама берёт их с mpt.ru при первом открытии (js/live.js),
    // а до этого показывает честное «загружаем расписание». Показывать чужую
    // группу как свою хуже, чем подождать пару секунд.
    //——————————————————————————————————-

    var EMPTY = DATA.EMPTY = { days: [], buildings: {}, schedule: {} };

    // ——————————————————————————————————
    // ДАННЫЕ С mpt.ru (файл data/schedule.js, обновляется раз в 12 часов)
    //——————————————————————————————————-

    var SRC = window.MPTSchedule || null;
    DATA.available = !!(SRC && SRC.departments && SRC.departmentOrder && SRC.departmentOrder.length);
    DATA.updatedAt = DATA.available ? (SRC.fetchedAt || null) : null;
    DATA.sourceUrl = DATA.available ? (SRC.source || "https://mpt.ru/raspisanie/") : null;
    // Дата и чётность недели, ради которых сайт и обновляется
    DATA.weekDate = DATA.available ? (SRC.page && SRC.page.weekDate) || null : null;
    DATA.weekParity = DATA.available ? (SRC.page && SRC.page.parity) || null : null;

    function norm(s) {
        return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
    }
    DATA.normDept = norm;

    DATA.departments = DATA.available ? SRC.departmentOrder.slice() : [];

    DATA.groups = function (otdel) {
        if (!DATA.available) return [];
        var dep = SRC.departments[otdel];
        return dep ? Object.keys(dep.groups) : [];
    };

    // Отделение могло прийти из настроек в написании «09.02.07 П, Т»,
    // а сайт отдаёт «09.02.07 П,Т». Ищем по совпадению без пробелов.
    DATA.findDepartment = function (name) {
        if (!name) return null;
        if (DATA.available && SRC.departments[name]) return name;
        var n = norm(name);
        for (var i = 0; i < DATA.departments.length; i++) {
            if (norm(DATA.departments[i]) === n) return DATA.departments[i];
        }
        return null;
    };

    DATA.findGroup = function (otdel, name) {
        var list = DATA.groups(otdel);
        if (!name) return null;
        if (list.indexOf(name) !== -1) return name;
        var n = norm(name);
        for (var i = 0; i < list.length; i++) {
            if (norm(list[i]) === n) return list[i];
        }
        return null;
    };

    // ——————————————————————————————————
    // ЧЁТНОСТЬ НЕДЕЛИ
    // Опора — неделя, которую сайт отдал как текущую. От неё и считаем
    // чётность любой даты, поэтому снимок не «протухает» на неделю.
    //——————————————————————————————————-

    function parseIso(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3]);
    }

    function mondayOf(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    }

    var anchorMonday = null;
    if (DATA.weekDate && DATA.weekParity) {
        var d0 = parseIso(DATA.weekDate);
        if (d0) anchorMonday = mondayOf(d0);
    }

    // Запасной путь: без сайта считаем от 1 сентября учебного года
    function parityBySchoolYear(monday) {
        var ref = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
        var y = ref.getFullYear();
        if (ref.getMonth() < 8) y -= 1;
        var first = mondayOf(new Date(y, 8, 1));
        var w = Math.round((monday - first) / WEEK_MS) + 1;
        return (w % 2 === 1) ? DATA.WEEK_W1 : DATA.WEEK_W2;
    }

    function otherParity(p) {
        return p === DATA.WEEK_W1 ? DATA.WEEK_W2 : DATA.WEEK_W1;
    }

    DATA.parityOfMonday = function (monday) {
        if (anchorMonday && DATA.weekParity) {
            var weeks = Math.round((monday - anchorMonday) / WEEK_MS);
            return (weeks % 2 === 0) ? DATA.weekParity : otherParity(DATA.weekParity);
        }
        return parityBySchoolYear(monday);
    };

    DATA.parityOfDate = function (d) {
        return DATA.parityOfMonday(mondayOf(d));
    };

    // ——————————————————————————————————
    // МОСКОВСКОЕ ВРЕМЯ
    // Сайт и наши снимки живут в UTC, а расписание у нас московское. Москва
    // круглый год UTC+3 (перевода часов нет с 2014 года), поэтому сдвиг
    // считаем сами: если брать пояс того, кто открыл страницу, подпись
    // «обновлено» будет врать на чужом поясе.
    //——————————————————————————————————-

    DATA.MSK_OFFSET_MIN = 180;

    // «07.10.2026 19:52» по Москве; null, если дата не разобралась
    DATA.fmtMoscow = function (iso) {
        if (!iso) return null;
        var t = Date.parse(iso);
        if (isNaN(t)) return null;
        var d = new Date(t + DATA.MSK_OFFSET_MIN * 60000);
        return pad2(d.getUTCDate()) + "." + pad2(d.getUTCMonth() + 1) + "." + d.getUTCFullYear()
            + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
    };

    // ——————————————————————————————————
    // ВЫБОР ОТДЕЛЕНИЯ И ГРУППЫ
    //——————————————————————————————————-

    DATA.otdel = "";
    DATA.grupa = "";
    DATA.origin = "none";   // "mpt" — данные с сайта | "none" — их ещё нет
    DATA.SCHEDULE = {};
    DATA.DAYS_INFO = {};
    DATA.days = DATA.DAYS.slice();

    var listeners = [];

    DATA.onChange = function (fn) {
        if (typeof fn === "function") listeners.push(fn);
    };

    function emit() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](); } catch (e) { /* страница не должна падать из-за слушателя */ }
        }
    }

    // Формат, который уже умеют читать schedule.js и diary.js:
    // SCHEDULE[день] = [ {pair, subj, teacher} | {pair, absent: "Числитель"} ]
    function scheduleFromGroup(group) {
        var out = {};
        var i;
        for (i = 0; i < DATA.DAYS.length; i++) out[DATA.DAYS[i]] = [];

        for (i = 0; i < group.pairs.length; i++) {
            var p = group.pairs[i];
            var bucket = out[p.day];
            if (!bucket) continue;
            var w1 = p.w1 || {};
            var w2 = p.w2 || {};
            var same = (w1.subj || "") === (w2.subj || "") && (w1.teacher || "") === (w2.teacher || "");

            if (same) {
                if (w1.subj) {
                    bucket.push({ pair: p.pair, subj: w1.subj, teacher: w1.teacher || "" });
                }
                continue;
            }
            if (w1.subj) {
                bucket.push({ pair: p.pair, subj: w1.subj, teacher: w1.teacher || "", week: DATA.WEEK_W1 });
            } else {
                bucket.push({ pair: p.pair, absent: DATA.WEEK_W1 });
            }
            if (w2.subj) {
                bucket.push({ pair: p.pair, subj: w2.subj, teacher: w2.teacher || "", week: DATA.WEEK_W2 });
            } else {
                bucket.push({ pair: p.pair, absent: DATA.WEEK_W2 });
            }
        }
        return out;
    }

    function buildFromGroup(group) {
        var days = group.days || [];
        var info = {};
        var i;
        for (i = 0; i < DATA.DAYS.length; i++) {
            var key = DATA.DAYS[i];
            var on = days.indexOf(key) !== -1;
            info[key] = {
                name: DATA.DAY_NAMES[key],
                building: on ? ((group.buildings || {})[key] || "") : "",
                off: !on
            };
        }
        DATA.DAYS_INFO = info;
        DATA.days = days.slice();
        DATA.SCHEDULE = scheduleFromGroup(group);
    }

    // Пустое состояние: данных с сайта ещё нет. Страницы по нему показывают
    // «загружаем расписание» и не рисуют ни одной карточки дня.
    function buildEmpty() {
        var info = {};
        for (var i = 0; i < DATA.DAYS.length; i++) {
            var key = DATA.DAYS[i];
            info[key] = { name: DATA.DAY_NAMES[key], building: "", off: true };
        }
        DATA.DAYS_INFO = info;
        DATA.days = [];
        DATA.SCHEDULE = {};
        for (var d = 0; d < DATA.DAYS.length; d++) {
            DATA.SCHEDULE[DATA.DAYS[d]] = [];
        }
    }

    // ——————————————————————————————————
    // ИСТОРИЯ РАСПИСАНИЯ
    // Сайт отдаёт одну схему сразу на обе недели, поэтому свежий снимок
    // переписывает и прошлое: стоило колледжу поменять пару — и в дневнике
    // она переехала бы на все прошлые даты. Поэтому держим версии расписания
    // по группам: каждая действует со своей даты, а всё до неё остаётся
    // на прежней. Новую версию заводим с завтрашнего дня — ровно так,
    // как правки приходят в реальности.
    //——————————————————————————————————-

    var HISTORY_KEY = "mpt-schedule-history-v1";
    var MANUAL_KEY = "mpt-schedule-manual-v1";
    var versions = null;

    //——————————————————————————————————-
    // ХРАНИЛИЩЕ С ЗАПАСНОЙ КОПИЕЙ
    // Каждая запись ложится и в основной ключ, и в соседний «-backup».
    // Если основной вдруг не читается или пуст, а копия на месте — берём
    // копию и один раз говорим об этом. От очистки данных браузера это
    // не спасёт (стираются оба), но спасает от испорченной записи.
    //——————————————————————————————————-

    var storageProblem = null;   // что сообщить пользователю про хранилище
    var lastProblemText = ""; // одно и то же предупреждение повторяем не дважды

    DATA.onStorageProblem = function (fn) {
        storageProblem = (typeof fn === "function") ? fn : null;
    };

    function backupKey(key) {
        return key + "-backup";
    }

    // Читает значение ключа. Если основное не годится, пробует копию.
    function readValue(key) {
        var main = null;
        var good = false;
        try {
            var raw = window.localStorage.getItem(key);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    main = parsed;
                    good = true;
                }
            }
        } catch (e) { /* нечитаемо — попробуем копию */ }
        if (good) return main;
        try {
            var rawB = window.localStorage.getItem(backupKey(key));
            if (rawB) {
                var parsedB = JSON.parse(rawB);
                if (parsedB && typeof parsedB === "object") {
                    tellStorage("Основное хранилище дневника не читается — данные взяты из запасной копии.");
                    return parsedB;
                }
            }
        } catch (e) { /* копии тоже нет */ }
        return null;
    }

    function writeValue(key, value) {
        var json = JSON.stringify(value);
        try {
            window.localStorage.setItem(key, json);
        } catch (e) {
            tellStorage("Браузер не смог сохранить данные: хранилище переполнено или недоступно. Выгрузите настройки.");
            return false;
        }
        // копия — страховка; её отсутствие само по себе не беда
        try {
            window.localStorage.setItem(backupKey(key), json);
        } catch (e) { /* места нет только на копию */ }
        return true;
    }

    function tellStorage(text) {
        if (!storageProblem || text === lastProblemText) return;
        lastProblemText = text;
        storageProblem(text);
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function isoOf(d) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function readHistory() {
        return readValue(HISTORY_KEY) || {};
    }

    // ——————————————————————————————————
    // Граница правки: с первого снимка с сайта расписание там настоящее.
    // Ручными периодами можно переписать только то, что было ДО него, —
    // всё, что начиная с этого дня, берётся исключительно с mpt.ru.
    //——————————————————————————————————-

    // "ГГГГ-ММ-ДД" без сдвигов по поясам: строку разбираем руками
    function parseIso(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
        if (!m) return null;
        var d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
        return d;
    }

    function readStamp() {
        var src = window.MPTSchedule || {};
        var iso = src.firstFetchedAt || src.fetchedAt || "";
        var d = parseIso(String(iso).slice(0, 10));
        return d ? isoOf(d) : null;
    }

    // Первый снимок с сайта: с этой даты расписание только с сайта
    DATA.firstFetchDate = function () {
        return readStamp();
    };

    // Последний день, который ещё можно править вручную (накануне снимка).
    // null — снимка нет вовсе, тогда править можно любую дату.
    DATA.manualLimitDate = function () {
        var iso = readStamp();
        if (!iso) return null;
        var d = parseIso(iso);
        d.setDate(d.getDate() - 1);
        return isoOf(d);
    };

    // Версии сайта живут отдельно от ручных периодов и нужны только
    // начиная с первого снимка.
    // Версии текущей группы по порядку: [{from: "ГГГГ-ММ-ДД"|null, schedule}]
    DATA.versions = function () {
        return versions || [];
    };

    // Версия расписания, действующая в указанный день.
    DATA.versionForDate = function (d) {
        var list = versions || [];
        if (!list.length) return { from: null, schedule: DATA.SCHEDULE };
        var iso = isoOf(d);
        var pick = list[0];
        for (var i = 0; i < list.length; i++) {
            if (list[i].from === null || list[i].from <= iso) pick = list[i];
            else break;
        }
        return pick;
    };

    DATA.scheduleForDate = function (d) {
        var iso = isoOf(d);
        var first = readStamp();
        // До первого снимка сайта расписания ещё не было: показываем
        // ручной период, а если его нет — самый ранний известный снимок,
        // ровно как до появления ручных периодов.
        if (first && iso < first) {
            var own = DATA.manualForDate(d);
            if (own) return own.schedule;
            var list = versions || [];
            return list.length ? list[0].schedule : DATA.SCHEDULE;
        }
        return DATA.versionForDate(d).schedule;
    };

    // День, показанный не по последней версии: расписание к нему уже меняли.
    DATA.isStaleDate = function (d) {
        var list = versions || [];
        if (list.length < 2) return false;
        return DATA.versionForDate(d) !== list[list.length - 1];
    };

    // ——————————————————————————————————
    // Ручные периоды: что человек поправил и когда это действовало
    // ——————————————————————————————————
    // Период — это [{from, to, schedule}], где границы включительные,
    // а from === null означает «с самого начала». Периоды хранятся
    // отдельно от версий сайта: иначе правка забрала бы у сайта его дату.
    //——————————————————————————————————-

    // Ключ группы: по нему расходятся отметки дневника, история расписания и
    // ручные правки. Собирать его где-то ещё нельзя — ключи разъедутся, и
    // дневник перестанет находить свои данные.
    function groupKeyOf(otdel, grupa) {
        return (otdel || "") + "|" + (grupa || "");
    }

    function groupKey() {
        return groupKeyOf(DATA.otdel, DATA.grupa);
    }

    function readManualAll() {
        return readValue(MANUAL_KEY) || {};
    }

    function writeManualAll(all) {
        return writeValue(MANUAL_KEY, all);
    }

    // Периоды текущей группы, отсортированные: сначала без начала,
    // потом по более позднему старту — при пересечении побеждает
    // самый узкий и самый свежий период.
    DATA.manualPeriods = function () {
        var list = readManualAll()[groupKey()] || [];
        return list.slice().sort(function (a, b) {
            var fa = a.from || "", fb = b.from || "";
            if (fa !== fb) return fa < fb ? -1 : 1;
            return (a.to || "") < (b.to || "") ? 1 : -1;
        });
    };

    DATA.isManual = function () {
        return DATA.manualPeriods().length > 0;
    };

    // Период, покрывающий день, либо null
    DATA.manualForDate = function (d) {
        var iso = isoOf(d);
        var list = DATA.manualPeriods();
        var best = null;
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (iso < (p.from || "0000-01-01")) continue;
            // пустой конец — период без верхней границы (снимка с сайта нет)
            if (p.to && iso > p.to) continue;
            if (!best || (p.from || "") >= (best.from || "")) best = p;
        }
        return best;
    };

    // Сетка пар для редактирования: у периода своя, у нового периода —
    // то, что сейчас показывает дневник.
    DATA.editableSchedule = function (d) {
        var own = d ? DATA.manualForDate(d) : null;
        return own ? own.schedule : DATA.SCHEDULE;
    };

    // Проверка периода. Возвращает текст ошибки или null, если всё в порядке.
    DATA.checkManualPeriod = function (from, to) {
        var limit = DATA.manualLimitDate();
        if (to && !parseIso(to)) return "не понята конечная дата";
        if (from && !parseIso(from)) return "не понята начальная дата";
        if (from && to && from > to) return "начало позже конца";
        if (limit && to && to > limit) {
            return "период заходит на " + limit + " и позже — там расписание уже с сайта";
        }
        if (limit && from && from > limit) return "период целиком позже первого снимка с сайта";
        return null;
    };

    // Сохранить период. Период с null вместо границ — весь доступный срок.
    DATA.setManualPeriod = function (from, to, schedule) {
        var problem = DATA.checkManualPeriod(from, to);
        if (problem) return problem;
        var limit = DATA.manualLimitDate();
        var all = readManualAll();
        var list = all[groupKey()] || [];
        var next = [];
        var replaced = false;
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            // тот же период — заменяем содержимое
            if ((p.from || null) === (from || null) && p.to === to) {
                next.push({ from: from || null, to: to, schedule: schedule });
                replaced = true;
            } else {
                next.push(p);
            }
        }
        if (!replaced) next.push({ from: from || null, to: to, schedule: schedule });
        all[groupKey()] = next;
        if (!writeManualAll(all)) return "правка не поместилась в хранилище браузера";
        emit();
        return null;
    };

    // Убрать один период. Период с null означает «весь срок».
    DATA.removeManualPeriod = function (from, to) {
        var all = readManualAll();
        var list = all[groupKey()] || [];
        var next = [];
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if ((p.from || null) === (from || null) && p.to === to) continue;
            next.push(p);
        }
        all[groupKey()] = next;
        writeManualAll(all);
        emit();
        return true;
    };

    // Вернуть расписание с сайта: ручные периоды уходят целиком
    DATA.clearManual = function () {
        var all = readManualAll();
        delete all[groupKey()];
        writeManualAll(all);
        return true;
    };

    // Старая модель держала одну ручную правку на всю историю и прятала её
    // в архиве версий сайта. Переносим её в периоды на весь доступный срок,
    // чтобы человек не потерял то, что нарисовал.
    function migrateOldManual() {
        var all = readHistory();
        var key = groupKey();
        var list = all[key];
        if (!list || !list.length) return;
        var mine = [];
        var rest = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].manual) mine.push(list[i]);
            else rest.push(list[i]);
        }
        if (!mine.length) return;

        var limit = DATA.manualLimitDate();
        var manual = readManualAll();
        var periods = manual[key] || [];
        for (var m = 0; m < mine.length; m++) {
            periods.push({ from: null, to: limit, schedule: mine[m].schedule });
        }
        manual[key] = periods;
        writeManualAll(manual);

        if (rest.length) all[key] = rest;
        else delete all[key];
        try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
        } catch (e) { /* не влезло — периоды уже сохранены */ }
    }

    // Вызывается сразу после того, как DATA.SCHEDULE пересобран.
    DATA.keepHistory = function () {
        if (DATA.origin !== "mpt") {
            versions = null;
            return;
        }
        migrateOldManual();
        var all = readHistory();
        var key = groupKey();
        var list = all[key];

        var changed = false;

        if (!list || !list.length) {
            // первый снимок с сайта — начало отсчёта: всё, что было раньше,
            // дневник показывает по нему, пока не вмешалась ручная правка
            list = [{ from: null, schedule: DATA.SCHEDULE }];
            changed = true;
        } else if (JSON.stringify(list[list.length - 1].schedule) !== JSON.stringify(DATA.SCHEDULE)) {
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            var from = isoOf(tomorrow);
            if (list[list.length - 1].from === from) {
                // изменения в тот же день — та же версия, заменяем содержимое
                list[list.length - 1].schedule = DATA.SCHEDULE;
            } else {
                list.push({ from: from, schedule: DATA.SCHEDULE });
            }
            changed = true;
        }

        if (changed) {
            all[key] = list;
            try {
                window.localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
            } catch (e) { /* не влезло — история просто не переживёт перезапуск */ }
        }
        versions = list;
    };

    DATA.groupKey = groupKey;
    DATA.groupKeyOf = groupKeyOf;

    // Заменить историю версий группы (по умолчанию — текущей). Нужно при
    // загрузке настроек: без этого на другом устройстве прошлые недели
    // показались бы по нынешнему расписанию, то есть с неправильными предметами.
    DATA.setVersions = function (list, key) {
        if (!list || !list.length) return false;
        var all = readHistory();
        var target = key || groupKey();
        all[target] = list;
        try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
        } catch (e) { return false; }
        if (target === groupKey()) versions = list;
        return true;
    };

    // Возвращает true, если группа выбрана и расписание взято с сайта;
    // false — если данных с сайта нет вовсе или такой группы в них не нашлось
    DATA.selectGroup = function (otdel, grupa, silent) {
        var dep = DATA.findDepartment(otdel);
        var grp = dep ? DATA.findGroup(dep, grupa) : null;
        var group = null;

        if (SRC && dep && grp) group = SRC.departments[dep].groups[grp];

        if (group && (group.pairs.length || (group.days && group.days.length))) {
            DATA.otdel = dep;
            DATA.grupa = grp;
            DATA.origin = "mpt";
            buildFromGroup(group);
            DATA.keepHistory();
            if (!silent) emit();
            return true;
        }

        // Данных с сайта нет вовсе или выбранной группы в них не нашлось:
        // оставляем пустое состояние и честно говорим об этом на странице.
        DATA.origin = "none";
        buildEmpty();
        if (!silent) emit();
        return false;
    };

    // ——————————————————————————————————
    // ПРИЁМ СВЕЖЕГО СНИМКА (js/live.js, обновление раз в 30 минут и 12 часов)
    // Модель приходит с сайта уже разобранной, но проходит тот же путь, что и
    // вшитый снимок: пересобираем сетку группы и зовём keepHistory. Поэтому
    // история версий, ручные периоды и отметки дневника не страдают.
    //——————————————————————————————————-

    function applySnapshot(model) {
        SRC = model;
        DATA.available = true;
        DATA.updatedAt = model.fetchedAt || null;
        DATA.sourceUrl = model.source || DATA.sourceUrl;
        DATA.weekDate = (model.page && model.page.weekDate) || null;
        DATA.weekParity = (model.page && model.page.parity) || null;
        // Якорь чётности пересчитываем от новой недели: от него страницы
        // считают числитель/знаменатель для любой даты.
        anchorMonday = null;
        if (DATA.weekDate && DATA.weekParity) {
            var d0 = parseIso(DATA.weekDate);
            if (d0) anchorMonday = mondayOf(d0);
        }
        DATA.departments = model.departmentOrder.slice();
    }

    // Есть ли в снимке такая группа и есть ли в ней что показывать. Проверяем
    // по модели, не трогая текущее состояние: тогда при неудаче откатывать
    // ничего не нужно.
    function groupInSnapshot(model, otdel, grupa) {
        var wantDep = norm(otdel);
        var wantGrp = norm(grupa);
        if (!wantDep || !wantGrp) return null;

        var order = model.departmentOrder || [];
        var dep = null;
        for (var i = 0; i < order.length; i++) {
            if (norm(order[i]) === wantDep) { dep = order[i]; break; }
        }
        if (!dep) return null;

        var groups = (model.departments[dep] || {}).groups || {};
        var names = Object.keys(groups);
        var grp = null;
        for (var j = 0; j < names.length; j++) {
            if (norm(names[j]) === wantGrp) { grp = names[j]; break; }
        }
        if (!grp) return null;

        var group = groups[grp];
        if (!group || !(group.pairs.length || (group.days && group.days.length))) return null;
        return { dep: dep, grp: grp };
    }

    // Выбор группы, запомненный настройками (js/theme.js). Нужен потому, что
    // данные приходят уже после открытия страницы: к этому моменту человек
    // мог ничего не выбрать, и выбрать за него некому.
    var OTDEL_KEY = "mpt-otdel";
    var GRUPA_KEY = "mpt-grupa";

    // Те же ключи нужны не только этой странице: по ним выбор группы читает
    // окошко расширения. Отдаём наружу здесь, где они уже объявлены: выше по
    // файлу они были бы undefined, и записи уходили бы в никуда.
    DATA.OTDEL_KEY = OTDEL_KEY;
    DATA.GRUPA_KEY = GRUPA_KEY;

    function rememberedGroup() {
        try {
            return {
                otdel: window.localStorage.getItem(OTDEL_KEY) || "",
                grupa: window.localStorage.getItem(GRUPA_KEY) || ""
            };
        } catch (e) { return { otdel: "", grupa: "" }; }
    }

    // Какую группу показывать после приёма снимка:
    //   1. выбранную сейчас — она важнее всего;
    //   2. иначе запомненную настройками: человек выбрал её в прошлый раз,
    //      а данные пришли только сейчас;
    //   3. иначе (самое первое открытие) — первую группу первого отделения,
    //      ровно как при обычном старте;
    //   4. если группа была выбрана, но из расписания пропала — null:
    //      молча подменять её чужой нельзя, лучше оставить прежние данные.
    function pickGroupFor(model) {
        var chosen = groupInSnapshot(model, DATA.otdel, DATA.grupa);
        if (chosen) return chosen;

        var saved = rememberedGroup();
        var remembered = groupInSnapshot(model, saved.otdel, saved.grupa);
        if (remembered) return remembered;

        if (!DATA.otdel && !DATA.grupa) {
            var dep = model.departmentOrder[0];
            var names = Object.keys((model.departments[dep] || {}).groups || {});
            if (names.length) return { dep: dep, grp: names[0] };
        }
        return null;
    }

    // Принять свежее расписание. Возвращает false, если снимок негодный или в
    // нём больше нет выбранной группы: тогда всё остаётся как было.
    DATA.adoptSnapshot = function (model) {
        if (!model || !model.departmentOrder || !model.departmentOrder.length || !model.departments) return false;

        var pick = pickGroupFor(model);
        if (!pick) return false;

        applySnapshot(model);
        return DATA.selectGroup(pick.dep, pick.grp);
    };

    // Принять свежие замены. Дневник их не использует, но вкладка «Замены»
    // перерисовывается по тому же событию.
    DATA.adoptReplacements = function (model) {
        if (!model || !model.days) return false;
        REPL = model;
        DATA.replacementsAvailable = true;
        DATA.replacementsFetchedAt = model.fetchedAt || null;
        emit();
        return true;
    };

    // Другая вкладка изменила ручные периоды или группу — подхватываем
    // это, чтобы две открытые страницы не затирали правки друг друга.
    if (window.addEventListener) {
        window.addEventListener("storage", function (ev) {
            if (!ev || !ev.key) return;
            if (ev.key === MANUAL_KEY) {
                emit();
                return;
            }
            if (ev.key === "mpt-otdel" || ev.key === "mpt-grupa") {
                try {
                    DATA.selectGroup(window.localStorage.getItem(OTDEL_KEY),
                        window.localStorage.getItem(GRUPA_KEY));
                } catch (e) { /* хранилище недоступно */ }
            }
        });
    }

    // ——————————————————————————————————
    // ЗАМЕНЫ (data/replacements.js, обновляется раз в полчаса)
    //——————————————————————————————————-

    var REPL = window.MPTReplacements || null;
    DATA.replacementsAvailable = !!(REPL && REPL.days);
    DATA.replacementsFetchedAt = DATA.replacementsAvailable ? (REPL.fetchedAt || null) : null;

    // Название группы нормализуем без пробелов: на сайте одна и та же группа
    // то пишется «ИИ-1-25, ИИ-11-26» (общая таблица), то «БИ-2-24; БИ-11/2-25»,
    // а в расписании она одна строка с «; ». Сравниваем по кускам.
    function groupPieces(name) {
        return String(name || "").split(/[;,]/).map(function (s) {
            return s.replace(/\s+/g, "").toUpperCase();
        }).filter(Boolean);
    }

    function sameGroup(a, b) {
        var x = groupPieces(a);
        var i;
        if (!x.length) return false;
        for (i = 0; i < x.length; i++) {
            if (groupPieces(b).indexOf(x[i]) !== -1) return true;
        }
        return false;
    }

    // Замены выбранной группы по дням, свежие сверху.
    // DATA.replacementsFor(grupa) — по умолчанию текущая.
    DATA.replacementsFor = function (grupa) {
        if (!DATA.replacementsAvailable) return [];
        var want = grupa === undefined ? DATA.grupa : grupa;
        var out = [];
        for (var i = 0; i < REPL.days.length; i++) {
            var day = REPL.days[i];
            var rows = [];
            for (var j = 0; j < day.groups.length; j++) {
                var g = day.groups[j];
                if (!sameGroup(want, g.groups.join(", "))) continue;
                for (var k = 0; k < g.rows.length; k++) rows.push(g.rows[k]);
            }
            if (!rows.length) continue;
            rows.sort(function (a, b) { return a.pair - b.pair; });
            out.push({
                date: day.date,
                dateText: day.dateText,
                weekday: day.weekday,
                // «Сегодня» считаем по календарю, а не по отметке в файле:
                // снимок обновляется раз в полчаса, но если он залежался,
                // отметка «(Сегодня)» с сайта укажет на прошедший день.
                today: day.date === isoOf(new Date()),
                rows: rows
            });
        }
        out.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
        return out;
    };

    // Первичная раскладка: то, что лежит в localStorage, иначе первое отделение и группа.
    // Рассылает событие — к этому моменту страницы уже подписались на смену группы.
    DATA.init = function (storedOtdel, storedGrupa) {
        var dep = DATA.findDepartment(storedOtdel) || DATA.departments[0] || null;
        var grp = dep ? (DATA.findGroup(dep, storedGrupa) || DATA.groups(dep)[0] || null) : null;
        DATA.selectGroup(dep, grp);
        return { otdel: DATA.otdel, grupa: DATA.grupa, noData: DATA.origin !== "mpt" };
    };
})();
