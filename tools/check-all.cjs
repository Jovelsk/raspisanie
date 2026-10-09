// Гоняет все проверки подряд и печатает общий итог.
// Нужен jsdom: npm install
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Проверки работают на настоящем расписании, а в репозитории его нет: снимки
// с сайта у каждого свои — страница делает их сама при первом открытии.
// Без файла проверки падали бы непонятно, поэтому говорим сразу, что делать.
if (!fs.existsSync(path.join(__dirname, "..", "data", "schedule.js"))) {
    console.log("нет data/schedule.js — проверкам нужно расписание.");
    console.log("Получите его один раз: npm run fetch-schedule && npm run fetch-replacements");
    process.exit(1);
}

const CHECKS = [
    "check-data.cjs",
    "check-snapshots.cjs",
    "check-live.cjs",
    "check-render.cjs",
    "check-diary-marks.cjs",
    "check-diary-teachers.cjs",
    "check-diary-history.cjs",
    "check-diary-settings.cjs",
    "check-replacements.cjs",
    "check-popup.cjs"
];

let ok = 0;
let bad = 0;

for (const name of CHECKS) {
    const res = spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: "utf8" });
    const out = (res.stdout || "") + (res.stderr || "");
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    // Итог ищем по образцу «N ok, M fail»: последней строкой может оказаться
    // предупреждение из stderr, и тогда по ней итог не прочитать.
    const summary = lines.slice().reverse().find((l) => /\d+\s+ok,\s*\d+\s+fail/.test(l));
    const tail = summary || lines.pop() || "нет вывода";
    const failed = !/\b0 fail/.test(tail);
    const m = tail.match(/(\d+)\s+ok,\s*(\d+)\s+fail/);
    if (m) {
        ok += +m[1];
        bad += +m[2];
    }
    console.log((failed ? "FAIL " : "ok   ") + name + " — " + tail);
}

console.log("\nитого: " + ok + " ok, " + bad + " fail");
process.exit(bad ? 1 : 0);