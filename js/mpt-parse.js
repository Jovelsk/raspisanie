// Разбор страниц mpt.ru — один файл на двоих.
//
// Страницы подключают его обычным <script src="js/mpt-parse.js"> и берут
// window.MPTParse. Модульные скрипты (<script type="module">) тут не годятся:
// при открытии через file:// браузер их блокирует, а сайт задуман так, чтобы
// открываться двойным щелчком по index.html.
//
// Node-загрузчики (tools/fetch-*.mjs) читают этот же файл и выполняют его в vm.
// Разбор обязан существовать в одном экземпляре: от него зависят расписание,
// замены и весь дневник, а две копии разъедутся при первой же правке сайта.
(function (root) {
    "use strict";

    // Адреса страниц: попадают в снимок полем source
    var SCHEDULE_URL = "https://mpt.ru/raspisanie/";
    var REPLACEMENTS_URL = "https://mpt.ru/izmeneniya-v-raspisanii/";

    // Сайт публикует обе недели сразу: label-danger = Числитель, label-info = Знаменатель.
    // Если раскладка цветов когда-то поменяется — достаточно поменять эти две строки.
    var CLS_W1 = "label label-danger";
    var CLS_W2 = "label label-info";

    var DAY_NAMES = {
        "ПОНЕДЕЛЬНИК": "ПН",
        "ВТОРНИК": "ВТ",
        "СРЕДА": "СР",
        "ЧЕТВЕРГ": "ЧТ",
        "ПЯТНИЦА": "ПТ",
        "СУББОТА": "СБ",
        "ВОСКРЕСЕНЬЕ": "ВС",
    };

    var MONTHS_GEN = {
        "января": 0, "февраля": 1, "марта": 2, "апреля": 3, "мая": 4, "июня": 5,
        "июля": 6, "августа": 7, "сентября": 8, "октября": 9, "ноября": 10, "декабря": 11,
    };

    var MONTHS_NOM = [
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря",
    ];

    var WEEKDAYS_RU = {
        "воскресенье": 0, "понедельник": 1, "вторник": 2, "среда": 3,
        "четверг": 4, "пятница": 5, "суббота": 6,
    };

    var WEEKDAYS_NOM = {
        "понедельник": "Понедельник", "вторник": "Вторник", "среда": "Среда",
        "четверг": "Четверг", "пятница": "Пятница", "суббота": "Суббота",
        "воскресенье": "Воскресенье",
    };

    // У страниц чуть разные наборы сущностей, и объединять их нельзя: в
    // расписании &#8211; раньше не трогали, и замена его на тире поменяла бы
    // уже разобранный текст. Поэтому функций две, ровно как было.
    var textSchedule = function (s) {
        return s
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&laquo;/g, "\u00ab").replace(/&raquo;/g, "\u00bb")
            .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "\u2019")
            .replace(/\s+/g, " ")
            .trim();
    };

    var textReplacements = function (s) {
        return s
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&laquo;/g, "\u00ab").replace(/&raquo;/g, "\u00bb")
            .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "\u2019")
            .replace(/&#8211;|&ndash;/g, "\u2013")
            .replace(/\s+/g, " ")
            .trim();
    };

    // ——————————————————————————————————
    // РАСПИСАНИЕ
    // ——————————————————————————————————

    function parseScheduleHeader(html) {
        var out = { weekDate: null, weekDateText: null, parity: null, title: null };

        var h2 = /<h2[^>]*>\s*([0-9]{1,2})\s+([А-Яа-яЁё]+)\s*(?:\u2013|-)\s*([А-Яа-яЁё]+)/.exec(html);
        if (h2) {
            var day = +h2[1];
            var mon = MONTHS_GEN[h2[2].toLowerCase()];
            var wantDow = WEEKDAYS_RU[h2[3].trim().toLowerCase()];
            // Года на странице нет — берём год публикации/изменения, иначе текущий.
            // Год подтверждаем совпадением дня недели, иначе перебираем ±1, ±2.
            var stamp = /<meta property="article:(?:modified|published)_time" content="([0-9]{4})/i.exec(html);
            var base = stamp ? +stamp[1] : new Date().getFullYear();
            if (mon !== undefined) {
                var years = [base, base + 1, base - 1, base + 2, base - 2];
                for (var i = 0; i < years.length; i++) {
                    var d = new Date(Date.UTC(years[i], mon, day));
                    if (d.getUTCDay() === wantDow) { out.weekDate = d.toISOString().slice(0, 10); break; }
                }
            }
            out.weekDateText = h2[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }

        var lbl = /Неделя:\s*(?:<[^>]+>\s*)*<span[^>]*>([^<]+)<\/span>/i.exec(html)
            || /Неделя:\s*([А-Яа-яЁё]+)/i.exec(html);
        if (lbl) {
            var p = lbl[1].trim();
            out.parity = /^числ/i.test(p) ? "Числитель" : /^знам/i.test(p) ? "Знаменатель" : p;
        }

        var ti = /<title>([\s\S]*?)<\/title>/i.exec(html);
        if (ti) out.title = textSchedule(ti[1]);
        return out;
    }

    // Режет страницу на секции отделений по заголовкам «Расписание занятий для …»
    function splitDepartments(html) {
        var marks = [];
        var re = /<h2[^>]*>\s*Расписание занятий для\s+([\s\S]*?)<\/h2>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            marks.push({
                name: textSchedule(m[1]).replace(/\s+/g, " ").trim(),
                start: m.index,
                headEnd: m.index + m[0].length,
            });
        }
        return marks.map(function (mark, i) {
            return {
                name: mark.name,
                html: html.slice(mark.headEnd, i + 1 < marks.length ? marks[i + 1].start : html.length),
            };
        });
    }

    function parseWeekVariants(cellHtml) {
        // Внутри <td> один или два блока: <div class="label label-...">текст</div>
        var out = {};
        var classes = [CLS_W1, CLS_W2];
        for (var c = 0; c < classes.length; c++) {
            var cls = classes[c];
            var re = new RegExp('<div class="' + cls + '"[^>]*>([\\s\\S]*?)</div>', "gi");
            var found = [];
            var m;
            while ((m = re.exec(cellHtml)) !== null) {
                var v = textSchedule(m[1]);
                if (v) found.push(v);
            }
            out[cls === CLS_W1 ? "w1" : "w2"] = found;
        }
        // Меток нет — пара одинакова в обе недели, текст лежит прямо в ячейке
        if (!out.w1.length && !out.w2.length) {
            var plain = textSchedule(cellHtml);
            if (plain) { out.w1 = [plain]; out.w2 = [plain]; }
        }
        return out;
    }

    function parseGroupPane(paneHtml) {
        var group = { days: [], buildings: {}, pairs: [] };
        var tables = paneHtml.match(/<table[\s\S]*?<\/table>/gi) || [];

        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            var head = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(tbl);
            if (!head) continue;
            var raw = textSchedule(head[1]);
            var dayKey = Object.keys(DAY_NAMES).find(function (k) {
                return raw.toUpperCase().indexOf(k) === 0;
            });
            if (!dayKey) continue;
            var day = DAY_NAMES[dayKey];
            var building = raw.slice(dayKey.length).trim();
            if (group.days.indexOf(day) === -1) group.days.push(day);
            group.buildings[day] = building;

            var rows = tbl.match(/<tr>([\s\S]*?)<\/tr>/gi) || [];
            for (var r = 0; r < rows.length; r++) {
                var cells = rows[r].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
                if (cells.length < 3) continue;
                var pairNo = textSchedule(cells[0]);
                if (!/^[1-9]\d*$/.test(pairNo)) continue;
                var s = parseWeekVariants(cells[1]);
                var tt = parseWeekVariants(cells[2]);
                if (!s.w1.length && !s.w2.length) continue;
                group.pairs.push({
                    day: day,
                    pair: +pairNo,
                    w1: { subj: s.w1.join(" / ") || null, teacher: tt.w1.join(" / ") || null },
                    w2: { subj: s.w2.join(" / ") || null, teacher: tt.w2.join(" / ") || null },
                });
            }
        }

        var order = Object.keys(DAY_NAMES);
        group.days.sort(function (a, b) {
            return order.indexOf(DAY_NAMES[a]) - order.indexOf(DAY_NAMES[b]);
        });
        return group;
    }

    function parseDepartments(html) {
        var departments = {};
        var order = [];

        var sections = splitDepartments(html);
        for (var d = 0; d < sections.length; d++) {
            var dept = sections[d];
            // Панели групп: id="hash"><h3>Группа NAME</h3> … идут в порядке вкладок
            var paneRe = /id="([0-9a-f]{16,40})"[^>]*>\s*<h3[^>]*>\s*Группа\s+([\s\S]*?)<\/h3>/gi;
            var panes = [];
            var m;
            while ((m = paneRe.exec(dept.html)) !== null) {
                panes.push({
                    hash: m[1],
                    name: textSchedule(m[2]),
                    start: m.index + m[0].length,
                    headStart: m.index,
                });
            }
            // Порядок групп из вкладок (текст может содержать объединённые вроде «П-8-24, П-11/8-25»)
            var linkRe = /<a href="#([0-9a-f]{16,40})"[^>]*data-toggle="tab"[^>]*>([\s\S]*?)<\/a>/gi;
            var links = [];
            while ((m = linkRe.exec(dept.html)) !== null) links.push({ hash: m[1], label: textSchedule(m[2]) });

            var groups = {};
            for (var i = 0; i < panes.length; i++) {
                var pane = panes[i];
                var end = i + 1 < panes.length ? panes[i + 1].headStart : dept.html.length;
                var label = panes[i].name;
                if (!label) {
                    var found = links.find(function (l) { return l.hash === pane.hash; });
                    label = found ? found.label : null;
                }
                if (!label) continue;
                groups[label] = parseGroupPane(dept.html.slice(pane.start, end));
            }

            if (!Object.keys(groups).length) continue;
            departments[dept.name] = { groups: groups };
            order.push(dept.name);
        }
        return { departments: departments, order: order };
    }

    function buildSchedule(html, fetchedAt, firstFetchedAt) {
        var header = parseScheduleHeader(html);
        var parsed = parseDepartments(html);
        var departments = parsed.departments;
        var order = parsed.order;

        var groupsCount = 0;
        var pairsCount = 0;
        Object.keys(departments).forEach(function (name) {
            var groups = departments[name].groups;
            var names = Object.keys(groups);
            groupsCount += names.length;
            names.forEach(function (g) { pairsCount += groups[g].pairs.length; });
        });

        return {
            source: SCHEDULE_URL,
            fetchedAt: fetchedAt,
            // когда снимок появился впервые: дальше это поле уже не меняется,
            // по нему дневник пишет, с какого момента можно править расписание вручную
            firstFetchedAt: firstFetchedAt || fetchedAt,
            page: header,
            departmentOrder: order,
            departments: departments,
            stats: { departments: order.length, groups: groupsCount, pairs: pairsCount },
        };
    }

    // Порог, ниже которого разбор считается сломанным: сайт поменял вёрстку,
    // а мы не хотим молча затереть рабочий файл пустым. Пусть лучше расписание
    // останется от прошлого раза, чем вкладка станет пустой.
    var MIN_DEPARTMENTS = 5;
    var MIN_GROUPS = 20;
    var MIN_PAIRS = 100;

    function checkSchedule(model) {
        var problems = [];
        if (!model || !model.page) return ["модель расписания пустая"];
        if (!model.page.weekDate) problems.push("не удалось прочитать дату недели с сайта");
        if (!model.page.parity) problems.push("не удалось прочитать чётность недели");
        if (!model.stats || model.stats.departments < MIN_DEPARTMENTS) {
            problems.push("отделений " + (model.stats ? model.stats.departments : 0)
                + ", ожидалось не меньше " + MIN_DEPARTMENTS);
        }
        if (!model.stats || model.stats.groups < MIN_GROUPS) {
            problems.push("групп " + (model.stats ? model.stats.groups : 0)
                + ", ожидалось не меньше " + MIN_GROUPS);
        }
        if (!model.stats || model.stats.pairs < MIN_PAIRS) {
            problems.push("пар " + (model.stats ? model.stats.pairs : 0)
                + ", ожидалось не меньше " + MIN_PAIRS);
        }
        return problems;
    }

    // ——————————————————————————————————
    // ЗАМЕНЫ
    // ——————————————————————————————————

    // Дни недели из строки «(Сегодня)» или «(Суббота)». Сайт пишет оба варианта.
    function weekdayOf(label) {
        var low = String(label || "").toLowerCase();
        if (low === "сегодня") return null;  // восстановим от даты
        return WEEKDAYS_NOM[low] || null;
    }

    function isoOfDotted(ddmmyyyy) {
        var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(ddmmyyyy);
        if (!m) return null;
        var mon = +m[2] - 1;
        if (mon < 0 || mon > 11) return null;
        var d = new Date(+m[3], mon, +m[1]);
        if (d.getMonth() !== mon || d.getDate() !== +m[1]) return null;
        return d;
    }

    // Имена групп в подписи: «ИИ-1-25, ИИ-11-26» — это две группы в одной таблице.
    // Разбиваем по запятой и точке с запятой, чтобы сопоставлять с выбранной группой.
    function splitGroups(caption) {
        var inner = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(caption);
        var s = textReplacements(inner ? inner[1] : caption);
        s = s.replace(/^Группа\s*:?\s*/i, "");
        var parts = s.split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
        return parts.length ? parts : [s];
    }

    // ФИО преподавателя в конце ячейки: «И.О. Фамилия», иногда несколько через запятую.
    // Предмет и преподаватель на сайте лежат одной строкой, поэтому режем по шаблону ФИО.
    var TEACHER_TAIL = /(?:^|[\s\u00A0])((?:[А-ЯЁ]\.[А-ЯЁ]\.\s*)?[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.)?(?:,\s*(?:[А-ЯЁ]\.\s?[А-ЯЁ]\.\s*)?[А-ЯЁ][а-яё]+)*)\s*$/;

    function splitSubject(cellHtml) {
        var raw = textReplacements(cellHtml);
        if (!raw) return { subj: null, teacher: null };
        // «Дополнительное занятие», «Занятие отменено с применением…» — тут нет ФИО
        var m = TEACHER_TAIL.exec(raw);
        if (m && raw.length > m[1].length + 1) {
            return { subj: raw.slice(0, m.index).trim() || null, teacher: m[1].trim() || null };
        }
        return { subj: raw, teacher: null };
    }

    function parseReplacementTable(tblHtml) {
        var groups = splitGroups(tblHtml);
        var rows = [];
        var trs = tblHtml.match(/<tr>([\s\S]*?)<\/tr>/gi) || [];
        for (var i = 0; i < trs.length; i++) {
            var cells = trs[i].match(/<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi) || [];
            if (!cells.length) continue;
            var byClass = {};
            for (var c = 0; c < cells.length; c++) {
                var cm = /<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/i.exec(cells[c]);
                if (cm) byClass[cm[1].replace(/\s+/g, " ").trim()] = textReplacements(cm[2]);
            }
            var pairNo = byClass["lesson-number"];
            if (!pairNo || !/^[1-9]\d*$/.test(pairNo)) continue;
            var from = splitSubject(byClass["replace-from"] || "");
            var to = splitSubject(byClass["replace-to"] || "");
            rows.push({
                pair: +pairNo,
                from: byClass["replace-from"] || null,
                to: byClass["replace-to"] || null,
                fromSubj: from.subj,
                fromTeacher: from.teacher,
                toSubj: to.subj,
                toTeacher: to.teacher,
                addedAt: byClass["updated-at"] || null,
            });
        }
        if (!rows.length) return null;
        return { groups: groups, rows: rows };
    }

    function buildReplacements(html, fetchedAt) {
        // Разделы: <h4>Замены на <b>ДД.ММ.ГГГГ</b> (День недели)</h4>
        var marks = [];
        var re = /<h4[^>]*>\s*Замены на\s*([\s\S]*?)<\/h4>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            marks.push({ text: textReplacements(m[1]), at: m.index });
        }

        var weekdayNames = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
        var days = [];
        for (var i = 0; i < marks.length; i++) {
            var from = marks[i].at;
            var to = i + 1 < marks.length ? marks[i + 1].at : html.length;
            var dm = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(marks[i].text);
            var wm = /\(([^)]*)\)/.exec(marks[i].text);
            var date = dm ? dm[1] : null;
            var dObj = date ? isoOfDotted(date) : null;

            var groups = [];
            var tables = html.slice(from, to).match(/<table[\s\S]*?<\/table>/gi) || [];
            for (var t = 0; t < tables.length; t++) {
                var parsed = parseReplacementTable(tables[t]);
                if (parsed) groups.push(parsed);
            }
            if (!dObj || !groups.length) continue;

            days.push({
                date: dObj.getFullYear() + "-" + pad2(dObj.getMonth() + 1) + "-" + pad2(dObj.getDate()),
                dateText: date,
                // «(Сегодня)» годен только в день публикации, поэтому подставляем
                // настоящее название дня недели от самой даты
                weekday: weekdayOf(wm ? wm[1] : "") || weekdayNames[dObj.getDay()],
                monthText: MONTHS_NOM[dObj.getMonth()],
                today: !!(wm && /^сегодня$/i.test(wm[1])),
                groups: groups,
            });
        }

        var groupNames = [];
        var rowCount = 0;
        for (var d = 0; d < days.length; d++) {
            for (var g = 0; g < days[d].groups.length; g++) {
                var names = days[d].groups[g].groups;
                for (var n = 0; n < names.length; n++) {
                    if (groupNames.indexOf(names[n]) === -1) groupNames.push(names[n]);
                }
                rowCount += days[d].groups[g].rows.length;
            }
        }
        groupNames.sort();

        return {
            source: REPLACEMENTS_URL,
            fetchedAt: fetchedAt,
            days: days,
            groupNames: groupNames,
            stats: { days: days.length, groups: groupNames.length, rows: rowCount },
        };
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    // Проверка разбора. Замен на конкретный день может не быть вообще — это
    // нормальное состояние, поэтому считать их нельзя. Проверяем, что страница
    // узнаваема: либо есть разделы по датам, либо разметка таблиц замен на месте.
    // Иначе пустой файл затёр бы рабочий, а сайт молча показал бы «замен нет».
    function checkReplacements(model, html) {
        var problems = [];
        var looksLikePage = /Замены на\s*<b>|replace-from/.test(html);
        if (!looksLikePage) problems.push("страница не похожа на список замен: нет ни дат, ни таблиц");
        if (!model || !model.stats || !model.stats.days) problems.push("не удалось прочитать ни одной даты замен");
        return problems;
    }

    root.MPTParse = {
        SCHEDULE_URL: SCHEDULE_URL,
        REPLACEMENTS_URL: REPLACEMENTS_URL,
        buildSchedule: buildSchedule,
        checkSchedule: checkSchedule,
        buildReplacements: buildReplacements,
        checkReplacements: checkReplacements,
        limits: { departments: MIN_DEPARTMENTS, groups: MIN_GROUPS, pairs: MIN_PAIRS },
    };
})(typeof window !== "undefined" ? window : this);
