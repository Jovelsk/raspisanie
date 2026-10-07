(function () {
    "use strict";

    var THEME_KEY = "mpt-theme";
    var COLOR_KEY = "mpt-color";
    var OTDEL_KEY = "mpt-otdel";
    var GRUPA_KEY = "mpt-grupa";

    var NAMED_COLORS = ["green", "blue", "red", "orange", "purple", "teal", "pink"];

    // Отделения и группы приходят из data/schedule.js. Если файла нет, данных
    // нет вовсе — страница честно покажет, что загружает их с mpt.ru.
    var DATA = window.MPTData || null;

    function currentOtdel() {
        return DATA ? DATA.otdel : "";
    }

    function currentGrupa() {
        return DATA ? DATA.grupa : "";
    }

    var doc = document.documentElement;

    // ——————————————————————————————————
    // Применение сохранённых настроек сразу (до отрисовки, чтобы не «мигало»)
    // ——————————————————————————————————
    var storedTheme = null;
    try { storedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (storedTheme !== "dark") storedTheme = "light";
    doc.setAttribute("data-theme", storedTheme);

    var storedColor = null;
    try { storedColor = localStorage.getItem(COLOR_KEY); } catch (e) {}
    if (isHex(storedColor)) {
        doc.setAttribute("data-color", "custom");
        doc.style.setProperty("--accent", storedColor);
    } else {
        if (NAMED_COLORS.indexOf(storedColor) === -1) storedColor = "green";
        doc.setAttribute("data-color", storedColor);
        doc.style.removeProperty("--accent");
    }

    function isHex(v) {
        return typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
    }

    // Актуальный акцент в виде hex (для поля-палитры)
    function accentHex() {
        var v = "";
        try { v = getComputedStyle(doc).getPropertyValue("--accent").trim(); } catch (e) {}
        if (isHex(v)) {
            if (v.length === 4) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
            return v;
        }
        var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(v);
        if (m) {
            var out = "#";
            for (var i = 1; i <= 3; i++) out += (+m[i] < 16 ? "0" : "") + Math.round(+m[i]).toString(16);
            return out;
        }
        return "#3f5d40";
    }

    function applyTheme(theme) {
        var t = (theme === "dark") ? "dark" : "light";
        doc.setAttribute("data-theme", t);
        try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
        syncUI();
    }

    // Базовый цвет (один из семи)
    function applyColor(name) {
        doc.setAttribute("data-color", name);
        doc.style.removeProperty("--accent");
        try { localStorage.setItem(COLOR_KEY, name); } catch (e) {}
        syncUI();
    }

    // Свой цвет из палитры (не добавляется в базовые)
    function applyCustomColor(hex) {
        if (!isHex(hex)) return;
        doc.setAttribute("data-color", "custom");
        doc.style.setProperty("--accent", hex.length === 4 ? expandHex(hex) : hex);
        try { localStorage.setItem(COLOR_KEY, hex); } catch (e) {}
        syncUI();
    }

    function expandHex(h) {
        return "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }

    function syncUI() {
        var accent = accentHex();
        var custom = doc.getAttribute("data-color") === "custom";
        var theme = doc.getAttribute("data-theme");

        var themeOpts = document.querySelectorAll(".theme-opt");
        for (var i = 0; i < themeOpts.length; i++) {
            themeOpts[i].classList.toggle("selected", themeOpts[i].getAttribute("data-theme") === theme);
        }

        var colorOpts = document.querySelectorAll(".color-opt");
        for (var j = 0; j < colorOpts.length; j++) {
            colorOpts[j].classList.toggle("selected", colorOpts[j].getAttribute("data-color") === doc.getAttribute("data-color"));
        }

        var customWrap = document.getElementById("color-custom");
        if (customWrap) {
            customWrap.classList.toggle("selected", custom);
        }

        var picker = document.getElementById("color-picker");
        if (picker) picker.value = accent;
    }

    // ——————————————————————————————————
    // Отделение и группа
    // ——————————————————————————————————
    function storedOtdel() {
        try { var v = localStorage.getItem(OTDEL_KEY); if (v) return v; } catch (e) {}
        return currentOtdel();
    }

    function storedGrupa() {
        try { var v = localStorage.getItem(GRUPA_KEY); if (v) return v; } catch (e) {}
        return currentGrupa();
    }

    function updateClassTitle() {
        var el = document.getElementById("class-title");
        if (!el) return;
        // Пока данных с сайта нет, группы ещё не выбраны: страница сама
        // сходит за ними (js/live.js), поэтому не пишем «— группа ».
        if (!currentOtdel() || !currentGrupa()) {
            el.textContent = "Загружаем данные с mpt.ru…";
            return;
        }
        el.textContent = currentOtdel() + " — группа " + currentGrupa();
    }

    // Свежие данные приходят уже после загрузки страницы — заголовок с
    // названием группы должен обновиться вместе с ними.
    if (DATA && DATA.onChange) DATA.onChange(updateClassTitle);

    // ——————————————————————————————————
    // Окно настроек
    // ——————————————————————————————————
    // ——————————————————————————————————
    // ФОН: картинка по пути и прозрачность панели
    // Путь работает, когда страница открыта с диска: тогда браузер разрешает
    // показывать файлы рядом со страницей. Через сервер или в расширении путь
    // к чужой папке браузер не пустит — об этом честно сказано в настройках.
    //——————————————————————————————————-

    var BG_KEY = "mpt-bg-path";
    var BG_ALPHA_KEY = "mpt-bg-alpha";
    var BG_HINT_DEFAULT = "Положите картинку в папку проекта, рядом с index.html, и впишите здесь её название — например bg.jpg. В расширении — только название: полный путь к диску браузер там не пускает.";

    function bgPathValue() {
        var raw = "";
        try { raw = window.localStorage.getItem(BG_KEY) || ""; } catch (e) { return ""; }
        // В расширении полный путь к диску всё равно не сработает, поэтому и при
        // чтении оставляем только название файла — так уже сохранённые значения
        // тоже начинают работать, а не только введённые заново.
        if (isExtension()) {
            var norm = normalizeBgPath(raw);
            if (/^file:/i.test(norm)) return norm.split("/").pop() || "";
        }
        return raw;
    }

    function bgAlphaValue() {
        try {
            var raw = window.localStorage.getItem(BG_ALPHA_KEY);
            if (raw === null) return 0;
            var v = parseInt(raw, 10);
            if (isNaN(v)) return 0;
            return Math.max(0, Math.min(100, v));
        } catch (e) { return 0; }
    }

    // Путь из проводника приходит с обратными слэшами и, бывает, в кавычках —
    // приводим к виду, который понимает браузер
    function normalizeBgPath(raw) {
        var p = String(raw || "").trim();
        if (p.length > 1 &&
            ((p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') ||
             (p.charAt(0) === "'" && p.charAt(p.length - 1) === "'"))) {
            p = p.slice(1, -1).trim();
        }
        p = p.replace(/\\/g, "/");
        if (/^[a-zA-Z]:\//.test(p)) p = "file:///" + p;
        return p;
    }

    // Мы внутри расширения?
    function isExtension() {
        return /^chrome-extension:$/.test(window.location.protocol) ||
            !!(window.chrome && window.chrome.runtime && window.chrome.runtime.id);
    }

    // В расширении полный путь к диску браузер не пустит: он показывает только
    // свои файлы. Поэтому из пути оставляем имя файла — картинка должна лежать
    // в папке проекта, рядом с index.html. На сайте путь работает целиком.
    function bgStoreValue(raw) {
        var path = normalizeBgPath(raw);
        if (isExtension() && /^file:/i.test(path)) {
            return path.split("/").pop() || "";
        }
        return raw;
    }

    // Слой с картинкой — отдельный элемент под всем остальным. Раньше картинка
    // висела на body через переменную и терялась по дороге: переменная,
    // подстановка, перенос фона на холст страницы. Прямой элемент надёжнее.
    function bgLayer() {
        var layer = document.getElementById("bg-layer");
        if (layer) return layer;
        if (!document.body) return null;
        layer = document.createElement("div");
        layer.id = "bg-layer";
        document.body.insertBefore(layer, document.body.firstChild);
        return layer;
    }

    function applyBg() {
        var path = normalizeBgPath(bgPathValue());
        var alpha = bgAlphaValue();
        var layer = bgLayer();
        if (layer) {
            layer.style.backgroundImage = path ? 'url("' + path.replace(/"/g, "%22") + '")' : "";
        }
        // 0% — панель непрозрачная, 100% — почти прозрачная: карточки пар и меню
        // остаются плотными всегда, поэтому текст читается независимо от фона.
        // Округляем: в двоичных дробях результат выходит с длинным хвостом
        var opacity = Math.round((1 - (alpha / 100) * 0.9) * 1000) / 1000;
        doc.style.setProperty("--panel-alpha", String(opacity));
        syncBgControls();
    }

    // Подставить сохранённые значения в поля настроек
    function syncBgControls() {
        var path = document.getElementById("bg-path");
        if (path && document.activeElement !== path) path.value = bgPathValue();
        var alpha = document.getElementById("bg-alpha");
        if (alpha) alpha.value = String(bgAlphaValue());
        var out = document.getElementById("bg-alpha-value");
        if (out) out.textContent = bgAlphaValue() + "%";
    }

    function setBgHint(text, bad) {
        var hint = document.getElementById("bg-hint");
        if (!hint) return;
        hint.textContent = text || BG_HINT_DEFAULT;
        hint.classList.toggle("settings-hint-bad", !!bad);
    }

    // Проверяем, что картинка действительно показывается
    function checkBgImage() {
        var path = normalizeBgPath(bgPathValue());
        if (!path) { setBgHint(BG_HINT_DEFAULT); return; }
        // У папки расширения нет — говорим прямо, что нужен путь к самому файлу:
        // «Копировать как путь» на папке даёт именно такой вид
        if (!/\.(jpe?g|png|gif|webp|bmp|avif|svg|ico)$/i.test(path)) {
            setBgHint("Похоже, это папка. Нужно название файла картинки — например bg.jpg. "
                + "Саму картинку положите в папку проекта, рядом с index.html. "
                + "Полный путь тоже можно, но он работает только когда сайт открыт с диска.", true);
            return;
        }
        // Пока браузер грузит картинку, не оставляем на экране прошлую подсказку:
        // иначе после исправленного пути ещё висело бы «похоже, это папка»
        setBgHint("Проверяю картинку…");
        var probe = new window.Image();
        probe.onload = function () { setBgHint("Картинка показывается."); };
        probe.onerror = function () { setBgHint("Не удалось показать картинку: файла нет или браузер его не пускает.", true); };
        probe.src = path;
    }

    document.addEventListener("input", function (e) {
        var t = e.target;
        if (!t || !t.id) return;
        if (t.id === "bg-path") {
            try { window.localStorage.setItem(BG_KEY, bgStoreValue(t.value)); } catch (err) { /* приватный режим */ }
            applyBg();
        } else if (t.id === "bg-alpha") {
            try { window.localStorage.setItem(BG_ALPHA_KEY, String(t.value)); } catch (err) { /* приватный режим */ }
            applyBg();
        }
    });

    document.addEventListener("change", function (e) {
        if (e.target && e.target.id === "bg-path") checkBgImage();
    });

    // Окно настроек открыли — подставляем сохранённые значения в поля
    document.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("#settings-btn") : null;
        if (!btn) return;
        window.setTimeout(function () { syncBgControls(); checkBgImage(); }, 0);
    });

    applyBg();

    function buildSettingsUI() {
        var content = document.querySelector(".content-about");
        if (!content) return;

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-btn";
        btn.id = "settings-btn";
        btn.title = "Настройки";
        btn.setAttribute("aria-label", "Настройки");
        btn.innerHTML = '<span class="settings-gear" aria-hidden="true">\u2699</span>';

        var overlay = document.createElement("div");
        overlay.className = "settings-overlay hidden";
        overlay.id = "settings-overlay";
        overlay.innerHTML =
            '<div class="settings-window">' +
            '<div class="settings-box">' +
                '<div class="settings-head">' +
                    '<span class="settings-title">Настройки</span>' +
                    '<button type="button" class="settings-close" aria-label="Закрыть">&times;</button>' +
                '</div>' +
                '<div class="settings-tabs" id="settings-tabs"></div>' +
                '<div class="settings-body">' +
                    '<div class="settings-pane" data-pane="general">' +
                    '<div class="settings-section">' +
                        '<span class="settings-section-title">Отделение</span>' +
                        '<select class="settings-select" id="otdel-select"></select>' +
                    '</div>' +
                    '<div class="settings-section">' +
                        '<span class="settings-section-title">Группа</span>' +
                        '<select class="settings-select" id="grupa-select"></select>' +
                    '</div>' +
                    '<div class="settings-section">' +
                        '<span class="settings-section-title">Тема оформления</span>' +
                        '<div class="theme-toggle" id="theme-toggle">' +
                            '<button type="button" class="theme-opt" data-theme="light">Светлая</button>' +
                            '<button type="button" class="theme-opt" data-theme="dark">Тёмная</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="settings-section">' +
                        '<span class="settings-section-title">Цвет оформления</span>' +
                        '<div class="color-toggle" id="color-toggle">' +
                            '<button type="button" class="color-opt green" data-color="green" title="Оригинал (зелёный)" aria-label="Оригинал (зелёный)"></button>' +
                            '<button type="button" class="color-opt blue" data-color="blue" title="Синий" aria-label="Синий"></button>' +
                            '<button type="button" class="color-opt red" data-color="red" title="Красный" aria-label="Красный"></button>' +
                            '<button type="button" class="color-opt orange" data-color="orange" title="Оранжевый" aria-label="Оранжевый"></button>' +
                            '<button type="button" class="color-opt purple" data-color="purple" title="Фиолетовый" aria-label="Фиолетовый"></button>' +
                            '<button type="button" class="color-opt teal" data-color="teal" title="Бирюзовый" aria-label="Бирюзовый"></button>' +
                            '<button type="button" class="color-opt pink" data-color="pink" title="Розовый" aria-label="Розовый"></button>' +
                            '<label class="color-custom" id="color-custom" title="Свой цвет">' +
                                '<input type="color" id="color-picker" aria-label="Свой цвет">' +
                            '</label>' +
                        '</div>' +
                    '</div>' +
                    '<div class="settings-section">' +
                        '<span class="settings-section-title">Фон</span>' +
                        '<input type="text" class="settings-input" id="bg-path" placeholder="название файла из папки проекта, например bg.jpg" spellcheck="false" autocomplete="off">' +
                        '<div class="bg-alpha-row">' +
                            '<input type="range" id="bg-alpha" min="0" max="100" step="5" aria-label="Прозрачность фона">' +
                            '<span class="bg-alpha-value" id="bg-alpha-value">0%</span>' +
                        '</div>' +
                        '<span class="settings-hint" id="bg-hint">' + BG_HINT_DEFAULT + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '</div>' +
            // Предупреждение живёт под окном, а не внутри него: видно
            // сразу, в любой вкладке, и не путается с содержимым
            '<div class="settings-notice hidden" id="settings-notice"></div>' +
            '</div>';

        content.appendChild(btn);
        content.appendChild(overlay);

        // ——————————————————————————————————
        // Вкладки
        // Основная — «Оформление». Другие страницы могут добавить свои
        // через MPTSettings.addTab(id, title, build), тогда вкладка
        // появится только там, где она реально нужна.
        //——————————————————————————————————-
        var tabsBar = overlay.querySelector("#settings-tabs");
        var body = overlay.querySelector(".settings-body");
        var box = overlay.querySelector(".settings-box");
        var panes = [];
        var activeId = "general";

// У вкладки может быть своя ширина окна: вкладка «Дневник» чуть шире,
// показывает больше мест, остальные остаются узкими.
            function applyBoxWidth(active) {
                if (!box) return;
                var wide = !!(active && active.wide);
box.classList.toggle("settings-box-wide", wide);
                // на широком окне ширину задаёт само правило
                box.style.maxWidth = (wide || !active || !active.boxWidth) ? "" : active.boxWidth + "px";
                syncNoticeWidth();
            }

            function showPane(id) {
                var active = null;
                for (var pi = 0; pi < panes.length; pi++) {
                    var on = panes[pi].id === id;
                    panes[pi].btn.classList.toggle("selected", on);
                    panes[pi].pane.classList.toggle("hidden", !on);
                    if (on) active = panes[pi];
                }
                // редактор расписания не влезает в узкое окно, но широким он
                // нужен только пока правка открыта
                applyBoxWidth(active);
                activeId = id;
                // вкладка успела узнать, что её снова показали:group могла смениться
                if (active && typeof active.refresh === "function") {
                    try { active.refresh(); } catch (e) { /* вкладка не должна ломать окно */ }
                }
            }

            // Вкладка может менять ширину окна на ходу. Повтор с тем же
            // значением ничего не делает, поэтому вкладка может звать это из
            // своей перерисовки и не зациклиться.
            function setWide(id, wide) {
                var want = !!wide;
                for (var si = 0; si < panes.length; si++) {
                    if (panes[si].id !== id) continue;
                    if (panes[si].wide === want) return;
                    panes[si].wide = want;
                    if (id === activeId) showPane(activeId);
                    return;
                }
            }

            // Ширина окна без правки: сколько пикселей, пока вкладка не широкая
            function setBoxWidth(id, px) {
                var want = px || 0;
                for (var bi = 0; bi < panes.length; bi++) {
                    if (panes[bi].id !== id) continue;
                    if (panes[bi].boxWidth === want) return;
                    panes[bi].boxWidth = want;
                    if (id === activeId) showPane(activeId);
                    return;
                }
            }

        function addTab(id, title, build, wide, refresh) {
            var btnEl = document.createElement("button");
            btnEl.type = "button";
            btnEl.className = "settings-tab";
            btnEl.textContent = title;
            btnEl.setAttribute("data-tab", id);
            tabsBar.appendChild(btnEl);

            var pane = document.createElement("div");
            pane.className = "settings-pane hidden";
            pane.setAttribute("data-pane", id);
            body.appendChild(pane);

            panes.push({ id: id, btn: btnEl, pane: pane, wide: !!wide, refresh: refresh });
            btnEl.addEventListener("click", function () { showPane(id); });
            // полоска вкладок нужна, только когда их больше одной
            tabsBar.hidden = panes.length < 2;

            if (typeof build === "function") {
                try { build(pane); } catch (e) { /* вкладка не должна ломать окно */ }
            }
            return pane;
        }

        addTab("general", "Оформление", function (pane) {
            // разложенные заранее секции оформления переезжают в готовую вкладку
            var src = body.querySelector('[data-pane="general"]');
            while (src.firstChild) pane.appendChild(src.firstChild);
        });
        showPane("general");

        // Предупреждение под окном настроек: пустой текст — блока нет.
        // Оно одно на все вкладки, поэтому видно везде сразу.
        var notice = overlay.querySelector("#settings-notice");
        function setNotice(text) {
            if (!notice) return;
            notice.innerHTML = text ? '<span>' + text + "</span>" : "";
            notice.classList.toggle("hidden", !text);
            syncNoticeWidth();
        }

        // Блок повторяет ширину окна: у вкладок ширина своя
        function syncNoticeWidth() {
            if (!notice || !box || notice.classList.contains("hidden")) return;
            notice.style.width = box.offsetWidth + "px";
        }

        // Другие страницы добавляют свои вкладки и умеют открыть окно
        window.MPTSettings = {
            addTab: addTab,
            show: showPane,
            setWide: setWide,
            setBoxWidth: setBoxWidth,
            setNotice: setNotice,
            open: function () { open(); },
            close: function () { close(); }
        };

        var closeBtn = overlay.querySelector(".settings-close");
        var themeBtns = overlay.querySelectorAll(".theme-opt");
        var colorBtns = overlay.querySelectorAll(".color-opt");
        var colorPicker = document.getElementById("color-picker");

        var otdelSel = overlay.querySelector("#otdel-select");
        var grupaSel = overlay.querySelector("#grupa-select");

        function setOptions(sel, items) {
            while (sel.firstChild) sel.removeChild(sel.firstChild);
            for (var i = 0; i < items.length; i++) {
                var op = document.createElement("option");
                op.textContent = items[i];
                op.value = items[i];
                sel.appendChild(op);
            }
        }

        function selectOtdel() {
            setOptions(grupaSel, DATA ? DATA.groups(currentOtdel()) : []);
            grupaSel.value = currentGrupa();
        }

        // Первичная раскладка: выбранное в настройках, иначе первое отделение/группа
        if (DATA) {
            var picked = DATA.init(storedOtdel(), storedGrupa());
            // Возвращаем каноничные названия (у сайта «09.02.07 П,Т», без пробела).
            // Пустотой запомненный выбор не затираем: данных могло ещё не быть,
            // и человек остался бы без своей группы после перезагрузки.
            if (picked.otdel && picked.grupa) {
                try { localStorage.setItem(OTDEL_KEY, picked.otdel); } catch (e) {}
                try { localStorage.setItem(GRUPA_KEY, picked.grupa); } catch (e) {}
            }
        }

        setOptions(otdelSel, DATA ? DATA.departments : [currentOtdel()]);
        selectOtdel();
        otdelSel.value = currentOtdel();
        updateClassTitle();

        otdelSel.addEventListener("change", function () {
            var otdel = this.value;
            try { localStorage.setItem(OTDEL_KEY, otdel); } catch (e) {}
            // Группа принадлежит отделению, поэтому при смене отделения
            // первой группе нового отделения и стать текущей
            if (DATA) DATA.selectGroup(otdel, (DATA.groups(otdel)[0] || ""), true);
            try { localStorage.setItem(GRUPA_KEY, currentGrupa()); } catch (e) {}
            selectOtdel();
            updateClassTitle();
            applySelection();
        });

        grupaSel.addEventListener("change", function () {
            try { localStorage.setItem(GRUPA_KEY, this.value); } catch (e) {}
            if (DATA) DATA.selectGroup(currentOtdel(), this.value, true);
            updateClassTitle();
            applySelection();
        });

        // Последний вызов selectGroup без silent — страницы перерисуются сами
        function applySelection() {
            if (DATA) DATA.selectGroup(currentOtdel(), currentGrupa());
        }

        // Свежие данные приходят уже после постройки окна (js/live.js), поэтому
        // списки надо наполнить заново: иначе выбирать отделение и группу было
        // бы не из чего — они бы остались пустыми с самого открытия страницы.
        if (DATA && DATA.onChange) {
            DATA.onChange(function () {
                setOptions(otdelSel, DATA.departments);
                setOptions(grupaSel, DATA.groups(currentOtdel()));
                otdelSel.value = currentOtdel();
                grupaSel.value = currentGrupa();
            });
        }

        function open() {
            overlay.classList.remove("hidden");
            syncUI();
            syncNoticeWidth();
            closeBtn.focus();
        }

        function close() {
            overlay.classList.add("hidden");
        }

        btn.addEventListener("click", open);
        closeBtn.addEventListener("click", close);
        // Клик мимо окна закрывает настройки. Определять это по моменту всплытия
        // нельзя: обработчик нажатой кнопки успевает перерисовать вкладку, элемент
        // открепляется, и closest() перестаёт находить окно — настройки
        // закрывались от любого клика внутри. Так было с периодами в дневнике.
        //
        // Поэтому решаем в фазе перехвата — раньше обработчиков кнопок, пока
        // нажатый элемент ещё на своём месте.
        var insideClick = false;

        overlay.addEventListener("click", function (ev) {
            var el = ev.target;
            insideClick = !!(el && el.closest &&
                (el.closest(".settings-box") || el.closest("#settings-notice")));
        }, true);

        overlay.addEventListener("click", function (ev) {
            // Подстраховка: если перехват почему-то не сработал, смотрим путь
            // события — он запоминается в момент клика и не меняется при перерисовке
            if (!insideClick && ev.composedPath) {
                var path = ev.composedPath();
                for (var i = 0; i < path.length; i++) {
                    var node = path[i];
                    if (node === overlay) break;                 // дошли до подложки — мимо окна
                    if (node.id === "settings-notice") { insideClick = true; break; }
                    if (node.classList && node.classList.contains("settings-box")) { insideClick = true; break; }
                }
            }
            var wasInside = insideClick;
            insideClick = false;

            // Последняя подстраховка, которая не зависит ни от разметки, ни от
            // перерисовок: если клик пришёлся внутрь прямоугольника окна настроек,
            // не закрываем. Проверяем только когда прямоугольник настоящий — в
            // проверках страница без настоящей раскладки, и там это правило молчит
            var boxEl = overlay.querySelector(".settings-box");
            if (!wasInside && boxEl && boxEl.getBoundingClientRect) {
                var r = boxEl.getBoundingClientRect();
                if (r && r.width > 0 && r.height > 0 &&
                    ev.clientX >= r.left && ev.clientX <= r.right &&
                    ev.clientY >= r.top && ev.clientY <= r.bottom) {
                    wasInside = true;
                }
            }

            if (wasInside) return;
            close();
        });
        document.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape" && !overlay.classList.contains("hidden")) close();
        });
        window.addEventListener("resize", syncNoticeWidth);

        for (var i = 0; i < themeBtns.length; i++) {
            themeBtns[i].addEventListener("click", function () {
                applyTheme(this.getAttribute("data-theme"));
            });
        }

        for (var j = 0; j < colorBtns.length; j++) {
            colorBtns[j].addEventListener("click", function () {
                applyColor(this.getAttribute("data-color"));
            });
        }

        if (colorPicker) {
            colorPicker.addEventListener("input", function () {
                applyCustomColor(this.value);
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildSettingsUI);
    } else {
        buildSettingsUI();
    }
})();