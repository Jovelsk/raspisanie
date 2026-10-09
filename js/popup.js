// Окошко расширения: сегодняшний день из дневника и переход на сайт.
//
// Данные берём из общего хранилища. Сайт лежит внутри расширения, поэтому у
// страницы и у окошка один origin и один localStorage — никаких пересылок
// между расширением и сайтом не нужно. Если открыть сайт как файл на диске,
// у него будет своё хранилище: расширение туда не заглядывает.
(function () {
    "use strict";

    var DATA = window.MPTData || null;
    var Live = window.MPTLive || null;
    var DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
    var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря"];

    function el(id) { return document.getElementById(id); }

    // Понедельник — первый день, как в расписании сайта
    function dayKey(date) { return DAYS[(date.getDay() + 6) % 7]; }

    // День недели в подписи не пишем: он и так в шапке карточки
    function dateText(date) {
        return date.getDate() + " " + MONTHS[date.getMonth()];
    }

    function openSite() {
        if (window.chrome && window.chrome.tabs && window.chrome.runtime) {
            window.chrome.tabs.create({ url: window.chrome.runtime.getURL("index.html") });
        } else {
            window.location.href = "index.html";
        }
    }

    function note(text, cls) {
        var div = document.createElement("div");
        div.className = cls;
        div.textContent = text;
        return div;
    }

    // Запись расписания: номер пары, предмет, преподаватель. Пара, которая
    // идёт только в другую неделю, приходит без предмета — показываем прочерк.
    function pairRow(item) {
        var row = document.createElement("div");
        row.className = "popup-pair";

        var num = document.createElement("div");
        num.className = "popup-pair-num";
        num.textContent = item.pair || "";

        var body = document.createElement("div");
        body.className = "popup-pair-body";

        var subj = document.createElement("div");
        subj.className = "popup-pair-subj";
        subj.textContent = item.subj || "—";
        body.appendChild(subj);

        if (item.teacher) {
            var teacher = document.createElement("div");
            teacher.className = "popup-pair-teacher";
            teacher.textContent = item.teacher;
            body.appendChild(teacher);
        }

        row.appendChild(num);
        row.appendChild(body);
        return row;
    }

    // Показанный день. По умолчанию — сегодня, ходить можно только на вчера и
    // завтра: дальше стрелки замолкают
    var viewDate = startOfToday();

    function startOfToday() {
        var d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();
    }

    function shiftDay(step) {
        var today = startOfToday();
        var next = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate() + step);
        var away = Math.round((next - today) / 86400000);
        if (away < -1 || away > 1) return;
        viewDate = next;
        render();
    }

    // Стрелки: вчера и завтра. На краю — замолкают
    function syncArrows(today) {
        var away = Math.round((viewDate - today) / 86400000);
        var prev = el("popup-prev");
        var next = el("popup-next");
        if (prev) prev.disabled = away <= -1;
        if (next) next.disabled = away >= 1;
    }

    function render() {
        var list = el("popup-list");
        var title = el("popup-title");
        var sub = el("popup-sub");
        if (!list || !title || !sub) return;

        var today = startOfToday();
        renderReplacements(viewDate);
        var day = dayKey(viewDate);
        var grupa = (DATA && DATA.grupa) ? DATA.grupa : "";
        var otdel = (DATA && DATA.otdel) ? DATA.otdel : "";

        title.textContent = grupa ? (otdel ? otdel + " · " + grupa : grupa) : "Группа не выбрана";

        // Корпус и день недели уже видны в карточке, поэтому в подписи — дата и
        // название чётности недели: её в карточке нет, а знать нужно
        var parity = (DATA && DATA.parityOfDate) ? DATA.parityOfDate(viewDate) : "";
        sub.textContent = dateText(viewDate) + (parity ? " · " + parity : "");
        syncArrows(today);

        list.innerHTML = "";

        if (!DATA || !DATA.available) {
            list.appendChild(note("Загружаем данные с mpt.ru…", "popup-loading"));
            return;
        }
        if (!grupa) {
            list.appendChild(note("Группа не выбрана. Откройте сайт и выберите её в настройках.", "popup-empty"));
            return;
        }

        // Пары берём на показанный день: расписание на завтра может отличаться от
        // сегодняшнего, поэтому передаём их в отрисовку явно
        var grid = DATA.scheduleForDate ? DATA.scheduleForDate(viewDate) : null;
        var lessons = (grid && grid[day]) ? grid[day] : [];

        // День рисуем тем же кодом, что и сайт: вид не разъедется при правках
        var view = window.MPTScheduleView;
        if (view && view.dayCardHtml) {
            list.innerHTML = '<div class="popup-day-grid">' +
                view.dayCardHtml(day, sameDay(viewDate, today), lessons) + "</div>";
            decorateMarks(viewDate);
            return;
        }

        // Запасной путь: если отрисовка сайта почему-то не подключилась
        var pairs = lessons;
        if (!pairs.length) {
            list.appendChild(note("На этот день пар нет.", "popup-empty"));
            return;
        }
        for (var i = 0; i < pairs.length; i++) {
            list.appendChild(pairRow(pairs[i]));
        }
    }

    // ——————————————————————————————————
    // ОТМЕТКИ ПРЯМО В КАРТОЧКЕ
    // Пользуемся функциями дневника (MPTDiary), поэтому отметка ложится в то же
    // хранилище и к той же группе, что и в дневнике на сайте: ключ группы общий.
    //——————————————————————————————————-

    var MARK_VALUES = ["5", "4", "3", "2", "н", "б"];

    // Класс цвета — тот же, что на сайте: g5, g4, g3, g2, gn, gb. Благодаря этому
    // цвета приходят из общей таблицы стилей, а не задаются заново здесь
    function markCls(val) {
        if (val === "н") return "gn";
        if (val === "б") return "gb";
        return "g" + val;
    }

    function currentMarks(date, pair) {
        if (!window.MPTDiary || !window.MPTDiary.marksFor) return [];
        return window.MPTDiary.marksFor(date, pair) || [];
    }

    // Нажали на оценку: такая уже стоит — убираем, иначе добавляем
    function toggleMark(date, pair, val) {
        var D = window.MPTDiary;
        if (!D) return;
        var now = currentMarks(date, pair);
        var at = now.indexOf(val);
        if (at === -1) {
            D.addOneMark(date, pair, val);
        } else {
            now.splice(at, 1);
            D.setMarks(date, pair, now);
        }
        render();
    }

    // Открыть выбор отметки для этого блока. Открытым держим только один за раз:
    // и плюсик, и сама оценка открывают одно и то же
    function openPick(box) {
        var open = document.querySelectorAll(".mk.mk-open");
        for (var k = 0; k < open.length; k++) {
            if (open[k] !== box) open[k].classList.remove("mk-open");
        }
        box.classList.toggle("mk-open");
    }

    function decorateMarks(date) {
        if (!window.MPTDiary || !window.MPTDiary.marksFor) return;
        var rows = document.querySelectorAll(".popup-day-grid .day-row");
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var numEl = row.querySelector(".pair-num");
            var subjEl = row.querySelector(".subj");
            // Пустые пары (прочерк) не трогаем: ставить отметку не за что
            if (!numEl || !subjEl) continue;
            var pair = parseInt(numEl.textContent, 10);
            if (!pair) continue;

            var box = document.createElement("div");
            box.className = "mk";

            var marks = currentMarks(date, pair);
            for (var m = 0; m < marks.length; m++) {
                // Оценка выглядит как на сайте — только значение. Нажатие на неё
                // открывает тот же выбор, что и плюсик: там её можно и сменить, и снять
                (function (val, self) {
                    var chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "mk-chip d-mark " + markCls(val);
                    chip.textContent = val;
                    chip.title = "Изменить отметку";
                    chip.addEventListener("click", function () { openPick(self); });
                    self.appendChild(chip);
                })(marks[m], box);
            }

            // Плюсик — как на сайте: по нему раскрывается выбор отметки, а не
            // висят шесть кнопок постоянно. Блок передаём в замыкание: box
            // объявлен через var в цикле, и без этого все плюсики открывали бы
            // выбор последней пары
            (function (self) {
                var plus = document.createElement("button");
                plus.type = "button";
                plus.className = "mk-plus d-mark d-mark-add";
                plus.textContent = "+";
                plus.title = "Поставить отметку";
                plus.addEventListener("click", function () { openPick(self); });
                self.appendChild(plus);
            })(box);

            var pick = document.createElement("span");
            pick.className = "mk-pick";
            for (var v = 0; v < MARK_VALUES.length; v++) {
                // Значение и номер пары передаём в замыкание: иначе все кнопки
                // запомнят последнюю пару из цикла
                (function (val, p) {
                    var b = document.createElement("button");
                    b.type = "button";
                    b.className = "mk-btn d-mark " + markCls(val) + (marks.indexOf(val) === -1 ? "" : " mk-on");
                    b.textContent = val;
                    b.addEventListener("click", function () { toggleMark(date, p, val); });
                    pick.appendChild(b);
                })(MARK_VALUES[v], pair);
            }
            // Крестик закрывает выбор, а не снимает отметки: убрать отметку можно
            // крестиком на самой оценке
            // box передаём явно: он объявлен через var в цикле, и внутри обработчика
            // к моменту нажатия это был бы блок последней пары
            (function (row, self) {
                var close = document.createElement("button");
                close.type = "button";
                close.className = "mk-close";
                close.textContent = "×";
                close.title = "Закрыть";
                close.addEventListener("click", function () { self.classList.remove("mk-open"); });
                row.appendChild(close);
            })(pick, box);
            box.appendChild(pick);

            // Отметку ставим в окно той недели, которая показана на эту дату. У
            // пары, разделённой по неделям, окон два, и «нет пары» не должно
            // получать оценку, если занятие в эту неделю есть в другом окне
            var parity = (DATA && DATA.parityOfDate) ? DATA.parityOfDate(date) : "";
            var want = (parity === DATA.WEEK_W2) ? ".wcell.w2" : ".wcell.w1";
            var cell = row.querySelector(want + " .subj") ? row.querySelector(want) : null;
            if (!cell && subjEl.parentNode) cell = subjEl.parentNode;
            if (!cell) cell = row;
            // В это окно занятий нет — ставить отметку не за что
            if (cell !== row && !cell.querySelector(".subj")) continue;
            cell.appendChild(box);
        }
    }

    // ——————————————————————————————————
    // ЗАМЕНЫ НА СЕГОДНЯ
    // Разметку берём ту же, что на странице замен: классы rep-* уже описаны в
    // общей таблице стилей, поэтому вид совпадёт без единой копии оформления.
    //——————————————————————————————————-

    function pad2(n) { return (n < 10 ? "0" : "") + n; }

    function esc(s) {
        return String(s === null || s === undefined ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // «Занятие отменено…» и «Дополнительное занятие» — это не предмет, а статус,
    // поэтому помечаем такие строки отдельно, как и на сайте
    function repKind(row) {
        if (/отмен/i.test(row.to || "")) return "cancel";
        if (/дополнительн/i.test(row.from || "")) return "extra";
        return "change";
    }

    // Снимок замен хранит записи с списком групп. Название группы приходит с того
    // же сайта, что и выбор в настройках, поэтому сравнение точное.
    function renderReplacements(date) {
        var box = el("popup-replacements");
        if (!box) return;
        box.innerHTML = "";

        var model = window.MPTReplacements;
        var grupa = (DATA && DATA.grupa) ? DATA.grupa : "";
        if (!model || !model.days || !grupa) return;

        var iso = date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
        var day = null;
        for (var i = 0; i < model.days.length; i++) {
            if (model.days[i].date === iso) { day = model.days[i]; break; }
        }
        if (!day || !day.groups) return;

        var rows = [];
        for (var g = 0; g < day.groups.length; g++) {
            var entry = day.groups[g];
            if (!entry || !entry.groups) continue;
            if (entry.groups.indexOf(grupa) !== -1) rows = rows.concat(entry.rows || []);
        }
        if (!rows.length) return;

        // Пишем дату, а не «сегодня»: когда появится перемотка на вчера и завтра,
        // заголовок должен называть именно тот день, который показан
        var html = '<div class="popup-rep-head">Замены на ' + dateText(date) + '</div>';
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            html += '<div class="rep-row rep-' + repKind(row) + '">'
                + '<span class="rep-pair">' + row.pair + '</span>'
                + '<span class="rep-body">'
                + '<span class="rep-from">' + esc(row.from || "—") + '</span>'
                + '<span class="rep-arrow" aria-hidden="true">→</span>'
                + '<span class="rep-to">' + esc(row.to || "—") + '</span>'
                + (row.addedAt ? '<span class="rep-added">добавлено ' + esc(row.addedAt) + '</span>' : "")
                + "</span></div>";
        }
        box.innerHTML = html;
    }

    function init() {
        var open = el("popup-open");
        if (open) open.addEventListener("click", openSite);

        var prev = el("popup-prev");
        if (prev) prev.addEventListener("click", function () { shiftDay(-1); });
        var next = el("popup-next");
        if (next) next.addEventListener("click", function () { shiftDay(1); });

        var refresh = el("popup-refresh");
        if (refresh) {
            refresh.addEventListener("click", function () {
                if (!Live || !Live.refresh) return;
                refresh.disabled = true;
                Live.refresh("schedule", true).then(function () {
                    refresh.disabled = false;
                    render();
                });
            });
        }

        // Выбранную группу окошко берёт оттуда же, откуда её берёт сайт
        if (DATA && DATA.init) {
            var otdel = "", grupa = "";
            try {
                otdel = window.localStorage.getItem(DATA.OTDEL_KEY) || "";
                grupa = window.localStorage.getItem(DATA.GRUPA_KEY) || "";
            } catch (e) { /* приватный режим — покажем что есть */ }
            DATA.init(otdel, grupa);
        }
        if (DATA && DATA.onChange) DATA.onChange(render);
        render();
    }

    // В расширении ручная правка расписания не нужна: убираем её разделы из
    // вкладки «Дневник», оставляя выгрузку и загрузку. Ищем по заголовкам, а не
    // по порядку: порядок разделов может поменяться, и тогда спрячем не то.
    function hideManualSections() {
        var pane = document.querySelector('[data-pane="diary"]');
        if (!pane) return;
        var sections = pane.querySelectorAll(".settings-section");
        for (var i = 0; i < sections.length; i++) {
            var title = sections[i].querySelector(".settings-section-title");
            var text = title ? title.textContent.trim().toLowerCase() : "";
            var hide = text.indexOf("ручное расписание") === 0 ||
                text.indexOf("периоды") === 0 ||
                text.indexOf("пары:") === 0;
            sections[i].style.display = hide ? "none" : "";
        }
    }

    // В окошке настройки занимают всю площадь, поэтому «фон» вокруг них — это
    // края окна. На сайте клик по нему закрывает настройки, а здесь они из-за
    // этого сворачивались при промахе. Гасим такие клики заранее (в фазе
    // перехвата, до обработчиков сайта): закрывать будет только крестик.
    document.addEventListener("click", function (e) {
        var t = e.target;
        if (t && t.id === "settings-overlay") e.stopPropagation();
        // Вкладка «Дневник» строится обработчиком этого же клика, поэтому прячем
        // не сейчас, а сразу после него — иначе скрывать ещё нечего
        window.setTimeout(hideManualSections, 0);
    }, true);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
