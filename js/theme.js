(function () {
    "use strict";

    var THEME_KEY = "mpt-theme";
    var COLOR_KEY = "mpt-color";
    var OTDEL_KEY = "mpt-otdel";
    var GRUPA_KEY = "mpt-grupa";

    var NAMED_COLORS = ["green", "blue", "red", "orange", "purple", "teal", "pink"];

    var OTDELS = ["09.02.07 П, Т"];
    var GRUPAS = ["П-5-25"];

    var defOtdel = OTDELS[0];
    var defGrupa = GRUPAS[0];

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
        return defOtdel;
    }

    function storedGrupa() {
        try { var v = localStorage.getItem(GRUPA_KEY); if (v) return v; } catch (e) {}
        return defGrupa;
    }

    function updateClassTitle() {
        var el = document.getElementById("class-title");
        if (!el) return;
        el.textContent = storedOtdel() + " — группа " + storedGrupa();
    }

    function fillOptions(sel, items) {
        for (var i = 0; i < items.length; i++) {
            var op = document.createElement("option");
            op.textContent = items[i];
            op.value = items[i];
            sel.appendChild(op);
        }
    }

    // ——————————————————————————————————
    // Окно настроек
    // ——————————————————————————————————
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
            '<div class="settings-box">' +
                '<div class="settings-head">' +
                    '<span class="settings-title">Настройки</span>' +
                    '<button type="button" class="settings-close" aria-label="Закрыть">&times;</button>' +
                '</div>' +
                '<div class="settings-body">' +
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
                '</div>' +
            '</div>';

        content.appendChild(btn);
        content.appendChild(overlay);

        var closeBtn = overlay.querySelector(".settings-close");
        var themeBtns = overlay.querySelectorAll(".theme-opt");
        var colorBtns = overlay.querySelectorAll(".color-opt");
        var colorPicker = document.getElementById("color-picker");

        var otdelSel = overlay.querySelector("#otdel-select");
        var grupaSel = overlay.querySelector("#grupa-select");
        fillOptions(otdelSel, OTDELS);
        fillOptions(grupaSel, GRUPAS);
        otdelSel.value = storedOtdel();
        grupaSel.value = storedGrupa();
        otdelSel.addEventListener("change", function () {
            try { localStorage.setItem(OTDEL_KEY, this.value); } catch (e) {}
            updateClassTitle();
        });
        grupaSel.addEventListener("change", function () {
            try { localStorage.setItem(GRUPA_KEY, this.value); } catch (e) {}
            updateClassTitle();
        });
        updateClassTitle();

        function open() {
            overlay.classList.remove("hidden");
            syncUI();
            closeBtn.focus();
        }

        function close() {
            overlay.classList.add("hidden");
        }

        btn.addEventListener("click", open);
        closeBtn.addEventListener("click", close);
        overlay.addEventListener("click", function (ev) {
            if (ev.target === overlay) close();
        });
        document.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape" && !overlay.classList.contains("hidden")) close();
        });

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