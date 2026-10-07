// Смена расписания не должна переписывать прошлое: дневник помнит версии,
// и всё до даты изменения остаётся на старой. Проверяем на живых данных
// с замканным «расписанием», которое меняется на следующей же загрузке.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HISTORY_KEY = "mpt-schedule-history-v1";
const DAYS = ["\u041f\u041d", "\u0412\u0422", "\u0421\u0420", "\u0427\u0422", "\u041f\u0422", "\u0421\u0411"];
const OTDEL = "09.02.07 \u041f,\u0422";
const GRUPA = "\u041f-5-25";

let pass = 0;
let fail = 0;
function t(name, fn) {
    try {
        fn();
        pass++;
        console.log("  ok   " + name);
    } catch (e) {
        console.log("  FAIL " + name + "\n       " + e.message);
        fail++;
    }
}
function eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error((msg || "") + " ожидалось " + JSON.stringify(b)
            + ", получено " + JSON.stringify(a));
    }
}
function ok(v, msg) {
    if (!v) throw new Error(msg || "ожидалось истинное значение");
}
function pad(n) { return (n < 10 ? "0" : "") + n; }
function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function boot() {
    const html = fs.readFileSync(path.join(ROOT, "diary.html"), "utf8")
        .replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/diary.html",
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.localStorage.clear();
    w.localStorage.setItem("mpt-otdel", OTDEL);
    w.localStorage.setItem("mpt-grupa", GRUPA);
    w.eval(fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8"));
    for (const f of ["js/data.js", "js/theme.js", "js/diary.js"]) {
        w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    return w;
}

function setMode(w, mode) {
    const b = w.document.querySelector('#view-mode .mode-btn[data-mode="' + mode + '"]');
    b.dispatchEvent(new w.Event("click", { bubbles: true }));
}
function shiftWeek(w, n) {
    const btn = n < 0 ? w.document.getElementById("diary-prev") : w.document.getElementById("diary-next");
    for (let i = 0; i < Math.abs(n); i++) btn.dispatchEvent(new w.Event("click", { bubbles: true }));
}
function goToday(w) {
    w.document.getElementById("diary-today").dispatchEvent(new w.Event("click", { bubbles: true }));
}

// Предмет в ячейке недели: pair — номер пары, dayIdx — 0…5
function weekSubj(w, pair, dayIdx) {
    const tr = w.document.querySelectorAll("#diary-table tbody tr")[pair - 1];
    if (!tr) return null;
    const td = tr.children[dayIdx + 1];
    if (!td) return null;
    const s = td.querySelector(".d-subj");
    return s ? s.textContent : null;
}
function band(w, tableId) {
    const span = w.document.querySelector("#" + tableId + " tfoot .stale-cell");
    if (!span) return null;
    return {
        cols: +span.getAttribute("colspan"),
        text: span.querySelector(".stale-band").textContent
    };
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = addDays(today, 1);
const viewMonday = (function () {
    const d = new Date(today);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
})();
const SEAL = "СЕВЕРНЫЙ ВЕТЕР";

console.log("Сегодня " + iso(today) + ", стык ожидается " + iso(tomorrow) + "\n");

// Первую загрузку архивируем, потом меняем расписание в том же окне —
// так же, как выглядит перезагрузка страницы после обновления data/schedule.js
const w = boot();
const group = w.MPTSchedule.departments[OTDEL].groups[GRUPA];
const pair = group.pairs.find((p) => p.w1 && p.w2 && p.w1.subj && p.w1.subj === p.w2.subj);
ok(pair, "у группы нет пары с одинаковыми половинами");
const dayIdx = DAYS.indexOf(pair.day);
const OLD = pair.w1.subj;
console.log("Меняем пару " + pair.pair + " в " + pair.day + ": «" + OLD + "» → «" + SEAL + "»\n");

console.log("== До изменений ==");
t("заведена одна версия расписания", () => {
    eq(w.MPTData.versions().length, 1, "версий:");
});
t("первая версия действует без ограничения снизу", () => {
    eq(w.MPTData.versions()[0].from, null, "from:");
});
t("повторный выбор группы не плодит версии", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    w.MPTData.selectGroup(OTDEL, GRUPA);
    eq(w.MPTData.versions().length, 1, "версий:");
});
t("в прошедшей клетке ставится оценка", () => {
    goToday(w);
    setMode(w, "week");
    shiftWeek(w, -1);
    const td = w.document.querySelectorAll("#diary-table tbody tr")[pair.pair - 1].children[dayIdx + 1];
    const add = td.querySelector(".d-mark-add");
    ok(add, "в клетке нет кнопки «+»");
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="5"]').dispatchEvent(new w.Event("click", { bubbles: true }));
    const again = w.document.querySelectorAll("#diary-table tbody tr")[pair.pair - 1].children[dayIdx + 1];
    eq(again.querySelector(".d-mark").textContent, "5", "оценка в клетке:");
});
t("ни неделя, ни месяц не показывают плашку", () => {
    goToday(w);
    setMode(w, "week");
    eq(band(w, "diary-table"), null);
    setMode(w, "month");
    eq(band(w, "diary-month-table"), null);
});

// ————— собственно смена расписания —————
pair.w1.subj = SEAL;
pair.w2.subj = SEAL;
w.MPTData.selectGroup(OTDEL, GRUPA);

console.log("\n== После смены расписания ==");
t("появилась вторая версия с датой «завтра»", () => {
    const v = w.MPTData.versions();
    eq(v.length, 2, "версий:");
    eq(v[1].from, iso(tomorrow), "дата вступления в силу:");
});
t("архив записан в localStorage", () => {
    const raw = w.localStorage.getItem(HISTORY_KEY);
    ok(raw, "ключа " + HISTORY_KEY + " нет");
    const all = JSON.parse(raw);
    eq(Object.keys(all).length, 1, "отделений/групп в архиве:");
    eq(all[OTDEL + "|" + GRUPA].length, 2, "версий в архиве:");
});
t("повторная загрузка того же расписания не добавляет версию", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    w.MPTData.selectGroup(OTDEL, GRUPA);
    eq(w.MPTData.versions().length, 2, "версий:");
});
t("сегодня и раньше — старая версия, завтра и дальше — новая", () => {
    ok(w.MPTData.isStaleDate(today), "сегодня должно быть по старой версии");
    ok(w.MPTData.isStaleDate(addDays(today, -1)), "вчера должно быть по старой версии");
    ok(w.MPTData.isStaleDate(addDays(today, -40)), "месяц назад должно быть по старой версии");
    ok(!w.MPTData.isStaleDate(tomorrow), "завтра должно быть по новой версии");
    ok(!w.MPTData.isStaleDate(addDays(tomorrow, 30)), "через месяц должно быть по новой версии");
});
t("прошлая неделя показывает старый предмет", () => {
    goToday(w);
    setMode(w, "week");
    shiftWeek(w, -1);
    eq(weekSubj(w, pair.pair, dayIdx), OLD, "предмет в прошлой неделе:");
});
t("будущая неделя показывает новый предмет", () => {
    goToday(w);
    setMode(w, "week");
    shiftWeek(w, 1);
    eq(weekSubj(w, pair.pair, dayIdx), SEAL, "предмет в будущей неделе:");
});

console.log("\n== Плашка в неделе ==");
t("плашка тянется ровно по старые дни текущей недели", () => {
    goToday(w);
    setMode(w, "week");
    let want = 0;
    for (let i = 0; i < 6; i++) {
        if (addDays(viewMonday, i).getTime() <= today.getTime()) want++;
    }
    const b = band(w, "diary-table");
    ok(b, "плашки нет");
    eq(b.cols, want, "старых дней в неделе:");
    eq(b.text, "старое расписание до " + pad(today.getDate()) + "." + pad(today.getMonth() + 1)
        + "." + today.getFullYear(), "подпись:");
});
t("в прошедшей неделе плашка закрывает все дни", () => {
    shiftWeek(w, -1);
    const b = band(w, "diary-table");
    ok(b, "плашки нет");
    eq(b.cols, 6, "столбцов под плашкой:");
    ok(/\d\d\.\d\d\.\d{4}$/.test(b.text), "подпись без даты: " + b.text);
});
t("в неделе без старых дней плашки нет", () => {
    goToday(w);
    shiftWeek(w, 2);
    eq(band(w, "diary-table"), null);
    shiftWeek(w, -2);
});

console.log("\n== Плашка в месяце ==");
// Месячный вид открывается на текущем месяце, поэтому сверяемся не с календарём,
// а с самими колонками: старые дни считаем теми же правилами, что и дневник.
function monthCols(w) {
    return [...w.document.querySelectorAll("#diary-month-table thead .ms-day-th")]
        .map((th) => th.getAttribute("data-jump-day"));
}
function oldCols(w, dates) {
    return dates.filter((iso) => {
        const p = iso.split("-");
        return w.MPTData.isStaleDate(new Date(+p[0], +p[1] - 1, +p[2]));
    });
}
t("в месяце плашка тянется по старым дням и подписана последним", () => {
    goToday(w);
    setMode(w, "month");
    const dates = monthCols(w);
    const old = oldCols(w, dates);
    const b = band(w, "diary-month-table");
    if (!old.length) {
        // месяц целиком новый — плашки быть не должно
        eq(b, null, "в месяце без старых дней плашки быть не должно");
        return;
    }
    ok(b, "плашки нет");
    eq(b.cols, old.length, "старых дней под плашкой:");
    // Подпись называет последний день, когда ещё действовало старое расписание, —
    // это сегодня (новое вступает завтра). Последняя колонка тут не годится: если
    // сегодня у группы выходной, колонки для него в таблице нет, и подпись
    // законно уходит на день дальше последней колонки.
    eq(b.text, "старое расписание до " + pad(today.getDate()) + "." + pad(today.getMonth() + 1)
        + "." + today.getFullYear(), "подпись:");
    // плашка должна начинаться сразу после колонок «№» и «Предмет»
    const lead = w.document.querySelector("#diary-month-table tfoot .stale-lead");
    eq(+lead.getAttribute("colspan"), 2, "колонок слева:");
});
t("в прошлом месяце плашка закрывает все дни", () => {
    // Стык наступает не раньше сегодняшнего дня, поэтому любой прошлый
    // месяц целиком лежит до него и должен быть старым целиком.
    goToday(w);
    setMode(w, "month");
    w.document.getElementById("diary-prev").dispatchEvent(new w.Event("click", { bubbles: true }));
    const b = band(w, "diary-month-table");
    ok(b, "плашки в прошлом месяце нет");
    const ths = monthCols(w);
    ok(ths.length > 0, "в прошлом месяце нет дней");
    eq(b.cols, ths.length, "столбцов дней в месяце:");
    eq(oldCols(w, ths).length, ths.length, "не все дни месяца считаются старыми:");
    ok(/старое расписание до \d\d\.\d\d\.\d{4}$/.test(b.text), "подпись: " + b.text);
    goToday(w);
    setMode(w, "week");
});


console.log("\n== Оценки в старых днях ==");
t("оценка в прошедшей клетке не пропадает после смены расписания", () => {
    goToday(w);
    setMode(w, "week");
    shiftWeek(w, -1);
    const td = w.document.querySelectorAll("#diary-table tbody tr")[pair.pair - 1].children[dayIdx + 1];
    const chip = td.querySelector(".d-mark");
    ok(chip, "отметки нет в клетке");
    eq(chip.textContent, "5", "отметка:");
    eq(td.querySelector(".d-subj").textContent, OLD, "предмет в старой клетке:");
});

console.log("\n== Годовой вид ==");
t("год не падает и делит предмет по преподавателям", () => {
    goToday(w);
    setMode(w, "year");
    const rows = w.document.querySelectorAll("#diary-year-table tbody tr");
    ok(rows.length > 0, "годовая таблица пустая");
    const subs = [...rows].map((tr) => tr.querySelector(".ms-subj-th").textContent);
    ok(subs.some((s) => s.indexOf(SEAL) !== -1), "нового предмета в году нет");
});

console.log("\n" + pass + " ok, " + fail + " fail");
process.exit(fail ? 1 : 0);
