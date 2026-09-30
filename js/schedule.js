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

    // ——————————————————————————————————
    // РЕНДЕРИНГ
    // ——————————————————————————————————
    function buildWindow(items, isAbsent, weekCls) {
        if (isAbsent || items.length === 0) {
            return '<span class="wcell ' + weekCls + ' wcell-empty">' +
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

        var grid = document.getElementById("days-grid");
        if (!grid) return;

        var todayKey = DAYS[new Date().getDay() - 1];

        var html = "";
        for (var d = 0; d < DAYS.length; d++) {
            var key = DAYS[d];
            var info = DAYS_INFO[key];
            var lessons = SCHEDULE[key];

            var isToday = (key === todayKey);
            var cardCls = isToday ? " day-card today" : " day-card";

            if (lessons.length === 0) {
                html += '<div class="' + cardCls.trim() + ' day-off-card">';
                html += '<div class="day-card-head">' + info.name +
                    '<span class="building">' + info.building + "</span></div>";
                html += '<div class="day-card-empty">' + info.building + "</div>";
                html += "</div>";
                continue;
            }

            html += '<div class="' + cardCls.trim() + '">';
            html += '<div class="day-card-head">' + info.name +
                '<span class="building">' + info.building + "</span></div>";

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
        }

        grid.innerHTML = html;
    }

    document.addEventListener("DOMContentLoaded", render);
    render();
})();