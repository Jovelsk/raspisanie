// Замены: страница и разбор страницы mpt.ru
const fs = require("fs");
const path = require("path");
const os = require("os");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");

let ok = 0, bad = 0;
function t(name, fn) {
    try { fn(); ok++; console.log("ok   " + name); }
    catch (e) { bad++; console.log("FAIL " + name + "\n     " + e.message); }
}
function eq(got, want, msg) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) throw new Error(msg + ": ожидалось " + w + ", получено " + g);
}
function ok_(cond, msg) { if (!cond) throw new Error(msg); }

// ——————————————————————————————————
// Фикстура: кусок настоящей страницы замен
// ——————————————————————————————————

const FIXTURE = `<!DOCTYPE html><html><body>
<h4>Замены на <b>02.10.2026</b> (Сегодня)</h4>
<div class="table-responsive">
<table class="table table-striped">
    <caption style="color: black; font-size: 16pt;">Группа: <b>П-5-25</b></caption>
    <tr><th class="lesson-number">Пара</th><th class="replace-from">Что заменяют</th>
        <th class="replace-to">На что заменяют</th><th class="updated-at">Замена добавлена</th></tr>
    <tr>
        <td class="lesson-number">2</td>
        <td class="replace-from">Дискретная математика Е.В. Добрынина</td>
        <td class="replace-to">Дискретная математика О.С. Зеленская</td>
        <td class="updated-at">02.10.2026 15:46:27</td>
    </tr>
    <tr>
        <td class="lesson-number">4</td>
        <td class="replace-from">Элементы высшей математики Е.В. Добрынина</td>
        <td class="replace-to">Занятие отменено с последующей отработкой</td>
        <td class="updated-at">02.10.2026 15:50:00</td>
    </tr>
</table>
<table class="table table-striped">
    <caption>Группа: <b>ИИ-1-25, ИИ-11-26</b></caption>
    <tr><th class="lesson-number">Пара</th></tr>
    <tr>
        <td class="lesson-number">1</td>
        <td class="replace-from">Дополнительное занятие </td>
        <td class="replace-to">Информатика А.О. Герлах</td>
        <td class="updated-at">02.10.2026 16:00:59</td>
    </tr>
</table>
</div>
<h4>Замены на <b>03.10.2026</b> (Суббота)</h4>
<div class="table-responsive">
<table class="table table-striped">
    <caption>Группа: <b>БИ-2-24; БИ-11/2-25</b></caption>
    <tr><th class="lesson-number">Пара</th></tr>
    <tr>
        <td class="lesson-number">3</td>
        <td class="replace-from">Математика Ю.А. Калашникова</td>
        <td class="replace-to">Физика К.А. Елисеева</td>
        <td class="updated-at">03.10.2026 09:00:00</td>
    </tr>
</table>
</div>
</body></html>`;

// Разбор держим в tools/, поэтому подключаем его как модуль через дочерний процесс.
// --no-log: прогон проверки не должен попадать в настоящую историю обновлений.
function parseFixture(htmlPath, outPath) {
    const res = require("child_process").spawnSync(process.execPath,
        [path.join(ROOT, "tools", "fetch-replacements.mjs"), "--html", htmlPath, "--out", outPath, "--no-log"],
        { encoding: "utf8", cwd: ROOT });
    // Дочерний процесс мог вообще не запуститься (нет прав, песочница).
    // Это не «разбор не прошёл проверку», а сломанное окружение: молчать
    // нельзя, иначе проверка «пустая страница не затирает файл» пройдёт
    // сама собой на любом отказе запуска.
    if (res.error) {
        throw new Error("не удалось запустить разбор: " + (res.error.code || res.error.message));
    }
    return res;
}

// ——————————————————————————————————
// Страница замен
// ——————————————————————————————————

const html = fs.readFileSync(path.join(ROOT, "replacements.html"), "utf8");

function openPage(replJs, storedGrupa) {
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/replacements.html",
        runScripts: "outside-only"
    });
    const w = dom.window;
    w.localStorage.clear();
    if (storedGrupa) {
        // Отделение тоже запоминаем: группа без отделения больше не выбирается
        w.localStorage.setItem("mpt-otdel", "09.02.07 П,Т");
        w.localStorage.setItem("mpt-grupa", storedGrupa);
    }
    if (replJs) w.eval("window.MPTReplacements = " + replJs + ";");
    w.eval(fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8"));
    for (const f of ["js/data.js", "js/theme.js", "js/replacements.js"]) {
        w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    return w;
}

const MODEL = {
    source: "https://mpt.ru/izmeneniya-v-raspisanii/",
    fetchedAt: "2026-10-02T17:29:38.340Z",
    days: [
        {
            date: "2026-10-02", dateText: "02.10.2026", weekday: "Пятница", today: true,
            groups: [{
                groups: ["П-5-25"],
                rows: [
                    { pair: 4, from: "Элементы высшей математики Е.В. Добрынина", to: "Занятие отменено с последующей отработкой", fromSubj: "Элементы высшей математики", fromTeacher: "Е.В. Добрынина", toSubj: "Занятие отменено с последующей отработкой", toTeacher: null, addedAt: "02.10.2026 15:50:00" },
                    { pair: 2, from: "Дискретная математика Е.В. Добрынина", to: "Дискретная математика О.С. Зеленская", fromSubj: "Дискретная математика", fromTeacher: "Е.В. Добрынина", toSubj: "Дискретная математика", toTeacher: "О.С. Зеленская", addedAt: "02.10.2026 15:46:27" },
                ]
            }]
        },
        {
            date: "2026-10-03", dateText: "03.10.2026", weekday: "Суббота", today: false,
            groups: [{
                groups: ["БИ-2-24", "БИ-11/2-25"],
                rows: [{ pair: 3, from: "Математика Ю.А. Калашникова", to: "Физика К.А. Елисеева", fromSubj: "Математика", fromTeacher: "Ю.А. Калашникова", toSubj: "Физика", toTeacher: "К.А. Елисеева", addedAt: "03.10.2026 09:00:00" }]
            }]
        }
    ],
    groupNames: ["П-5-25", "ИИ-1-25", "ИИ-11-26", "БИ-2-24", "БИ-11/2-25"],
    stats: { days: 2, groups: 5, rows: 4 }
};

t("страница подключает файл замен и свой скрипт", () => {
    ok_(/data\/replacements\.js/.test(html), "нет <script src=\"data/replacements.js\">");
    ok_(/js\/replacements\.js/.test(html), "нет <script src=\"js/replacements.js\">");
    ok_(/id="replacements-list"/.test(html), "нет контейнера для списка замен");
    ok_(/id="replacements-empty"/.test(html), "нет блока «замен нет»");
    ok_(/class="no-replacements hidden"/.test(html), "блок «замен нет» должен быть изначально скрыт");
});

t("замены выбранной группы показаны, чужие — нет", () => {
    const w = openPage(JSON.stringify(MODEL), "П-5-25");
    w.MPTData.selectGroup("09.02.07 П,Т", "П-5-25");
    const list = w.document.getElementById("replacements-list");
    ok_(/Дискретная математика Е.В. Добрынина/.test(list.textContent), "нет своей замены: " + list.textContent);
    ok_(!/Физика К.А. Елисеева/.test(list.textContent), "показана чуж group's замена");
    ok_(w.document.getElementById("replacements-empty").classList.contains("hidden"),
        "блок «замен нет» не должен быть виден при наличии замен");
});

t("внутри группы замены идут по номеру пары", () => {
    const w = openPage(JSON.stringify(MODEL), "П-5-25");
    const days = w.MPTData.replacementsFor("П-5-25");
    eq(days.length, 1, "дней с заменами");
    eq(days[0].rows.map((r) => r.pair), [2, 4], "номера пар по порядку");
});

t("объединённая подпись попадает и первой, и второй группе", () => {
    const w = openPage(JSON.stringify(MODEL), null);
    eq(w.MPTData.replacementsFor("БИ-2-24").length, 1, "для БИ-2-24");
    eq(w.MPTData.replacementsFor("БИ-11/2-25").length, 1, "для БИ-11/2-25");
});

t("свежий день идёт первым", () => {
    const w = openPage(JSON.stringify(MODEL), null);
    const days = w.MPTData.replacementsFor("П-5-25");
    eq(days.length, 1, "дней");
    // модель с двумя днями для одной группы проверим отдельно
    const both = JSON.parse(JSON.stringify(MODEL));
    both.days[1].groups[0].groups = ["П-5-25"];
    const w2 = openPage(JSON.stringify(both), null);
    const d2 = w2.MPTData.replacementsFor("П-5-25");
    eq(d2.map((d) => d.date), ["2026-10-03", "2026-10-02"], "порядок дней");
});

t("«сегодня» считается по календарю, а не по отметке в файле", () => {
    // Отметка с сайта верна только в день съёмки: залежавшийся снимок
    // не должен подписывать прошедший день словом «сегодня».
    const stale = JSON.parse(JSON.stringify(MODEL));
    const w = openPage(JSON.stringify(stale), "П-5-25");
    w.MPTData.selectGroup("09.02.07 П,Т", "П-5-25");
    ok_(!/сегодня/.test(w.document.getElementById("replacements-list").textContent),
        "прошедший день подписан как «сегодня»");

    // А настоящий сегодняшний день отмечаем, даже если в файле отметки нет
    const d = new Date();
    const p = (n) => (n < 10 ? "0" : "") + n;
    const todayIso = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    const fresh = JSON.parse(JSON.stringify(MODEL));
    fresh.days[0].date = todayIso;
    fresh.days[0].dateText = p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
    fresh.days[0].today = false;
    const w2 = openPage(JSON.stringify(fresh), "П-5-25");
    w2.MPTData.selectGroup("09.02.07 П,Т", "П-5-25");
    ok_(/сегодня/.test(w2.document.getElementById("replacements-list").textContent),
        "у сегодняшнего дня нет отметки «сегодня»");
});

t("отмена и доп. занятие помечены своим классом", () => {
    const w = openPage(JSON.stringify(MODEL), "П-5-25");
    const list = w.document.getElementById("replacements-list");
    ok_(list.querySelector(".rep-cancel"), "нет класса для отменённой пары");
    ok_(list.querySelector(".rep-change"), "нет класса для обычной замены");
    // у отменённой пары зачёркивать «на что заменяют» нельзя
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const cancel = css.match(/\.rep-cancel[^{]*\{[^}]*\}/g) || [];
    ok_(cancel.length >= 2, "нет отдельных правил для отменённой пары");
});

t("при смене группы список перерисовывается", () => {
    const w = openPage(JSON.stringify(MODEL), "П-5-25");
    // группу берём настоящую: иначе selectGroup её не найдёт и страница
    // останется на прежней, а проверка врёт
    const other = w.MPTData.groups("09.02.01 Э")[0];
    ok_(w.MPTData.selectGroup("09.02.01 Э", other), "не удалось переключиться на группу " + other);
    eq(w.MPTData.replacementsFor().length, 0, "у группы без замен не должно быть ничего");
    const list = w.document.getElementById("replacements-list");
    eq(list.textContent.trim(), "", "у группы без замен список должен быть пуст");
    ok_(!w.document.getElementById("replacements-empty").classList.contains("hidden"),
        "должен появиться блок «замен нет»");
    const sub = w.document.getElementById("replacements-empty-sub").textContent;
    ok_(sub.indexOf(other) !== -1, "в подписи не названа группа: " + sub);
});

t("имя группы сопоставляется по кускам, а не целиком", () => {
    // На сайте группа бывает «ИИ-1-25, ИИ-11-26» в одной таблице,
    // а в расписании она названа иначе — сравнение идёт по кускам.
    const w = openPage(JSON.stringify(MODEL), null);
    eq(w.MPTData.replacementsFor("БИ-11/2-25").length, 1, "по одному куску объединённого имени");
    eq(w.MPTData.replacementsFor("БИ-2-24; БИ-11/2-25").length, 1, "по объединённому имени целиком");
    eq(w.MPTData.replacementsFor("П-5-25").length, 1, "по одиночному имени");
    eq(w.MPTData.replacementsFor("П-5-2").length, 0, "похожее, но другое имя не должно подходить");
});

t("на настоящем файле замен нашлись замены для выбранной группы", () => {
    const file = path.join(ROOT, "data", "replacements.js");
    if (!fs.existsSync(file)) throw new Error("нет data/replacements.js — запустите npm run fetch-replacements");
    const m = /window\.MPTReplacements = ([\s\S]*?);\s*$/.exec(fs.readFileSync(file, "utf8"));
    const w = openPage(m ? m[1] : null, "П-5-25");
    w.MPTData.selectGroup("09.02.07 П,Т", "П-5-25");
    // П-5-25 была в реальном снимке: проверяем именно совпадение по имени
    const list = w.document.getElementById("replacements-list");
    const model = JSON.parse(m[1]);
    const mine = model.days.some((d) => d.groups.some((g) => g.groups.indexOf("П-5-25") !== -1));
    if (mine) ok_(list.textContent.trim().length > 0, "замены П-5-25 есть в файле, но список пуст");
    ok_(w.MPTData.replacementsAvailable, "файл замен должен считаться загруженным");
});

t("без файла замен страница не молчит, а говорит, что загружает", () => {
    const w = openPage(null, "П-5-25");
    ok_(!w.MPTData.replacementsAvailable, "замены не должны считаться доступными");
    ok_(!w.document.getElementById("replacements-empty").classList.contains("hidden"),
        "нужен блок с пояснением");
    ok_(/Загружаем замены/.test(w.document.getElementById("replacements-empty-sub").textContent),
        "нет пояснения о загрузке: " + w.document.getElementById("replacements-empty-sub").textContent);
});

t("подпись обещает обновление раз в полчаса и даёт московское время", () => {
    const w = openPage(JSON.stringify(MODEL), "П-5-25");
    const txt = w.document.getElementById("replacements-updated").textContent;
    ok_(/полчаса/.test(txt), "нет упоминания получасового обновления: " + txt);
    // 17:29 UTC — это 20:29 по Москве
    ok_(/02\.10\.2026 20:29 МСК/.test(txt), "нет даты проверки по Москве: " + txt);
    ok_(!/02\.10\.2026 17:29/.test(txt), "в подписи UTC вместо московского: " + txt);
});

// ——————————————————————————————————
// Разбор страницы
// ——————————————————————————————————

// Фикстуры кладём во временную папку, а не в data/: там лежат настоящие данные
// с mpt.ru, и проверка не должна ни затирать их, ни мусорить рядом.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mpt-replacements-"));
const tmpHtml = path.join(tmpDir, "page.html");
const tmpOut = path.join(tmpDir, "out.js");

t("разбор страницы замен: даты, группы, предметы", () => {
    fs.writeFileSync(tmpHtml, FIXTURE, "utf8");
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    const res = parseFixture(tmpHtml, tmpOut);
    ok_(fs.existsSync(tmpOut), "разбор не создал файл:\n" + (res.stdout || "") + (res.stderr || ""));
    const m = /window\.MPTReplacements = ([\s\S]*?);\s*$/.exec(fs.readFileSync(tmpOut, "utf8"));
    ok_(m, "в файле нет window.MPTReplacements");
    const model = JSON.parse(m[1]);

    eq(model.stats.days, 2, "дней");
    eq(model.stats.groups, 5, "групп");
    eq(model.stats.rows, 4, "замен");

    eq(model.days[0].date, "2026-10-02", "дата первого дня");
    eq(model.days[0].weekday, "Пятница", "день недели восстановлен из даты вместо «Сегодня»");
    eq(model.days[0].today, true, "отметка «сегодня»");
    eq(model.days[1].weekday, "Суббота", "день недели второго дня");

    const g0 = model.days[0].groups[0];
    eq(g0.groups, ["П-5-25"], "имя группы");
    eq(g0.rows.length, 2, "замен в первой таблице");
    eq(g0.rows[0].pair, 2, "номер пары");
    eq(g0.rows[0].fromSubj, "Дискретная математика", "предмет до замены");
    eq(g0.rows[0].fromTeacher, "Е.В. Добрынина", "преподаватель до замены");
    eq(g0.rows[0].toTeacher, "О.С. Зеленская", "преподаватель после замены");
    eq(g0.rows[0].addedAt, "02.10.2026 15:46:27", "время добавления");

    eq(g0.rows[1].toSubj, "Занятие отменено с последующей отработкой", "отмена целиком в предмете");
    eq(g0.rows[1].toTeacher, null, "у отмены нет преподавателя");

    eq(model.days[0].groups[1].groups, ["ИИ-1-25", "ИИ-11-26"], "объединённая подпись через запятую");
    eq(model.days[0].groups[1].rows[0].fromSubj, "Дополнительное занятие", "доп. занятие");
    eq(model.days[0].groups[1].rows[0].fromTeacher, null, "у доп. занятия нет преподавателя");

    eq(model.days[1].groups[0].groups, ["БИ-2-24", "БИ-11/2-25"], "объединённая подпись через точку с запятой");
});

t("разбор пустой страницы не затирает рабочий файл", () => {
    fs.writeFileSync(tmpHtml, "<html><body><h1>Какая-то ошибка</h1></body></html>", "utf8");
    fs.writeFileSync(tmpOut, "window.MPTReplacements = " + JSON.stringify({ fetchedAt: "2026-01-01T00:00:00.000Z", days: [], stats: {} }) + ";\n", "utf8");
    const res = parseFixture(tmpHtml, tmpOut);
    ok_(res.status !== 0, "разбор должен был провалиться");
    const kept = fs.readFileSync(tmpOut, "utf8");
    ok_(/2026-01-01/.test(kept), "прошлый снимок должен был остаться: " + kept.slice(0, 120));
});

t("страница замен без таблиц не считается разобранной", () => {
    fs.writeFileSync(tmpHtml, "<html><body><h1>Замены на 02.10.2026</h1></body></html>", "utf8");
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    const res = parseFixture(tmpHtml, tmpOut);
    ok_(res.status !== 0, "пустой список замен не должен записываться");
    ok_(!fs.existsSync(tmpOut), "файл не должен был появиться");
});

// Убираем временную папку целиком, чтобы уборка не зависела от порядка тестов
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${ok} ok, ${bad} fail\n`);
process.exit(bad ? 1 : 0);