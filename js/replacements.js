// Замены: список для выбранной группы. Данные приходят файлом
// data/replacements.js, который обновляет tools/fetch-replacements.mjs.
(function () {
    "use strict";

    var DATA = window.MPTData;
    var root = document.getElementById("replacements-list");
    var empty = document.getElementById("replacements-empty");
    var emptySub = document.getElementById("replacements-empty-sub");
    var stamp = document.getElementById("replacements-updated");
    var meta = document.getElementById("replacements-meta");
    if (!DATA || !root) return;

    function esc(s) {
        return String(s === null || s === undefined ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // «Занятие отменено…» и «Дополнительное занятие» — это не предмет,
    // а статус, поэтому помечаем такие строки отдельно.
    function kindOf(row) {
        var to = row.to || "";
        if (/отмен/i.test(to)) return "cancel";
        if (/дополнительн/i.test(row.from || "")) return "extra";
        return "change";
    }

    function rowHtml(row) {
        var kind = kindOf(row);
        var to = row.to || "—";
        return '<div class="rep-row rep-' + kind + '">'
            + '<span class="rep-pair">' + row.pair + '</span>'
            + '<span class="rep-body">'
            + '<span class="rep-from">' + esc(row.from || "—") + '</span>'
            + '<span class="rep-arrow" aria-hidden="true">→</span>'
            + '<span class="rep-to">' + esc(to) + '</span>'
            + (row.addedAt ? '<span class="rep-added">добавлено ' + esc(row.addedAt) + '</span>' : "")
            + "</span>"
            + "</div>";
    }

    function dayHtml(day) {
        return '<section class="rep-day">'
            + '<h2 class="rep-day-head">'
            + esc(day.weekday)
            + (day.today ? " · сегодня" : "")
            + '<span class="rep-day-date">' + esc(day.dateText) + "</span>"
            + "</h2>"
            + day.rows.map(rowHtml).join("")
            + "</section>";
    }

    // Время проверки — московское: снимок хранит UTC, см. DATA.fmtMoscow

    function render() {
        var days = DATA.replacementsFor();
        var total = 0;
        for (var i = 0; i < days.length; i++) total += days[i].rows.length;

        if (!DATA.replacementsAvailable) {
            root.innerHTML = "";
            empty.classList.remove("hidden");
            var live = window.MPTLive && window.MPTLive.state ? window.MPTLive.state() : null;
            var fail = live && live.replacements ? live.replacements.error : null;
            emptySub.textContent = fail
                ? "Не удалось получить замены с mpt.ru — проверьте интернет"
                : "Загружаем замены с mpt.ru…";
            if (stamp) stamp.textContent = "";
            if (meta) meta.textContent = "";
            return;
        }

        root.innerHTML = days.map(dayHtml).join("");
        empty.classList.toggle("hidden", total > 0);

        if (total) {
            // Подсказка без группы нужна редко, поэтому конкретную убираем
            emptySub.textContent = "";
        } else {
            emptySub.textContent = "Для группы " + DATA.grupa + " на ближайшие дни замен не найдены";
        }

        var when = DATA.fmtMoscow(DATA.replacementsFetchedAt);
        if (stamp) {
            stamp.textContent = when
                ? "Замены проверены " + when + " МСК · обновляются раз в полчаса"
                : "Замены обновляются раз в полчаса";
        }
        if (meta) {
            meta.textContent = total
                ? total + (total % 10 === 1 && total % 100 !== 11 ? " замена"
                    : (total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 10 || total % 100 >= 20)
                        ? " замены" : " замен"))
                : "";
        }
    }

    DATA.onChange(function () {
        render();
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", render);
    } else {
        render();
    }
})();