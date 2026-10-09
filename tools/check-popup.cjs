// Окошко расширения в jsdom: грузим настоящий popup.html со всеми его скриптами
// и смотрим, что получилось. Данные подкладываем из data/schedule.js — тот же
// приём, что и в остальных проверках.
// Запуск: node tools/check-popup.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Без снимка расписания проверять нечего: окошко без данных показывает
// «Группа не выбрана», и все утверждения ниже потеряли бы смысл
if (!fs.existsSync(path.join(root, "data", "schedule.js"))) {
    console.log("нет data/schedule.js — проверкам нужно расписание.");
    console.log("Получите его один раз: npm run fetch-schedule && npm run fetch-replacements");
    process.exit(1);
}

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
const assert = require("assert");
const eq = (a, b, what) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), what || "");

const model = JSON.parse(/window\.MPTSchedule = ([\s\S]*?);\s*$/.exec(read("data/schedule.js"))[1]);

// Свежий снимок замен на сегодня: берём настоящий файл, если он есть, и в любом
// случае добавляем в него запись для нашей группы — иначе проверять нечего
function replacementsFor(dep, grp) {
    let saved = null;
    try {
        saved = JSON.parse(/window\.MPTReplacements = ([\s\S]*?);\s*$/.exec(read("data/replacements.js"))[1]);
    } catch (e) { saved = null; }
    const snap = saved && saved.days ? saved : { days: [] };
    const d = new Date();
    const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    let day = snap.days.find((x) => x.date === iso);
    if (!day) {
        day = { date: iso, dateText: "сегодня", weekday: "Сегодня", today: true, groups: [] };
        snap.days.push(day);
    }
    day.groups.push({
        groups: [grp],
        rows: [
            { pair: 2, from: "Основы алгоритмизации и программирования Н.Н. Кудров", to: "Математика И.И. Иванов", addedAt: "09.10.2026 08:00:00" },
            { pair: 3, from: "История", to: "Занятие отменено с последующей отработкой" }
        ]
    });
    return snap;
}

// Открывает окошко так же, как его открывает браузер: скрипты берём прямо из
// popup.html, чтобы проверка не разошлась с настоящим порядком подключения
function openPopup(seed, repl, noData) {
    const raw = read("popup.html");
    const scripts = [...raw.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const html = raw.replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, { url: "http://localhost:8080/popup.html", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    w.localStorage.clear();
    for (const k of Object.keys(seed || {})) w.localStorage.setItem(k, seed[k]);
    if (repl) w.MPTReplacements = repl;
    for (const s of scripts) w.eval(read(s));
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    // jsdom не ходит в сеть, поэтому снимок «приносим» сами — ровно то, что
    // делает js/live.js, когда получает ответ от mpt.ru
    if (!noData) w.MPTData.adoptSnapshot(model);
    return w;
}

const dep = model.departmentOrder[0];
const grp = Object.keys(model.departments[dep].groups)[0];
const CHOSEN = { "mpt-otdel": dep, "mpt-grupa": grp };
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

// Отметки ставим через сам интерфейс: так карточка перерисовывается и значки
// появляются в ней ровно как у человека
function setMarksViaUI(w, values) {
    for (const val of values) {
        const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
        row.querySelector(".mk-plus").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        const btn = [...row.querySelectorAll(".mk-pick .mk-btn")].find((b) => b.textContent === val);
        btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    }
}

console.log("\n== Окошко: заголовок и карточка дня ==");

t("в заголовке — выбранная группа, а не первая из расписания", () => {
    const w = openPopup(CHOSEN);
    eq(text(w.document.getElementById("popup-title")), dep + " · " + grp);
});

t("карточка дня нарисована тем же кодом, что и сайт", () => {
    const w = openPopup(CHOSEN);
    const cards = w.document.querySelectorAll(".popup-day-grid .day-card");
    eq(cards.length, 1, "карточек дней");
    // как на сайте: всегда пять строк, чтобы карточка была ровной
    eq(w.document.querySelectorAll(".popup-day-grid .day-row").length, 5, "строк пар");
});

t("пока данных нет, честно сказано, что группа не выбрана", () => {
    // Без снимка окошко не должно выдумывать группу: оно говорит как есть
    const w = openPopup({}, null, true);
    eq(text(w.document.getElementById("popup-title")), "Группа не выбрана");
    assert.ok(text(w.document.getElementById("popup-list")).indexOf("Загружаем данные") !== -1,
        "нет сообщения о загрузке: " + text(w.document.getElementById("popup-list")));
});

t("когда данных нет, но группа выбрана раньше — показывается она", () => {
    const w = openPopup(CHOSEN, null, false);
    eq(text(w.document.getElementById("popup-title")), dep + " · " + grp);
});

console.log("\n== Окошко: отметки ==");

t("кнопки отметок есть только у пар с предметом", () => {
    const w = openPopup(CHOSEN);
    const rows = [...w.document.querySelectorAll(".popup-day-grid .day-row")];
    const withSubj = rows.filter((r) => r.querySelector(".subj")).length;
    eq(w.document.querySelectorAll(".popup-day-grid .mk").length, withSubj, "строк с кнопками");
});

t("нажатие ставит отметку, повторное — снимает", () => {
    const w = openPopup(CHOSEN);
    const today = new Date();
    const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
    eq(w.MPTDiary.marksFor(today, 1), [], "до нажатия");
    // как на сайте: сначала плюсик, потом значение из раскрывшегося выбора
    assert.ok(!row.querySelector(".mk.mk-open"), "выбор отметки раскрыт без нажатия");
    row.querySelector(".mk-plus").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert.ok(row.querySelector(".mk.mk-open"), "выбор отметки не раскрылся по плюсику");
    row.querySelector(".mk-pick .mk-btn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(w.MPTDiary.marksFor(today, 1), ["5"], "после нажатия");

    const again = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
    assert.ok(again.querySelector(".mk-chip"), "значка отметки в карточке нет");
    again.querySelector(".mk-plus").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    again.querySelector(".mk-pick .mk-btn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(w.MPTDiary.marksFor(today, 1), [], "после повторного нажатия");
});

t("крестик в выборе закрывает выбор, а не снимает отметки", () => {
    const w = openPopup(CHOSEN);
    const today = new Date();
    setMarksViaUI(w, ["4"]);
    const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
    row.querySelector(".mk-plus").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert.ok(row.querySelector(".mk.mk-open"), "выбор не раскрылся");
    row.querySelector(".mk-close").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert.ok(!row.querySelector(".mk.mk-open"), "выбор не закрылся");
    eq(w.MPTDiary.marksFor(today, 1), ["4"], "отметка не должна пропасть");
});

t("нажатие на оценку открывает выбор, а снять её можно в нём", () => {
    const w = openPopup(CHOSEN);
    const today = new Date();
    setMarksViaUI(w, ["4", "5"]);
    const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
    eq(row.querySelectorAll(".mk-chip").length, 2, "значков отметок");
    eq(row.querySelectorAll(".mk-off").length, 0, "внутри оценки не должно быть крестика");
    // нажимаем на саму оценку — должен раскрыться тот же выбор
    row.querySelector(".mk-chip").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert.ok(row.querySelector(".mk.mk-open"), "выбор не раскрылся по нажатию на оценку");
    // и в нём снимаем именно её: нажимаем то же значение
    const btn = [...row.querySelectorAll(".mk-pick .mk-btn")].find((b) => b.textContent === "4");
    btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(w.MPTDiary.marksFor(today, 1), ["5"], "после снятия одной отметки");
});

t("цвета отметок берутся с сайта", () => {
    const w = openPopup(CHOSEN);
    setMarksViaUI(w, ["5", "н"]);
    const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
    const classes = [...row.querySelectorAll(".mk-chip")].map((c) => c.className);
    assert.ok(classes.some((c) => c.indexOf("g5") !== -1), "нет класса g5: " + classes.join(" / "));
    assert.ok(classes.some((c) => c.indexOf("gn") !== -1), "нет класса gn для «н»: " + classes.join(" / "));
    assert.ok(row.querySelector(".mk-plus.d-mark.d-mark-add"), "плюсик не оформлен как на сайте");
});

t("отметка ложится к своей группе и пустой записи «|» не оставляет", () => {
    const w = openPopup(CHOSEN);
    w.MPTDiary.addOneMark(new Date(), 1, "4");
    const store = JSON.parse(w.localStorage.getItem("mpt-diary-grades-v2") || "{}");
    assert.ok(store[dep + "|" + grp], "нет записи нашей группы");
    assert.ok(!store["|"], "появилась пустая запись группы «|»");
});

console.log("\n== Окошко: замены ==");

t("служебный маркер на месте — по нему живое обновление знает, что нужны замены", () => {
    const w = openPopup(CHOSEN);
    assert.ok(w.document.getElementById("replacements-list"), "маркера replacements-list нет");
});

t("замены группы показываются, чужие — нет", () => {
    const w = openPopup(CHOSEN, replacementsFor(dep, grp));
    const box = w.document.getElementById("popup-replacements");
    // В заголовке — дата, а не слово «сегодня»: так он останется верным и когда
    // появится перемотка на вчера и завтра
    const head = text(box.querySelector(".popup-rep-head"));
    assert.ok(/^Замены на \d+ \S+$/.test(head), "в заголовке должна быть дата: " + head);
    eq(box.querySelectorAll(".rep-row").length, 2, "строк замен");
    assert.ok(box.querySelector(".rep-cancel"), "отмена не помечена отдельно");
});

t("когда замен у группы нет, блок пустой", () => {
    const other = openPopup(CHOSEN, { days: [{ date: "2000-01-01", groups: [{ groups: [grp], rows: [{ pair: 1, from: "a", to: "b" }] }] }] });
    eq(text(other.document.getElementById("popup-replacements")), "", "содержимое блока");
});

console.log("\n== Окошко: оформление и настройки ==");

t("тема из общих настроек применяется", () => {
    const w = openPopup(Object.assign({ "mpt-theme": "dark" }, CHOSEN));
    eq(w.document.documentElement.getAttribute("data-theme"), "dark");
});

t("шестерёнка и окно настроек построены", () => {
    const w = openPopup(CHOSEN);
    assert.ok(w.document.getElementById("settings-btn"), "нет шестерёнки");
    assert.ok(w.document.getElementById("settings-overlay"), "нет окна настроек");
});

t("поля выбора группы и фона есть в настройках", () => {
    const w = openPopup(CHOSEN);
    assert.ok(w.document.getElementById("otdel-select"), "нет выбора отделения");
    assert.ok(w.document.getElementById("grupa-select"), "нет выбора группы");
    assert.ok(w.document.getElementById("bg-path"), "нет поля фона");
    const placeholder = w.document.getElementById("bg-path").getAttribute("placeholder");
    assert.ok(/папк[уи] проекта/.test(placeholder || ""), "в поле не сказано, куда класть картинку: " + placeholder);
});

t("отметки стоят в окне с занятием, а не в «нет пары»", () => {
    const w = openPopup(CHOSEN);
    const boxes = [...w.document.querySelectorAll(".popup-day-grid .mk")];
    assert.ok(boxes.length > 0, "ни одной строки с отметками");
    for (const box of boxes) {
        const cell = box.closest(".wcell");
        assert.ok(cell, "отметки не в окне недели");
        assert.ok(cell.querySelector(".subj"), "отметки попали в окно без занятия: " + cell.textContent.trim());
        assert.ok(!cell.classList.contains("wcell-absent") && !cell.classList.contains("wcell-empty"),
            "отметки попали в «нет пары»");
    }
});

console.log("\n== Окошко: перемотка дня ==");

t("стрелки показывают вчера и завтра, но не дальше", () => {
    const w = openPopup(CHOSEN);
    const prev = w.document.getElementById("popup-prev");
    const next = w.document.getElementById("popup-next");
    assert.ok(prev && next, "нет стрелок перемотки");
    const here = text(w.document.getElementById("popup-sub"));
    assert.ok(!prev.disabled && !next.disabled, "в середине обе стрелки должны работать");

    next.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const tomorrow = text(w.document.getElementById("popup-sub"));
    assert.notStrictEqual(tomorrow, here, "дата не сменилась на завтра");
    assert.ok(next.disabled, "на завтра стрелка должна замолкать");
    // нажатие по замолчавшей стрелке ничего не меняет
    next.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(text(w.document.getElementById("popup-sub")), tomorrow, "дальше завтра уходить нельзя");

    prev.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(text(w.document.getElementById("popup-sub")), here, "назад к сегодняшнему дню");
    prev.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const yesterday = text(w.document.getElementById("popup-sub"));
    assert.notStrictEqual(yesterday, here, "дата не сменилась на вчера");
    assert.ok(prev.disabled, "на вчера стрелка должна замолкать");
    prev.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    eq(text(w.document.getElementById("popup-sub")), yesterday, "дальше вчера уходить нельзя");
});

t("перемотка не сбрасывает данные и отметки", () => {
    const w = openPopup(CHOSEN);
    w.document.getElementById("popup-next").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert.ok(text(w.document.getElementById("popup-title")).indexOf(grp) !== -1, "потерялась группа");
    const grid = w.document.querySelector(".popup-day-grid .day-card");
    assert.ok(grid, "карточка дня пропала при перемотке");
});

t("отметка на показанный день ложится в этот день", () => {
    const w = openPopup(CHOSEN);
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Ищем соседний день, в который у группы есть пары: в выходной ставить нечего
    let shown = null;
    for (const step of [1, -1]) {
        const arrow = w.document.getElementById(step === 1 ? "popup-next" : "popup-prev");
        const back = w.document.getElementById(step === 1 ? "popup-prev" : "popup-next");
        arrow.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        const row = [...w.document.querySelectorAll(".popup-day-grid .day-row")].find((r) => r.querySelector(".subj"));
        if (row) {
            shown = new Date(base.getFullYear(), base.getMonth(), base.getDate() + step);
            break;
        }
        back.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    }
    if (!shown) return; // ни вчера, ни завтра пар нет — проверять нечего
    setMarksViaUI(w, ["5"]);
    eq(w.MPTDiary.marksFor(shown, 1), ["5"], "отметка показанного дня");
    eq(w.MPTDiary.marksFor(base, 1), [], "сегодняшний день не тронут");
});

console.log("\n" + ok + " ok, " + fail + " fail");
process.exit(fail ? 1 : 0);
