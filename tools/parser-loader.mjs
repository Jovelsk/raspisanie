// Разбор страниц mpt.ru живёт в js/mpt-parse.js — в том же файле, который
// обычным <script> подключает страница.
//
// Здесь мы выполняем его в песочнице Node, чтобы разбор существовал в одном
// экземпляре: две копии неизбежно разъедутся, а от разбора зависят и
// расписание, и замены, и весь дневник.
import { readFile } from "node:fs/promises";
import vm from "node:vm";

export async function loadParser() {
    const url = new URL("../js/mpt-parse.js", import.meta.url);
    const code = await readFile(url, "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: "js/mpt-parse.js" });
    const parser = sandbox.window.MPTParse;
    if (!parser) throw new Error("в js/mpt-parse.js не нашлось window.MPTParse");
    return parser;
}
