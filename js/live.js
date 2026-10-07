// Живое обновление данных с mpt.ru прямо со страницы.
//
// Раньше данные обновлял только Node-скрипт по задаче в Планировщике, поэтому
// скачанная копия застывала на дате скачивания. Теперь страница сама проверяет
// замены раз в 30 минут и расписание раз в 12 часов — те же сроки, что у задачи.
//
// Три правила, ради которых всё устроено именно так:
//
//   1. Показываем сразу то, что уже есть (вшитый снимок или прошлую загрузку).
//      Пустого экрана и ожидания сети не бывает: сеть догоняет картинку.
//
//   2. Свежие данные принимаем только после проверки. Если сайт сменил вёрстку
//      и разбор вышел пустым, остаётся то, что было: пустая вкладка хуже старой.
//
//   3. Границу ручных правок (firstFetchedAt) не двигаем вперёд никогда.
//      Дневник считает от неё, до какой даты расписание можно править руками,
//      и сдвиг вперёд молча отключил бы уже сделанные правки.
(function (root) {
    "use strict";

    var KEYS = { schedule: "mpt-live-schedule-v1", replacements: "mpt-live-replacements-v1" };
    // Глобальные переменные, в которых страницы и Node-снимок держат данные
    var GLOBALS = { schedule: "MPTSchedule", replacements: "MPTReplacements" };

    // Замены правят в течение дня, расписание меняется редко
    var EVERY = {
        replacements: 30 * 60 * 1000,
        schedule: 12 * 60 * 60 * 1000,
    };
    var TICK = 60 * 1000;                 // как часто проверяем, не пора ли обновиться
    var RETRY_AFTER_ERROR = 5 * 60 * 1000; // после неудачи не долбим сайт сразу
    // Пока показывать нечего, после неудачи пробуем быстрее: ждать пять минут
    // с надписью «загружаем» на первом открытии — плохо.
    var RETRY_WHEN_EMPTY = 60 * 1000;
    // Расписание весит около 2,8 МБ. По-настоящему короткий ответ — это не
    // «сайт поменял вёрстку», а обрыв: сайт изредка отдаёт страницу не целиком.
    var MIN_SCHEDULE_RESPONSE = 300 * 1024;

    var API = "https://mpt.ru/wp-json/wp/v2/pages?slug=";
    var SLUG = { schedule: "raspisanie", replacements: "izmeneniya-v-raspisanii" };

    var where = { schedule: "bundled", replacements: "bundled" };
    // Был ли у человека к открытию свой снимок. Если нет, первое открытие
    // обязано сходить на сайт, не дожидаясь сроков: тогда у каждого свой
    // первый снимок, а не приложенный к проекту чужой.
    var hadOwnSnapshot = { schedule: false, replacements: false };
    var lastTry = { schedule: 0, replacements: 0 };
    var lastError = { schedule: null, replacements: null };
    var timer = null;

    function parser() { return root.MPTParse || null; }
    function data() { return root.MPTData || null; }

    // Замены нужны только там, где для них есть место на странице: на
    // «Расписании» и в «Дневнике» этот файл даже не подключается.
    function usesReplacements() {
        return !!(root.document && root.document.getElementById("replacements-list"));
    }

    function store() {
        try { return root.localStorage || null; } catch (e) { return null; }
    }

    function readSaved(kind) {
        var ls = store();
        if (!ls) return null;
        try {
            var raw = ls.getItem(KEYS[kind]);
            if (!raw) return null;
            var model = JSON.parse(raw);
            return model && typeof model === "object" ? model : null;
        } catch (e) { return null; }
    }

    function save(kind, model) {
        var ls = store();
        if (!ls) return false;
        try { ls.setItem(KEYS[kind], JSON.stringify(model)); return true; }
        catch (e) { return false; }   // не влезло — не беда: останется вшитый снимок
    }

    // Отметка съёмки в миллисекундах; 0 — если её нет или она непонятная
    function fetchedMs(model) {
        var t = model && model.fetchedAt ? Date.parse(model.fetchedAt) : NaN;
        return isNaN(t) ? 0 : t;
    }

    // Из двух снимков берём тот, что снят позже
    function newerOf(a, b) {
        if (!a) return b || null;
        if (!b) return a;
        return fetchedMs(b) > fetchedMs(a) ? b : a;
    }

    // При загрузке страницы подставляем прошлую удачную загрузку, если она
    // свежее вшитого снимка: страница успевает отрисоваться по ней, не ожидая
    // сети. Данные при этом проходят обычный путь через js/data.js.
    function upgradeGlobals() {
        var kinds = usesReplacements() ? ["schedule", "replacements"] : ["schedule"];
        for (var i = 0; i < kinds.length; i++) {
            var kind = kinds[i];
            var bundled = root[GLOBALS[kind]] || null;
            var saved = readSaved(kind);
            hadOwnSnapshot[kind] = !!saved;
            var pick = newerOf(bundled, saved);
            if (!pick) continue;
            if (pick !== bundled) {
                root[GLOBALS[kind]] = pick;
                where[kind] = "saved";
            }
        }
    }

    // WordPress отдаёт данные не с начала ответа: Elementor подмешивает перед
    // JSON блок <style>, а после данных идёт хвост страницы. Начало ищем по
    // «[{"id"», а конец — считая скобки вручную. Так разбор не зависит ни от
    // переносов строк, ни от того, что ещё сайт приклеит к ответу.
    function extractContent(text) {
        var start = text.indexOf('[{"id"');
        if (start === -1) return null;

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var i = start; i < text.length; i++) {
            var ch = text.charAt(i);
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === "[") { depth++; continue; }
            if (ch !== "]") continue;
            depth--;
            if (depth !== 0) continue;

            var parsed = null;
            try { parsed = JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; }
            return parsed && parsed[0] && parsed[0].content && parsed[0].content.rendered
                ? parsed[0].content.rendered
                : null;
        }
        return null;
    }

    // Первый снимок, который мы знаем: от него дневник считает границу ручных
    // правок, поэтому новое значение никогда не берём «сейчас».
    function knownFirstFetch() {
        var src = root.MPTSchedule || {};
        return src.firstFetchedAt || src.fetchedAt || null;
    }

    // Сходить на сайт и собрать модель. null — если не получилось или разбор
    // не прошёл проверку: тогда вызывающий оставляет то, что уже есть.
    // retried — признак того, что это вторая попытка после обрыва.
    function requestModel(kind, retried) {
        var P = parser();
        if (!P || typeof root.fetch !== "function") return Promise.resolve(null);

        return root.fetch(API + SLUG[kind], { headers: { Accept: "application/json, */*" } })
            .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.text();
            })
            .then(function (text) {
                if (kind === "schedule" && text.length < MIN_SCHEDULE_RESPONSE) {
                    var short = new Error("ответ сайта короче обычного (" + text.length + " символов)");
                    short.truncated = true;
                    throw short;
                }
                var html = extractContent(text);
                if (!html) throw new Error("в ответе нет данных страницы");
                var model = kind === "schedule"
                    ? P.buildSchedule(html, new Date().toISOString(), knownFirstFetch())
                    : P.buildReplacements(html, new Date().toISOString());
                var problems = kind === "schedule" ? P.checkSchedule(model) : P.checkReplacements(model, html);
                if (problems.length) throw new Error("разбор не прошёл проверку: " + problems.join("; "));
                return model;
            })
            .catch(function (e) {
                // Обрыв обычно случаен — один раз пробуем сразу ещё раз
                if (e && e.truncated && !retried) return requestModel(kind, true);
                lastError[kind] = String(e && e.message ? e.message : e);
                if (root.console && root.console.warn) {
                    root.console.warn("Не удалось обновить "
                        + (kind === "schedule" ? "расписание" : "замены") + ": " + lastError[kind]);
                }
                return null;
            });
    }

    // Отдать модель страницам. Данные проходят тот же путь, что и вшитый
    // снимок, поэтому история версий, ручные периоды и отметки не страдают.
    // Если приняли не до конца — возвращаем глобальную переменную как была.
    function adopt(kind, model) {
        var D = data();
        if (!D) return false;
        var fn = kind === "schedule" ? D.adoptSnapshot : D.adoptReplacements;
        if (typeof fn !== "function") return false;

        var before = root[GLOBALS[kind]];
        root[GLOBALS[kind]] = model;
        if (!fn.call(D, model)) {
            root[GLOBALS[kind]] = before;
            return false;
        }
        save(kind, model);
        hadOwnSnapshot[kind] = true;
        where[kind] = "live";
        lastError[kind] = null;
        return true;
    }

    function isDue(kind) {
        // Своего снимка ещё нет — идём на сайт сразу, сколько бы ни было
        // вшитым данным: это и есть «первое открытие делает снимок».
        if (!hadOwnSnapshot[kind]) return true;
        var current = root[GLOBALS[kind]];
        var at = fetchedMs(current);
        if (!at) return true;                                              // снимка нет — надо сходить
        if (Date.now() - at < EVERY[kind]) return false;                    // данные свежие
        // Пока показывать нечего, повторяем чаще: пустой экран ждать не должен
        var pause = hadOwnSnapshot[kind] ? RETRY_AFTER_ERROR : RETRY_WHEN_EMPTY;
        if (Date.now() - lastTry[kind] < pause) return false;               // только что пытались
        return true;
    }

    // force — сходить независимо от сроков (кнопка «обновить», проверки)
    function refresh(kind, force) {
        if (kind === "replacements" && !usesReplacements()) return Promise.resolve(false);
        if (!force && !isDue(kind)) return Promise.resolve(false);
        lastTry[kind] = Date.now();
        return requestModel(kind).then(function (model) {
            return model ? adopt(kind, model) : false;
        });
    }

    function refreshAll(force) {
        return Promise.all([refresh("schedule", force), refresh("replacements", force)]);
    }

    function start() {
        if (timer) return;
        // Нулевая задержка: к этому моменту страницы уже разложили вшитый снимок
        // и выбрали группу, поэтому подмена пройдёт по обычному пути.
        root.setTimeout(function () { refreshAll(false); }, 0);
        timer = root.setInterval(function () { refreshAll(false); }, TICK);
    }

    // Что сейчас показываем: bundled (вшитый снимок), saved (прошлая загрузка)
    // или live (данные только что с сайта). Плюс последняя ошибка — по ней
    // видно, почему обновления нет.
    function state() {
        return {
            schedule: {
                from: where.schedule,
                at: (root.MPTSchedule || {}).fetchedAt || null,
                error: lastError.schedule,
            },
            replacements: {
                from: where.replacements,
                at: (root.MPTReplacements || {}).fetchedAt || null,
                error: lastError.replacements,
            },
            every: EVERY,
        };
    }

    root.MPTLive = { refresh: refresh, refreshAll: refreshAll, state: state, every: EVERY };

    upgradeGlobals();

    if (root.document) {
        if (root.document.readyState === "loading") {
            root.document.addEventListener("DOMContentLoaded", start);
        } else {
            start();
        }
    }
})(window);
