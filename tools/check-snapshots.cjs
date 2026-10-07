// Хранилище снимков: текущий файл плюс архив только тех версий, что отличаются.
// Проверки идут в своей временной папке и не трогают настоящие data/.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");

let ok = 0, bad = 0;
async function t(name, fn) {
    try { await fn(); ok++; console.log("ok   " + name); }
    catch (e) { bad++; console.log("FAIL " + name + "\n     " + e.message); }
}
function eq(got, want, msg) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error((msg || "") + ": ожидалось " + w + ", получено " + g);
}
function ok_(cond, msg) { if (!cond) throw new Error(msg); }

// Тот же формат, что у настоящих снимков
const toScript = (m) => "// проверочный снимок — не редактировать руками.\n"
    + "window.MPTSchedule = " + JSON.stringify(m) + ";\n";

function model(stamp, subj) {
    return {
        source: "https://mpt.ru/raspisanie/",
        fetchedAt: stamp,
        firstFetchedAt: "2026-09-30T17:13:29.995Z",
        page: { weekDate: "2026-10-07", parity: "Знаменатель" },
        groups: { "П-5-25": [subj] },
        stats: { groups: 1 },
    };
}

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "mpt-snap-"));
const listDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);

(async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, "tools", "snapshot-store.mjs")).href);
    const { storeSnapshot, sameContent, contentOf, stampForFile, historyName, HISTORY_DIR } = mod;

    console.log("== Имя версии и сравнение ==");

    await t("имя архивного файла берётся из метки снимка", () => {
        eq(stampForFile("2026-10-07T16:52:05.667Z"), "2026-10-07_16-52-05", "метка");
        eq(historyName("replacements", "2026-10-07T16:52:05.667Z"),
            "replacements-2026-10-07_16-52-05.js", "имя файла замен");
        eq(historyName("schedule", "2026-10-07T16:52:05.667Z"),
            "schedule-2026-10-07_16-52-05.js", "имя файла расписания");
        eq(stampForFile(""), "unknown", "пустая метка");
        eq(stampForFile(null), "unknown", "метки нет");
    });

    await t("отметка съёмки не считается изменением, а содержимое — считается", () => {
        eq(sameContent(model("2026-10-07T10:00:00.000Z", "A"), model("2026-10-07T23:59:00.000Z", "A")),
            true, "та же модель с другой отметкой");
        eq(sameContent(model("2026-10-07T10:00:00.000Z", "A"), model("2026-10-07T10:00:00.000Z", "B")),
            false, "другой предмет");
        eq(sameContent(null, model("2026-10-07T10:00:00.000Z", "A")), false, "пустая модель");
    });

    await t("шапку недели выбрасывает только расписание", () => {
        const m = model("2026-10-07T10:00:00.000Z", "A");
        eq(contentOf(m, "schedule").page.weekDate, undefined, "у расписания дата недели выброшена");
        eq(contentOf(m, "schedule").page.parity, undefined, "у расписания чётность выброшена");
        eq(contentOf(m, "replacements").page.weekDate, "2026-10-07", "у замен шапка не трогается");
        eq(contentOf(m, "schedule").fetchedAt, undefined, "отметка съёмки выброшена");
        // исходная модель не портится: правки идут в копию
        eq(m.page.weekDate, "2026-10-07", "исходная модель осталась целой");
    });

    eq(HISTORY_DIR, "data/history", "папка архива по умолчанию");

    console.log("\n== Запись снимков ==");

    await t("смена недели на сайте — не изменение расписания", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        const nextWeek = (m, iso, parity) => ({ ...m, page: { ...m.page, weekDate: iso, parity } });
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        const r = await storeSnapshot({
            out, kind: "schedule", toScript, historyDir: hist,
            model: nextWeek(model("2026-10-14T10:00:00.000Z", "A"), "2026-10-14", "Числитель"),
        });
        eq(r.changed, false, "смена недели изменением не считается");
        eq(listDir(hist), [], "архив должен остаться пустым");
        // но сама неделя в текущем файле должна обновиться: по ней страница
        // считает чётность и подписывает пилюлю «неделя ...»
        ok_(/2026-10-14/.test(fs.readFileSync(out, "utf8")), "в текущем файле не обновилась неделя");
    });

    await t("правка пары — изменение расписания, и прошлая версия идёт в архив", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-14T10:00:00.000Z", "B"), toScript, historyDir: hist });
        eq(r.changed, true, "правка пары — изменение");
        eq(r.archived, "schedule-2026-10-07_10-00-00.js", "прошлая версия в архиве");
    });

    await t("первый снимок: архива ещё нет, текущий файл создан", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        const r = await storeSnapshot({
            out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist,
        });
        eq(r.changed, true, "changed");
        eq(r.archived, null, "archived");
        eq(r.pruned, [], "pruned");
        ok_(fs.existsSync(out), "текущий файл не создан");
        eq(listDir(hist), [], "архив должен быть пустым");
    });

    await t("содержимое то же — в архив ничего не добавляется", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T22:00:00.000Z", "A"), toScript, historyDir: hist });
        eq(r.changed, false, "changed");
        eq(listDir(hist), [], "архив должен остаться пустым");
        // отметку проверки в текущем файле всё равно обновляем: по ней видно,
        // когда данные смотрели в последний раз
        ok_(/2026-10-07T22:00:00/.test(fs.readFileSync(out, "utf8")),
            "в текущем файле не обновилась отметка проверки");
    });

    await t("содержимое изменилось — прошлая версия уходит в архив", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-08T10:00:00.000Z", "B"), toScript, historyDir: hist });
        eq(r.changed, true, "changed");
        eq(r.archived, "schedule-2026-10-07_10-00-00.js", "имя архивного файла");
        eq(listDir(hist), ["schedule-2026-10-07_10-00-00.js"], "в архиве");
        ok_(/"A"/.test(fs.readFileSync(path.join(hist, r.archived), "utf8")),
            "в архиве лежит не прошлая версия");
    });

    await t("расписание вернули к прежнему виду — копия текущей версии убирается", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-08T10:00:00.000Z", "B"), toScript, historyDir: hist });
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-09T10:00:00.000Z", "A"), toScript, historyDir: hist });
        eq(r.changed, true, "changed");
        eq(r.pruned, ["schedule-2026-10-07_10-00-00.js"], "убранные копии");
        eq(listDir(hist), ["schedule-2026-10-08_10-00-00.js"], "в архиве должен остаться только B");
    });

    await t("уже лежащую в архиве версию не кладём второй раз", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        const A = model("2026-10-07T10:00:00.000Z", "A");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, toScript(A), "utf8");
        await storeSnapshot({ out, kind: "schedule", model: model("2026-10-08T10:00:00.000Z", "B"), toScript, historyDir: hist });
        eq(listDir(hist), ["schedule-2026-10-07_10-00-00.js"], "после первого изменения");
        // та же самая версия снова стала текущей — в архиве она уже есть
        fs.writeFileSync(out, toScript(A), "utf8");
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-09T10:00:00.000Z", "C"), toScript, historyDir: hist });
        eq(r.archived, null, "повторно архивировать нечего");
        eq(listDir(hist).length, 1, "копий не должно прибавиться");
    });

    await t("замены и расписание ведут архивы раздельно", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const sched = path.join(dir, "data", "schedule.js");
        const repl = path.join(dir, "data", "replacements.js");
        await storeSnapshot({ out: sched, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        await storeSnapshot({ out: repl, kind: "replacements", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        await storeSnapshot({ out: sched, kind: "schedule", model: model("2026-10-08T10:00:00.000Z", "B"), toScript, historyDir: hist });
        const r = await storeSnapshot({ out: repl, kind: "replacements", model: model("2026-10-08T10:00:00.000Z", "B"), toScript, historyDir: hist });
        eq(r.archived, "replacements-2026-10-07_10-00-00.js", "архив замен");
        eq(listDir(hist),
            ["replacements-2026-10-07_10-00-00.js", "schedule-2026-10-07_10-00-00.js"],
            "в архиве обе версии");
    });

    await t("испорченный текущий файл не мешает записать новый", async () => {
        const dir = freshDir();
        const hist = path.join(dir, "data", "history");
        const out = path.join(dir, "data", "schedule.js");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, "тут мусор, а не снимок", "utf8");
        const r = await storeSnapshot({ out, kind: "schedule", model: model("2026-10-07T10:00:00.000Z", "A"), toScript, historyDir: hist });
        eq(r.changed, true, "changed");
        eq(r.archived, null, "мусор в архив не кладём");
        eq(listDir(hist), [], "архив пуст");
        ok_(/window\.MPTSchedule/.test(fs.readFileSync(out, "utf8")), "текущий файл не перезаписан");
    });

    console.log("\n" + ok + " ok, " + bad + " fail");
    process.exit(bad ? 1 : 0);
})();
