(function () {
    "use strict";

    var DATA = window.MPTData;
    if (!DATA) return;

    var DAYS = DATA.DAYS;
    var WEEK_W1 = DATA.WEEK_W1;
    var WEEK_W2 = DATA.WEEK_W2;
    var PAIR_TIMES = DATA.PAIR_TIMES;

    // ——————————————————————————————————
    // ФОРМАТИРОВАНИЕ ДАТЫ
    // ——————————————————————————————————
    function fmtDate(d) {
        var months = [
            "января", "февраля", "марта", "апреля", "мая", "июня",
            "июля", "августа", "сентября", "октября", "ноября", "декабря"
        ];
        var weekdays = [
            "Воскресенье", "Понедельник", "Вторник", "Среда",
            "Четверг", "Пятница", "Суббота"
        ];
        return weekdays[d.getDay()] + ", " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
    }

    // Время обновления — московское: снимок хранит UTC, см. DATA.fmtMoscow
    function fmtStamp(iso) {
        return DATA.fmtMoscow(iso);
    }

    // ——————————————————————————————————
    // РЕНДЕРИНГ
    // ——————————————————————————————————
    function buildWindow(items, isAbsent, weekCls) {
        if (isAbsent || items.length === 0) {
            // «нет пары» — окно недели, поэтому рамка как у пары; прочерк — просто пусто
            var cls = isAbsent ? "wcell-empty wcell-absent" : "wcell-empty";
            return '<span class="wcell ' + weekCls + " " + cls + '">' +
                (isAbsent ? "нет пары" : "—") + "</span>";
        }
        var h = '<span class="wcell ' + weekCls + '">';
        for (var i = 0; i < items.length; i++) {
            h += '<span class="subj">' + items[i].subj + "</span>";
            h += '<span class="teacher">' + (items[i].teacher || "—") + "</span>";
        }
        return h + "</span>";
    }

    function render() {
        var dateEl = document.getElementById("schedule-date");
        if (dateEl) dateEl.textContent = fmtDate(new Date());

        renderStamp();

        var grid = document.getElementById("days-grid");
        if (!grid) return;

        // Данных с сайта ещё нет: страница сама сходит за ними (js/live.js), и
        // обычно это занимает пару секунд. Показываем «загружаем расписание»,
        // а не шесть карточек «Выходной» — те врали бы про выходной день.
        if (!DATA.available) {
            grid.innerHTML = '<div class="no-replacements">' +
                '<div class="nr-title">Загружаем расписание</div>' +
                '<div class="nr-sub">Данные придут с mpt.ru — обычно это пара секунд</div>' +
                "</div>";
            return;
        }

        var todayKey = DAYS[new Date().getDay() - 1];

        var html = "";
        for (var d = 0; d < DAYS.length; d++) {
            html += dayCardHtml(DAYS[d], DAYS[d] === todayKey);
        }

        grid.innerHTML = html;
    }

    // Карточка одного дня. Отдаём её наружу (MPTScheduleView), чтобы окошко
    // расширения рисовало день ровно этим кодом, а не своей копией вида:
    // две копии разошлись бы при первой же правке оформления.
    function dayCardHtml(key, isToday, lessonsOfDay) {
        var DAYS_INFO = DATA.DAYS_INFO;
        var info = DAYS_INFO[key] || { name: key, building: "", off: true };
        // Обычно пары берутся из текущего расписания, но для перемотки на другой
        // день их можно передать: расписание на завтра может отличаться
        var lessons = lessonsOfDay || DATA.SCHEDULE[key] || [];
        var cardCls = isToday ? "day-card today" : "day-card";
        var html = "";

        // День без учебных занятий у этой группы
        if (info.off || lessons.length === 0) {
            html += '<div class="' + cardCls + ' day-off-card">';
            html += '<div class="day-card-head">' + info.name +
                '<span class="building">' + (info.building || "—") + "</span></div>";
            html += '<div class="day-card-empty">Выходной</div>';
            html += "</div>";
            return html;
        }

        html += '<div class="' + cardCls + '">';
        html += '<div class="day-card-head">' + info.name +
            '<span class="building">' + (info.building || "—") + "</span></div>";

        html += '<div class="day-card-body">';

        // Всегда выводим 5 пар, чтобы карточки были ровными
        for (var p = 1; p <= 5; p++) {
            var time = PAIR_TIMES[p] ? PAIR_TIMES[p] : "";

            // Разбираем записи по неделям
            var w1Items = [];
            var w2Items = [];
            var w1Absent = false;
            var w2Absent = false;
            var hasVariation = false;

            for (var i = 0; i < lessons.length; i++) {
                var it = lessons[i];
                if (it.pair !== p) continue;
                if (it.absent) {
                    hasVariation = true;
                    if (it.absent === WEEK_W1) w1Absent = true;
                    else w2Absent = true;
                } else if (it.week === WEEK_W1) {
                    hasVariation = true;
                    w1Items.push(it);
                } else if (it.week === WEEK_W2) {
                    hasVariation = true;
                    w2Items.push(it);
                } else {
                    w1Items.push(it);
                    w2Items.push(it);
                }
            }

            html += '<div class="day-row">';
            html += '<span class="pair-cell"><span class="pair-num">' + p + '</span>' +
                (time ? '<span class="pair-time">' + time + "</span>" : "") + "</span>";

            // Пары без изменений — одно окно
            if (!hasVariation) {
                if (w1Items.length === 0) {
                    html += '<span class="wcell wcell-empty">—</span>';
                } else {
                    html += '<span class="wcell wcell-plain">';
                    for (var j = 0; j < w1Items.length; j++) {
                        html += '<span class="subj">' + w1Items[j].subj + "</span>";
                        html += '<span class="teacher">' + (w1Items[j].teacher || "—") + "</span>";
                    }
                    html += "</span>";
                }
            } else {
                // Меняющаяся пара — два окна друг под другом
                html += '<span class="week-cells">';
                html += buildWindow(w1Items, w1Absent, "w1");
                html += buildWindow(w2Items, w2Absent, "w2");
                html += "</span>";
            }

            html += "</div>";
        }

        html += "</div>";
        html += "</div>";
        return html;
    }

    // Неделя — пилюля рядом с датой, время обновления — подпись под расписанием
    function renderStamp() {
        var weekEl = document.getElementById("schedule-week");
        if (weekEl) {
            var parity = DATA.parityOfDate(new Date());
            weekEl.textContent = "неделя " + (parity ? parity.toLowerCase() : "—");
            weekEl.className = DATA.available ? "meta-date meta-week" : "meta-date meta-week warn";
        }

        var capEl = document.getElementById("schedule-updated");
        if (!capEl) return;
        if (!DATA.available) {
            // Данных ещё нет: либо их вот-вот принесёт js/live.js, либо он уже
            // сходил и не смог — тогда говорим об этом прямо, а не «загружаем».
            var live = window.MPTLive && window.MPTLive.state ? window.MPTLive.state() : null;
            var fail = live && live.schedule ? live.schedule.error : null;
            capEl.textContent = fail
                ? "Не удалось получить данные с mpt.ru — проверьте интернет"
                : "Загружаем данные с mpt.ru…";
            capEl.className = fail ? "schedule-caption warn" : "schedule-caption";
            capEl.title = fail || "";
            return;
        }
        var when = fmtStamp(DATA.updatedAt);
        capEl.textContent = when
            ? "Расписание с mpt.ru, обновлено " + when + " МСК"
            : "Расписание с mpt.ru";
        capEl.className = "schedule-caption";
        capEl.title = DATA.sourceUrl || "";
    }

    // Смена отделения/группы в настройках
    DATA.onChange(render);

    // Отрисовка дня — наружу, для окошка расширения: оно показывает тот же
    // день тем же кодом и с теми же стилями, что и сайт.
    window.MPTScheduleView = {
        dayCardHtml: dayCardHtml,
        fmtDate: fmtDate,
        fmtStamp: fmtStamp,
        renderStamp: renderStamp
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", render);
    }
    render();
})();
