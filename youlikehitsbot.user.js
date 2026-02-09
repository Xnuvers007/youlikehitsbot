// ==UserScript==
// @name         YouLikeHits Bot Pro
// @namespace    https://github.com/gekkedev/youlikehitsbot
// @version      2.0.0
// @description  Advanced YLH automation bot with smart point filtering, robust captcha solving, session management, anti-detection, statistics dashboard, and auto-recovery.
// @author       gekkedev (enhanced)
// @updateURL    https://raw.githubusercontent.com/gekkedev/youlikehitsbot/master/youlikehitsbot.user.js
// @downloadURL  https://raw.githubusercontent.com/gekkedev/youlikehitsbot/master/youlikehitsbot.user.js
// @match        *://*.youlikehits.com/login.php
// @match        *://*.youlikehits.com/soundcloudplays.php*
// @match        *://*.youlikehits.com/websites.php*
// @match        *://*.youlikehits.com/viewwebsite.php*
// @match        *://*.youlikehits.com/youtubenew2.php*
// @match        *://*.youlikehits.com/youtubelikes.php*
// @match        *://*.youlikehits.com/youtube2.php*
// @match        *://*.youlikehits.com/bonuspoints.php*
// @match        *://*.youlikehits.com/twitter2.php*
// @match        *://*.youlikehits.com/instagram*.php*
// @match        *://*.youlikehits.com/tiktok*.php*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @require      https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js
// @require      https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js
// @require      https://cdn.jsdelivr.net/gh/naptha/tesseract.js/dist/tesseract.min.js
// ==/UserScript==

(() => {
    "use strict";

    const J = jQuery.noConflict(true);

    // =========================================================================
    // CONFIGURATION — Adjust these values to your preference
    // =========================================================================
    const CONFIG = Object.freeze({
        // Core timing
        LOOP_INTERVAL_MS:       1500,       // Main loop interval (ms) — slightly randomized at runtime
        LOOP_JITTER_MS:         500,        // ±jitter added to loop interval for anti-detection

        // YouTube settings
        YT_MIN_POINTS:          5,          // Skip videos worth fewer points than this
        YT_PATIENCE_SEC:        250,        // Max seconds to wait for a video before auto-skipping
        YT_NO_VIDEOS_DELAY_MS:  5000,       // Delay before reload when no videos available
        YT_CAPTCHA_FAIL_DELAY:  2000,       // Delay before reload on captcha failure

        // Bonus Points
        BONUS_RELOAD_MIN_SEC:   60,         // Min seconds before reloading bonus page
        BONUS_RELOAD_MAX_SEC:   300,        // Max seconds before reloading bonus page

        // Website Traffic
        TRAFFIC_RATE_LIMIT_DELAY: 3000,     // Delay when rate-limited on website viewing

        // SoundCloud
        SC_STALE_TIMER_SEC:     30,         // Consider a SoundCloud timer stale after this many seconds

        // Captcha
        CAPTCHA_RETRY_LIMIT:    3,          // Max captcha solve retries before giving up
        CAPTCHA_COOLDOWN_MS:    2000,       // Cooldown between captcha retry attempts

        // Anti-detection
        HUMAN_DELAY_MIN_MS:     300,        // Minimum human-like delay before clicking
        HUMAN_DELAY_MAX_MS:     1200,       // Maximum human-like delay before clicking

        // Logging
        LOG_LEVEL:              "DEBUG",    // "DEBUG" | "INFO" | "WARN" | "ERROR"
        LOG_MAX_ENTRIES:        500,        // Max log entries kept in memory

        // Dashboard
        DASHBOARD_ENABLED:      true,       // Show floating stats dashboard
        DASHBOARD_POSITION:     "bottom-right", // "top-left" | "top-right" | "bottom-left" | "bottom-right"
    });

    // =========================================================================
    // LOGGER — Structured logging with levels, timestamps and in-memory buffer
    // =========================================================================
    const Logger = (() => {
        const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        const currentLevel = LEVELS[CONFIG.LOG_LEVEL] ?? LEVELS.INFO;
        const buffer = [];
        const STYLES = {
            DEBUG: "color:#888;",
            INFO:  "color:#4fc3f7;font-weight:bold;",
            WARN:  "color:#ffb74d;font-weight:bold;",
            ERROR: "color:#ef5350;font-weight:bold;",
        };

        const _log = (level, ...args) => {
            if (LEVELS[level] < currentLevel) return;
            const ts = new Date().toLocaleTimeString();
            const prefix = `[YLH-Bot ${ts}] [${level}]`;
            const entry = { level, time: ts, message: args.join(" ") };
            buffer.push(entry);
            if (buffer.length > CONFIG.LOG_MAX_ENTRIES) buffer.shift();
            console.log(`%c${prefix}`, STYLES[level], ...args);
        };

        return {
            debug: (...a) => _log("DEBUG", ...a),
            info:  (...a) => _log("INFO",  ...a),
            warn:  (...a) => _log("WARN",  ...a),
            error: (...a) => _log("ERROR", ...a),
            getBuffer: () => [...buffer],
        };
    })();

    // =========================================================================
    // STATISTICS TRACKER — Persisted via GM storage
    // =========================================================================
    const Stats = (() => {
        const STORAGE_KEY = "ylh_bot_stats_v2";
        let data = {
            sessionStart:   Date.now(),
            videosViewed:   0,
            videosSkipped:  0,
            pointsEarned:   0,
            captchasSolved: 0,
            captchasFailed: 0,
            websitesVisited: 0,
            songsPlayed:    0,
            bonusClaimed:   0,
            errors:         0,
            reloads:        0,
        };

        const load = async () => {
            try {
                const saved = await GM.getValue(STORAGE_KEY, null);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Merge persistent totals but reset session timer
                    Object.keys(data).forEach(k => {
                        if (k !== "sessionStart" && typeof parsed[k] === "number") {
                            data[k] = parsed[k];
                        }
                    });
                }
            } catch (e) {
                Logger.warn("Stats load failed, starting fresh:", e.message);
            }
        };

        const save = async () => {
            try {
                await GM.setValue(STORAGE_KEY, JSON.stringify(data));
            } catch (e) {
                Logger.warn("Stats save failed:", e.message);
            }
        };

        const increment = (key, amount = 1) => {
            if (key in data && typeof data[key] === "number") {
                data[key] += amount;
                save(); // fire-and-forget
            }
        };

        const getUptime = () => {
            const diff = Date.now() - data.sessionStart;
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            return `${h}h ${m}m ${s}s`;
        };

        const reset = async () => {
            Object.keys(data).forEach(k => {
                if (typeof data[k] === "number" && k !== "sessionStart") data[k] = 0;
            });
            data.sessionStart = Date.now();
            await save();
        };

        return { load, save, increment, data, getUptime, reset };
    })();

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    /** Returns a random integer in [min, max] */
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    /** Returns random milliseconds from a seconds range */
    const randomMs = (fromSec, toSec) => randInt(fromSec, toSec) * 1000;

    /** Promise-based delay */
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    /** Human-like random delay before performing an action */
    const humanDelay = () => delay(randInt(CONFIG.HUMAN_DELAY_MIN_MS, CONFIG.HUMAN_DELAY_MAX_MS));

    /** Safe element click with optional human delay */
    const safeClick = async (el) => {
        if (!el || !el.length) return false;
        await humanDelay();
        try {
            const domEl = el[0] || el;
            if (typeof domEl.click === "function") {
                domEl.click();
            } else if (typeof domEl.onclick === "function") {
                domEl.onclick();
            }
            return true;
        } catch (e) {
            Logger.error("safeClick failed:", e.message);
            return false;
        }
    };

    /** Safely evaluate a math expression from captcha (no eval!) */
    const safeMathEval = (expr) => {
        try {
            // Sanitize: only allow digits, +, -, *, /, spaces
            const sanitized = expr.replace(/[^0-9+\-*/() ]/g, "").trim();
            if (!sanitized || sanitized.length > 20) return null;
            // Use Function constructor (safer than eval, still sandboxed in userscript)
            const result = new Function(`"use strict"; return (${sanitized});`)();
            return Number.isFinite(result) ? Math.round(result) : null;
        } catch {
            return null;
        }
    };

    /** Check if page contains text (optimized — avoids scanning entire DOM repeatedly) */
    const pageContains = (text) => {
        return document.body?.innerText?.includes(text) ?? false;
    };

    /** Debounce utility */
    const debounce = (fn, ms) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    };

    // =========================================================================
    // NOTIFICATION SYSTEM — Styled floating notifications
    // =========================================================================
    const Notifications = (() => {
        const activeNotes = new Map();

        const createStyle = () => {
            if (document.getElementById("ylh-bot-notif-style")) return;
            const style = document.createElement("style");
            style.id = "ylh-bot-notif-style";
            style.textContent = `
                .ylh-bot-notif {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: #e0e0e0;
                    padding: 10px 16px;
                    margin: 4px 0;
                    border-left: 4px solid #4fc3f7;
                    border-radius: 6px;
                    font-size: 13px;
                    font-family: 'Segoe UI', Tahoma, sans-serif;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    animation: ylhSlideIn 0.3s ease-out;
                    transition: opacity 0.3s ease;
                }
                .ylh-bot-notif.warning { border-left-color: #ffb74d; }
                .ylh-bot-notif.error   { border-left-color: #ef5350; }
                .ylh-bot-notif.success { border-left-color: #66bb6a; }
                .ylh-bot-notif strong  { color: #4fc3f7; }
                @keyframes ylhSlideIn {
                    from { opacity: 0; transform: translateY(-8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        };

        const attach = (targetSelector, message, type = "info", dedupKey = null) => {
            createStyle();
            const key = dedupKey || message;
            if (activeNotes.has(key)) return activeNotes.get(key);

            const typeClass = type !== "info" ? ` ${type}` : "";
            const html = `<div class="ylh-bot-notif${typeClass}"><strong>🤖 Bot:</strong> ${message}</div>`;
            const target = J(targetSelector);
            if (!target.length) return null;

            const el = J(html).insertBefore(target);
            activeNotes.set(key, el);
            return el;
        };

        const remove = (keyOrEl) => {
            if (!keyOrEl) return;
            if (typeof keyOrEl === "string") {
                const el = activeNotes.get(keyOrEl);
                if (el) {
                    el.css("opacity", "0");
                    setTimeout(() => el.remove(), 300);
                    activeNotes.delete(keyOrEl);
                }
            } else {
                keyOrEl.css("opacity", "0");
                setTimeout(() => keyOrEl.remove(), 300);
                // Clean from map
                for (const [k, v] of activeNotes) {
                    if (v === keyOrEl) { activeNotes.delete(k); break; }
                }
            }
        };

        const clear = () => {
            activeNotes.forEach(el => el.remove());
            activeNotes.clear();
        };

        return { attach, remove, clear };
    })();

    // =========================================================================
    // ALERT ONCE — Prevents repeated alert() popups per session
    // =========================================================================
    const shownWarnings = new Set();
    const alertOnce = (message, id) => {
        const key = id ?? message;
        if (shownWarnings.has(key)) return;
        shownWarnings.add(key);
        alert(message);
    };

    // =========================================================================
    // CAPTCHA SOLVER — Robust with retries, validation, and lock management
    // =========================================================================
    const CaptchaSolver = (() => {
        const locks = new Map(); // captchaId -> { retries, locked }

        const solve = async (imageEl, outputEl, captchaId, callback = () => {}) => {
            const lockState = locks.get(captchaId) || { locked: false, retries: 0 };

            if (lockState.locked) {
                Logger.debug(`Captcha [${captchaId}] already being solved, skipping...`);
                return;
            }

            if (lockState.retries >= CONFIG.CAPTCHA_RETRY_LIMIT) {
                Logger.warn(`Captcha [${captchaId}] exceeded retry limit (${CONFIG.CAPTCHA_RETRY_LIMIT})`);
                Notifications.attach(imageEl, "Captcha solver exceeded max retries. Please solve manually.", "error");
                return;
            }

            lockState.locked = true;
            lockState.retries++;
            locks.set(captchaId, lockState);

            const noteKey = `captcha_solving_${captchaId}`;
            Notifications.attach(imageEl, `Solving captcha... (attempt ${lockState.retries}/${CONFIG.CAPTCHA_RETRY_LIMIT})`, "info", noteKey);

            try {
                const imgSrc = J(imageEl).attr("src");
                if (!imgSrc) throw new Error("No image source found");

                const result = await Tesseract.recognize(imgSrc);
                let formula = (result.text || "").trim();

                Logger.debug(`Captcha OCR raw: "${formula}"`);

                if (formula.length < 1 || formula.length > 10) {
                    throw new Error(`Invalid formula length: ${formula.length}`);
                }

                // Fix common OCR misreads
                // "271" for "2-1", "7" misread as operator
                if (formula.length === 3 && /^\d7\d$/.test(formula)) {
                    formula = formula[0] + "-" + formula[2];
                }
                formula = formula.replace(/x/gi, "*");    // x → *
                formula = formula.replace(/X/g, "*");
                formula = formula.replace(/[}{)(|\\]/g, ""); // junk chars
                formula = formula.replace(/\s+/g, "");       // whitespace
                formula = formula.replace(/[oO]/g, "0");     // O → 0
                formula = formula.replace(/[lI]/g, "1");     // l/I → 1
                formula = formula.replace(/[sS]/g, "5");     // S → 5

                Logger.debug(`Captcha formula cleaned: "${formula}"`);

                const answer = safeMathEval(formula);
                if (answer === null) {
                    throw new Error(`Could not evaluate: "${formula}"`);
                }

                Logger.info(`Captcha [${captchaId}] solved: ${formula} = ${answer}`);
                outputEl.val(answer);
                Stats.increment("captchasSolved");
                Notifications.remove(noteKey);

                lockState.locked = false;
                lockState.retries = 0;
                locks.set(captchaId, lockState);

                await humanDelay();
                callback();

            } catch (err) {
                Logger.error(`Captcha [${captchaId}] error:`, err.message);
                Stats.increment("captchasFailed");
                Notifications.remove(noteKey);

                lockState.locked = false;
                locks.set(captchaId, lockState);

                // Auto-retry after cooldown
                if (lockState.retries < CONFIG.CAPTCHA_RETRY_LIMIT) {
                    Logger.info(`Retrying captcha [${captchaId}] in ${CONFIG.CAPTCHA_COOLDOWN_MS}ms...`);
                    await delay(CONFIG.CAPTCHA_COOLDOWN_MS);
                    return solve(imageEl, outputEl, captchaId, callback);
                }
            }
        };

        const resetLock = (captchaId) => locks.delete(captchaId);

        return { solve, resetLock };
    })();

    // =========================================================================
    // SAFE RELOAD — With anti-loop protection
    // =========================================================================
    const SafeReload = (() => {
        const STORAGE_KEY = "ylh_reload_count";
        const MAX_RAPID_RELOADS = 10;
        const WINDOW_MS = 60000; // 1 minute

        const check = async () => {
            try {
                const raw = await GM.getValue(STORAGE_KEY, "[]");
                const timestamps = JSON.parse(raw).filter(t => Date.now() - t < WINDOW_MS);
                if (timestamps.length >= MAX_RAPID_RELOADS) {
                    Logger.error(`Reload loop detected (${timestamps.length} reloads in 1min). Pausing for 5 minutes...`);
                    Notifications.attach(".maintable, .mainfocus, body",
                        "Too many reloads detected. Bot paused for 5 minutes to prevent a loop.", "error");
                    await delay(300000); // 5 min
                    await GM.setValue(STORAGE_KEY, "[]");
                }
                timestamps.push(Date.now());
                await GM.setValue(STORAGE_KEY, JSON.stringify(timestamps));
            } catch {
                // Ignore storage errors
            }
        };

        const reload = async (reason = "Unknown") => {
            Logger.info(`Reloading page — reason: ${reason}`);
            Stats.increment("reloads");
            await check();
            location.reload();
        };

        const reloadAfter = async (ms, reason = "Scheduled") => {
            Logger.info(`Scheduled reload in ${Math.round(ms / 1000)}s — reason: ${reason}`);
            await delay(ms);
            await reload(reason);
        };

        return { reload, reloadAfter };
    })();

    // =========================================================================
    // DASHBOARD — Floating stats overlay
    // =========================================================================
    const Dashboard = (() => {
        let container = null;
        let updateInterval = null;
        let minimized = false;

        const POSITIONS = {
            "top-left":     "top:10px;left:10px;",
            "top-right":    "top:10px;right:10px;",
            "bottom-left":  "bottom:10px;left:10px;",
            "bottom-right": "bottom:10px;right:10px;",
        };

        const create = () => {
            if (!CONFIG.DASHBOARD_ENABLED || container) return;

            const pos = POSITIONS[CONFIG.DASHBOARD_POSITION] || POSITIONS["bottom-right"];
            const div = document.createElement("div");
            div.id = "ylh-bot-dashboard";
            div.innerHTML = `
                <style>
                    #ylh-bot-dashboard {
                        position: fixed;
                        ${pos}
                        z-index: 99999;
                        background: linear-gradient(145deg, #0d1b2a, #1b2838);
                        color: #c8d6e5;
                        font-family: 'Consolas', 'Monaco', monospace;
                        font-size: 12px;
                        border: 1px solid #2d4059;
                        border-radius: 10px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                        min-width: 220px;
                        max-width: 280px;
                        transition: all 0.3s ease;
                        user-select: none;
                    }
                    #ylh-bot-dashboard.minimized {
                        min-width: auto;
                        max-width: 160px;
                    }
                    #ylh-dash-header {
                        background: linear-gradient(90deg, #2d4059, #1b2838);
                        padding: 8px 12px;
                        border-radius: 10px 10px 0 0;
                        cursor: pointer;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-weight: bold;
                        color: #4fc3f7;
                    }
                    #ylh-dash-header:hover { background: linear-gradient(90deg, #3a5a80, #2d4059); }
                    #ylh-dash-body {
                        padding: 10px 12px;
                        line-height: 1.8;
                    }
                    #ylh-dash-body.hidden { display: none; }
                    .ylh-dash-row {
                        display: flex;
                        justify-content: space-between;
                        border-bottom: 1px solid rgba(255,255,255,0.05);
                        padding: 1px 0;
                    }
                    .ylh-dash-label { color: #8899aa; }
                    .ylh-dash-value { color: #4fc3f7; font-weight: bold; }
                    .ylh-dash-value.good { color: #66bb6a; }
                    .ylh-dash-value.bad  { color: #ef5350; }
                    #ylh-dash-actions {
                        padding: 6px 12px 10px;
                        display: flex;
                        gap: 6px;
                    }
                    #ylh-dash-actions.hidden { display: none; }
                    .ylh-dash-btn {
                        flex: 1;
                        padding: 4px 8px;
                        border: 1px solid #2d4059;
                        border-radius: 4px;
                        background: #1b2838;
                        color: #4fc3f7;
                        font-size: 11px;
                        cursor: pointer;
                        text-align: center;
                        transition: background 0.2s;
                    }
                    .ylh-dash-btn:hover { background: #2d4059; }
                    .ylh-dash-btn.danger { color: #ef5350; border-color: #ef5350; }
                    .ylh-dash-btn.danger:hover { background: #3a1a1a; }
                    #ylh-dash-status {
                        padding: 4px 12px 6px;
                        font-size: 11px;
                        color: #66bb6a;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    #ylh-dash-status.hidden { display: none; }
                    .ylh-pulse {
                        width: 8px; height: 8px;
                        background: #66bb6a;
                        border-radius: 50%;
                        animation: ylhPulse 1.5s infinite;
                    }
                    @keyframes ylhPulse {
                        0%, 100% { opacity: 1; }
                        50%      { opacity: 0.3; }
                    }
                </style>
                <div id="ylh-dash-header">
                    <span>🤖 YLH Bot Pro</span>
                    <span id="ylh-dash-toggle">▼</span>
                </div>
                <div id="ylh-dash-status">
                    <div class="ylh-pulse"></div>
                    <span id="ylh-dash-status-text">Running on ${document.location.pathname}</span>
                </div>
                <div id="ylh-dash-body"></div>
                <div id="ylh-dash-actions">
                    <button class="ylh-dash-btn" id="ylh-dash-reset">Reset Stats</button>
                    <button class="ylh-dash-btn danger" id="ylh-dash-pause">Pause Bot</button>
                </div>
            `;

            document.body.appendChild(div);
            container = div;

            // Event listeners
            document.getElementById("ylh-dash-header").addEventListener("click", toggleMinimize);
            document.getElementById("ylh-dash-reset").addEventListener("click", async () => {
                await Stats.reset();
                Logger.info("Stats reset by user");
            });
            document.getElementById("ylh-dash-pause").addEventListener("click", () => {
                BotState.paused = !BotState.paused;
                const btn = document.getElementById("ylh-dash-pause");
                btn.textContent = BotState.paused ? "Resume Bot" : "Pause Bot";
                btn.classList.toggle("danger", !BotState.paused);
                Logger.info(BotState.paused ? "Bot PAUSED by user" : "Bot RESUMED by user");
            });

            // Start auto-update
            updateInterval = setInterval(render, 2000);
            render();
        };

        const toggleMinimize = () => {
            minimized = !minimized;
            container?.classList.toggle("minimized", minimized);
            document.getElementById("ylh-dash-body")?.classList.toggle("hidden", minimized);
            document.getElementById("ylh-dash-actions")?.classList.toggle("hidden", minimized);
            document.getElementById("ylh-dash-status")?.classList.toggle("hidden", minimized);
            const toggle = document.getElementById("ylh-dash-toggle");
            if (toggle) toggle.textContent = minimized ? "▶" : "▼";
        };

        const render = () => {
            const body = document.getElementById("ylh-dash-body");
            if (!body || minimized) return;

            const s = Stats.data;
            const rows = [
                ["⏱ Uptime",        Stats.getUptime()],
                ["🎬 Videos",        `${s.videosViewed} viewed / ${s.videosSkipped} skipped`],
                ["💰 Points (est)", `+${s.pointsEarned}`],
                ["🔤 Captchas",      `${s.captchasSolved}✅ / ${s.captchasFailed}❌`],
                ["🌐 Websites",      s.websitesVisited],
                ["🎵 Songs",         s.songsPlayed],
                ["🎁 Bonus",         s.bonusClaimed],
                ["🔄 Reloads",       s.reloads],
                ["⚠ Errors",        s.errors],
            ];

            body.innerHTML = rows.map(([label, value]) =>
                `<div class="ylh-dash-row">
                    <span class="ylh-dash-label">${label}</span>
                    <span class="ylh-dash-value">${value}</span>
                </div>`
            ).join("");

            // Update status
            const statusText = document.getElementById("ylh-dash-status-text");
            if (statusText) {
                statusText.textContent = BotState.paused ? "⏸ Paused" : `Running on ${document.location.pathname}`;
            }
            const pulse = container?.querySelector(".ylh-pulse");
            if (pulse) pulse.style.background = BotState.paused ? "#ffb74d" : "#66bb6a";
        };

        const destroy = () => {
            if (updateInterval) clearInterval(updateInterval);
            container?.remove();
            container = null;
        };

        return { create, render, destroy };
    })();

    // =========================================================================
    // BOT STATE — Central state management
    // =========================================================================
    const BotState = {
        paused:              false,
        previousVideoId:     "",
        mainLoopRef:         null,
        patienceTimers:      new Map(),
        scLastTimerValue:    null,
        scStaleChecks:       0,
    };

    // =========================================================================
    // PAGE HANDLERS — Modular handlers for each page type
    // =========================================================================

    /** LOGIN PAGE */
    const handleLogin = async () => {
        const passField = J("#password");
        if (passField.length && !passField.val()?.length) {
            Notifications.attach("#username", "Consider storing your login data in your browser.", "warning");
        }
        const captchaImg = J("img[alt='Enter The Numbers']");
        if (captchaImg.length) {
            await CaptchaSolver.solve(
                captchaImg[0],
                J("input[name='postcaptcha']"),
                "ylh_login"
            );
        }
    };

    /** BONUS POINTS PAGE */
    const handleBonusPoints = async () => {
        if (pageContains("You have made ") && pageContains(" Hits out of ")) {
            const reloadMs = randomMs(CONFIG.BONUS_RELOAD_MIN_SEC, CONFIG.BONUS_RELOAD_MAX_SEC);
            const reloadMin = Math.round(reloadMs / 60000);
            Notifications.attach(
                ".maintable",
                `Daily limit reached. Auto-reloading in ~${reloadMin} min to check again.`,
                "warning"
            );
            // Stop loop and schedule reload
            stopMainLoop();
            await SafeReload.reloadAfter(reloadMs, "Bonus daily limit");
        } else if (J(".buybutton").length) {
            Logger.info("Claiming bonus points...");
            Stats.increment("bonusClaimed");
            await safeClick(J(".buybutton").first());
        }
    };

    /** SOUNDCLOUD PLAYS PAGE */
    const handleSoundCloud = async () => {
        const timerSpan = J(".maintable span[id*='count']");
        const styleAttr = timerSpan.attr("style") || "";

        if (timerSpan.length && !styleAttr.includes("display:none")) {
            // Timer is visible — music might be playing, or stale
            const currentVal = timerSpan.text()?.trim();
            if (currentVal === BotState.scLastTimerValue) {
                BotState.scStaleChecks++;
                if (BotState.scStaleChecks > CONFIG.SC_STALE_TIMER_SEC) {
                    Logger.warn("SoundCloud timer appears stale, reloading...");
                    await SafeReload.reload("SoundCloud stale timer");
                    return;
                }
            } else {
                BotState.scStaleChecks = 0;
                BotState.scLastTimerValue = currentVal;
            }
            Notifications.attach(".maintable", "Music playing... waiting for completion.", "info", "sc_playing");
            return;
        }

        Notifications.remove("sc_playing");

        const buttons = J(".followbutton");
        if (buttons.length) {
            Logger.info("Starting SoundCloud play...");
            Stats.increment("songsPlayed");
            await safeClick(buttons.first());
        } else {
            Logger.warn("No SoundCloud follow button found");
            Notifications.attach(".maintable", "No tracks available. Waiting...", "warning");
        }
    };

    /** YOUTUBE PAGE — Primary earner */
    const handleYouTube = async () => {
        // No videos available
        if (J("#listall").length && pageContains("There are no videos available to view at this time")) {
            Logger.info("No YouTube videos available, reloading...");
            Notifications.attach("#listall", "No videos available. Reloading soon...", "warning", "yt_novids");
            await SafeReload.reloadAfter(CONFIG.YT_NO_VIDEOS_DELAY_MS, "No videos available");
            return;
        }

        // Captcha failure detection
        if (pageContains("failed") || pageContains("Failed")) {
            Logger.warn("Captcha failure detected, reloading...");
            await delay(CONFIG.YT_CAPTCHA_FAIL_DELAY);
            await SafeReload.reload("YouTube captcha failed");
            return;
        }

        const followButtons = J(".followbutton");

        if (followButtons.length) {
            // A video is available for viewing
            const getVidId = () => {
                return followButtons.first().parent().children("span[id*='count']").attr("id") || "";
            };

            const vidId = getVidId();

            if (vidId && vidId !== BotState.previousVideoId) {
                BotState.previousVideoId = vidId;

                // Extract points value
                const parentHtml = followButtons.first().parent().html() || "";
                const pointsMatch = parentHtml.match(/Points<\/b>:\s*(\d+)/);
                const points = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;

                // Extract video title for logging
                const titleEl = followButtons.first().parent().find("font[size='3']");
                const videoTitle = titleEl.length ? titleEl.text().trim() : "Unknown";

                Logger.info(`New video: "${videoTitle}" — ${points} points`);

                // Check if the popup window from YLH is closed or doesn't exist
                const winExists = typeof window.newWin !== "undefined";
                const winClosed = !winExists || window.newWin.closed;

                if (!winClosed) {
                    Logger.debug("Popup window still open, waiting...");
                    return;
                }

                if (points >= CONFIG.YT_MIN_POINTS) {
                    Logger.info(`Viewing video (${points} pts >= ${CONFIG.YT_MIN_POINTS} min)...`);
                    Stats.increment("videosViewed");
                    Stats.increment("pointsEarned", points);
                    await safeClick(followButtons.first());

                    // Set patience timer — auto-skip if video takes too long
                    setupPatienceTimer(vidId);
                } else {
                    Logger.info(`Skipping video (${points} pts < ${CONFIG.YT_MIN_POINTS} min)...`);
                    Stats.increment("videosSkipped");
                    const skipLink = followButtons.first().parent().children("a:contains('Skip')");
                    await safeClick(skipLink);
                }
            }
            // else: same video, waiting for it to finish or be replaced
        } else {
            // No follow button — likely a captcha
            const captchaImg = J("img[src*='captchayt']");
            if (captchaImg.length) {
                Logger.info("YouTube captcha detected, solving...");
                await CaptchaSolver.solve(
                    captchaImg[0],
                    J("input[name='answer']"),
                    "ylh_yt_captcha",
                    () => {
                        const submitBtn = J("input[value='Submit']").first();
                        if (submitBtn.length) submitBtn[0].click();
                    }
                );
            }
        }
    };

    /** Patience timer — auto-skip when a video exceeds max wait time */
    const setupPatienceTimer = (vidId) => {
        // Clear any existing patience timer
        if (BotState.patienceTimers.has(vidId)) return;

        const timerId = setTimeout(() => {
            const currentVidId = J(".followbutton").first().parent().children("span[id*='count']").attr("id") || "";
            if (currentVidId === vidId) {
                Logger.warn(`Patience expired for video ${vidId}, auto-skipping...`);
                const skipLink = J(".followbutton").first().parent().children("a:contains('Skip')");
                if (skipLink.length) skipLink[0].click();
                try { if (window.newWin && !window.newWin.closed) window.newWin.close(); } catch {}
            }
            BotState.patienceTimers.delete(vidId);
        }, CONFIG.YT_PATIENCE_SEC * 1000);

        BotState.patienceTimers.set(vidId, timerId);
    };

    /** WEBSITE TRAFFIC PAGE */
    const handleWebsites = async () => {
        const tabOpen = await GM.getValue("ylh_traffic_tab_open", false);

        if (pageContains("There are no Websites currently visitable for Points")) {
            alertOnce("All websites visited. Reload the page to start surfing again.");
            return;
        }

        // Close orphan child windows if tab state is inconsistent
        let childExists = false;
        try { childExists = typeof window.childWindow !== "undefined"; } catch {}

        if (!tabOpen && childExists) {
            try { if (!window.childWindow.closed) window.childWindow.close(); } catch {}
        } else if (tabOpen && !childExists) {
            Logger.info("Tab state mismatch — no child window exists. Resetting...");
            await GM.setValue("ylh_traffic_tab_open", false);
            return; // Will pick up on next loop iteration
        }

        const buttons = J(".followbutton:visible");
        if (buttons.length) {
            if (!tabOpen) {
                Logger.info("Visiting new website...");
                Stats.increment("websitesVisited");
                await GM.setValue("ylh_traffic_tab_open", true);
                await humanDelay();
                try {
                    buttons[0].onclick();
                } catch (e) {
                    Logger.error("Website click failed:", e.message);
                    await GM.setValue("ylh_traffic_tab_open", false);
                }
            }
            // else: waiting for current website visit to complete
        } else {
            // No more buttons — check if child is done, then reload
            let childClosed = true;
            try { childClosed = typeof window.childWindow === "undefined" || window.childWindow.closed; } catch {}
            if (childClosed) {
                Logger.info("No more website buttons, reloading for more...");
                await SafeReload.reload("Websites exhausted");
            }
        }
    };

    /** WEBSITE VIEW PAGE */
    const handleViewWebsite = async () => {
        if (pageContains("been logged out of YouLikeHits")) {
            alertOnce("Please reload the website list and make sure you are still logged in.");
            return;
        }

        const gotPoints = J(".alert:visible:contains('You got'):contains('Points')").length > 0;
        const notFound  = pageContains("We couldn't locate the website you're attempting to visit.");
        const reported  = pageContains("You have successfully reported");

        if (gotPoints || notFound || reported) {
            Logger.info("Website visit complete, freeing tab state...");
            await GM.setValue("ylh_traffic_tab_open", false);
            return;
        }

        if (pageContains("viewing websites too quickly! Please wait")) {
            Logger.warn("Rate limited on websites, waiting...");
            await SafeReload.reloadAfter(CONFIG.TRAFFIC_RATE_LIMIT_DELAY, "Website rate limit");
        }
    };

    // =========================================================================
    // ERROR RECOVERY — Global error handling
    // =========================================================================
    const handleGlobalErrors = () => {
        if (pageContains("503 Service Unavailable")) {
            Logger.error("503 Server Error detected!");
            Stats.increment("errors");
            SafeReload.reload("503 error");
            return true;
        }
        if (pageContains("not logged in!")) {
            Logger.warn("Session expired — redirecting to login...");
            window.location.href = "login.php";
            return true;
        }
        if (pageContains("Failed. You did not successfully solve the problem.")) {
            Logger.warn("Captcha failure detected, retrying...");
            const retryLink = J("a:contains('Try Again')");
            if (retryLink.length) retryLink[0].click();
            return true;
        }
        return false;
    };

    // =========================================================================
    // MAIN LOOP — Core orchestrator with jitter and error boundaries
    // =========================================================================
    const getLoopInterval = () => {
        return CONFIG.LOOP_INTERVAL_MS + randInt(-CONFIG.LOOP_JITTER_MS, CONFIG.LOOP_JITTER_MS);
    };

    const runMainLoop = async () => {
        if (BotState.paused) return;

        try {
            // Global error checks first
            if (handleGlobalErrors()) return;

            // Route to appropriate page handler
            const path = document.location.pathname;

            switch (path) {
                case "/login.php":
                    await handleLogin();
                    break;
                case "/bonuspoints.php":
                    await handleBonusPoints();
                    break;
                case "/soundcloudplays.php":
                    await handleSoundCloud();
                    break;
                case "/youtubenew2.php":
                case "/youtubelikes.php":
                case "/youtube2.php":
                    await handleYouTube();
                    break;
                case "/websites.php":
                    await handleWebsites();
                    break;
                case "/viewwebsite.php":
                    await handleViewWebsite();
                    break;
                default:
                    Logger.debug(`No handler for path: ${path}`);
                    break;
            }
        } catch (err) {
            Logger.error("Main loop error:", err.message, err.stack);
            Stats.increment("errors");
        }
    };

    const startMainLoop = () => {
        Logger.info("Starting main loop...");
        // Use dynamic interval with jitter
        const tick = () => {
            runMainLoop().finally(() => {
                BotState.mainLoopRef = setTimeout(tick, getLoopInterval());
            });
        };
        tick();
    };

    const stopMainLoop = () => {
        if (BotState.mainLoopRef) {
            clearTimeout(BotState.mainLoopRef);
            BotState.mainLoopRef = null;
            Logger.info("Main loop stopped.");
        }
    };

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    const init = async () => {
        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.info("  YLH Bot Pro v2.0.0 — Starting up...");
        Logger.info(`  Page: ${document.location.pathname}`);
        Logger.info(`  Min Points Filter: ${CONFIG.YT_MIN_POINTS}`);
        Logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Load persistent stats
        await Stats.load();

        // Create dashboard
        Dashboard.create();

        // Start the main loop
        startMainLoop();

        // Attach keyboard shortcut: Ctrl+Shift+P to toggle pause
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === "P") {
                e.preventDefault();
                const btn = document.getElementById("ylh-dash-pause");
                if (btn) btn.click();
            }
        });

        Logger.info("Bot initialized successfully. Happy earning! 🚀");
    };

    // Fire it up
    init().catch(err => {
        Logger.error("Initialization failed:", err.message);
    });

})();
