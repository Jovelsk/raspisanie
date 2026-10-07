// Живое обновление (js/live.js) и приём свежего снимка (js/data.js).
//
// Главное здесь — не «скачалось ли», а что обновление НЕ ЛОМАЕТ дневник:
// история версий расписания, ручные периоды, отметки и граница правок
// должны переживать подмену данных. Сеть не нужна: ответы подставляем сами.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const HISTORY_KEY = "mpt-schedule-history-v1";
const MANUAL_KEY = "mpt-schedule-manual-v1";
const GRADES_KEY = "mpt-diary-grades-v2";

let ok = 0, bad = 0;
function t(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") {
            return r.then(
                () => { ok++; console.log("ok   " + name); },
                (e) => { bad++; console.log("FAIL " + name + "\n     " + e.message); }
            );
        }
        ok++; console.log("ok   " + name);
    } catch (e) { bad++; console.log("FAIL " + name + "\n     " + e.message); }
    return Promise.resolve();
}
function eq(got, want, msg) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error((msg || "") + ": ожидалось " + w + ", получено " + g);
}
function ok_(cond, msg) { if (!cond) throw new Error(msg || "ожидалось истинное значение"); }

// Снимок расписания из репозитория — настоящая модель со всеми 119 группами
function bundledSchedule() {
    const raw = fs.readFileSync(path.join(ROOT, "data", "schedule.js"), "utf8");
    const m = /window\.MPTSchedule = ([\s\S]*?);\s*$/.exec(raw);
    if (!m) throw new Error("в data/schedule.js нет window.MPTSchedule");
    return JSON.parse(m[1]);
}

// Копия снимка с другим содержимым у выбранной группы: fetchedAt новый,
// первая пара предмета заменена — так выглядит настоящая правка сайта.
function changedCopy(model, group, newSubject) {
    const copy = JSON.parse(JSON.stringify(model));
    copy.fetchedAt = new Date(Date.now() + 60 * 1000).toISOString();
    const dept = Object.keys(copy.departments).find((d) => copy.departments[d].groups[group]);
    if (!dept) throw new Error("в снимке нет группы " + group);
    const pairs = copy.departments[dept].groups[group].pairs;
    pairs[0].w1.subj = newSubject;
    pairs[0].w2.subj = newSubject;
    return copy;
}

// Ответ WordPress: перед JSON идёт блок <style>, после — хвост страницы.
// Для расписания добавляем наполнитель: настоящий ответ весит мегабайты, а
// слой обновления считает по-настоящему короткий ответ обрывом связи.
function wpResponse(html, pad) {
    const json = JSON.stringify([{ id: 1, content: { rendered: html } }]);
    const filler = pad ? "<!-- " + "x".repeat(400 * 1024) + " -->" : "";
    return '<style id="elementor-post-1">.x{color:red}</style>\n' + json + filler + "\n<!-- хвост -->";
}

const REPL_PAGE = `<!DOCTYPE html><html><body>
<h4>Замены на <b>08.10.2026</b> (Четверг)</h4>
<table class="table"><caption>Группа: <b>П-5-25</b></caption>
<tr><td class="lesson-number">2</td>
    <td class="replace-from">История С.С. Иконникова</td>
    <td class="replace-to">Обществознание С.А. Абрамов</td>
    <td class="updated-at">08.10.2026 09:15:00</td></tr>
</table></body></html>`;

function boot(file, scripts, seed) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/" + file,
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const w = dom.window;
    w.localStorage.clear();
    // Часть проверок нарочно подсовывает мусор, и live.js честно пишет об этом
    // в console.warn. В проверке этот шум не нужен: он мешает читать итог.
    w.console = { log: function () { }, warn: function () { }, error: function () { } };
    if (seed) for (const k of Object.keys(seed)) w.localStorage.setItem(k, seed[k]);
    for (const s of scripts) w.eval(fs.readFileSync(path.join(ROOT, s), "utf8"));
    // Сети в проверке нет: без заглушки live.js просто ничего не сделает
    w.fetch = undefined;
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    return w;
}

// Ответ, который live.js примет за настоящий
function stubFetch(w, body) {
    w.fetch = function () {
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(body); } });
    };
}
function stubFetchGarbage(w, body) {
    w.fetch = function () {
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(body); } });
    };
}

const SCHEDULE_SCRIPTS = ["js/mpt-parse.js", "data/schedule.js", "js/live.js", "js/data.js", "js/theme.js", "js/schedule.js"];
const DIARY_SCRIPTS = ["js/mpt-parse.js", "data/schedule.js", "js/live.js", "js/data.js", "js/theme.js", "js/diary.js"];
const REPL_SCRIPTS = ["js/mpt-parse.js", "data/schedule.js", "data/replacements.js", "js/live.js", "js/data.js", "js/theme.js", "js/replacements.js"];

const MODEL = bundledSchedule();
const GROUP = "П-5-25";
const OTDEL = "09.02.07 П,Т";
// Выбор, как он лежит в настройках. Страница без сохранённого выбора показывает
// первое отделение с сайта, поэтому там, где проверяем именно П-5-25, выбираем её явно.
const CHOSEN = { "mpt-otdel": OTDEL, "mpt-grupa": GROUP };

(async () => {
    console.log("== Что видно сразу после загрузки ==");

    await t("вшитый снимок на месте и страница по нему отрисовалась", () => {
        const w = boot("index.html", SCHEDULE_SCRIPTS);
        eq(w.MPTData.available, true, "данные доступны");
        eq(w.MPTData.updatedAt, MODEL.fetchedAt, "отметка съёмки");
        ok_(w.document.querySelectorAll(".day-card").length === 6, "карточек дней");
        eq(w.MPTLive.state().schedule.from, "bundled", "источник данных");
    });

    await t("сохранённая прошлая загрузка свежее вшитого снимка — берём её", () => {
        const saved = changedCopy(MODEL, GROUP, "ПРЕДМЕТ ИЗ ПРОШЛОЙ ЗАГРУЗКИ");
        const w = boot("index.html", SCHEDULE_SCRIPTS, { "mpt-live-schedule-v1": JSON.stringify(saved) });
        eq(w.MPTData.updatedAt, saved.fetchedAt, "взята сохранённая отметка");
        eq(w.MPTLive.state().schedule.from, "saved", "источник данных");
    });

    await t("вшитый снимок свежее сохранённого — остаётся вшитый", () => {
        const old = changedCopy(MODEL, GROUP, "СТАРОЕ");
        old.fetchedAt = "2020-01-01T00:00:00.000Z";
        const w = boot("index.html", SCHEDULE_SCRIPTS, { "mpt-live-schedule-v1": JSON.stringify(old) });
        eq(w.MPTData.updatedAt, MODEL.fetchedAt, "осталась вшитая отметка");
        eq(w.MPTLive.state().schedule.from, "bundled", "источник данных");
    });

    console.log("\n== Обновление с сайта ==");

    await t("замены: настоящий ответ принимается и попадает на страницу", async () => {
        const w = boot("replacements.html", REPL_SCRIPTS, CHOSEN);
        stubFetch(w, wpResponse(REPL_PAGE));
        const adopted = await w.MPTLive.refresh("replacements", true);
        eq(adopted, true, "принято");
        eq(w.MPTLive.state().replacements.from, "live", "источник данных");
        const block = w.document.getElementById("replacements-list");
        ok_(/Обществознание С\.А\. Абрамов/.test(block.textContent), "замена не показана: " + block.textContent);
        ok_(w.localStorage.getItem("mpt-live-replacements-v1"), "не сохранилось в браузере");
    });

    await t("мусор вместо данных не принимается, старое остаётся", async () => {
        const w = boot("replacements.html", REPL_SCRIPTS);
        const before = w.MPTData.replacementsFetchedAt;
        stubFetchGarbage(w, "<html><body><h1>Сайт недоступен</h1></body></html>");
        const adopted = await w.MPTLive.refresh("replacements", true);
        eq(adopted, false, "не принято");
        eq(w.MPTData.replacementsFetchedAt, before, "отметка не изменилась");
        ok_(w.MPTLive.state().replacements.error, "ошибка не записана");
    });

    await t("расписание: пустой ответ не затирает данные", async () => {
        const w = boot("index.html", SCHEDULE_SCRIPTS);
        const before = w.MPTData.updatedAt;
        stubFetchGarbage(w, "<html><body>ничего похожего на расписание</body></html>");
        const adopted = await w.MPTLive.refresh("schedule", true);
        eq(adopted, false, "не принято");
        eq(w.MPTData.updatedAt, before, "данные не подменены");
    });

    await t("обрезанный ответ расписания: повторяем, а не считаем сменой вёрстки", async () => {
        // Сайт изредка отдаёт страницу не целиком: короткий ответ — это обрыв,
        // а не повод решить, что вёрстка поменялась
        const w = boot("index.html", SCHEDULE_SCRIPTS);
        const fresh = changedCopy(MODEL, GROUP, "ПОСЛЕ ОБРЫВА");
        w.MPTParse.buildSchedule = function () { return fresh; };
        w.MPTParse.checkSchedule = function () { return []; };
        let calls = 0;
        w.fetch = function () {
            calls++;
            const body = calls === 1 ? "<html>обрыв</html>" : wpResponse("<html></html>", true);
            return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(body); } });
        };
        const adopted = await w.MPTLive.refresh("schedule", true);
        eq(calls, 2, "запросов к сайту");
        eq(adopted, true, "второй ответ должен быть принят");
    });

    await t("первое открытие: своего снимка нет — идём на сайт сразу, не ожидая сроков", async () => {
        // Как у человека, который только что скачал проект: данных нет вовсе
        const w = boot("index.html", ["js/mpt-parse.js", "js/live.js", "js/data.js", "js/theme.js", "js/schedule.js"]);
        eq(w.MPTData.available, false, "до обновления данных с сайта быть не должно");
        ok_(/Загружаем данные/.test(w.document.getElementById("schedule-updated").textContent),
            "нет надписи о загрузке");
        const fresh = changedCopy(MODEL, GROUP, "ПЕРВЫЙ СНИМОК ЧЕЛОВЕКА");
        w.MPTParse.buildSchedule = function () { return fresh; };
        w.MPTParse.checkSchedule = function () { return []; };
        let calls = 0;
        w.fetch = function () {
            calls++;
            return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(wpResponse("<html></html>", true)); } });
        };
        // Без force: решение принимает сам слой обновления
        const adopted = await w.MPTLive.refresh("schedule");
        eq(calls, 1, "запросов к сайту");
        eq(adopted, true, "снимок принят");
        eq(w.MPTLive.state().schedule.from, "live", "источник данных");
        eq(w.MPTData.available, true, "данные с сайта не появились");
        eq(w.MPTData.departments.length, MODEL.departmentOrder.length, "отделений");
        ok_(/обновлено \d\d\.\d\d\.\d{4} \d\d:\d\d МСК/.test(w.document.getElementById("schedule-updated").textContent),
            "подпись: " + w.document.getElementById("schedule-updated").textContent);
        ok_(w.localStorage.getItem("mpt-live-schedule-v1"), "снимок не сохранён в браузере");
    });

    await t("свой свежий снимок — лишний раз на сайт не ходим", async () => {
        const saved = JSON.parse(JSON.stringify(MODEL));
        saved.fetchedAt = new Date().toISOString();
        const w = boot("index.html", SCHEDULE_SCRIPTS, { "mpt-live-schedule-v1": JSON.stringify(saved) });
        let calls = 0;
        w.fetch = function () {
            calls++;
            return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(""); } });
        };
        const adopted = await w.MPTLive.refresh("schedule");
        eq(calls, 0, "запросов к сайту");
        eq(adopted, false, "принимать нечего");
        eq(w.MPTLive.state().schedule.from, "saved", "источник данных");
    });

    await t("на страницах без замены этот файл и не запрашивается", async () => {
        const w = boot("index.html", SCHEDULE_SCRIPTS);
        const adopted = await w.MPTLive.refresh("replacements", true);
        eq(adopted, false, "замены не трогаем");
    });

    await t("границу ручных правок живое обновление не двигает", async () => {
        const w = boot("index.html", SCHEDULE_SCRIPTS);
        const beforeFirst = w.MPTData.firstFetchDate();
        const seen = [];
        const fresh = changedCopy(MODEL, GROUP, "ПРЕДМЕТ ОТ ЖИВОГО ОБНОВЛЕНИЯ");
        // Подменяем только сборку модели: так видно, что live.js передаёт ей
        // именно прежний первый снимок, а не «сейчас».
        w.MPTParse.buildSchedule = function (html, now, first) { seen.push(first); return fresh; };
        w.MPTParse.checkSchedule = function () { return []; };
        stubFetch(w, wpResponse("<html></html>", true));
        const adopted = await w.MPTLive.refresh("schedule", true);
        eq(adopted, true, "принято");
        // В сборку должна уйти полная прежняя метка, а не сегодняшняя дата
        eq(seen[0], MODEL.firstFetchedAt, "в сборку передан прежний первый снимок");
        eq(fresh.firstFetchedAt, MODEL.firstFetchedAt, "модель сохранила прежнюю границу");
        // И граница, по которой дневник пускает ручные правки, не сдвинулась
        eq(w.MPTData.firstFetchDate(), beforeFirst, "граница ручных правок сдвинулась");
    });

    console.log("\n== Дневник: что должно пережить обновление ==");

    await t("та же модель — новые версии расписания не плодятся", () => {
        const w = boot("diary.html", DIARY_SCRIPTS);
        const before = w.MPTData.versions().length;
        const same = JSON.parse(JSON.stringify(MODEL));
        same.fetchedAt = new Date(Date.now() + 1000).toISOString();
        eq(w.MPTData.adoptSnapshot(same), true, "снимок принят");
        eq(w.MPTData.versions().length, before, "версий стало больше");
    });

    await t("настоящая правка сайта даёт ровно одну новую версию", () => {
        const w = boot("diary.html", DIARY_SCRIPTS, CHOSEN);
        const before = w.MPTData.versions().length;
        const changed = changedCopy(MODEL, GROUP, "НОВЫЙ ПРЕДМЕТ ИЗ САЙТА");
        eq(w.MPTData.adoptSnapshot(changed), true, "снимок принят");
        eq(w.MPTData.versions().length, before + 1, "версий");
    });

    await t("ручные периоды и граница правок остаются на месте", () => {
        const w = boot("diary.html", DIARY_SCRIPTS);
        const limit = w.MPTData.manualLimitDate();
        eq(w.MPTData.setManualPeriod(null, limit, { ПН: [{ pair: 1, subj: "РУЧНОЙ ПРЕДМЕТ" }], ВТ: [], СР: [], ЧТ: [], ПТ: [], СБ: [] }), null, "период сохранён");
        const periodsBefore = JSON.stringify(w.MPTData.manualPeriods());
        const firstBefore = w.MPTData.firstFetchDate();
        eq(w.MPTData.adoptSnapshot(JSON.parse(JSON.stringify(MODEL))), true, "снимок принят");
        eq(JSON.stringify(w.MPTData.manualPeriods()), periodsBefore, "периоды изменились");
        eq(w.MPTData.firstFetchDate(), firstBefore, "граница правок сдвинулась");
        eq(w.MPTData.isManual(), true, "ручная правка потерялась");
    });

    await t("отметки дневника не теряются при обновлении", () => {
        // В хранилище кладём СТАРЫЙ формат (недели в корне): заодно проверяем,
        // что перенос отметок под группу срабатывает
        const grades = {};
        grades[w0Monday()] = { ПН: { 1: ["5"] } };
        const w = boot("diary.html", DIARY_SCRIPTS, { ...CHOSEN, [GRADES_KEY]: JSON.stringify(grades) });
        eq(w.MPTData.adoptSnapshot(changedCopy(MODEL, GROUP, "ПРЕДМЕТ ПОСЛЕ ОБНОВЛЕНИЯ")), true, "снимок принят");
        const marks = [...w.document.querySelectorAll("#diary-table .d-mark:not(.d-mark-add)")].map((c) => c.textContent);
        ok_(marks.indexOf("5") !== -1, "отметка «5» пропала, видно: " + marks.join(","));
        const saved = JSON.parse(w.localStorage.getItem(GRADES_KEY));
        eq(saved[OTDEL + "|" + GROUP][w0Monday()].ПН["1"], ["5"], "хранилище отметок");
    });

    await t("если группы нет в новом снимке, данные остаются прежними", () => {
        const w = boot("diary.html", DIARY_SCRIPTS);
        const before = w.MPTData.updatedAt;
        const broken = JSON.parse(JSON.stringify(MODEL));
        broken.fetchedAt = new Date(Date.now() + 1000).toISOString();
        broken.departments = {};
        broken.departmentOrder = ["Только это отделение"];
        eq(w.MPTData.adoptSnapshot(broken), false, "снимок должен быть отклонён");
        eq(w.MPTData.updatedAt, before, "данные подменены");
        eq(w.MPTData.available, true, "расписание с сайта потеряно");
    });

    console.log("\n" + ok + " ok, " + bad + " fail");
    process.exit(bad ? 1 : 0);
})();

// Понедельник текущей недели в том же виде, в каком его пишет дневник
function w0Monday() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
