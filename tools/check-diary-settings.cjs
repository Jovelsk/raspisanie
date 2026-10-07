// Ручное расписание в настройках дневника: правка живёт периодами до первого
// снимка расписания с сайта, дальше сайт единственный источник. Настройки
// целиком выгружаются и загружаются обратно вместе с группой и отметками.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const OTDEL = "09.02.07 П,Т";
const GRUPA = "П-5-25";
const OTHER = "П-5-24";
const GRADES_KEY = "mpt-diary-grades-v2";
const MANUAL_KEY = "mpt-schedule-manual-v1";
const ALL = ["js/data.js", "js/theme.js", "js/diary.js", "js/diary-settings.js"];

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

// pages: какие js грузить; seed: что положить в localStorage до старта
function boot(opts) {
    const o = opts || {};
    const page = o.page || "diary.html";
    const html = fs.readFileSync(path.join(ROOT, page), "utf8")
        .replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/" + page,
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.localStorage.clear();
    w.localStorage.setItem("mpt-otdel", OTDEL);
    w.localStorage.setItem("mpt-grupa", o.group || GRUPA);
    for (const k in (o.seed || {})) w.localStorage.setItem(k, o.seed[k]);
    w.eval(fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8"));
    for (const f of (o.pages || ALL)) w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));

    // выгрузку ловим без файловой системы: Blob -> строка, ссылка без перехода
    w.__json = "";
    w.Blob = function (parts) { w.__json = parts[0]; };
    w.URL.createObjectURL = function () { return "#mpt-download"; };
    w.URL.revokeObjectURL = function () {};
    // чтение файла делаем синхронным, чтобы тест не ждал FileReader
    w.FileReader = function () {
        const self = this;
        self.readAsText = function (file) { self.result = file.__text; if (self.onload) self.onload(); };
    };
    return w;
}

// окно подтверждения/уведомления дневника
function lastMsg(w) {
    const list = w.document.querySelectorAll(".c-overlay .c-msg");
    return list.length ? list[list.length - 1].textContent : null;
}
function tapOverlay(w) {
    const list = w.document.querySelectorAll(".c-overlay");
    const ov = list[list.length - 1];
    if (!ov) return null;
    const msg = ov.querySelector(".c-msg").textContent;
    ov.querySelector(".c-ok").dispatchEvent(new w.Event("click", { bubbles: true }));
    return msg;
}
// закрыть последнее окно подтверждения кнопкой «Отмена»
function refuseOverlay(w) {
    const list = w.document.querySelectorAll(".c-overlay");
    const ov = list[list.length - 1];
    ok(ov, "окно подтверждения не появилось");
    const msg = ov.querySelector(".c-msg").textContent;
    ov.querySelector(".c-no").dispatchEvent(new w.Event("click", { bubbles: true }));
    return msg;
}
function edPane(w) {
    return w.document.querySelector('#settings-overlay .settings-pane[data-pane="diary"]');
}
function showDiaryTab(w) {
    w.MPTSettings.show("diary");
    w.MPTSettings.open();
    return edPane(w);
}
// показать вкладку и выйти из режима правки, если он был открыт
function idleTab(w) {
    const ed = showDiaryTab(w);
    const cancel = ed.querySelector("#ed-cancel");
    if (cancel) click(w, cancel);
    return ed;
}
// вкладки периодов: клик открывает период на правку, первый — «весь срок»
function periodTabs(w) {
    return edPane(w).querySelectorAll(".ed-tab");
}
function openTab(w, n) {
    const ed = edPane(w);
    const tabs = ed.querySelectorAll(".ed-tab");
    click(w, tabs[n || 0]);
    return edPane(w);
}
// новая дата относительно первого снимка расписания с сайта
function fromFirst(isoDay) {
    const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    return new Date(+p[1], +p[2] - 1, +p[3]);
}
function click(w, el) {
    ok(el, "элемент для клика не найден");
    el.dispatchEvent(new w.Event("click", { bubbles: true }));
}
function setVal(w, el, value) {
    ok(el, "поле для ввода не найдено");
    el.value = value;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
}
// «Сохранить изменения» спрашивает подтверждения — отвечаем согласием
function saveEd(w, ed) {
    click(w, ed.querySelector("#ed-save"));
    return tapOverlay(w);
}
// Предмет в ячейке недельной таблицы
function weekSubj(w, pair, dayIdx) {
    const tr = w.document.querySelectorAll("#diary-table tbody tr")[pair - 1];
    if (!tr) return null;
    const td = tr.children[dayIdx + 1];
    if (!td) return null;
    const s = td.querySelector(".d-subj");
    return s ? s.textContent : null;
}
function weekMarks(w, pair, dayIdx) {
    const tr = w.document.querySelectorAll("#diary-table tbody tr")[pair - 1];
    if (!tr) return null;
    const td = tr.children[dayIdx + 1];
    if (!td) return null;
    return Array.prototype.map.call(
        td.querySelectorAll(".d-mark:not(.d-mark-add)"), (b) => b.textContent).join("");
}
function gridWith(day, pair, subj, teacher) {
    const g = {};
    for (const d of DAYS) g[d] = [];
    const row = { pair: pair, subj: subj };
    if (teacher) row.teacher = teacher;
    g[day] = [row];
    return g;
}
function subjects(grid) {
    const out = [];
    for (const d of DAYS) for (const r of (grid[d] || [])) out.push(r.subj);
    return out;
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const nextWeek = addDays(today, 7);
const thisMonday = addDays(today, -((today.getDay() + 6) % 7));
const MANUAL = "РУЧНОЙ ПРЕДМЕТ";
const MANUAL2 = "РУЧНОЙ ВТОРОЙ";
const TEACHER = "И. И. Иванов";
console.log("Сегодня " + iso(today) + "\n");

// ——————————————————————————————————————————————
// Слой данных: ручные периоды только до первого снимка с сайта
// ——————————————————————————————————————————————

console.log("== Ручное расписание ==");
const w = boot({});
const siteGrid = w.MPTData.editableSchedule();
const firstDay = DAYS.find((d) => siteGrid[d] && siteGrid[d].length);
const firstPair = siteGrid[firstDay][0].pair;
const firstOld = siteGrid[firstDay][0].subj;
const dayIdx = DAYS.indexOf(firstDay);
const FIRST = w.MPTData.firstFetchDate();
const LIMIT = w.MPTData.manualLimitDate();
const firstDayDate = fromFirst(FIRST);
const limitDay = fromFirst(LIMIT);
// дата внутри ручного периода: за пару дней до границы
const inLimit = addDays(limitDay, -2);
// Дата за неделю до границы: тут ручная правка действует заведомо. Отсчитывать
// «неделю назад» от сегодня нельзя — со временем она уезжает за снимок.
const weekBeforeLimit = addDays(limitDay, -7);

t("изначально расписание с сайта", () => {
    eq(w.MPTData.isManual(), false, "ручная версия:");
    eq(w.MPTData.manualPeriods().length, 0, "периодов:");
    eq(w.MPTData.editableSchedule(), siteGrid, "сетка для правки:");
    ok(FIRST, "не известна дата первого снимка");
    ok(LIMIT, "не известна граница ручных правок");
    ok(LIMIT < FIRST, "граница правок позже первого снимка: " + LIMIT);
    eq(addDays(limitDay, 1).getTime(), firstDayDate.getTime(), "граничный день не день перед снимком");
});

t("ручная правка действует только до первого снимка", () => {
    eq(w.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, MANUAL, TEACHER)),
        null, "сохранение периода:");
    eq(w.MPTData.isManual(), true, "ручная версия:");
    eq(w.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "до снимка:");
    eq(w.MPTData.scheduleForDate(inLimit)[firstDay][0].teacher, TEACHER, "преподаватель:");
    eq(w.MPTData.scheduleForDate(weekBeforeLimit)[firstDay][0].subj, MANUAL, "неделю назад:");
    // с первого снимка и дальше расписание только с сайта
    eq(w.MPTData.scheduleForDate(firstDayDate)[firstDay][0].subj, firstOld, "в день снимка:");
    eq(w.MPTData.scheduleForDate(today)[firstDay][0].subj, firstOld, "сегодня:");
    eq(w.MPTData.scheduleForDate(nextWeek)[firstDay][0].subj, firstOld, "через неделю:");
});

t("ручная правка лежит в периодах, а не в истории сайта", () => {
    const list = w.MPTData.manualPeriods();
    eq(list.length, 1, "периодов:");
    eq(list[0].from, null, "from:");
    eq(list[0].to, LIMIT, "to:");
    eq(w.MPTData.versions().length, 1, "версий сайта:");
    eq(w.MPTData.versions()[0].manual, undefined, "в истории сайта ручной записи нет");
});

t("период нельзя вывести за первый снимок", () => {
    eq(w.MPTData.checkManualPeriod(null, LIMIT), null, "предельный период:");
    ok(w.MPTData.checkManualPeriod(null, FIRST), "период до первого снимка не отклонён");
    ok(w.MPTData.checkManualPeriod("2026-05-10", "2026-10-10"), "период через снимок не отклонён");
    ok(w.MPTData.checkManualPeriod("2026-05-10", "2026-05-01"), "перепутанные границы не отклонены");
    ok(w.MPTData.checkManualPeriod(null, "не дата"), "мусор в датах не отклонён");
    eq(w.MPTData.manualPeriods().length, 1, "периодов не должно было измениться");
});

t("смена группы не плодит версии и не теряет правку", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    w.MPTData.selectGroup(OTDEL, GRUPA);
    eq(w.MPTData.versions().length, 1, "версий:");
    eq(w.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "правка на месте:");
});

t("дневник показывает правку до снимка и сайт после", () => {
    // Снимок сделан в конкретный день, и его неделя со временем перестаёт быть
    // текущей. Открываем неделю снимка по дате, а не кнопкой «Сегодня»:
    // иначе проверка верна только в ту неделю, когда снимок и сняли.
    setVal(w, w.document.getElementById("diary-picker"), FIRST);
    // первый снимок 30.09.2026 — среда: в её неделе слева ручная правка, справа сайт
    const wedIdx = DAYS.indexOf("СР");
    ok(siteGrid["СР"] && siteGrid["СР"].length, "в снимке нет пар в среду");
    const wedPair = siteGrid["СР"][0].pair;
    eq(weekSubj(w, firstPair, DAYS.indexOf("ПН")), MANUAL, "понедельник недели снимка:");
    eq(weekSubj(w, wedPair, wedIdx), siteGrid["СР"][0].subj, "среда недели снимка:");
    // неделя после снимка целиком берётся с сайта
    setVal(w, w.document.getElementById("diary-picker"), iso(addDays(firstDayDate, 7)));
    eq(weekSubj(w, firstPair, dayIdx), firstOld, "через неделю:");
    w.document.getElementById("diary-today").dispatchEvent(new w.Event("click", { bubbles: true }));
});

t("плашки старой версии при ручном нет", () => {
    eq(w.document.querySelectorAll("#diary-table tfoot .stale-cell").length, 0, "плашек в неделе:");
    eq(w.document.querySelectorAll("#diary-month tfoot .stale-cell").length, 0, "плашек в месяце:");
});

t("ручная правка переживает перезапуск страницы", () => {
    const saved = w.localStorage.getItem(MANUAL_KEY);
    ok(saved, "периоды не записаны в localStorage");
    const w2 = boot({ seed: { [MANUAL_KEY]: saved } });
    eq(w2.MPTData.isManual(), true, "ручная версия:");
    eq(w2.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "расписание:");
    eq(w2.MPTData.versions().length, 1, "версий:");
});

t("чужая группа не наследует ручную версию", () => {
    w.MPTData.selectGroup(OTDEL, OTHER);
    eq(w.MPTData.isManual(), false, "ручная версия у другой группы:");
    const otherGrid = w.MPTData.scheduleForDate(today);
    ok(subjects(otherGrid).length > 0, "у другой группы должны быть пары");
    ok(subjects(otherGrid).indexOf(MANUAL) === -1, "чужая правка не подмешалась");
});

t("возврат к группе с правкой всё помнит", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    eq(w.MPTData.isManual(), true, "ручная версия:");
    eq(w.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "правка:");
});

t("возврат к расписанию с сайта убирает правку", () => {
    w.MPTData.clearManual();
    eq(w.MPTData.isManual(), false, "ручная версия:");
    eq(w.MPTData.manualPeriods().length, 0, "периодов:");
    eq(w.MPTData.versions().length, 1, "версий:");
    eq(w.MPTData.editableSchedule(), siteGrid, "вернулось расписание сайта:");
    w.document.getElementById("diary-today").dispatchEvent(new w.Event("click", { bubbles: true }));
    eq(weekSubj(w, firstPair, dayIdx), firstOld, "в дневнике:");
});

// ——————————————————————————————————————————————
// Вкладка настроек дневника
// ——————————————————————————————————————————————

console.log("\n== Вкладка «Дневник» в настройках ==");
t("на странице расписания такой вкладки нет", () => {
    const wi = boot({ page: "index.html", pages: ["js/data.js", "js/theme.js"] });
    ok(wi.MPTSettings, "окно настроек есть");
    eq(wi.document.querySelectorAll('#settings-tabs [data-tab="diary"]').length, 0, "вкладок дневника:");
    eq(wi.document.querySelectorAll("#settings-tabs button").length, 1, "вкладок всего:");
});

t("вкладка дневника есть только в дневнике", () => {
    eq(w.document.querySelectorAll('#settings-tabs [data-tab="diary"]').length, 1, "вкладок дневника:");
    eq(w.document.querySelectorAll('#settings-tabs [data-tab="general"]').length, 1, "вкладок оформления:");
});

t("в шапке дневника кнопок выгрузки больше нет", () => {
    eq(w.document.getElementById("diary-export"), null, "кнопка выгрузки:");
    eq(w.document.getElementById("diary-import"), null, "кнопка загрузки:");
});

t("во вкладке есть периоды, правка и выгрузка", () => {
    const ed = showDiaryTab(w);
    ok(ed, "полотно вкладки:");
    ok(ed.querySelector("#ed-add-period"), "кнопка добавления периода:");
    ok(ed.querySelector(".ed-tabs"), "вкладок периодов нет");
    eq(ed.querySelectorAll(".ed-tab").length, 1, "вкладок периодов:");
    ok(/Всё до/.test(ed.querySelector(".ed-tab").textContent),
        "подпись вкладки: " + ed.querySelector(".ed-tab").textContent);
    ok(ed.querySelector("#ed-export"), "кнопка выгрузки:");
    ok(ed.querySelector("#ed-import"), "кнопка загрузки:");
});

t("окно узкое вне правки и широкое в правке", () => {
    const box = w.document.querySelector(".settings-box");
    const ed = showDiaryTab(w);
    // «Дневник» чуть шире обычного окна, но не настолько широк, как правка
    eq(box.style.maxWidth, "495px", "ширина окна на вкладке дневника:");
    w.MPTSettings.show("general");
    eq(box.style.maxWidth, "", "на «Оформлении» ширина должна остаться общей");
    showDiaryTab(w);
    ok(!box.classList.contains("settings-box-wide"), "вне правки окно должно быть узким");
    openTab(w);
    ok(box.classList.contains("settings-box-wide"), "в режиме правки окно должно быть широким");
    eq(box.style.maxWidth, "", "в режиме правки ширину задаёт само правило");
    click(w, edPane(w).querySelector("#ed-cancel"));
    ok(!box.classList.contains("settings-box-wide"), "после отмены окно не сузилось");
    // на других вкладках окно всегда узкое, даже если правили расписание
    openTab(w);
    w.MPTSettings.show("general");
    ok(!box.classList.contains("settings-box-wide"), "на вкладке оформления окно широкое");
    w.MPTSettings.show("diary");
    ok(box.classList.contains("settings-box-wide"), "правка не восстановилась при возврате на вкладку");
    click(w, edPane(w).querySelector("#ed-cancel"));
    // и сужается после сохранения
    openTab(w);
    saveEd(w, edPane(w));
    ok(!box.classList.contains("settings-box-wide"), "после сохранения окно осталось широким");
});

t("правка открывает строки с парами", () => {
    idleTab(w);
    const ed = openTab(w);
    const rows = ed.querySelectorAll(".ed-row");
    ok(rows.length > 0, "строк редактора нет");
    ok(rows[0].querySelector(".ed-subj").value, "предмет не подставлен");
    ok(rows[0].querySelector(".ed-day").value, "день не подставлен");
    ok(ed.querySelector("#ed-save"), "нет кнопки сохранения");
    ok(ed.querySelector("#ed-cancel"), "нет кнопки отмены");
});

t("список пар в рамке, счётчик и прокрутка на месте", () => {
    idleTab(w);
    let ed = openTab(w);
    ok(ed.querySelector(".ed-list"), "список пар не обёрнут в рамку");
    const rowsBox = ed.querySelector("#ed-rows");
    ok(rowsBox && rowsBox.classList.contains("ed-rows"), "нет прокручиваемого списка");
    const count = ed.querySelector("#ed-count");
    ok(count && /\d+ пар/.test(count.textContent), "счётчик пар: " + (count ? count.textContent : "нет"));
    const before = ed.querySelectorAll("#ed-rows .ed-row").length;
    click(w, ed.querySelector("#ed-add"));
    ed = edPane(w);
    eq(ed.querySelectorAll("#ed-rows .ed-row").length, before + 1, "после добавления строк:");
    ok(new RegExp("^" + (before + 1) + " пар").test(ed.querySelector("#ed-count").textContent),
        "счётчик не обновился: " + ed.querySelector("#ed-count").textContent);
    click(w, ed.querySelector("#ed-cancel"));
});

t("окно настроек широкое, список ограничен по высоте", () => {
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const boxes = css.match(/\.settings-box\s*\{[^}]*\}/g) || [];
    ok(boxes.length, "нет правила .settings-box");
    // окно не прокручивается нигде: ни в основном правиле, ни в темах, ни на телефоне
    boxes.forEach((b) => {
        ok(!/overflow/.test(b), "окно прокручивается: " + b.replace(/\s+/g, " "));
        ok(!/max-height/.test(b), "окно всё ещё ограничено по высоте: " + b.replace(/\s+/g, " "));
    });
    const wideBox = css.match(/\.settings-box-wide\s*\{[^}]*\}/);
    ok(wideBox, "нет правила .settings-box-wide");
    ok(/max-width:\s*(\d+)px/.test(wideBox[0]), "у широкого окна нет max-width");
    ok(+wideBox[0].match(/max-width:\s*(\d+)px/)[1] >= 1200, "окно всё ещё узкое: " + wideBox[0]);
    // узкое окно — 400 пикселей, «Дневник» просит себе чуть шире сам
    const withWidth = boxes.filter((b) => /max-width/.test(b))[0];
    ok(withWidth, "у окна настроек нет max-width");
    eq(+withWidth.match(/max-width:\s*(\d+)px/)[1], 400, "ширина окна вне правки: " + withWidth);
    const rows = css.match(/\.ed-rows\s*\{[^}]*\}/);
    ok(rows && /max-height:\s*\d+px/.test(rows[0]), "у списка пар нет ограничения высоты");
    ok(/overflow-y:\s*auto/.test(rows[0]), "список пар не прокручивается");
    ok(/\.ed-list\s*\{[^}]*border/.test(css), "нет рамки вокруг списка пар");
});

t("колонки редактора тянутся, а не заданы в пикселях", () => {
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const grid = css.match(/\.ed-head,\s*\n\.ed-row\s*\{[^}]*\}/);
    ok(grid, "нет общей сетки шапки и строк");
    ok(/fr/.test(grid[0]), "колонки не тянутся: " + grid[0]);
    // колонки либо тянутся (minmax/fr), либо фиксированы узкими: ползунок и кнопка
    const cols = grid[0].match(/grid-template-columns:([^;]+)/)[1];
    const fixed = cols.replace(/minmax\([^)]*\)/g, "").match(/(\d+)px/g) || [];
    eq(fixed.map((s) => parseInt(s, 10)).sort((a, b) => a - b).join(","), "34,96",
        "фиксированные колонки: " + fixed.join(", "));
    // на планшете и телефоне поля складываются в две колонки
    ok(/@media\s*\(max-width:\s*1024px\)[\s\S]*?\.ed-row\s*\{\s*grid-template-columns:\s*1fr 1fr/.test(css),
        "нет складывания полей на узком экране");
});

t("в тёмной теме иконка календаря в поле даты видна", () => {
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    // без этого правила браузер рисует иконку календаря тёмной на тёмном
    const darkBlocks = css.match(/\[data-theme="dark"\][^{]*\{[^}]*\}/g) || [];
    const dateRule = darkBlocks.filter((b) => /input\[type="date"\]/.test(b.split("{")[0]))[0];
    ok(dateRule && /color-scheme:\s*dark/.test(dateRule),
        "нет color-scheme: dark для поля даты");
    // а вот переворот цвета здесь гасит его работу: иконка снова тёмная
    const ind = css.match(/\[data-theme="dark"\][^{]*calendar-picker-indicator\s*\{[^}]*\}/);
    if (ind) ok(!/filter:\s*invert/.test(ind[0]),
        "иконку календаря нельзя переворачивать: color-scheme уже покрасил её: " + ind[0]);
});

t("окно остаётся по центру, а блок идёт под ним", () => {
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const win = css.match(/\.settings-window\s*\{[^}]*\}/);
    ok(win, "нет общей колонки окна и предупреждения");
    // колонка по центру: иначе окно уезжает влево
    ok(/align-items:\s*center/.test(win[0]), "окно должно оставаться по центру: " + win[0]);
    ok(/flex-direction:\s*column/.test(win[0]), "окно и блок должны идти друг под другом: " + win[0]);
    // само окно больше не центрируется самостоятельно — это делает колонка
    const box = css.match(/\.settings-box\s*\{[^}]*\}/);
    ok(box && !/margin:\s*auto/.test(box[0]), "у окна не должно быть своих auto-отступов: " + (box && box[0]));
});

t("выбранная неделя обведена рамкой, а не залита цветом", () => {
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const sel = css.match(/\.ed-week\.selected\s*\{[^}]*\}/);
    ok(sel, "нет стиля выбранной недели");
    ok(/border-color/.test(sel[0]), "выбранная неделя не обведена: " + sel[0]);
    ok(!/background/.test(sel[0]), "выбранная неделя по-прежнему заливается цветом: " + sel[0]);
    const btn = css.match(/\.ed-week\s*\{[^}]*\}/);
    ok(btn && /border:\s*2px solid/.test(btn[0]), "нет заметной рамки у кнопок недели: " + (btn && btn[0]));
});

t("пометка о хранении и дата выгрузки", () => {
    const ed = showDiaryTab(w);
    const note = ed.querySelector("#ed-note-export");
    ok(note, "нет пометки о хранении");
    ok(note.textContent.indexOf("только в этом браузере") !== -1, "текст пометки: " + note.textContent);
    ok(/Выгрузки ещё не было/.test(note.textContent), "до выгрузки: " + note.textContent);
    w.MPTDiary.exportSettings();
    const ed2 = showDiaryTab(w);
    const after = ed2.querySelector("#ed-note-export");
    ok(after, "пометка пропала после выгрузки");
    ok(/Выгружено \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} МСК/.test(after.textContent),
        "дата выгрузки по Москве: " + after.textContent);
});

t("кнопка «Экспорт» скачивает ровно один файл", () => {
    const w2 = boot();
    let files = 0;
    w2.HTMLAnchorElement.prototype.click = function () { if (this.download) files++; };
    // жив��й путь: открыть настройки кнопкой, перейти на вкладку, нажать «Экспорт»
    click(w2, w2.document.getElementById("settings-btn"));
    click(w2, w2.document.querySelector('.settings-tab[data-tab="diary"]'));
    const ed = edPane(w2);
    eq(ed.querySelector("#ed-export").textContent, "Экспорт", "подпись кнопки выгрузки:");
    eq(ed.querySelector("#ed-import").textContent, "Импорт", "подпись кнопки загрузки:");
    click(w2, ed.querySelector("#ed-export"));
    eq(files, 1, "по клику должно качаться ровно один файл, а не " + files);
    // двойной клик не должен давать два файла
    click(w2, edPane(w2).querySelector("#ed-export"));
    eq(files, 1, "двойной клик скачал файлов: " + files);
    // а через пару секунд повторный экспорт снова работает
    const realNow = w2.Date.now;
    w2.Date.now = () => realNow() + 3000;
    click(w2, edPane(w2).querySelector("#ed-export"));
    w2.Date.now = realNow;
    eq(files, 2, "повторный экспорт должен скачать файл:");
    files = 0;
    click(w2, edPane(w2).querySelector("#ed-import"));
    eq(files, 0, "кнопка «Импорт» ничего не качает сама:");
});

t("надпись о расписании с сайта с датой первого снимка", () => {
    w.MPTData.clearManual();
    const ed = idleTab(w);
    const note = ed.querySelector(".ed-note");
    ok(note, "нет врезки о расписании");
    ok(/Дневник берёт расписание с mpt\.ru/.test(note.textContent), "текст: " + note.textContent);
    // дата снимка стоит в тексте после двоеточия, а не отдельной меткой
    ok(note.textContent.indexOf("Снимок с сайта: " + FIRST.split("-").reverse().join(".")) !== -1,
        "даты снимка в тексте нет: " + note.textContent);
    ok(note.textContent.indexOf("только до этого дня") !== -1, "не сказано про границу правки: " + note.textContent);
    ok(note.textContent.indexOf("для всех дат") === -1, "осталось враньё про все даты: " + note.textContent);
    eq(note.querySelector(".ed-note-date"), null, "дата снимка осталась отдельной меткой");
    // подсказки под кнопкой добавления периода больше нет
    const periodSection = ed.querySelector("#ed-add-period").closest(".settings-section");
    eq(periodSection.querySelector(".ed-sub"), null, "под кнопкой добавления периода осталась подпись");
    // дата берётся из снимка расписания и не позже последней загрузки
    const src = w.MPTSchedule;
    ok(src.firstFetchedAt, "в снимке нет firstFetchedAt");
    ok(new Date(src.firstFetchedAt) <= new Date(src.fetchedAt),
        "первая загрузка позже последней: " + src.firstFetchedAt);
});

t("ручная правка не действует с первого снимка и дальше", () => {
    eq(w.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, MANUAL, TEACHER)),
        null, "сохранение периода:");
    [-365, -90, -2].forEach((off) => {
        const d = addDays(firstDayDate, off);
        eq(w.MPTData.scheduleForDate(d)[firstDay][0].subj, MANUAL, "за " + off + " дней: ручная правка:");
        eq(w.MPTData.isStaleDate(d), false, "за " + off + " дней: плашка старой версии:");
    });
    [0, 1, 120, 400].forEach((off) => {
        const d = addDays(firstDayDate, off);
        ok(subjects(w.MPTData.scheduleForDate(d)).indexOf(MANUAL) === -1,
            "за " + off + " дней от снимка ручная правка просочилась");
    });
});

t("надписи режимов переписаны", () => {
    w.MPTData.clearManual();
    const ed = idleTab(w);
    const site = ed.querySelector(".ed-note").textContent;
    ok(site.indexOf("например, если в дневнике ошибка") === -1, "старая надпись про ошибку в дневнике");
    openTab(w);
    const editing = edPane(w).querySelector(".ed-note").textContent;
    ok(/Правим период/.test(editing), "надпись при правке: " + editing);
    ok(editing.indexOf("Пока включён этот режим") === -1, "осталась старая надпись при правке");
    click(w, edPane(w).querySelector("#ed-cancel"));
    w.MPTData.setManualPeriod(null, LIMIT, siteGrid);
    const manual = idleTab(w).querySelector(".ed-note").textContent;
    ok(/Расписание исправлено вручную/.test(manual), "надпись при ручной правке: " + manual);
    ok(/Начиная со снимка с сайта: \d{2}\.\d{2}\.\d{4}/.test(manual),
        "не сказано про границу с сайтом: " + manual);
});

t("сохранение и отмена стоят под рамкой пар справа", () => {
    idleTab(w);
    const pane = openTab(w);
    ok(!pane.querySelector(".settings-section").querySelector("#ed-save"), "кнопки остались в верхней секции");
    const list = pane.querySelector(".ed-list");
    const under = pane.querySelector(".ed-actions.ed-under");
    ok(under, "нет ряда кнопок под рамкой");
    ok(list.compareDocumentPosition(under) & w.Node.DOCUMENT_POSITION_FOLLOWING, "ряд не под рамкой");
    ok(pane.querySelector("#ed-add"), "нет кнопки добавления пары");
    const end = under.querySelector(".ed-actions-end");
    ok(end && end.querySelector("#ed-cancel") && end.querySelector("#ed-save"), "кнопки не справа");
    // на телефоне ряд переносится, но порядок прежний
    const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8");
    const rule = css.match(/\.ed-actions\.ed-under\s*\{[^}]*\}/);
    ok(rule && /margin-top:\s*\d+px/.test(rule[0]), "у ряда кнопок нет отступа сверху: " + (rule && rule[0]));
    ok(/\.ed-actions-end\s*\{[^}]*margin-left:\s*auto/.test(css), "правый блок не прижат к краю");
});

t("правка без изменений не портит сетку", () => {
    idleTab(w);
    const ed = openTab(w);
    saveEd(w, ed);
    eq(w.MPTData.isManual(), true, "ручная версия:");
    eq(w.MPTData.manualPeriods().length, 1, "периодов:");
    eq(w.MPTData.manualPeriods()[0].schedule, siteGrid, "сетка сохранилась целиком");
});

t("сохранение спрашивает подтверждения и отменяется", () => {
    idleTab(w);
    const ed = openTab(w);
    setVal(w, ed.querySelectorAll(".ed-row")[0].querySelector(".ed-subj"), "НЕ СОХРАНЯТЬ");
    click(w, ed.querySelector("#ed-save"));
    const msg = lastMsg(w);
    ok(msg && msg.indexOf("Сохранить изменения?") !== -1, "нет вопроса о сохранении: " + msg);
    ok(msg.indexOf("Период:") !== -1, "не назван период: " + msg);
    ok(msg.indexOf("во всех датах") === -1, "опять сказано про все даты: " + msg);
    refuseOverlay(w);
    ok(subjects(w.MPTData.editableSchedule()).indexOf("НЕ СОХРАНЯТЬ") === -1, "правка всё же применилась");
    ok(edPane(w).querySelector("#ed-save"), "режим правки закрылся, хотя отменили сохранение");
    click(w, edPane(w).querySelector("#ed-cancel"));
});

t("изменение предмета и сохранение меняют дневник", () => {
    idleTab(w);
    const ed = openTab(w);
    const row = ed.querySelectorAll(".ed-row")[0];
    const day = row.querySelector(".ed-day").value;
    const pair = +row.querySelector(".ed-pair").value;
    setVal(w, ed.querySelectorAll(".ed-row")[0].querySelector(".ed-subj"), MANUAL2);
    setVal(w, ed.querySelectorAll(".ed-row")[0].querySelector(".ed-teacher"), TEACHER);
    saveEd(w, ed);
    eq(w.MPTData.isManual(), true, "ручная версия:");
    // правка видна там, где период действует, а не с первого снимка
    const cell = w.MPTData.scheduleForDate(inLimit)[day].filter((r) => r.pair === pair)[0];
    ok(cell, "пара не найдена в сетке");
    eq(cell.subj, MANUAL2, "предмет в сетке:");
    eq(cell.teacher, TEACHER, "преподаватель в сетке:");
    const siteCell = w.MPTData.scheduleForDate(today)[day].filter((r) => r.pair === pair)[0];
    ok(siteCell && siteCell.subj !== MANUAL2, "правка попала в расписание после первого снимка");
});

t("отмена не оставляет правку", () => {
    idleTab(w);
    const ed = openTab(w);
    setVal(w, ed.querySelectorAll(".ed-row")[0].querySelector(".ed-subj"), "НЕ СОХРАНЯТЬ");
    click(w, ed.querySelector("#ed-cancel"));
    const subjectsNow = subjects(w.MPTData.scheduleForDate(inLimit));
    ok(subjectsNow.indexOf("НЕ СОХРАНЯТЬ") === -1, "отменённый предмет попал в расписание");
    eq(edPane(w).querySelector("#ed-save"), null, "режим правки не закрылся");
});

t("пустой предмет пару не создаёт", () => {
    const before = w.MPTData.manualPeriods().length;
    idleTab(w);
    const ed = openTab(w);
    setVal(w, ed.querySelectorAll(".ed-row")[0].querySelector(".ed-subj"), "");
    saveEd(w, ed);
    eq(w.MPTData.manualPeriods().length, before, "периодов:");
    ok(subjects(w.MPTData.manualPeriods()[0].schedule).indexOf("") === -1, "пустой предмет в сетке");
});

t("смена группы в настройках перерисовывает правку", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    idleTab(w);
    openTab(w);
    const wasDiary = w.document.querySelector('#settings-tabs [data-tab="diary"]').classList.contains("selected");
    ok(wasDiary, "после смены группы вкладка осталась активной");
    const otherGrid = w.MPTData.scheduleForDate(today);
    w.MPTData.selectGroup(OTDEL, OTHER);
    ok(subjects(w.MPTData.scheduleForDate(today)).indexOf(MANUAL2) === -1,
        "правка прежней группы не подмешалась");
    ok(subjects(otherGrid).length > 0, "у прежней группы были пары");
    // у чужой группы свои периоды: правки прежней группы не видно в её вкладках
    const ed = idleTab(w);
    eq(ed.querySelectorAll(".ed-tab").length, 1, "вкладок периодов у чужой группы:");
    ok(ed.querySelector("#ed-add-period"), "нет кнопки добавления периода");
});

t("переключение вкладок не теряет несохранённые правки", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    idleTab(w);
    // создаём второй период, чтобы было куда переключиться
    click(w, edPane(w).querySelector("#ed-add-period"));
    setVal(w, edPane(w).querySelector("#ed-from"), "2026-09-01");
    setVal(w, edPane(w).querySelector("#ed-to"), "2026-09-15");
    click(w, edPane(w).querySelector("#ed-create-period"));
    eq(periodTabs(w).length, 2, "вкладок после создания периода:");
    // правим «весь срок» и уходим на вкладку периода, не сохраняя
    openTab(w, 0);
    setVal(w, edPane(w).querySelectorAll(".ed-row")[0].querySelector(".ed-subj"), "ЧЕРНОВИК");
    openTab(w, 1);
    ok(edPane(w).querySelector("#ed-save"), "режим правки закрылся при переключении вкладок");
    eq(edPane(w).querySelectorAll(".ed-row")[0].querySelector(".ed-subj").value !== "ЧЕРНОВИК", true,
        "черновик из другой вкладки подмешался сюда");
    openTab(w, 0);
    eq(edPane(w).querySelectorAll(".ed-row")[0].querySelector(".ed-subj").value, "ЧЕРНОВИК",
        "черновик «всего срока» потерялся");
    click(w, edPane(w).querySelector("#ed-cancel"));
    eq(subjects(w.MPTData.scheduleForDate(inLimit)).indexOf("ЧЕРНОВИК"), -1,
        "отменённый черновик попал в расписание");
});

t("период создаётся по датам и попадает во вкладки", () => {
    const ed = idleTab(w);
    click(w, ed.querySelector("#ed-add-period"));
    let pane = edPane(w);
    eq(pane.querySelector("#ed-from").max, LIMIT, "максимум начала периода:");
    eq(pane.querySelector("#ed-to").max, LIMIT, "максимум конца периода:");
    setVal(w, pane.querySelector("#ed-from"), "2026-09-01");
    setVal(w, pane.querySelector("#ed-to"), "2026-09-15");
    click(w, pane.querySelector("#ed-create-period"));
    pane = edPane(w);
    const tabs = periodTabs(w);
    eq(tabs.length, 2, "вкладок:");
    eq(tabs[1].getAttribute("data-from"), "2026-09-01", "from вкладки:");
    eq(tabs[1].getAttribute("data-to"), "2026-09-15", "to вкладки:");
    // создание не открывает период на правку: сразу исходный вид вкладки
    ok(!pane.querySelector("#ed-rows"), "после создания сразу открылась правка периода");
    ok(!pane.querySelector("#ed-from"), "после создания осталась форма добавления");
    eq(pane.querySelectorAll(".ed-tab.selected").length, 0, "после создания выбрана вкладка:");
    // открываем период сами и правим пары внутри него
    openTab(w, 1);
    pane = edPane(w);
    ok(pane.querySelector("#ed-rows"), "вкладка периода не открылась на правку");
    const row = pane.querySelectorAll(".ed-row")[0];
    const day = row.querySelector(".ed-day").value;
    const pair = +row.querySelector(".ed-pair").value;
    setVal(w, row.querySelector(".ed-subj"), "ПЕРИОДНАЯ");
    saveEd(w, pane);
    const list = w.MPTData.manualPeriods();
    eq(list.length, 2, "периодов:");
    const own = list.filter((p) => p.from === "2026-09-01")[0];
    ok(own, "период 01.09 — 15.09 не сохранился");
    const whole = list.filter((p) => p.from === null)[0];
    ok(subjects(own.schedule).indexOf("ПЕРИОДНАЯ") !== -1, "правка периода не сохранилась");
    ok(subjects(whole.schedule).indexOf("ПЕРИОДНАЯ") === -1, "правка периода попала в «весь срок»");
    // даты периода показывают свою правку, соседние — сетку периода «весь срок»
    const inside = w.MPTData.scheduleForDate(fromFirst("2026-09-10"))[day]
        .filter((r) => r.pair === pair)[0];
    eq(inside && inside.subj, "ПЕРИОДНАЯ", "внутри периода:");
    const outside = w.MPTData.scheduleForDate(fromFirst("2026-09-20"))[day]
        .filter((r) => r.pair === pair)[0];
    eq(outside && outside.subj, whole.schedule[day].filter((r) => r.pair === pair)[0].subj,
        "вне периода:");
});

t("период за последним снимком не создаётся", () => {
    const before = w.MPTData.manualPeriods().length;
    const ed = idleTab(w);
    click(w, ed.querySelector("#ed-add-period"));
    let pane = edPane(w);
    setVal(w, pane.querySelector("#ed-from"), FIRST);
    setVal(w, pane.querySelector("#ed-to"), "2026-12-31");
    click(w, pane.querySelector("#ed-create-period"));
    pane = edPane(w);
    ok(pane.querySelector(".ed-error"), "нет сообщения об ошибке");
    eq(w.MPTData.manualPeriods().length, before, "периодов:");
    click(w, pane.querySelector("#ed-cancel-period"));
});

t("период удаляется отдельной кнопкой", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    const list = w.MPTData.manualPeriods();
    ok(list.length >= 2, "нужен период для удаления");
    const target = list.filter((p) => p.from)[0];
    idleTab(w);
    openTab(w, 1);
    ok(edPane(w).querySelector("#ed-del-period"), "нет кнопки удаления периода");
    click(w, edPane(w).querySelector("#ed-del-period"));
    const msg = tapOverlay(w);
    ok(msg && msg.indexOf("Удалить период") !== -1, "нет вопроса об удалении: " + msg);
    eq(w.MPTData.manualPeriods().length, list.length - 1, "периодов после удаления:");
    eq(periodTabs(w).length, list.length - 1, "вкладок после удаления:");
    // «весь срок» удалять нельзя
    openTab(w, 0);
    eq(edPane(w).querySelector("#ed-del-period"), null, "у «всего срока» есть кнопка удаления");
    click(w, edPane(w).querySelector("#ed-cancel"));
});

t("кнопка возврата к сайту убирает все периоды", () => {
    w.MPTData.selectGroup(OTDEL, GRUPA);
    w.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, MANUAL, TEACHER));
    const ed = idleTab(w);
    ok(ed.querySelector("#ed-drop"), "нет кнопки возврата");
    click(w, ed.querySelector("#ed-drop"));
    const msg = tapOverlay(w);
    ok(msg && msg.indexOf("Вернуть расписание с сайта") !== -1, "нет вопроса о возврате: " + msg);
    eq(w.MPTData.isManual(), false, "ручная версия:");
    eq(w.MPTData.manualPeriods().length, 0, "периодов:");
    eq(w.MPTData.editableSchedule(), siteGrid, "расписание сайта:");
    eq(edPane(w).querySelector("#ed-add-period") !== null, true, "вернулась кнопка добавления периода");
});

// ——————————————————————————————————————————————
// Выгрузка и загрузка настроек целиком
// ——————————————————————————————————————————————

console.log("\n== Выгрузка и загрузка настроек ==");
const SEED_GRADES = {};
SEED_GRADES[iso(thisMonday)] = {};
SEED_GRADES[iso(thisMonday)][firstDay] = {};
SEED_GRADES[iso(thisMonday)][firstDay][firstPair] = ["5"];

const wx = boot({ seed: { [GRADES_KEY]: JSON.stringify(SEED_GRADES) } });
let exported = null;
t("выгрузка кладёт отметки, группу и ручные периоды", () => {
    wx.MPTDiary.applyManual(gridWith(firstDay, firstPair, MANUAL, TEACHER));
    wx.MPTDiary.exportSettings();
    const p = JSON.parse(wx.__json);
    exported = p;
    eq(p.app, "mpt-diary", "приложение:");
    eq(p.kind, "settings", "тип:");
    eq(p.version, 6, "версия формата:");
    eq(p.group, { otdel: OTDEL, grupa: GRUPA }, "группа:");
    ok(["week", "month", "year"].indexOf(p.mode) !== -1, "режим: " + p.mode);
    eq(p.grades[iso(thisMonday)][firstDay][firstPair], ["5"], "отметки в файле:");
    eq(p.schedule.manual, true, "ручное расписание:");
    eq(p.schedule.firstFetchDate, FIRST, "дата первого снимка в файле:");
    eq(p.schedule.periods.length, 1, "периодов в файле:");
    eq(p.schedule.periods[0].from, null, "from периода:");
    eq(p.schedule.periods[0].to, LIMIT, "to периода:");
    eq(p.schedule.periods[0].schedule[firstDay][0].subj, MANUAL, "предмет в файле:");
    // правка действует до снимка, а не после
    eq(wx.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "правка до снимка на месте");
    eq(wx.MPTData.scheduleForDate(today)[firstDay][0].subj, firstOld, "после снимка расписание сайта");
});

t("выгрузка без ручного расписания его не упоминает", () => {
    const w2 = boot({});
    w2.MPTDiary.exportSettings();
    const p = JSON.parse(w2.__json);
    ok(!("schedule" in p), "в файле не должно быть раздела schedule");
    eq(p.group.grupa, GRUPA, "группа всё равно пишется:");
});

t("история расписания переезжает вместе с выгрузкой", () => {
    // Подкладываем в историю «прошлую» версию с другим предметом: дневник
    // добавит к ней нынешнюю, и в прошлом должен показываться старый предмет
    const key = OTDEL + "|" + GRUPA;
    const HISTORY_KEY = "mpt-schedule-history-v1";
    const oldGrid = {};
    for (const d of DAYS) oldGrid[d] = [];
    oldGrid[firstDay] = [{ pair: firstPair, subj: "СТАРЫЙ ПРЕДМЕТ" }];
    const hist = {};
    hist[key] = [{ from: null, schedule: oldGrid }];

    const wa = boot({ seed: { [HISTORY_KEY]: JSON.stringify(hist) } });
    const before = wa.MPTData.versions();
    ok(before.length >= 2, "у группы должно стать больше одной версии: " + before.length);
    const past = addDays(today, -8);
    eq(wa.MPTData.scheduleForDate(past)[firstDay][0].subj, "СТАРЫЙ ПРЕДМЕТ", "в прошлом у себя:");
    wa.MPTDiary.exportSettings();

    // Другая машина: истории нет, после импорта она должна появиться
    const wb = boot({ group: OTHER });
    wb.MPTDiary.importSettings({ __text: wa.__json });
    tapOverlay(wb);
    eq(wb.MPTData.scheduleForDate(past)[firstDay][0].subj, "СТАРЫЙ ПРЕДМЕТ", "в прошлом после импорта:");
    eq(wb.MPTData.versions().length, before.length, "версий после импорта:");
});

t("привязка к группе переживает выгрузку и импорт", () => {
    // Отметка у П-5-25 лежит под ключом группы — выгружаем и импортируем,
    // стоя на другой группе: отметки должны вернуться к своей
    const key = OTDEL + "|" + GRUPA;
    const seed = {};
    seed[key] = {};
    seed[key][iso(thisMonday)] = { [firstDay]: { [firstPair]: ["5"] } };
    const wa = boot({ seed: { [GRADES_KEY]: JSON.stringify(seed) } });
    wa.MPTDiary.exportSettings();

    const wb = boot({ group: OTHER });
    wb.MPTDiary.importSettings({ __text: wa.__json });
    tapOverlay(wb);

    const saved = JSON.parse(wb.localStorage.getItem(GRADES_KEY) || "{}");
    eq(saved[key][iso(thisMonday)][firstDay][firstPair], ["5"], "отметки своей группы:");
    eq(wb.MPTData.grupa, GRUPA, "группа переключилась на ту, что в файле:");
});

t("файл расписания читается обратно без потерь", () => {
    // выгружаем ровно то, что сейчас показывается, и читаем на другом устройстве
    const wx2 = boot({});
    wx2.MPTDiary.applyManual(siteGrid);
    wx2.MPTDiary.exportSettings();
    const w2 = boot({ group: OTHER });
    w2.MPTDiary.importSettings({ __text: wx2.__json });
    tapOverlay(w2);
    eq(w2.MPTData.scheduleForDate(inLimit), siteGrid, "сетка после кругового импорта");
});

t("импорт возвращает группу, отметки и периоды", () => {
    const w2 = boot({ group: OTHER, seed: { [GRADES_KEY]: JSON.stringify({}) } });
    w2.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, "ЧУЖАЯ ПРАВКА"));
    w2.MPTDiary.importSettings({ __text: wx.__json });
    const msg = tapOverlay(w2);
    ok(msg && msg.indexOf("Загрузить") !== -1, "было окно подтверждения: " + msg);
    ok(msg.indexOf("ручное") !== -1, "не сказано про ручные периоды: " + msg);
    eq(w2.MPTData.otdel, OTDEL, "отделение:");
    eq(w2.MPTData.grupa, GRUPA, "группа:");
    eq(w2.MPTData.isManual(), true, "ручная версия:");
    eq(w2.MPTData.manualPeriods().length, 1, "периодов:");
    eq(w2.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "расписание из файла:");
    eq(w2.MPTData.scheduleForDate(today)[firstDay][0].subj, firstOld, "после снимка — сайт:");
    eq(weekMarks(w2, firstPair, dayIdx), "5", "отметка из файла в клетке");
});

t("импорт с отказом ничего не меняет", () => {
    const w3 = boot({ group: OTHER });
    w3.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, "ЧУЖАЯ ПРАВКА"));
    w3.MPTDiary.importSettings({ __text: wx.__json });
    const ov = w3.document.querySelectorAll(".c-overlay");
    const last = ov[ov.length - 1];
    last.querySelector(".c-no").dispatchEvent(new w3.Event("click", { bubbles: true }));
    eq(w3.MPTData.grupa, OTHER, "группа не должна меняться");
    eq(w3.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, "ЧУЖАЯ ПРАВКА", "правка осталась");
});

t("старый файл с ручной версией читается как период", () => {
    const w7 = boot({});
    const legacy = JSON.stringify({
        app: "mpt-diary", kind: "settings", version: 4,
        exportedAt: "2026-01-01T00:00:00.000Z",
        group: { otdel: OTDEL, grupa: GRUPA }, mode: "week", grades: {},
        schedule: { manual: true, grid: gridWith(firstDay, firstPair, "ИЗ СТАРОГО ФАЙЛА") }
    });
    w7.MPTDiary.importSettings({ __text: legacy });
    tapOverlay(w7);
    eq(w7.MPTData.isManual(), true, "ручная версия:");
    eq(w7.MPTData.manualPeriods().length, 1, "периодов:");
    eq(w7.MPTData.manualPeriods()[0].from, null, "from периода:");
    eq(w7.MPTData.manualPeriods()[0].to, w7.MPTData.manualLimitDate(), "to периода:");
    eq(w7.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, "ИЗ СТАРОГО ФАЙЛА", "расписание:");
    eq(w7.MPTData.scheduleForDate(today)[firstDay][0].subj, firstOld, "после снимка — сайт:");
});

t("старый файл с одними отметками тоже читается", () => {
    const w4 = boot({});
    const legacy = JSON.stringify({
        app: "mpt-diary", version: 3, exportedAt: "2026-01-01T00:00:00.000Z",
        grades: { [iso(thisMonday)]: { [firstDay]: { [firstPair]: ["4"] } } }
    });
    w4.MPTDiary.importSettings({ __text: legacy });
    tapOverlay(w4);
    eq(w4.MPTData.grupa, GRUPA, "группа не должна прыгать");
    eq(w4.MPTData.isManual(), false, "ручная версия не появилась из старого файла");
    eq(weekMarks(w4, firstPair, dayIdx), "4", "отметка из старого файла");
});

t("битый файл не ломает данные", () => {
    const w5 = boot({});
    w5.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, MANUAL, TEACHER));
    w5.MPTDiary.importSettings({ __text: "{ это не json" });
    const msg = tapOverlay(w5);
    ok(msg && msg.indexOf("JSON") !== -1, "сообщение: " + msg);
    eq(w5.MPTData.isManual(), true, "данные не тронуты");
    eq(w5.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "расписание не тронуто");
});

t("пустой файл не ломает данные", () => {
    const w6 = boot({});
    w6.MPTDiary.importSettings({ __text: "[]" });
    const msg = tapOverlay(w6);
    ok(msg && msg.indexOf("формат") !== -1, "сообщение: " + msg);
    eq(w6.MPTData.grupa, GRUPA, "группа на месте");
});

// ——————————————————————————————————————————————
// Сохранность данных: запасная копия, вкладки, невыгруженные правки
// ——————————————————————————————————————————————

console.log("\n== Сохранность данных ==");

// Событие storage в другой вкладке: key + новое значение
function storageEvent(w, key, value) {
    const ev = new w.Event("storage");
    ev.key = key;
    ev.newValue = value;
    return ev;
}

t("испорченное хранилище поднимается из запасной копии", () => {
    const wb = boot({});
    wb.MPTData.setManualPeriod(null, LIMIT, gridWith(firstDay, firstPair, MANUAL, TEACHER));
    eq(wb.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "правка сохранена");
    // вторая страница: основной ключ испорчен, запасная копия цела
    const wc = boot({ seed: {
        "mpt-schedule-manual-v1": "{ это не json",
        "mpt-schedule-manual-v1-backup": JSON.stringify({
            [OTDEL + "|" + GRUPA]: [{ from: null, to: LIMIT, schedule: gridWith(firstDay, firstPair, MANUAL, TEACHER) }]
        })
    } });
    const msg = tapOverlay(wc);
    ok(msg && msg.indexOf("запасн") !== -1, "сообщение о копии: " + msg);
    eq(wc.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "расписание из копии:");
    eq(wc.MPTData.manualPeriods().length, 1, "период из копии:");
});

t("правка в одной вкладке видна в другой", () => {
    const empty = JSON.stringify({ [OTDEL + "|" + GRUPA]: [] });
    const we = boot({ seed: { [MANUAL_KEY]: empty } });
    eq(we.MPTData.manualPeriods().length, 0, "до события периодов нет");
    // соседняя вкладка записала период и сообщила об этом событием storage
    const fresh = JSON.stringify({
        [OTDEL + "|" + GRUPA]: [{ from: null, to: LIMIT, schedule: gridWith(firstDay, firstPair, MANUAL, TEACHER) }]
    });
    we.localStorage.setItem(MANUAL_KEY, fresh);
    we.dispatchEvent(storageEvent(we, MANUAL_KEY, fresh));
    eq(we.MPTData.manualPeriods().length, 1, "после события виден период другой вкладки:");
    eq(we.MPTData.scheduleForDate(inLimit)[firstDay][0].subj, MANUAL, "расписание из другой вкладки:");
});

t("отметки из другой вкладки не затираются и показываются", () => {
    const wf = boot({ seed: { [GRADES_KEY]: JSON.stringify(SEED_GRADES) } });
    eq(weekMarks(wf, firstPair, dayIdx), "5", "отметка на месте:");
    // соседняя вкладка переписала отметки — здесь должны появиться её
    const fresh = JSON.stringify({ [iso(thisMonday)]: { [firstDay]: { [firstPair]: ["3"] } } });
    wf.localStorage.setItem(GRADES_KEY, fresh);
    wf.dispatchEvent(storageEvent(wf, GRADES_KEY, fresh));
    eq(weekMarks(wf, firstPair, dayIdx), "3", "отметка из другой вкладки:");
});

t("шестерёнка отмечает невыгруженные изменения", () => {
    const wg = boot({});
    const gear = wg.document.getElementById("settings-btn");
    ok(gear, "нет кнопки настроек");
    // пустой дневник выгружать нечего — точка не нужна
    eq(gear.classList.contains("has-changes"), false, "на пустом дневнике точка не нужна");
    // поставили отметку, а выгрузки не было ни разу — точка обязана появиться
    click(wg, wg.document.querySelector("#diary-table .d-mark-add"));
    click(wg, wg.document.querySelector('.grade-opt[data-grade="5"]'));
    eq(gear.classList.contains("has-changes"), true, "после отметки без выгрузки должна быть точка");
    eq(wg.MPTDiary.hasUnexported(), true, "MPTDiary должен видеть невыгруженное:");
    // отдельный блок под содержимым окна — и в «Оформлении», и в «Дневнике»
const notice = wg.document.getElementById("settings-notice");
    ok(notice, "нет блока предупреждения в окне настроек");
    eq(notice.classList.contains("hidden"), false, "блок должен быть показан:");
    ok(notice.textContent.indexOf("несохранённые изменения") !== -1, "текст блока: " + notice.textContent);
    // блок должен лежать под окном, а не внутри него
    eq(notice.closest(".settings-box"), null, "блок не должен быть внутри окна настроек");
    ok(notice.parentNode.classList.contains("settings-window"), "блок должен быть под окном: " + notice.parentNode.className);
    eq(notice.parentNode.querySelector(".settings-box") !== null, true, "окно должно быть над блоком");
    // клик по блоку не закрывает окно — он теперь снаружи
    const ov2 = wg.document.getElementById("settings-overlay");
    wg.MPTSettings.open();
    click(wg, notice);
    eq(ov2.classList.contains("hidden"), false, "окно не должно закрываться от клика по блоку");
    // клик по свободному месту закрывает: и по самому оверлею, и по колонке
    // вокруг окна, и по полям внутри оверлея
    click(wg, ov2);
    eq(ov2.classList.contains("hidden"), true, "клик по оверлею должен закрыть окно");
    wg.MPTSettings.open();
    click(wg, ov2.querySelector(".settings-window"));
    eq(ov2.classList.contains("hidden"), true, "клик по колонке вокруг окна должен закрыть окно");
    // клик по самому окну не закрывает
    wg.MPTSettings.open();
    click(wg, ov2.querySelector(".settings-box"));
    eq(ov2.classList.contains("hidden"), false, "клик по окну не должен его закрывать");
    // клик по содержимому окна не закрывает
    wg.MPTSettings.open();
    click(wg, ov2.querySelector(".settings-head"));
    eq(ov2.classList.contains("hidden"), false, "клик по заголовку окна не должен его закрывать");
    wg.MPTSettings.open();
    // блок один на всё окно, поэтому виден независимо от вкладки
    showDiaryTab(wg);
    eq(notice.classList.contains("hidden"), false, "во вкладке «Дневник» блок виден:");
    wg.MPTSettings.show("general");
    eq(notice.classList.contains("hidden"), false, "во вкладке «Оформление» блок виден:");
    showDiaryTab(wg);
    // заметка про хранилище осталась на своём месте
    const note2 = showDiaryTab(wg).querySelector("#ed-note-export");
    ok(note2.textContent.indexOf("только в этом браузере") !== -1, "текст в настройках: " + note2.textContent);
    // выгружаем по-настоящему (минуту секунд с прошлой выгрузки)
    const realNow2 = wg.Date.now;
    wg.Date.now = () => realNow2() + 60000;
    wg.MPTDiary.exportSettings();
    wg.Date.now = realNow2;
    eq(gear.classList.contains("has-changes"), false, "точка снята после выгрузки:");
    eq(wg.MPTDiary.hasUnexported(), false, "невыгруженного больше нет:");
    eq(notice.classList.contains("hidden"), true, "после выгрузки блок должен пропасть:");
    // правим расписание — файл снова устарел
    wg.MPTDiary.applyManual(gridWith(firstDay, firstPair, MANUAL, TEACHER));
    eq(gear.classList.contains("has-changes"), true, "после правки расписания должна быть точка");
    // и это переживает перезагрузку страницы
    const wh = boot({ seed: {
        [GRADES_KEY]: wg.localStorage.getItem(GRADES_KEY),
        "mpt-diary-exported-snapshot": wg.localStorage.getItem("mpt-diary-exported-snapshot")
    } });
    eq(wh.document.getElementById("settings-btn").classList.contains("has-changes"), false,
        "после перезагрузки точка остаётся, ведь файл тот же");
});

t("неудачная запись не проходит молча", () => {
    const wj = boot({ seed: { [GRADES_KEY]: JSON.stringify(SEED_GRADES) } });
    // хранилище, которое отказывается писать в отметки
    const real = {};
    for (let i = 0; i < wj.localStorage.length; i++) {
        const k = wj.localStorage.key(i);
        if (k) real[k] = wj.localStorage.getItem(k);
    }
    const fake = {
        getItem: (k) => (k in real ? real[k] : null),
        setItem: (k, v) => {
            if (k === "mpt-diary-grades-v2") throw new Error("QuotaExceededError");
            real[k] = String(v);
        },
        removeItem: (k) => { delete real[k]; },
        clear: () => { for (const k in real) delete real[k]; }
    };
    Object.defineProperty(wj, "localStorage", { configurable: true, value: fake });
    // ставим отметку: именно она пишет отметки в хранилище
    const add = wj.document.querySelector("#diary-table .d-mark-add");
    ok(add, "не нашлось клетки для отметки");
    click(wj, add);
    click(wj, wj.document.querySelector('.grade-opt[data-grade="5"]'));
    const msg = lastMsg(wj);
    ok(msg && msg.indexOf("не смог сохранить отметки") !== -1,
        "должно быть предупреждение, а не тишина: " + msg);
    // повтор той же ошибки не превращается в бесконечные окна
    const ovs = wj.document.querySelectorAll(".c-overlay").length;
    click(wj, wj.document.querySelector("#diary-table .d-mark-add"));
    click(wj, wj.document.querySelector('.grade-opt[data-grade="5"]'));
    eq(wj.document.querySelectorAll(".c-overlay").length, ovs, "повтор не должен снова звать окно");
});

// Настройки закрывались от любого клика внутри вкладки: обработчик нажатой кнопки
// успевал перерисовать вкладку, элемент откреплялся от страницы, и проверка «клик
// мимо окна» ошибалась. Ошибка не видна ни в разметке, ни в стилях — поэтому
// ловим её поведением: жмём то, что жмёт человек, и смотрим, осталось ли окно
t("клик внутри настроек не закрывает их", () => {
    const w = boot();
    const d = w.document;
    const overlay = d.getElementById("settings-overlay");
    ok(overlay, "окна настроек нет");
    const opened = () => !overlay.classList.contains("hidden");
    const click = (el, what) => {
        ok(el, "не нашёлся элемент: " + what);
        el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    };

    click(d.getElementById("settings-btn"), "шестерёнка настроек");
    ok(opened(), "настройки не открылись");

    click([...d.querySelectorAll(".settings-tab")].find((b) => /Дневник/.test(b.textContent)), "вкладка «Дневник»");
    ok(opened(), "клик по вкладке «Дневник» закрыл настройки");

    click(d.getElementById("ed-add-period"), "кнопка «Добавить период»");
    ok(opened(), "кнопка «Добавить период» закрыла настройки");

    click([...d.querySelectorAll("button")].find((b) => /Отмена/.test(b.textContent)), "кнопка «Отмена»");
    ok(opened(), "кнопка «Отмена» закрыла настройки");

    // Вкладки периодов ищем по исключению: это те же .week-btn, что и кнопки
    // действий, но без знакомых id. Так проверка не зависит от подписи периода
    const action = ["ed-add-period", "ed-drop", "ed-del-period", "ed-add", "ed-cancel",
        "ed-save", "ed-create-period", "ed-cancel-period", "ed-export", "ed-import"];
    const weekBtns = [...d.querySelectorAll(".week-btn")];
    const periodTab = weekBtns.find((b) => action.indexOf(b.id) === -1 && b.id)
        || d.querySelector(".settings-pane .week-btn");

    click(periodTab, "вкладка периода");
    ok(opened(), "выбор периода закрыл настройки");

    click(d.getElementById("otdel-select"), "поле выбора отделения");
    ok(opened(), "клик по полю в настройках закрыл их");

    // а клик по пустому месту окна закрывать обязан и дальше
    click(d.querySelector(".settings-window") || overlay, "пустое место окна");
    ok(!opened(), "клик мимо окна больше не закрывает настройки");
});

console.log("\n" + pass + " ok, " + fail + " fail");
process.exit(fail ? 1 : 0);
