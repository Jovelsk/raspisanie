// Рендер страниц в jsdom: грузим настоящие HTML+JS и смотрим на получившийся DOM.
// Запуск: node tools/check-render.cjs   (jsdom из node_modules: npm install)
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// jsdom берём из node_modules проекта, а если его там нет — из временной папки,
// куда его ставили вручную до того, как он попал в devDependencies.
function loadJsdom() {
    const candidates = [
        "jsdom",
        path.join(os.tmpdir(), "opencode", "mpt", "domtest", "node_modules", "jsdom"),
    ];
    const missed = [];
    for (const c of candidates) {
        try { return require(c); }
        catch (e) {
            if (e.code !== "MODULE_NOT_FOUND" || !/^Cannot find module/.test(e.message)) throw e;
            missed.push(c);
        }
    }
    throw new Error("jsdom не найден (пробовали: " + missed.join(", ") + "). Установите: npm install");
}
const { JSDOM } = loadJsdom();

let ok = 0, fail = 0;
function t(name, fn) {
    try { fn(); ok++; console.log("  ok   " + name); }
    catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

// script-теги вырезаем: jsdom сам их не выполнит (runScripts: outside-only),
// а мы запускаем их вручную в нужном порядке
function openPage(htmlFile, scripts, withData = true) {
    const html = read(htmlFile).replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/" + htmlFile,
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.localStorage.clear();
    if (!withData) {
        // сценарий «файл данных не забрали»
        win.eval("window.MPTSchedule = undefined;");
    } else {
        for (const s of scripts.filter((x) => x.startsWith("data/"))) win.eval(read(s));
    }
    for (const s of scripts.filter((x) => !x.startsWith("data/"))) win.eval(read(s));
    win.document.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
    return win;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
// Массивы из jsdom — из другого контекста, поэтому сравниваем через JSON
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

console.log("\n== Расписание (index.html) ==");
const idx = openPage("index.html", ["data/schedule.js", "js/data.js", "js/theme.js", "js/schedule.js"]);
const d1 = idx.document;
const grid = d1.getElementById("days-grid");

t("страница отрисовала карточки дней", () =>
    assert.ok(grid.querySelectorAll(".day-card").length === 6,
        "карточек: " + grid.querySelectorAll(".day-card").length));

t("без сохранённого выбора берётся первое отделение с сайта", () => {
    // Раньше здесь был запасной вариант с группой автора; теперь данных в
    // проекте нет, поэтому по умолчанию берётся первое отделение из расписания
    const dep = idx.MPTData.departments[0];
    const grp = idx.MPTData.groups(dep)[0];
    assert.strictEqual(text(d1.getElementById("class-title")), dep + " — группа " + grp);
    assert.strictEqual(idx.MPTData.origin, "mpt", "взято с сайта");
});

t("неделя — пилюля рядом с датой, обновлено — подпись под таблицами", () => {
    const week = d1.getElementById("schedule-week");
    assert.strictEqual(week.className, "meta-date meta-week", "та же рамка, что у даты");
    // Неделя на сайте меняется каждую неделю, поэтому сверяем не с названием,
    // а с тем, что страница считает для текущей недели по якорю сайта
    assert.strictEqual(text(week), "неделя " + idx.MPTData.parityOfDate(new Date()).toLowerCase());
    // Пилюля недели стоит в одной строке с датой
    const meta = week.parentElement;
    assert.strictEqual(d1.getElementById("schedule-date").parentElement, meta);

    // Подпись — отдельный блок после сетки, по центру
    const cap = d1.getElementById("schedule-updated");
    assert.strictEqual(cap.className, "schedule-caption");
    assert.ok(/^Расписание с mpt\.ru, обновлено \d\d\.\d\d\.\d{4} \d\d:\d\d МСК$/.test(text(cap)), text(cap));
    // Часы должны быть московскими: раньше подпись печатала UTC как есть
    const when = idx.MPTData.fmtMoscow(idx.MPTData.updatedAt);
    assert.ok(text(cap).indexOf(when + " МСК") !== -1,
        "подпись «" + text(cap) + "», а по Москве " + when);
    const after = meta.nextElementSibling;
    assert.strictEqual(after.id, "days-grid", "сразу после строки с датой идёт сетка");
    assert.strictEqual(after.nextElementSibling, cap, "подпись идёт под таблицами");
});

t("заголовок карточки = название дня + корпус", () => {
    const heads = [...grid.querySelectorAll(".day-card-head")].map(text);
    assert.strictEqual(heads.length, 6);
    assert.ok(heads[0].startsWith("Понедельник"), heads[0]);
});

// Теперь явно выбираем П-5-25 и проверяем карточки
console.log("\n== Расписание для П-5-25 ==");
idx.MPTData.selectGroup("09.02.07 П,Т", "П-5-25");
t("после выбора группы заголовок обновился", () => {
    // заголовок вешает theme.js, зовём его обработчик через select
    const otdel = d1.getElementById("otdel-select");
    const grupa = d1.getElementById("grupa-select");
    otdel.value = "09.02.07 П,Т";
    otdel.dispatchEvent(new idx.Event("change", { bubbles: true }));
    grupa.value = "П-5-25";
    grupa.dispatchEvent(new idx.Event("change", { bubbles: true }));
    assert.ok(/09\.02\.07 П,Т — группа П-5-25/.test(text(d1.getElementById("class-title"))),
        text(d1.getElementById("class-title")));
});

t("6 карточек, ПТ — выходной", () => {
    const cards = [...grid.querySelectorAll(".day-card")];
    assert.strictEqual(cards.length, 6);
    const friday = cards[4];
    assert.ok(friday.className.includes("day-off-card"), friday.className);
    assert.strictEqual(text(friday.querySelector(".day-card-empty")), "Выходной");
});

t("в учебные дни ровно 5 строк пар", () => {
    for (const name of ["Понедельник", "Вторник", "Среда", "Четверг", "Суббота"]) {
        const card = [...grid.querySelectorAll(".day-card")].find((c) =>
            text(c.querySelector(".day-card-head")).startsWith(name));
        assert.strictEqual(card.querySelectorAll(".day-row").length, 5, name);
    }
});

t("пара ПН-5 показана двумя окнами (числитель/знаменатель)", () => {
    const mon = [...grid.querySelectorAll(".day-card")]
        .find((c) => text(c.querySelector(".day-card-head")).startsWith("Понедельник"));
    const row5 = mon.querySelectorAll(".day-row")[4];
    const cells = row5.querySelectorAll(".wcell");
    assert.strictEqual(cells.length, 2, "окон: " + cells.length);
    assert.ok(cells[0].className.includes("w1"));
    assert.ok(/Архитектура аппаратных средств/.test(text(cells[0])), text(cells[0]));
    assert.ok(/нет пары/.test(text(cells[1])), text(cells[1]));
});

t("пара без деления по неделям — одно окно", () => {
    const tue = [...grid.querySelectorAll(".day-card")]
        .find((c) => text(c.querySelector(".day-card-head")).startsWith("Вторник"));
    const row2 = tue.querySelectorAll(".day-row")[1];
    const cells = row2.querySelectorAll(".wcell");
    assert.strictEqual(cells.length, 1);
    assert.ok(cells[0].className.includes("wcell-plain"), cells[0].className);
});

t("время пар подставлено", () => {
    const mon = [...grid.querySelectorAll(".day-card")]
        .find((c) => text(c.querySelector(".day-card-head")).startsWith("Понедельник"));
    assert.ok(/08:30/.test(text(mon.querySelector(".day-row"))), text(mon.querySelector(".day-row")));
});

console.log("\n== У разных групп разные дни в интерфейсе ==");
t("П-5-24: ПН становится выходным, а СР и ПТ — учебные", () => {
    const gr = d1.getElementById("grupa-select");
    gr.value = "П-5-24";
    gr.dispatchEvent(new idx.Event("change", { bubbles: true }));
    const cards = [...grid.querySelectorAll(".day-card")];
    const off = cards.filter((c) => c.className.includes("day-off-card"))
        .map((c) => text(c.querySelector(".day-card-head")).split("—")[0].trim());
    eq(off, ["Понедельник"]);
    const busy = cards.filter((c) => !c.className.includes("day-off-card")).length;
    assert.strictEqual(busy, 5, "учебных дней: " + busy);
});

t("список групп в настройках совпадает с отделением", () => {
    const otdel = d1.getElementById("otdel-select");
    otdel.value = "40.02.04 Ю";
    otdel.dispatchEvent(new idx.Event("change", { bubbles: true }));
    const opts = [...d1.getElementById("grupa-select").options].map((o) => o.value);
    assert.strictEqual(opts.length, 8, opts.join(", "));
    assert.strictEqual(d1.getElementById("grupa-select").value, opts[0]);
});

t("список отделений — все 14 с сайта", () => {
    const opts = [...d1.getElementById("otdel-select").options].map((o) => o.value);
    assert.strictEqual(opts.length, 14);
    assert.ok(opts.includes("09.02.07 П,Т"));
    assert.ok(opts.includes("10.02.05 БИ"));
});

t("смена отделения меняет заголовок и перерисовывает сетку", () => {
    const otdel = d1.getElementById("otdel-select");
    otdel.value = "09.02.07 П,Т";
    otdel.dispatchEvent(new idx.Event("change", { bubbles: true }));
    const gr = d1.getElementById("grupa-select");
    gr.value = "П-1-23";
    gr.dispatchEvent(new idx.Event("change", { bubbles: true }));
    assert.ok(/П-1-23/.test(text(d1.getElementById("class-title"))));
    assert.strictEqual(grid.querySelectorAll(".day-card").length, 6);
    assert.ok(grid.querySelector(".day-card .day-row"), "сетка пустая");
});

console.log("\n== Без файла с сайта — загружаем расписание ==");
const nb = openPage("index.html", ["data/schedule.js", "js/data.js", "js/theme.js", "js/schedule.js"], false);
const d2 = nb.document;
t("без данных страница честно говорит, что загружает", () => {
    const cap = d2.getElementById("schedule-updated");
    assert.strictEqual(cap.className, "schedule-caption");
    assert.ok(/Загружаем данные/.test(text(cap)), text(cap));
    assert.ok(!/обновлено/.test(text(cap)), "время обновления выдумывать нельзя: " + text(cap));
    // неделя всё равно показывается — она считается от даты
    assert.strictEqual(d2.getElementById("schedule-week").className, "meta-date meta-week warn");
});
t("вместо расписания надпись о загрузке, а не чужой группы пары", () => {
    const g = d2.getElementById("days-grid");
    assert.strictEqual(g.querySelectorAll(".day-card").length, 0, "карточек дня быть не должно");
    assert.ok(/Загружаем расписание/.test(g.textContent), g.textContent.slice(0, 200));
    assert.ok(!/Основы алгоритмизации/.test(g.textContent),
        "в проекте не должно быть расписания чужой группы: " + g.textContent.slice(0, 200));
});
t("настройки не падают без данных и ничего не выдумывают", () => {
    // Данных нет — выбирать не из чего; список наполнится, когда придут данные
    assert.strictEqual(d2.getElementById("otdel-select").options.length, 0);
    assert.strictEqual(d2.getElementById("grupa-select").options.length, 0);
    assert.ok(/Загружаем данные/.test(text(d2.getElementById("class-title"))),
        text(d2.getElementById("class-title")));
});

console.log("\n== Дневник (diary.html) ==");
const dr = openPage("diary.html", ["data/schedule.js", "js/data.js", "js/theme.js", "js/diary.js"]);
const d3 = dr.document;
t("дневник нарисовал таблицу", () =>
    assert.ok(d3.getElementById("diary-table").querySelectorAll("tr").length > 5));
t("по умолчанию дневник на первом отделении с сайта", () => {
    // Без сохранённого выбора берётся первое отделение расписания
    assert.strictEqual(dr.MPTData.otdel, dr.MPTData.departments[0]);
    assert.strictEqual(dr.MPTData.grupa, dr.MPTData.groups(dr.MPTData.otdel)[0]);
    assert.strictEqual(dr.MPTData.origin, "mpt");
    assert.ok(dr.MPTData.days.length > 0, "у группы должны быть учебные дни");
});
t("сетка дневника соответствует расписанию группы", () => {
    const cells = d3.getElementById("diary-table").querySelectorAll(".d-cell");
    assert.ok(cells.length > 0, "клеток нет");
    // Раскладку группы theme.js собирает на DOMContentLoaded — дневник обязан
    // забрать её до первой отрисовки, иначе все клетки пустые.
    const withLesson = [...cells].filter((td) => td.querySelector(".d-subj"));
    assert.ok(withLesson.length > 0,
        "ни одной клетки с парой — дневник не подхватил расписание (" + cells.length + " клеток)");
    const subj = Object.values(dr.MPTData.SCHEDULE).flat().find((x) => x.subj);
    assert.ok(d3.getElementById("diary-table").textContent.includes(subj.subj.slice(0, 12)),
        "предмет из расписания не попал в дневник");
});
t("в клетке с парой есть кнопка «+» для добавления оценки", () => {
    const busy = [...d3.getElementById("diary-table").querySelectorAll(".d-cell")]
        .filter((td) => td.querySelector(".d-subj"));
    assert.ok(busy.length > 0, "нет клеток с парами");
    for (const td of busy) {
        assert.ok(td.querySelector(".d-marks .d-mark-add"),
            "в клетке «" + text(td.querySelector(".d-subj")) + "» нет кнопки «+»");
    }
});
t("чётность недели берётся с сайта", () => {
    const chip = d3.getElementById("diary-parity");
    assert.ok(/Числитель|Знаменатель/.test(text(chip)), text(chip));
    // Неделя на сайте меняется, поэтому сверяем не с названием, а с тем,
    // что страница считает для текущей недели по якорю сайта
    assert.strictEqual(text(chip), dr.MPTData.parityOfDate(new Date()),
        "неделя должна совпадать с сайта");
});
t("смена группы перерисовывает дневник", () => {
    const tbl = d3.getElementById("diary-table");
    const gr = d3.getElementById("grupa-select");

    // Берём заведомо другую группу того же отделения
    const orig = dr.MPTData.grupa;
    const other = [...gr.options].map((o) => o.value).find((v) => v !== orig);
    assert.ok(other, "в отделении нет второй группы для проверки");
    const before = tbl.innerHTML;
    gr.value = other;
    gr.dispatchEvent(new dr.Event("change", { bubbles: true }));
    assert.strictEqual(dr.MPTData.grupa, other, "группа не сменилась");
    assert.notStrictEqual(tbl.innerHTML, before, "дневник не перерисовался");
    // и вернуть обратно
    gr.value = orig;
    gr.dispatchEvent(new dr.Event("change", { bubbles: true }));
    assert.strictEqual(dr.MPTData.grupa, orig, "обратно не вернулась исходная группа");
    assert.strictEqual(tbl.innerHTML, before, "обратно не вернулось исходное расписание");
});
t("выгрузка/загрузка переехали в настройки дневника", () => {
    // в шапке дневника этих кнопок больше нет
    assert.strictEqual(d3.getElementById("diary-export"), null, "в шапке осталась выгрузка");
    assert.strictEqual(d3.getElementById("diary-import"), null, "в шапке осталась загрузка");
    // и появились во вкладке «Дневник»
    const d5 = openPage("diary.html", ["data/schedule.js", "js/data.js", "js/theme.js", "js/diary.js", "js/diary-settings.js"]);
    assert.ok(d5.document.querySelector('#settings-tabs [data-tab="diary"]'), "нет вкладки «Дневник»");
    d5.MPTSettings.show("diary");
    const ed = d5.document.querySelector('#settings-overlay .settings-pane[data-pane="diary"]');
    assert.ok(ed, "нет полотна вкладки дневника");
    assert.ok(ed.querySelector("#ed-export"), "нет кнопки выгрузки");
    assert.ok(ed.querySelector("#ed-import"), "нет кнопки загрузки");
    assert.ok(ed.querySelector("#ed-import-file"), "нет скрытого input");
});

console.log("\n== Замены (replacements.html) ==");
const rp = openPage("replacements.html", ["data/schedule.js", "js/data.js", "js/theme.js"]);
t("страница открылась, настройки построились", () => {
    assert.ok(rp.document.getElementById("settings-btn"));
    assert.strictEqual(rp.document.getElementById("otdel-select").options.length, 14);
});

console.log("\n== Фон: путь к картинке и прозрачность ==");

const PAGE = ["data/schedule.js", "js/data.js", "js/theme.js", "js/schedule.js"];
const styleOf = (w) => w.document.documentElement.style;
// Фон ставится на отдельный слой-элемент (его создаёт js/theme.js): так надёжнее,
// чем через переменную — та терялась по дороге до отрисовки
const bgOf = (w) => {
    const layer = w.document.getElementById("bg-layer");
    return layer ? layer.style.backgroundImage : "(слоя фона нет)";
};

t("без настройки вид не меняется", () => {
    const w = openPage("index.html", PAGE);
    eq(bgOf(w), "");
    eq(styleOf(w).getPropertyValue("--panel-alpha"), "1");
});

t("путь сохраняется и превращается в адрес картинки", () => {
    const w = openPage("index.html", PAGE);
    const input = w.document.getElementById("bg-path");
    assert.ok(input, "поля пути нет в настройках");
    input.value = "D:\\обои\\кот.jpg";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(w.localStorage.getItem("mpt-bg-path"), "D:\\обои\\кот.jpg");
    eq(bgOf(w), 'url("file:///D:/обои/кот.jpg")');
});

t("путь в кавычках из проводника тоже понимается", () => {
    const w = openPage("index.html", PAGE);
    const input = w.document.getElementById("bg-path");
    input.value = '"C:\\Users\\Лизка\\картинка.png"';
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(bgOf(w), 'url("file:///C:/Users/Лизка/картинка.png")');
});

t("название файла из папки проекта остаётся относительным", () => {
    // Так фон работает одинаково: сайт берёт файл из своей папки, расширение —
    // из своей. Абсолютный путь в расширении браузер не пустит.
    const w = openPage("index.html", PAGE);
    const input = w.document.getElementById("bg-path");
    input.value = "bg.jpg";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(bgOf(w), 'url("bg.jpg")');
});

t("ползунок задаёт прозрачность, но панель не становится нечитаемой", () => {
    const w = openPage("index.html", PAGE);
    const range = w.document.getElementById("bg-alpha");
    assert.ok(range, "ползунка нет в настройках");
    range.value = "100";
    range.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(w.localStorage.getItem("mpt-bg-alpha"), "100");
    eq(styleOf(w).getPropertyValue("--panel-alpha"), "0.1");
    eq(text(w.document.getElementById("bg-alpha-value")), "100%");
    range.value = "0";
    range.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(styleOf(w).getPropertyValue("--panel-alpha"), "1");
});

t("настройка переживает перезагрузку страницы", () => {
    const w = openPage("index.html", PAGE);
    const input = w.document.getElementById("bg-path");
    input.value = "C:\\bg.jpg";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    // запускаем theme.js заново — это то же самое, что открыть страницу заново
    w.eval(read("js/theme.js"));
    eq(bgOf(w), 'url("file:///C:/bg.jpg")');
    eq(styleOf(w).getPropertyValue("--panel-alpha"), "1");
});

t("пустой путь возвращает обычный вид и подсказку", () => {
    const w = openPage("index.html", PAGE);
    const input = w.document.getElementById("bg-path");
    input.value = "D:\\bg.jpg";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(bgOf(w), "");
    assert.ok(text(w.document.getElementById("bg-hint")).indexOf("папку проекта") !== -1,
        "подсказка: " + text(w.document.getElementById("bg-hint")));
});

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
