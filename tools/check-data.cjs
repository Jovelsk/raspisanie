// Проверка js/data.js без браузера: подменяем window и гоняем выбор отделения/группы.
// Запуск: node tools/check-data.cjs
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function load({ withData = true } = {}) {
    const sandbox = { window: {}, console };
    if (withData) {
        const m = /window\.MPTSchedule = ([\s\S]*?);\s*$/.exec(read("data/schedule.js"));
        sandbox.window.MPTSchedule = JSON.parse(m[1]);
    }
    vm.createContext(sandbox);
    vm.runInContext(read("js/data.js"), sandbox, { filename: "data.js" });
    return sandbox.window.MPTData;
}

let ok = 0, fail = 0;
// Массивы приходят из контекста vm, поэтому deepStrictEqual ругается на разные
// прототипы. Сравниваем через JSON — ровно то, что уедет в браузер.
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const eqSet = (a, b) => eq([...a].sort(), [...b].sort());
function t(name, fn) {
    try { fn(); ok++; console.log("  ok   " + name); }
    catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log("\n== Данные с сайта доступны ==");
const D = load();
t("available", () => assert.strictEqual(D.available, true));
t("14 отделений", () => assert.strictEqual(D.departments.length, 14));
t("есть 09.02.07 П,Т", () => assert.ok(D.departments.includes("09.02.07 П,Т")));
t("119 групп всего", () => assert.strictEqual(
    D.departments.reduce((n, d) => n + D.groups(d).length, 0), 119));
t("в П,Т 25 групп", () => assert.strictEqual(D.groups("09.02.07 П,Т").length, 25));
t("неделя и дата с сайта", () => {
    assert.ok(/^(Числитель|Знаменатель)$/.test(D.weekParity), D.weekParity);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(D.weekDate), D.weekDate);
});

console.log("\n== Поиск с прощением к пробелам и регистру ==");
t("«09.02.07 П, Т» находит «09.02.07 П,Т»", () =>
    assert.strictEqual(D.findDepartment("09.02.07 П, Т"), "09.02.07 П,Т"));
t("«п-5-25» находит «П-5-25»", () =>
    assert.strictEqual(D.findGroup("09.02.07 П,Т", "п-5-25"), "П-5-25"));
t("несуществующее отделение -> null", () =>
    assert.strictEqual(D.findDepartment("99.99.99 ХЗ"), null));

console.log("\n== Группа выбрана с сайта, структура расписания цела ==");
t("ключи хранилища отданы наружу и верны", () => {
    // По ним выбор группы читает окошко расширения. Если объявить их выше
    // присваивания, наружу уйдёт undefined, и записи уедут в никуда.
    assert.strictEqual(D.OTDEL_KEY, "mpt-otdel");
    assert.strictEqual(D.GRUPA_KEY, "mpt-grupa");
});
t("выбрана с сайта (название с лишним пробелом тоже находится)", () => {
    assert.strictEqual(D.selectGroup("09.02.07 П, Т", "П-5-25"), true);
    assert.strictEqual(D.origin, "mpt");
});
// Проверки ниже намеренно НЕ привязаны к нынешнему содержимому расписания: сайт
// техникума его меняет, и «в среду четвёртой пары не бывает» через неделю станет
// неправдой. Смысл этих проверок — поймать поломку разбора, а не зафиксировать
// чужое расписание на конкретный день.
t("учебные дни совпадают с ключами расписания, и в каждом есть пары", () => {
    assert.ok(D.days.length >= 5, "учебных дней: " + D.days.length);
    for (const d of D.days) {
        assert.ok(Array.isArray(D.SCHEDULE[d]), "нет расписания на " + d);
        assert.ok(D.SCHEDULE[d].length > 0, "пустой учебный день " + d);
    }
});
t("у каждой пары есть номер 1..5, и она либо предмет, либо помечена как отсутствующая", () => {
    for (const d of Object.keys(D.SCHEDULE)) {
        for (const x of D.SCHEDULE[d]) {
            assert.ok(x.pair >= 1 && x.pair <= 5, "пара " + x.pair + " в " + d);
            assert.ok(x.subj || x.absent, "ни предмета, ни пометки: " + d + ", пара " + x.pair);
        }
    }
});
// Пара, которая идёт не каждую неделю, занимает две записи: либо две с разными
// неделями, либо одна с неделей и одна с пометкой «в эту неделю её нет».
t("пара, разделённая по неделям, занимает две записи", () => {
    for (const d of Object.keys(D.SCHEDULE)) {
        for (const x of D.SCHEDULE[d]) {
            if (!x.week && !x.absent) continue;
            const same = D.SCHEDULE[d].filter((y) => y.pair === x.pair);
            assert.strictEqual(same.length, 2,
                "у пары " + d + "-" + x.pair + " записей " + same.length + ", ожидалось 2");
        }
    }
});
t("у всех 6 дней есть запись в DAYS_INFO", () =>
    eqSet(Object.keys(D.DAYS_INFO), ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"]));
t("у выходного дня нет корпуса, у учебного корпус указан", () => {
    for (const d of Object.keys(D.DAYS_INFO)) {
        const info = D.DAYS_INFO[d];
        if (info.off) assert.strictEqual(info.building, "", "у выходного " + d + " указан корпус");
        else assert.ok(info.building, "у учебного дня " + d + " нет корпуса");
    }
});

console.log("\n== У разных групп разные учебные дни ==");
t("П-5-24: ВТ,СР,ЧТ,ПТ,СБ", () => {
    D.selectGroup("09.02.07 П,Т", "П-5-24");
    eq(D.days, ["ВТ", "СР", "ЧТ", "ПТ", "СБ"]);
    assert.strictEqual(D.DAYS_INFO["ПН"].off, true);
    assert.strictEqual(D.DAYS_INFO["ПТ"].off, false);
});
t("П-1-23: ПН,ВТ,СР,ЧТ,ПТ (другой набор)", () => {
    D.selectGroup("09.02.07 П,Т", "П-1-23");
    eq(D.days, ["ПН", "ВТ", "СР", "ЧТ", "ПТ"]);
    assert.strictEqual(D.DAYS_INFO["СБ"].off, true);
});
t("все 119 групп дают непустое расписание", () => {
    for (const dep of D.departments) {
        for (const g of D.groups(dep)) {
            assert.strictEqual(D.selectGroup(dep, g), true, `${dep} / ${g} не нашлась`);
            const n = Object.values(D.SCHEDULE).reduce((a, x) => a + x.length, 0);
            assert.ok(n > 0, `${dep} / ${g} пустая`);
            assert.ok(D.days.length > 0, `${dep} / ${g} без учебных дней`);
        }
    }
});

console.log("\n== Чётность недели от якоря сайта ==");
const site = D.weekDate.split("-").map(Number);
const siteDate = (k) => new Date(site[0], site[1] - 1, site[2] + k);
// день недели якоря: 0 — понедельник, 6 — воскресенье
const wd = (new Date(site[0], site[1] - 1, site[2]).getDay() + 6) % 7;
// Чётность недели сайта меняется от недели к неделе: снимок, снятый в
// знаменатель, даёт «Знаменатель». Поэтому проверяем не название недели, а
// правило — неделя сайта равна объявленной им чётности, а соседние недели
// противоположны.
const siteParity = D.weekParity;
const flipParity = (p) => (p === D.WEEK_W1 ? D.WEEK_W2 : D.WEEK_W1);
t("неделя сайта -> объявленная сайтом чётность", () =>
    assert.strictEqual(D.parityOfDate(siteDate(0)), siteParity));
t("следующая неделя -> противоположная", () =>
    assert.strictEqual(D.parityOfDate(siteDate(7)), flipParity(siteParity)));
t("через две недели снова как на сайте", () =>
    assert.strictEqual(D.parityOfDate(siteDate(14)), siteParity));
t("предыдущая неделя -> противоположная", () =>
    assert.strictEqual(D.parityOfDate(siteDate(-7)), flipParity(siteParity)));
t("внутри недели чётность не меняется (понедельник..воскресенье)", () => {
    // якорь сайта может попасть на любой день недели, поэтому берём
    // границы недели от него: понедельник это -wd, воскресенье 6-wd
    for (let k = -wd; k <= 6 - wd; k++) {
        assert.strictEqual(D.parityOfDate(siteDate(k)), siteParity, `сдвиг ${k}`);
    }
});
t("воскресенье той же недели ещё как на сайте, понедельник — уже нет", () => {
    assert.strictEqual(D.parityOfDate(siteDate(6 - wd)), siteParity);
    assert.strictEqual(D.parityOfDate(siteDate(7 - wd)), flipParity(siteParity));
});

console.log("\n== Московское время в подписях ==");
// 16:52 UTC — это 19:52 по Москве, где бы ни открыли страницу
t("UTC переводится в московское (+3), а не в пояс читателя", () => {
    assert.strictEqual(D.fmtMoscow("2026-10-07T16:52:05.667Z"), "07.10.2026 19:52");
    assert.strictEqual(D.fmtMoscow("2026-10-07T21:05:00.000Z"), "08.10.2026 00:05");
    assert.strictEqual(D.fmtMoscow("2026-01-01T00:00:00.000Z"), "01.01.2026 03:00");
});
t("время снимка показывается московским", () => {
    const shown = D.fmtMoscow(D.updatedAt);
    assert.ok(/^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(shown), shown);
    const msk = new Date(Date.parse(D.updatedAt) + D.MSK_OFFSET_MIN * 60000);
    const hh = String(msk.getUTCHours()).padStart(2, "0");
    const mm = String(msk.getUTCMinutes()).padStart(2, "0");
    assert.strictEqual(shown.slice(11), hh + ":" + mm, shown);
});
t("непонятная дата не превращается в мусор", () => {
    assert.strictEqual(D.fmtMoscow(""), null);
    assert.strictEqual(D.fmtMoscow(null), null);
    assert.strictEqual(D.fmtMoscow("не дата"), null);
});

console.log("\n== Событие смены группы ==");
t("подписчики получают сигнал", () => {
    const D2 = load();
    let hits = 0;
    D2.onChange(() => hits++);
    D2.selectGroup("09.02.07 П,Т", "П-1-23");
    D2.selectGroup("09.02.07 П,Т", "П-2-23");
    assert.strictEqual(hits, 2);
});
t("silent=true не шлёт сигнал", () => {
    const D2 = load();
    let hits = 0;
    D2.onChange(() => hits++);
    D2.selectGroup("09.02.07 П,Т", "П-1-23", true);
    assert.strictEqual(hits, 0);
});
t("сломанный подписчик не роняет остальных", () => {
    const D2 = load();
    let hits = 0;
    D2.onChange(() => { throw new Error("бум"); });
    D2.onChange(() => hits++);
    D2.selectGroup("09.02.07 П,Т", "П-1-23");
    assert.strictEqual(hits, 1);
});

console.log("\n== Без файла с сайта — пустое состояние ==");
const F = load({ withData: false });
t("available = false", () => assert.strictEqual(F.available, false));
t("отделений нет, пока данные не пришли", () => eq(F.departments, []));
t("групп нет ни у какого отделения", () => eq(F.groups("09.02.07 П, Т"), []));
t("вместо расписания пусто: чужой группы в проекте нет", () => {
    assert.strictEqual(F.selectGroup("09.02.07 П, Т", "П-5-25"), false);
    assert.strictEqual(F.origin, "none");
    eq(F.days, []);
    eq(F.SCHEDULE["ПН"], []);
    eq(F.SCHEDULE["СБ"], []);
});
t("без данных чётность всё равно считается", () => {
    const a = F.parityOfMonday(new Date(2026, 8, 28));
    const b = F.parityOfMonday(new Date(2026, 8, 28 + 7));
    assert.notStrictEqual(a, b);
});
t("init без файла не падает и ничего не выдумывает", () => {
    const r = F.init(null, null);
    assert.strictEqual(r.noData, true);
    assert.strictEqual(r.otdel, "");
    assert.strictEqual(r.grupa, "");
});
t("init с чужим отделением тоже не выдумывает группу", () => {
    const r = F.init("несуществующее", "несуществующая");
    assert.strictEqual(r.otdel, "");
    assert.strictEqual(r.grupa, "");
});

console.log(`\n${ok} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
