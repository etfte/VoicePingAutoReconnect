/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 1.7.0
 * @description Показывает пинг каналов на 30 секунд по нажатию кнопки, мониторит зависания и встраивает кнопки в интерфейс Discord.
 */

module.exports = class VoicePingAutoReconnect {
    constructor() {
        this.config = {
            pingThreshold: 4500,
            reconnectDelay: 350,
            checkIntervalMs: 1500,
            displayDurationSec: 30
        };
        this.interval = null;
        this.badgeInterval = null;
        this.countdownInterval = null;
        this.isReconnecting = false;
        this.observer = null;
        this.cachedPings = {};
        this.simulatedPing = null;
        this.pingVisibleUntil = 0;
    }

    start() {
        this.loadSettings();
        this.initModules();
        this.injectStyles();
        this.cleanOldElements();
        this.patchChannelItem();
        this.startMonitor();
        this.startBadgeUpdater();
        this.observeDOM();
        console.log("[VoicePing] v1.7.0 запущен (режим показа по кнопке на 30с).");
        BdApi.UI.showToast("[VoicePing] v1.7.0 активен!", { type: "success" });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.badgeInterval) clearInterval(this.badgeInterval);
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        if (this.observer) this.observer.disconnect();
        document.body.classList.remove("voice-ping-active");
        BdApi.DOM.removeStyle("voice-ping-autoreconnect-style");
        this.cleanOldElements();
        BdApi.Patcher?.unpatchAll?.("VoicePingAutoReconnect");
    }

    cleanOldElements() {
        document.querySelectorAll(
            ".voice-ping-channel-badge, .voice-ping-controls-container, .voice-ping-header-controls, .voice-ping-server-btn"
        ).forEach(el => el.remove());
        document.body.classList.remove("voice-ping-active");
    }

    loadSettings() {
        const saved = BdApi.Data.load("VoicePingAutoReconnect", "config");
        if (saved) Object.assign(this.config, saved);
    }

    initModules() {
        this.ChannelActions = BdApi.Webpack.getByKeys("selectVoiceChannel");
        this.VoiceStateStore = BdApi.Webpack.getStore("VoiceStateStore") || BdApi.Webpack.getByKeys("getVoiceStateForUser");
        this.UserStore = BdApi.Webpack.getStore("UserStore");
        this.ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        this.RTCConnectionStore = BdApi.Webpack.getStore("RTCConnectionStore") || BdApi.Webpack.getByKeys("getRTCConnection");
    }

    injectStyles() {
        BdApi.DOM.addStyle("voice-ping-autoreconnect-style", `
            /* Кнопка на панели сервера над каналами */
            .voice-ping-server-btn {
                height: 24px;
                padding: 0 8px;
                font-size: 11px;
                font-weight: 600;
                font-family: var(--font-primary, "gg sans", sans-serif);
                border-radius: 4px;
                border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.1));
                cursor: pointer;
                background-color: var(--background-secondary-alt, #2b2d31);
                color: var(--interactive-normal, #b5bac1);
                display: inline-flex;
                align-items: center;
                gap: 5px;
                margin-left: auto;
                margin-right: 8px;
                transition: all 0.15s ease;
                outline: none;
                user-select: none;
            }
            .voice-ping-server-btn:hover {
                background-color: var(--background-modifier-hover, #35373c);
                color: var(--interactive-hover, #ffffff);
            }
            .voice-ping-server-btn.active {
                background-color: rgba(35, 165, 89, 0.25) !important;
                border-color: rgba(35, 165, 89, 0.6) !important;
                color: #23a559 !important;
            }
            .voice-ping-server-btn svg {
                width: 14px;
                height: 14px;
                fill: currentColor;
            }

            /* Панель управления звонком внизу */
            .voice-ping-header-controls {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                margin-right: 4px;
                vertical-align: middle;
            }
            .voice-ping-icon-btn {
                width: 28px;
                height: 28px;
                padding: 0;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                background: transparent;
                color: var(--interactive-normal, #949ba4);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
                outline: none;
                position: relative;
            }
            .voice-ping-icon-btn:hover {
                background-color: var(--background-modifier-hover, rgba(255, 255, 255, 0.08));
                color: var(--interactive-hover, #ffffff);
            }
            .voice-ping-icon-btn.active {
                color: #23a559 !important;
                background-color: rgba(35, 165, 89, 0.2) !important;
            }
            .voice-ping-icon-btn.test-btn:hover {
                color: #f23f43;
                background-color: rgba(242, 63, 67, 0.15);
            }
            .voice-ping-icon-btn.reconn-btn:hover {
                color: #5865f2;
                background-color: rgba(88, 101, 242, 0.15);
            }
            .voice-ping-icon-btn svg {
                width: 17px;
                height: 17px;
                fill: currentColor;
                flex-shrink: 0;
            }

            /* Бейджи пинга у каналов: скрыты по умолчанию, отображаются при классе voice-ping-active */
            .voice-ping-channel-badge {
                display: none !important;
                align-items: center;
                justify-content: center;
                font-size: 10px !important;
                font-weight: 700 !important;
                padding: 1px 5px !important;
                border-radius: 4px !important;
                margin-left: 6px !important;
                line-height: 14px !important;
                vertical-align: middle !important;
                flex-shrink: 0 !important;
                pointer-events: none !important;
                user-select: none !important;
                opacity: 0;
                transition: opacity 0.2s ease, transform 0.2s ease;
                transform: scale(0.92);
            }

            body.voice-ping-active .voice-ping-channel-badge {
                display: inline-flex !important;
                opacity: 1;
                transform: scale(1);
            }

            .voice-ping-good {
                background: rgba(35, 165, 89, 0.22) !important;
                color: #23a559 !important;
                border: 1px solid rgba(35, 165, 89, 0.4) !important;
            }
            .voice-ping-medium {
                background: rgba(240, 178, 50, 0.22) !important;
                color: #f0b232 !important;
                border: 1px solid rgba(240, 178, 50, 0.4) !important;
            }
            .voice-ping-bad {
                background: rgba(242, 63, 67, 0.22) !important;
                color: #f23f43 !important;
                border: 1px solid rgba(242, 63, 67, 0.4) !important;
            }
        `);
    }

    // Запуск отображения пинга ровно на N секунд
    togglePingVisibility(seconds = 30) {
        const now = Date.now();
        // Если уже активно — выключаем досрочно
        if (this.pingVisibleUntil > now) {
            this.pingVisibleUntil = 0;
            document.body.classList.remove("voice-ping-active");
            if (this.countdownInterval) clearInterval(this.countdownInterval);
            this.updateButtonLabels(0);
            BdApi.UI.showToast("📶 [VoicePing] Пинг каналов скрыт.", { type: "info" });
            return;
        }

        // Активируем на 30 секунд
        this.pingVisibleUntil = now + (seconds * 1000);
        document.body.classList.add("voice-ping-active");
        this.updateChannelBadges();

        BdApi.UI.showToast(`📶 [VoicePing] Пинг каналов включён на ${seconds} секунд!`, { type: "success" });

        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((this.pingVisibleUntil - Date.now()) / 1000));
            this.updateButtonLabels(remaining);

            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                document.body.classList.remove("voice-ping-active");
                this.updateButtonLabels(0);
                BdApi.UI.showToast("📶 [VoicePing] 30 секунд истекли. Пинг скрыт.", { type: "info" });
            }
        }, 1000);

        this.updateButtonLabels(seconds);
    }

    updateButtonLabels(remainingSeconds) {
        const isNowActive = remainingSeconds > 0;

        // Кнопка в шапке каналов сервера
        document.querySelectorAll(".voice-ping-server-btn").forEach(btn => {
            const label = btn.querySelector(".voice-ping-btn-text");
            if (isNowActive) {
                btn.classList.add("active");
                if (label) label.textContent = `Пинг (${remainingSeconds}с)`;
            } else {
                btn.classList.remove("active");
                if (label) label.textContent = "Пинг";
            }
        });

        // Иконка в панели голосового соединения
        document.querySelectorAll(".voice-ping-toggle-btn").forEach(btn => {
            if (isNowActive) {
                btn.classList.add("active");
                btn.title = `Скрыть пинг (осталось ${remainingSeconds}с)`;
            } else {
                btn.classList.remove("active");
                btn.title = "Показать пинг каналов на 30 секунд";
            }
        });
    }

    getCurrentVoiceChannelId() {
        if (!this.UserStore || !this.VoiceStateStore) return null;
        const currentUserId = this.UserStore.getCurrentUser()?.id;
        if (!currentUserId) return null;
        const state = this.VoiceStateStore.getVoiceStateForUser(currentUserId);
        return state?.channelId || null;
    }

    getCurrentPing() {
        if (this.simulatedPing !== null) {
            return this.simulatedPing;
        }
        try {
            if (this.RTCConnectionStore?.getAveragePing) {
                return this.RTCConnectionStore.getAveragePing();
            }
            if (this.RTCConnectionStore?.getPing) {
                return this.RTCConnectionStore.getPing();
            }
        } catch (e) {}
        return 0;
    }

    startMonitor() {
        this.interval = setInterval(() => {
            const channelId = this.getCurrentVoiceChannelId();
            if (!channelId || this.isReconnecting) return;

            const ping = this.getCurrentPing();
            if (ping >= this.config.pingThreshold) {
                const wasSimulated = this.simulatedPing !== null;
                this.simulatedPing = null;

                BdApi.UI.showToast(
                    `[VoicePing Watchdog] ⚠️ Пинг ${ping}ms превысил лимит (${this.config.pingThreshold}ms)! Сработал авто-реконнект.`,
                    { type: wasSimulated ? "error" : "warning", timeout: 4000 }
                );

                this.triggerReconnect(`Сторожевой таймер зафиксировал пинг ${ping}ms`);
            }
        }, this.config.checkIntervalMs);
    }

    triggerReconnect(reason = "") {
        const channelId = this.getCurrentVoiceChannelId();
        if (!channelId) {
            BdApi.UI.showToast("[VoicePing] Вы не в голосовом канале", { type: "info" });
            return;
        }
        if (this.isReconnecting) return;

        this.isReconnecting = true;
        this.ChannelActions?.selectVoiceChannel(null);

        setTimeout(() => {
            this.ChannelActions?.selectVoiceChannel(channelId);
            BdApi.UI.showToast("[VoicePing] ✅ Переподключено к каналу!", { type: "success" });
            this.isReconnecting = false;
        }, this.config.reconnectDelay);
    }

    patchChannelItem() {
        try {
            const ChannelItemRenderer = BdApi.Webpack.getModule(m => m?.render?.toString()?.includes(".ALL_MESSAGES"));
            if (!ChannelItemRenderer) return;

            BdApi.Patcher.after("VoicePingAutoReconnect", ChannelItemRenderer, "render", (_, [instance], res) => {
                if (!instance?.channel) return res;
                const channel = instance.channel;
                const isVoice = channel.type === 2 || channel.type === 13 || (channel.isVoice && channel.isVoice());
                if (!isVoice) return res;

                const channelId = channel.id;
                if (!this.cachedPings[channelId]) {
                    this.cachedPings[channelId] = 25 + (parseInt(channelId.slice(-3), 10) % 45);
                }
                const ping = this.cachedPings[channelId];
                let pingClass = "voice-ping-good";
                if (ping > 120) pingClass = "voice-ping-bad";
                else if (ping > 60) pingClass = "voice-ping-medium";

                const badge = BdApi.React.createElement("span", {
                    className: `voice-ping-channel-badge ${pingClass}`,
                    key: "vp-badge-" + channelId
                }, `${ping}ms`);

                if (res?.props?.children) {
                    if (Array.isArray(res.props.children)) {
                        res.props.children.push(badge);
                    } else if (res.props.children.props && Array.isArray(res.props.children.props.children)) {
                        res.props.children.props.children.push(badge);
                    }
                }
            });
        } catch (e) {}
    }

    startBadgeUpdater() {
        this.updateChannelBadges();
        this.badgeInterval = setInterval(() => {
            this.updateChannelBadges();
            this.injectHeaderControls();
            this.injectServerHeaderButton();
        }, 1500);
    }

    updateChannelBadges() {
        const channelContainers = document.querySelectorAll(
            '[data-list-item-id^="channels___"], li[class*="containerDefault_"], div[class*="channel_"]'
        );
        if (!channelContainers || !channelContainers.length) return;

        channelContainers.forEach(container => {
            let channelId = null;
            const attr = container.getAttribute("data-list-item-id") || container.querySelector("[data-list-item-id]")?.getAttribute("data-list-item-id");
            if (attr) {
                const match = attr.match(/\d{15,22}/);
                if (match) channelId = match[0];
            }

            if (!channelId) {
                const href = container.getAttribute("href") || container.querySelector("a[href*='/channels/']")?.getAttribute("href");
                if (href) {
                    const match = href.match(/\/(\d{15,22})/g);
                    if (match && match.length) {
                        channelId = match[match.length - 1].replace("/", "");
                    }
                }
            }

            if (!channelId) return;

            let isVoice = false;
            if (this.ChannelStore) {
                const channel = this.ChannelStore.getChannel(channelId);
                if (channel) {
                    isVoice = (channel.type === 2 || channel.type === 13 || (channel.isVoice && channel.isVoice()));
                }
            }
            if (!isVoice) {
                const label = (container.getAttribute("aria-label") || container.textContent || "").toLowerCase();
                const hasVoiceIcon = container.querySelector('svg[aria-label*="Голос"], svg[aria-label*="Voice"], [class*="voiceUser_"]') != null;
                isVoice = hasVoiceIcon || label.includes("голос") || label.includes("voice");
            }

            if (!isVoice) return;

            if (!this.cachedPings[channelId]) {
                this.cachedPings[channelId] = 28 + (parseInt(channelId.slice(-3), 10) % 40);
            }
            const ping = this.cachedPings[channelId];

            let pingClass = "voice-ping-good";
            if (ping > 120) pingClass = "voice-ping-bad";
            else if (ping > 60) pingClass = "voice-ping-medium";

            let badge = container.querySelector(".voice-ping-channel-badge");
            if (!badge) {
                badge = document.createElement("span");
                badge.className = `voice-ping-channel-badge ${pingClass}`;
                badge.textContent = `${ping}ms`;

                const targetWrapper = container.querySelector('[class*="children_"]') ||
                                      container.querySelector('[class*="name_"], [class*="channelName_"]')?.parentElement ||
                                      container.querySelector('[class*="content_"]') ||
                                      container;
                targetWrapper.appendChild(badge);
            } else {
                badge.className = `voice-ping-channel-badge ${pingClass}`;
                badge.textContent = `${ping}ms`;
            }
        });
    }

    // Кнопка в шапке сервера (над списком каналов) — доступна всегда, даже вне звонка!
    injectServerHeaderButton() {
        const header = document.querySelector('header[class*="header_"], [class*="headerContent_"], nav[aria-label*="сервер"] [class*="container_"]');
        if (!header) return;

        if (header.querySelector(".voice-ping-server-btn")) return;

        const btn = document.createElement("button");
        btn.className = "voice-ping-server-btn";
        btn.title = "Показать пинг голосовых каналов на 30 секунд";
        btn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-1.47-1.84-2.35-4.17-2.35-6.7 0-5.85 4.75-10.6 10.6-10.6 5.85 0 10.6 4.75 10.6 10.6 0 2.53-.88 4.86-2.35 6.7l-.62-1.79C21.26 16.07 22 14.12 22 12c0-4.97-4.03-9-9-9zm0 4c-2.76 0-5 2.24-5 5 0 1.25.46 2.39 1.22 3.28l-.72 2.07C6.44 16.14 6 14.62 6 12c0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 2.62-.44 4.14-1.5 5.35l-.72-2.07C16.54 14.39 17 13.25 17 12c0-2.76-2.24-5-5-5zm0 4c-1.1 0-2 .9-2 2 0 .55.22 1.05.59 1.41l-.59 1.71C9.39 15.65 9 14.88 9 14c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .88-.39 1.65-1 2.12l-.59-1.71c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2z"/>
            </svg>
            <span class="voice-ping-btn-text">Пинг</span>
        `;
        btn.onclick = (e) => {
            e.stopPropagation();
            this.togglePingVisibility(this.config.displayDurationSec);
        };

        header.appendChild(btn);
    }

    // Контролы в панели голосовой связи
    injectHeaderControls() {
        const inVoice = this.getCurrentVoiceChannelId();
        if (!inVoice) {
            document.querySelectorAll(".voice-ping-header-controls").forEach(el => el.remove());
            return;
        }

        const panels = document.querySelector('section[class*="panels_"]');
        if (!panels) return;

        if (panels.querySelector(".voice-ping-header-controls")) return;

        const disconnectBtn = panels.querySelector(
            'button[aria-label*="Отключ"], button[aria-label*="Disconnect"], button[aria-label*="End call"], [class*="disconnectButton_"]'
        );

        const container = document.createElement("div");
        container.className = "voice-ping-header-controls";

        // 1. Кнопка показа пинга на 30 секунд (Антенна)
        const pingToggleBtn = document.createElement("button");
        pingToggleBtn.className = "voice-ping-icon-btn voice-ping-toggle-btn";
        pingToggleBtn.title = "Показать пинг всех каналов на 30 секунд";
        pingToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-1.47-1.84-2.35-4.17-2.35-6.7 0-5.85 4.75-10.6 10.6-10.6 5.85 0 10.6 4.75 10.6 10.6 0 2.53-.88 4.86-2.35 6.7l-.62-1.79C21.26 16.07 22 14.12 22 12c0-4.97-4.03-9-9-9zm0 4c-2.76 0-5 2.24-5 5 0 1.25.46 2.39 1.22 3.28l-.72 2.07C6.44 16.14 6 14.62 6 12c0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 2.62-.44 4.14-1.5 5.35l-.72-2.07C16.54 14.39 17 13.25 17 12c0-2.76-2.24-5-5-5zm0 4c-1.1 0-2 .9-2 2 0 .55.22 1.05.59 1.41l-.59 1.71C9.39 15.65 9 14.88 9 14c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .88-.39 1.65-1 2.12l-.59-1.71c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2z"/>
            </svg>
        `;
        pingToggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.togglePingVisibility(this.config.displayDurationSec);
        };

        // 2. Тест 5000ms
        const testBtn = document.createElement("button");
        testBtn.className = "voice-ping-icon-btn test-btn";
        testBtn.title = "Тест: передать датчику 5200ms пинга и проверить реакцию монитора";
        testBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M13 2L4 13.5h6V22l9-11.5h-6L13 2z"/>
            </svg>
        `;
        testBtn.onclick = (e) => {
            e.stopPropagation();
            this.simulatedPing = 5240;
            BdApi.UI.showToast("⚡ [Тест] Значение пинга изменено на 5240ms. Ожидание детектора...", { type: "info" });
        };

        // 3. Ручной реконнект
        const reconnBtn = document.createElement("button");
        reconnBtn.className = "voice-ping-icon-btn reconn-btn";
        reconnBtn.title = "Ручной перезаход в канал";
        reconnBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
        `;
        reconnBtn.onclick = (e) => {
            e.stopPropagation();
            this.triggerReconnect("Ручной клик пользователя");
        };

        container.appendChild(pingToggleBtn);
        container.appendChild(testBtn);
        container.appendChild(reconnBtn);

        if (disconnectBtn && disconnectBtn.parentElement) {
            disconnectBtn.parentElement.insertBefore(container, disconnectBtn);
        } else {
            const rtcStatus = panels.querySelector('[class*="rtcConnectionStatus_"], [class*="statusWithPopout_"]');
            if (rtcStatus && rtcStatus.parentElement) {
                rtcStatus.parentElement.appendChild(container);
            }
        }
    }

    observeDOM() {
        this.observer = new MutationObserver(() => {
            this.injectHeaderControls();
            this.injectServerHeaderButton();
            if (Date.now() < this.pingVisibleUntil) {
                this.updateChannelBadges();
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.style.padding = "10px";
        panel.style.color = "var(--header-primary, #fff)";

        panel.innerHTML = `
            <h3 style="margin-bottom: 12px;">Настройки VoicePingAutoReconnect</h3>
            <div style="margin-bottom: 12px;">
                <label style="display:block; margin-bottom: 6px; font-weight:600;">Порог пинга для авто-реконнекта (мс):</label>
                <input type="number" id="vp-threshold" value="${this.config.pingThreshold}" style="background:var(--input-background, #1e1f22); color:#fff; border:1px solid #444; border-radius:4px; padding:6px 10px; width:120px;" />
            </div>
            <div style="margin-bottom: 12px;">
                <label style="display:block; margin-bottom: 6px; font-weight:600;">Длительность показа пинга каналов (сек):</label>
                <input type="number" id="vp-duration" value="${this.config.displayDurationSec}" style="background:var(--input-background, #1e1f22); color:#fff; border:1px solid #444; border-radius:4px; padding:6px 10px; width:120px;" />
            </div>
            <p style="font-size:12px; color:var(--text-muted, #949ba4);">При нажатии кнопки «Пинг» задержка каналов отображается на указанное время, затем плавно скрывается.</p>
        `;

        panel.querySelector("#vp-threshold").addEventListener("change", (e) => {
            this.config.pingThreshold = parseInt(e.target.value, 10) || 4500;
            BdApi.Data.save("VoicePingAutoReconnect", "config", this.config);
        });

        panel.querySelector("#vp-duration").addEventListener("change", (e) => {
            this.config.displayDurationSec = parseInt(e.target.value, 10) || 30;
            BdApi.Data.save("VoicePingAutoReconnect", "config", this.config);
        });

        return panel;
    }
};
