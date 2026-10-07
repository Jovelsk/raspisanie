// Проверка нескольких оценок за пару: модель хранения, средний балл, пропуски,
// годовая таблица и обратная совместимость со старым форматом (строка в клетке).
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STORE_KEY = "mpt-diary-grades-v2";

let pass = 0;
let fail = 0;
function t(name, fn) {
    try {
        fn();
        console.log("  ok   " + name);
        pass++;
    } catch (e) {
        console.log("  FAIL " + name + "\n       " + e.message);
        fail++;
    }
}
function eq(a, b, msg) {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) throw new Error((msg || "") + " ожидалось " + sb + ", получено " + sa);
}
function ok(v, msg) {
    if (!v) throw new Error(msg || "ожидалось истинное значение");
}

// Поднимает diary.html в отдельном контексте с заданными отметками
function boot(gradesSeed) {
    // script-теги вырезаем: jsdom сам их не выполнит (runScripts: outside-only),
    // а мы запускаем их вручную в нужном порядке
    const html = fs.readFileSync(path.join(ROOT, "diary.html"), "utf8")
        .replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/diary.html",
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const w = dom.window;
    w.localStorage.clear();
    // Группу выбираем явно: по умолчанию страница показывает первое отделение
    // с сайта, а отметки в этих проверках стоят у П-5-25
    w.localStorage.setItem("mpt-otdel", "09.02.07 П,Т");
    w.localStorage.setItem("mpt-grupa", "П-5-25");
    if (gradesSeed) w.localStorage.setItem(STORE_KEY, JSON.stringify(gradesSeed));
    w.eval(fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8"));
    for (const f of ["js/data.js", "js/theme.js", "js/diary.js"]) {
        w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    return w;
}

function readMarks(w) {
    return JSON.parse(w.localStorage.getItem(STORE_KEY) || "{}");
}

// Понедельник текущей недели: дневник открывается именно на ней, а отметки
// в тестах лежат в конкретной неделе. Зашитая дата со временем уезжает в
// прошлое, и отметки перестают попадать в показанную неделю.
// Понедельник текущей недели: дневник открывается именно на ней, а отметки
// в тестах лежат в конкретной неделе. Зашитая дата со временем уезжает в
// прошлое, и отметки перестают попадать в показанную неделю.
const MON = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
})();
// Отметки лежат по группам: группа -> неделя -> день -> пара.
// Структура хранилища: store["отделение|группа"][неделя][день][пара]
const GRP = "09.02.07 П,Т|П-5-25";
const seed = (v, day, pair) => ({ [GRP]: { [MON]: { [day || "ПН"]: { [pair || "1"]: v } } } });
const cell = (v) => seed(v);
// Отметки за пару: пустая структура, если её уже вычистили из хранилища
const marksOf = (w) => {
    const all = JSON.parse(w.localStorage.getItem(STORE_KEY) || "{}");
    const group = all[GRP];
    const day = group && group[MON] && group[MON]["ПН"];
    return (day && day["1"]) || [];
};

// Переключает режим просмотра (неделя / месяц / год)
function setMode(w, mode) {
    const btn = w.document.querySelector('#view-mode .mode-btn[data-mode="' + mode + '"]');
    if (!btn) throw new Error("нет кнопки режима " + mode);
    btn.dispatchEvent(new w.Event("click", { bubbles: true }));
}

// Строка годовой таблицы, где стоят все оценки одной пары (по числу чипов)
function yearRow(w, count) {
    const rows = [...w.document.querySelectorAll("#diary-year-table tbody tr")];
    const row = rows.find((r) => r.querySelectorAll(".d-mark").length === count);
    if (!row) {
        throw new Error("в годовой таблице нет строки с " + count
            + " отметками; строк: " + rows.length);
    }
    return row;
}

console.log("== Совместимость со старым форматом ==");
t("старая строка в клетке читается как одна оценка", () => {
    const w = boot(cell("5"));
    const cells = [...w.document.querySelectorAll("#diary-table .d-mark")];
    const five = cells.filter((c) => c.textContent === "5");
    ok(five.length >= 1, "не нашли чип «5», всего чипов: " + cells.length);
    ok(five.every((c) => c.getAttribute("data-slot") === "0"),
        "у единственной оценки слот должен быть 0");
});

t("после первой правки старая строка переписывается в массив", () => {
    const w = boot(cell("5"));
    const five = [...w.document.querySelectorAll("#diary-table .d-mark")].find((c) => c.textContent === "5");
    const add = [...w.document.querySelectorAll("#diary-table .d-mark-add")][0];
    ok(add, "нет кнопки «+»");
    five.dispatchEvent(new w.Event("click", { bubbles: true }));
    const opt = w.document.querySelector('.grade-opt[data-grade="4"]');
    opt.dispatchEvent(new w.Event("click", { bubbles: true }));
    const list = marksOf(w);
    ok(Array.isArray(list), "клетка должна стать массивом, а не " + typeof list);
    eq(list, ["4"], "правка чипа заменяет его значение");
});

console.log("\n== Добавление нескольких оценок ==");
t("кнопка «+» дописывает оценку, не заменяя прежние", () => {
    const w = boot(cell(["5"]));
    const add = [...w.document.querySelectorAll("#diary-table .d-mark-add")][0];
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    const opt = w.document.querySelector('.grade-opt[data-grade="3"]');
    opt.dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(marksOf(w), ["5", "3"]);
});

t("в клетке видны все оценки чипами плюс кнопка «+»", () => {
    const w = boot(cell(["5", "4"]));
    const cellEl = [...w.document.querySelectorAll("#diary-table .d-cell")]
        .find((td) => td.querySelectorAll(".d-mark").length >= 2);
    ok(cellEl, "не нашли клетку с двумя оценками");
    const marks = [...cellEl.querySelectorAll(".d-mark:not(.d-mark-add)")].map((c) => c.textContent);
    eq(marks, ["5", "4"]);
    eq([...cellEl.querySelectorAll(".d-mark")].map((c) => c.getAttribute("data-slot")),
        ["0", "1", "-1"]);
});

t("повтор той же оценки не дублируется", () => {
    const w = boot(cell(["5"]));
    const add = [...w.document.querySelectorAll("#diary-table .d-mark-add")][0];
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="5"]')
        .dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(marksOf(w), ["5"]);
});

t("клик по чипу правит именно его, а не добавляет", () => {
    const w = boot(cell(["5", "4"]));
    const second = [...w.document.querySelectorAll("#diary-table .d-mark")]
        .find((c) => c.getAttribute("data-slot") === "1");
    ok(second, "нет чипа со слотом 1");
    second.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="2"]')
        .dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(marksOf(w), ["5", "2"]);
});

t("«×» удаляет выбранную оценку и пересобирает слоты", () => {
    const w = boot(cell(["5", "4", "3"]));
    const second = [...w.document.querySelectorAll("#diary-table .d-mark")]
        .find((c) => c.getAttribute("data-slot") === "1");
    second.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt.grade-clear')
        .dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(marksOf(w), ["5", "3"]);
    const slots = [...w.document.querySelectorAll("#diary-table .d-mark:not(.d-mark-add)")]
        .filter((c) => c.textContent === "3")
        .map((c) => c.getAttribute("data-slot"));
    eq(slots, ["1"], "после удаления слоты должны сдвинуться");
});

t("удаление последней оценки убирает пару из хранилища", () => {
    const w = boot(cell(["5"]));
    const only = [...w.document.querySelectorAll("#diary-table .d-mark")][0];
    only.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt.grade-clear')
        .dispatchEvent(new w.Event("click", { bubbles: true }));
    const saved = readMarks(w);
    eq(marksOf(w), [], "после удаления клетка должна опустеть");
});

console.log("\n== Статистика считает все оценки ==");
t("«н» и «б» считаются по каждой оценке в паре", () => {
    const w = boot(seed(["н", "н"]));
    setMode(w, "year");
    // н + н = два пропуска, среднего нет
    eq([...yearRow(w, 2).querySelectorAll(".ys-stat")].map((s) => s.textContent), ["—", "2", "0"]);
});

t("пропуск и больничный в одной паре учитываются раздельно", () => {
    const w = boot(seed(["н", "б"]));
    setMode(w, "year");
    eq([...yearRow(w, 2).querySelectorAll(".ys-stat")].map((s) => s.textContent), ["—", "1", "1"]);
});

t("средний балл усредняет все оценки пары", () => {
    const w = boot(seed(["5", "4"]));
    setMode(w, "year");
    eq(yearRow(w, 2).querySelector(".ys-stat").textContent, "4,50", "среднее 5 и 4 = 4,50");
});

t("«н» и «б» не тянут средний балл вниз", () => {
    const w = boot(seed(["5", "н", "б"]));
    setMode(w, "year");
    eq(yearRow(w, 3).querySelector(".ys-stat").textContent, "5,00");
});

t("оценки за пару попадают в строку своего предмета", () => {
    const w = boot(seed(["5", "4"]));
    setMode(w, "year");
    const row = yearRow(w, 2);
    const subj = row.querySelector(".ms-subj-th").textContent;
    // У предмета несколько преподавателей — в скобках подпись
    ok(subj.startsWith("Основы алгоритмизации и программирования"), "предмет: " + subj);
    eq([...row.querySelectorAll(".d-mark")].map((c) => c.textContent), ["5", "4"]);
});

console.log("\n== Месячная таблица ==");
// Месячный вид всегда открывается на текущем месяце, а отметки в тестах
// лежат в конкретной неделе. Домотаем до нужного месяца.
function monthHasDates(w, yyyymm) {
    return [...w.document.querySelectorAll("#diary-month-table thead .ms-day-th")]
        .some((th) => (th.getAttribute("data-jump-day") || "").indexOf(yyyymm) === 0);
}
function showMonthOf(w, yyyymm) {
    setMode(w, "month");
    for (let i = 0; i < 3 && !monthHasDates(w, yyyymm); i++) {
        w.document.getElementById("diary-prev").dispatchEvent(new w.Event("click", { bubbles: true }));
    }
    ok(monthHasDates(w, yyyymm), "не открылся месяц " + yyyymm);
}
t("в месячной таблице пара показывает все свои оценки", () => {
    const w = boot(seed(["5", "4"]));
    showMonthOf(w, MON.slice(0, 7));
    const marks = [...w.document.querySelectorAll("#diary-month-table .d-mark:not(.d-mark-add)")]
        .map((c) => c.textContent);
    ok(marks.includes("5") && marks.includes("4"),
        "в месячной таблице нет обеих оценок: " + marks.join(","));
    const slots = [...w.document.querySelectorAll("#diary-month-table .d-mark:not(.d-mark-add)")]
        .map((c) => c.getAttribute("data-slot"));
    ok(slots.includes("0") && slots.includes("1"), "слоты: " + slots.join(","));
});

t("в месячной таблице «+» правит нужную пару и дату", () => {
    const w = boot(seed(["5"], "ПН", "1"));
    showMonthOf(w, MON.slice(0, 7));
    // За одну дату в месячной таблице строка на каждый предмет, поэтому ищем по дате и паре
    const add = [...w.document.querySelectorAll("#diary-month-table .d-mark-add")]
        .find((b) => b.getAttribute("data-date") === MON && b.getAttribute("data-pair") === "1");
    ok(add, "нет кнопки «+» за " + MON + " пара 1");
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="3"]')
        .dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(marksOf(w), ["5", "3"]);
});

console.log("\n== Пустые значения ==");
t("пустые строки в клетке отбрасываются", () => {
    const w = boot(seed(["", "5", ""]));
    const cellEl = [...w.document.querySelectorAll("#diary-table .d-cell")]
        .find((td) => td.querySelector(".d-mark-add"));
    const marks = [...cellEl.querySelectorAll(".d-mark:not(.d-mark-add)")].map((c) => c.textContent);
    eq(marks, ["5"], "пустые строки должны отбрасываться: " + marks.join(","));
});

t("пустая клетка в неделе показывает только «+»", () => {
    const w = boot(null);
    const busy = [...w.document.querySelectorAll("#diary-table .d-cell")]
        .filter((td) => td.querySelector(".d-subj"));
    ok(busy.length > 0, "нет клеток с парами");
    const noMarks = busy.filter((td) => td.querySelectorAll(".d-mark:not(.d-mark-add)").length === 0);
    ok(noMarks.length > 0, "у всех клеток уже есть оценки");
    for (const td of noMarks) {
        eq([...td.querySelectorAll(".d-mark")].map((c) => c.className.includes("d-mark-add")), [true]);
    }
});

t("в клетке с парой всегда есть кнопка «+»", () => {
    const w = boot(cell(["5"]));
    const cellEl = [...w.document.querySelectorAll("#diary-table .d-cell")]
        .find((td) => td.querySelector(".d-subj"));
    eq([...cellEl.querySelectorAll(".d-marks > .d-mark-add")].length, 1);
});

t("пустая клетка в неделе показывает только «+»", () => {
    const w = boot(null);
    const busy = [...w.document.querySelectorAll("#diary-table .d-cell")]
        .filter((td) => td.querySelector(".d-subj"));
    ok(busy.length > 0, "нет клеток с парами");
    const noMarks = busy.filter((td) => td.querySelectorAll(".d-mark:not(.d-mark-add)").length === 0);
    ok(noMarks.length > 0, "у всех клеток уже есть оценки");
    for (const td of noMarks) {
        eq([...td.querySelectorAll(".d-mark")].map((c) => c.className.includes("d-mark-add")), [true]);
    }
});

console.log("\n" + pass + " ok, " + fail + " fail");
process.exit(fail ? 1 : 0);
