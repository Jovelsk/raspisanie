// Забирает https://mpt.ru/izmeneniya-v-raspisanii/ и раскладывает замены по датам и группам.
// Запуск: node tools/fetch-replacements.mjs [--out data/replacements.js] [--html <локальный файл>] [--no-log]
// Прошлые версии уходят в data/history — только те, что отличаются от текущей
// (см. tools/snapshot-store.mjs).
//
// Отдельный скрипт, а не дополнение к fetch-schedule: страница замен меняется
// часто (преподаватели правят в течение дня), расписание — раз в неделю.
// Разбор страницы общий с сайтом: js/mpt-parse.js.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { storeSnapshot, HISTORY_DIR } from "./snapshot-store.mjs";
import { loadParser } from "./parser-loader.mjs";

const SOURCE_URL = "https://mpt.ru/izmeneniya-v-raspisanii/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Разбор берём из общего файла — того же, который читает страница
const P = await loadParser();

// Файл отдаётся браузеру обычным <script>: работает и при открытии через file://
function toScript(model) {
    return "// Сгенерировано tools/fetch-replacements.mjs — не редактировать руками.\n"
        + "window.MPTReplacements = " + JSON.stringify(model) + ";\n";
}

async function readStamp(out) {
    try {
        const m = /window\.MPTReplacements = ([\s\S]*?);\s*$/.exec(await readFile(resolve(out), "utf8"));
        const prev = m ? JSON.parse(m[1]) : null;
        return prev ? { fetchedAt: prev.fetchedAt, stats: prev.stats } : null;
    } catch (e) { return null; }
}

// Время в журнале — московское: журнал читает человек, а снимки и сайт живут
// в UTC. Москва круглый год UTC+3, смещение пишем прямо в метке.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
function mskStamp() {
    return new Date(Date.now() + MSK_OFFSET_MS).toISOString().replace(/Z$/, "+03:00");
}

// Журнал — вспомогательная запись. Если он не открывается (нет прав, том
// только для чтения), данные всё равно уже обновлены, поэтому запуск не валим.
// --no-log полностью выключает запись: им пользуются проверки, чтобы не
// подмешивать свои прогоны в настоящую историю обновлений.
async function log(line) {
    if (noLog) return;
    try {
        const p = resolve("data/last-update.log");
        let old = "";
        try { old = await readFile(p, "utf8"); } catch (e) {}
        const lines = old.split("\n").filter(Boolean);
        lines.push(`${mskStamp()}  ${line}`);
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, lines.slice(-60).join("\n") + "\n", "utf8");
    } catch (e) {
        console.error(`Не удалось записать журнал обновлений: ${e.message}`);
    }
}

async function loadHtml() {
    const local = arg("--html", null);
    if (local) return readFile(resolve(local), "utf8");
    const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
}

// ——————————————————————————————————
// Запуск
// ——————————————————————————————————

const out = arg("--out", "data/replacements.js");
const quiet = process.argv.includes("--quiet");
const noLog = process.argv.includes("--no-log");
const say = quiet ? () => { } : console.log;

let html;
try {
    html = await loadHtml();
} catch (e) {
    const prev = await readStamp(out);
    say(`Не удалось скачать ${SOURCE_URL}: ${e.message}`);
    say(prev
        ? `Оставлен прошлый снимок замен от ${prev.fetchedAt}`
        : `Замен ещё нет — файл ${out} не создан, проверь сеть`);
    await log(`ОШИБКА загрузки замен: ${e.message}${prev ? ` (оставлен снимок ${prev.fetchedAt})` : " (снимка нет)"}`);
    process.exit(1);
}

const model = P.buildReplacements(html, new Date().toISOString());
const problems = P.checkReplacements(model, html);

if (problems.length) {
    const prev = await readStamp(out);
    say("Разбор замен не прошёл проверку:");
    for (const p of problems) say("  - " + p);
    say(prev
        ? `Оставлен прошлый снимок от ${prev.fetchedAt} (замен: ${prev.stats.rows})`
        : "Прошлого снимка нет — файл не тронут, замен не будет");
    await log(`ОШИБКА разбора замен: ${problems.join("; ")}${prev ? ` (оставлен снимок ${prev.fetchedAt})` : ""}`);
    process.exit(1);
}

// Текущий файл перезаписываем всегда (по отметке видно, когда проверяли),
// а прошлую версию кладём в архив только если замены правда поменялись
const stored = await storeSnapshot({ out, kind: "replacements", model, toScript });

say(`Дней с заменами: ${model.stats.days} | групп: ${model.stats.groups} | замен: ${model.stats.rows}`);
for (const d of model.days) say(`  ${d.date} ${d.weekday}: ${d.groups.length} групп`);
say(`Записано: ${out}`);
if (!stored.changed) {
    say("Содержимое не изменилось — архив не тронут");
} else if (stored.archived) {
    say(`Прошлая версия сохранена: ${HISTORY_DIR}/${stored.archived}`);
}
if (stored.pruned.length) say(`Убрано копий, совпавших с текущей версией: ${stored.pruned.length}`);
await log(`OK замены — дней ${model.stats.days}, групп ${model.stats.groups}, замен ${model.stats.rows}`
    + (stored.changed ? "" : " (без изменений)")
    + (stored.archived ? ` (прошлая версия -> ${HISTORY_DIR}/${stored.archived})` : ""));
