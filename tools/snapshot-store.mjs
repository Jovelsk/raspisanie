// Хранилище снимков: текущий файл плюс архив прошлых версий.
//
// Правило: версия попадает в архив только тогда, когда содержимое реально
// изменилось, и лежит там, пока отличается от текущей. Одинаковые снимки
// не копятся: снимок замен обновляется каждые полчаса, но расписание от
// этого не меняется, и archive не должен пухнуть от копий одного и того же.
//
// Сравниваем без отметки fetchedAt: она меняется на каждом запуске и означала
// бы «изменение» там, где ничего не поменялось. Страницам она нужна — по ней
// в подписи видно, когда данные проверяли в последний раз, поэтому текущий
// файл перезаписывается всегда, а архив — только по делу.
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

export const HISTORY_DIR = "data/history";

// Что в снимке считается содержимым.
// Отметку съёмки выбрасываем всегда: она меняется на каждом запуске и давала бы
// «изменение» там, где ничего не поменялось. У расписания вдобавок выбрасываем
// шапку сайта про текущую неделю — дату и чётность: сайт меняет их сам каждую
// неделю, а правкой расписания это не является, иначе в архив каждую неделю
// ложился бы новый файл на 580 КБ вообще без изменений в парах.
export function contentOf(model, kind) {
    if (!model || typeof model !== "object") return null;
    const copy = { ...model };
    delete copy.fetchedAt;
    if (kind === "schedule" && copy.page && typeof copy.page === "object") {
        copy.page = { ...copy.page };
        delete copy.page.weekDate;
        delete copy.page.weekDateText;
        delete copy.page.parity;
    }
    return copy;
}

export function sameContent(a, b, kind) {
    return JSON.stringify(contentOf(a, kind)) === JSON.stringify(contentOf(b, kind));
}

// «2026-10-07T16:52:05.667Z» -> «2026-10-07_16-52-05» (двоеточия в именах нельзя)
export function stampForFile(iso) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(iso || ""));
    if (!m) return "unknown";
    return m[1] + "_" + m[2] + "-" + m[3] + "-" + m[4];
}

export function historyName(kind, iso) {
    return kind + "-" + stampForFile(iso) + ".js";
}

// Читает файл снимка: и сырой текст (его кладём в архив как есть), и модель
async function readSnapshot(file) {
    try {
        const raw = await readFile(file, "utf8");
        const m = /= ([\s\S]*?);\s*$/.exec(raw);
        if (!m) return null;
        return { raw, model: JSON.parse(m[1]) };
    } catch (e) {
        return null;
    }
}

async function listHistory(dir) {
    let names = [];
    try { names = await readdir(dir); } catch (e) { return []; }
    const out = [];
    for (const name of names) {
        if (!name.endsWith(".js")) continue;
        const snap = await readSnapshot(join(dir, name));
        if (snap) out.push({ name, model: snap.model });
    }
    return out;
}

// Кладёт новый снимок. Возвращает, что именно произошло:
//   changed  — содержимое отличается от прежнего
//   archived — имя файла в архиве, куда легла прошлая версия (или null)
//   pruned   — имена убранных копий, совпавших с текущей версией
export async function storeSnapshot({ out, kind, model, toScript, historyDir }) {
    const live = resolve(out);
    const histDir = resolve(historyDir || HISTORY_DIR);
    const prev = await readSnapshot(live);
    const changed = !prev || !sameContent(prev.model, model, kind);

    let archived = null;
    if (changed && prev) {
        await mkdir(histDir, { recursive: true });
        const name = historyName(kind, prev.model && prev.model.fetchedAt);
        if (!(await readSnapshot(join(histDir, name)))) {
            await writeFile(join(histDir, name), prev.raw, "utf8");
            archived = name;
        }
    }

    await mkdir(dirname(live), { recursive: true });
    await writeFile(live, toScript(model), "utf8");

    // Чистим архив только когда содержимое сменилось: именно тогда в нём
    // может появиться копия, совпавшая с текущей версией (например, когда
    // расписание вернули к прежнему виду).
    const pruned = [];
    if (changed) {
        for (const h of await listHistory(histDir)) {
            if (sameContent(h.model, model, kind)) {
                await unlink(join(histDir, h.name));
                pruned.push(h.name);
            }
        }
    }

    return { changed, archived, pruned, historyDir: histDir };
}
