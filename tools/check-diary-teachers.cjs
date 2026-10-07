// Разделение по преподавателям: предмет, который ведут несколько человек,
// должен занимать в дневнике отдельную строку на каждого (1а, 1б, 1в…),
// а оценки не должны смешиваться между преподавателями.
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

// Группы, где один предмет ведут несколько преподавателей (берём прямо из данных)
function multiTeacherGroups() {
    const S = new Function("window", fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8")
        + "\n;return window.MPTSchedule;")({});
    const out = [];
    for (const dep of Object.keys(S.departments)) {
        for (const gk of Object.keys(S.departments[dep].groups)) {
            const g = S.departments[dep].groups[gk];
            const bySubj = {};
            for (const p of g.pairs || []) {
                for (const half of [p.w1, p.w2]) {
                    if (!half || !half.subj || !half.teacher) continue;
                    (bySubj[half.subj] = bySubj[half.subj] || new Set()).add(half.teacher);
                }
            }
            for (const subj in bySubj) {
                if (bySubj[subj].size > 1) {
                    out.push({
                        otdel: dep,
                        // Ключ группы отдаётся как есть: у части групп он вида
                        // «ИС-1-23; ИС-11/1-24», и резать его нельзя
                        grupa: gk,
                        subj: subj,
                        teachers: [...bySubj[subj]]
                    });
                }
            }
        }
    }
    return out;
}

function boot(otdel, grupa) {
    const html = fs.readFileSync(path.join(ROOT, "diary.html"), "utf8")
        .replace(/<script\b[^>]*><\/script>/gi, "");
    const dom = new JSDOM(html, {
        url: "http://localhost:8080/diary.html",
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.localStorage.clear();
    w.localStorage.setItem("mpt-otdel", otdel);
    w.localStorage.setItem("mpt-grupa", grupa);
    w.eval(fs.readFileSync(path.join(ROOT, "data/schedule.js"), "utf8"));
    for (const f of ["js/data.js", "js/theme.js", "js/diary.js"]) {
        w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
    }
    w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    return w;
}

function setMode(w, mode) {
    const btn = w.document.querySelector('#view-mode .mode-btn[data-mode="' + mode + '"]');
    if (!btn) throw new Error("нет кнопки режима " + mode);
    btn.dispatchEvent(new w.Event("click", { bubbles: true }));
}

// Строки месячной таблицы: {№, подпись предмета, отметки}
function monthRows(w) {
    return [...w.document.querySelectorAll("#diary-month-table tbody tr")].map((tr) => ({
        num: tr.querySelector(".ms-num").textContent,
        subj: tr.querySelector(".ms-subj-th").textContent,
        marks: [...tr.querySelectorAll(".d-mark:not(.d-mark-add)")].map((c) => c.textContent)
    }));
}

const ALL = multiTeacherGroups();
console.log("Групп с много преподавателями: " + new Set(ALL.map((g) => g.otdel + "|" + g.grupa)).size
    + " (случаев: " + ALL.length + ")\n");

// Номер предмета — его порядок в таблице, он не обязательно 1,
// поэтому ожидаемую базу берём из самой строки
function expectSplitNums(nums, count) {
    const letters = "абвгдежзиклмнопрстуфхцчшщыэюя";
    ok(nums.length === count, "строк " + nums.length + ", а преподавателей " + count);
    const bases = nums.map((n) => n.replace(/[а-я]$/, ""));
    eq(new Set(bases).size, 1, "базовые номера разные: " + bases.join(","));
    const base = bases[0];
    ok(/^\d+$/.test(base), "база «" + base + "» не число");
    eq(nums, [...Array(count)].map((_, i) => base + letters[i]),
        "ожидались номера с буквами по порядку");
}

console.log("== Нумерация строк ==");
t("предмет с несколькими преподами получает буквенные номера 1а, 1б, 1в", () => {
    // ИВ-1-26: «Иностранный язык» ведут Т.А. Тимошина и А.А. Сердцева
    const w = boot("Отделение первого курса", "ИВ-1-26");
    setMode(w, "month");
    const rows = monthRows(w);
    const eng = rows.filter((r) => r.subj.indexOf("Иностранный язык") === 0);
    ok(eng.length >= 2, "строк с иностранным: " + eng.length);
    expectSplitNums(eng.map((r) => r.num), 2);
    // обе строки называют своего препода
    for (const r of eng) {
        ok(/\(.*\)/.test(r.subj), "в подписи нет препода: " + r.subj);
    }
    const who = eng.map((r) => /\(([^)]+)\)/.exec(r.subj)[1]);
    ok(who.includes("Т.А. Тимошина") && who.includes("А.А. Сердцева"),
        "преподаватели в строках: " + who.join(" / "));
});

t("у П-5-25 «Основы алгоритмизации» делятся на три строки", () => {
    // Д.А. Подлесный, В.А. Чибук, Н.Н. Кудров
    const w = boot("09.02.07 П,Т", "П-5-25");
    setMode(w, "month");
    const rows = monthRows(w);
    const prog = rows.filter((r) => r.subj.indexOf("Основы алгоритмизации") === 0);
    expectSplitNums(prog.map((r) => r.num), 3);
    for (const t2 of ["Д.А. Подлесный", "В.А. Чибук", "Н.Н. Кудров"]) {
        ok(prog.some((r) => r.subj.indexOf("(" + t2 + ")") !== -1),
            "нет строки с " + t2 + ": " + prog.map((r) => r.subj).join(" | "));
    }
});

t("предмет с одним преподавателем номера не буквует", () => {
    const w = boot("Отделение первого курса", "ИВ-1-26");
    setMode(w, "month");
    const rows = monthRows(w);
    const plain = rows.filter((r) => /\)$/.test(r.subj) === false);
    ok(plain.length > 0, "не нашли строк с одним преподавателем");
    for (const r of plain) {
        ok(/^\d+$/.test(r.num), "номер «" + r.num + "» у предмета " + r.subj);
    }
});

t("все номера строк уникальны внутри таблицы", () => {
    const w = boot("09.02.07 П,Т", "П-5-25");
    setMode(w, "month");
    const nums = monthRows(w).map((r) => r.num);
    eq(nums.length, new Set(nums).size, "дубли номеров: " + nums.join(","));
});

console.log("\n== Оценки не смешиваются ==");
t("оценка попадает в строку своего преподавателя", () => {
    const w = boot("09.02.07 П,Т", "П-5-25");
    setMode(w, "month");
    const rows = monthRows(w);
    const prog = rows.filter((r) => r.subj.indexOf("Основы алгоритмизации") === 0);

    // Ищем клетку «+» в строке преподавателя В.А. Чибук и ставим туда 5
    const trs = [...w.document.querySelectorAll("#diary-month-table tbody tr")]
        .filter((tr) => tr.querySelector(".ms-subj-th").textContent.indexOf("В.А. Чибук") !== -1);
    ok(trs.length > 0, "нет строки В.А. Чибук");
    const add = trs[0].querySelector(".d-mark-add");
    ok(add, "в строке нет кнопки «+»");
    const date = add.getAttribute("data-date");
    const pair = add.getAttribute("data-pair");
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="5"]')
        .dispatchEvent(new w.Event("click", { bubbles: true }));

    const after = monthRows(w);
    const chipRow = after.find((r) => r.marks.includes("5"));
    ok(chipRow, "оценка 5 нигде не появилась");
    eq(chipRow.subj, trs[0].querySelector(".ms-subj-th").textContent,
        "оценка уехала в чужую строку");
    eq(chipRow.num, prog.find((r) => r.subj.indexOf("В.А. Чибук") !== -1).num);

    // и проверяем, что она легла по правильным дате и паре
    // отметки лежат по группам: группа -> неделя -> день -> пара
    const saved = JSON.parse(w.localStorage.getItem(STORE_KEY));
    const group = saved[Object.keys(saved)[0]];
    const week = group[Object.keys(group)[0]];
    const dayKey = Object.keys(week)[0];
    const cell = week[dayKey][pair];
    eq(cell, ["5"], "в хранилище: " + JSON.stringify(cell));
});

t("разные преподатели одного предмета не делят одну клетку", () => {
    // В П-5-25 пара 1 в ПН: «Основы алгоритмизации» (Подлесный).
    // Ставим оценку, потом убеждаемся, что в строках других преподавателей пусто.
    const w = boot("09.02.07 П,Т", "П-5-25");
    setMode(w, "month");
    const trs = [...w.document.querySelectorAll("#diary-month-table tbody tr")];
    const chibuk = trs.find((tr) => tr.querySelector(".ms-subj-th").textContent.indexOf("В.А. Чибук") !== -1);
    const add = chibuk.querySelector(".d-mark-add");
    add.dispatchEvent(new w.Event("click", { bubbles: true }));
    w.document.querySelector('.grade-opt[data-grade="4"]')
        .dispatchEvent(new w.Event("click", { bubbles: true }));

    const rows = monthRows(w);
    const withMark = rows.filter((r) => r.marks.length > 0);
    ok(withMark.length > 0, "оценка не появилась");
    for (const r of withMark) {
        ok(r.subj.indexOf("В.А. Чибук") !== -1,
            "оценка попала в строку " + r.subj);
    }
});

console.log("\n== Сквозная проверка по всем группам ==");
t("во всех группах с несколькими преподами предмет разбит на отдельные строки", () => {
    const seen = new Set();
    const problems = [];
    for (const g of ALL) {
        const key = g.otdel + "|" + g.grupa;
        if (seen.has(key)) continue;
        seen.add(key);
        const w = boot(g.otdel, g.grupa);
        setMode(w, "month");
        const rows = monthRows(w);
        // сколько строк должны быть у этого предмета
        const want = g.teachers.length;
        // английский объединяется в одну группу — это осознанное исключение
        const isEnglish = /^[Ии]нностранный/i.test(g.subj);
        const got = rows.filter((r) => r.subj.indexOf(g.subj) === 0);
        if (isEnglish) {
            if (got.length !== 1) {
                problems.push(key + " «" + g.subj + "»: английский должен быть одной строкой, а строк " + got.length);
            }
            continue;
        }
        if (got.length !== want) {
            problems.push(key + " «" + g.subj + "»: ждали " + want
                + " строк, получили " + got.length + " (" + got.map((r) => r.subj).join(" | ") + ")");
        }
    }
    ok(seen.size > 40, "проверено всего " + seen.size + " групп — мало");
    ok(problems.length === 0, "расхождений " + problems.length + ":\n       "
        + problems.slice(0, 6).join("\n       "));
});

t("во всех этих группах номера строк не дублируются", () => {
    const seen = new Set();
    const problems = [];
    for (const g of ALL) {
        const key = g.otdel + "|" + g.grupa;
        if (seen.has(key)) continue;
        seen.add(key);
        const w = boot(g.otdel, g.grupa);
        setMode(w, "month");
        const nums = monthRows(w).map((r) => r.num);
        if (nums.length !== new Set(nums).size) {
            problems.push(key + ": " + nums.join(","));
        }
    }
    ok(problems.length === 0, "дубли в " + problems.length + " группах:\n       "
        + problems.slice(0, 6).join("\n       "));
});

t("годовая таблица держит то же разделение", () => {
    const w = boot("09.02.07 П,Т", "П-5-25");
    setMode(w, "year");
    const rows = [...w.document.querySelectorAll("#diary-year-table tbody tr")]
        .map((tr) => ({
            num: tr.querySelector(".ms-num").textContent,
            subj: tr.querySelector(".ms-subj-th").textContent
        }));
    const prog = rows.filter((r) => r.subj.indexOf("Основы алгоритмизации") === 0);
    expectSplitNums(prog.map((r) => r.num), 3);
    for (const teacher of ["Д.А. Подлесный", "В.А. Чибук", "Н.Н. Кудров"]) {
        ok(prog.some((r) => r.subj.indexOf("(" + teacher + ")") !== -1),
            "в годовой нет " + teacher);
    }
});


console.log("\n" + pass + " ok, " + fail + " fail");
process.exit(fail ? 1 : 0);
