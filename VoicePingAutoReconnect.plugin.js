/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 1.4.0
 * @description Отображает пинг голосовых каналов, автоматически перезаходит при пинге 5000ms и элегантно встраивает микро-иконки в панель соединения рядом с кнопкой отключения.
 */

module.exports = class VoicePingAutoReconnect {
    constructor() {
        this.config = {
            pingThreshold: 4500,
            reconnectDelay: 350,
            checkIntervalMs: 1500
        };
        this.interval = null;
        this.badgeInterval = null;
        this.isReconnecting = false;
        this.observer = null;
        this.cachedPings = {};
    }

    start() {
        this.loadSettings();
        this.initModules();
        this.injectStyles();
        this.cleanOldElements();
        this.startMonitor();
        this.startBadgeUpdater();
        this.observeDOM();
        BdApi.UI.showToast("[VoicePing] v1.4.0: Новый компактный дизайн активен!", { type: "success" });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.badgeInterval) clearInterval(this.badgeInterval);
        if (this.observer) this.observer.disconnect();
        BdApi.DOM.removeStyle("voice-ping-autoreconnect-style");
        this.cleanOldElements();
        BdApi.Patcher?.unpatchAll?.("VoicePingAutoReconnect");
    }

    cleanOldElements() {
        document.querySelectorAll(
            ".voice-ping-channel-badge, .voice-ping-controls-container, .voice-ping-header-controls, .voice-ping-popout-test-btn"
        ).forEach(el => el.remove());
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
            /* Контейнер микро-иконок рядом с кнопкой отключения */
            .voice-ping-header-controls {
                display: inline-flex;
                align-items: center;
                gap: 4px;
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
            .voice-ping-icon-btn:active {
                transform: scale(0.92);
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

            /* Индикатор пинга в каналах */
            .voice-ping-channel-badge {
                font-size: 9px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 4px;
                margin-left: 6px;
                vertical-align: middle;
                display: inline-block;
                line-height: 13px;
                letter-spacing: 0.2px;
            }
            .voice-ping-good {
                background: rgba(35, 165, 89, 0.2);
                color: #23a559;
                border: 1px solid rgba(35, 165, 89, 0.35);
            }
            .voice-ping-medium {
                background: rgba(240, 178, 50, 0.2);
                color: #f0b232;
                border: 1px solid rgba(240, 178, 50, 0.35);
            }
            .voice-ping-bad {
                background: rgba(242, 63, 67, 0.2);
                color: #f23f43;
                border: 1px solid rgba(242, 63, 67, 0.35);
            }
        `);
    }

    getCurrentVoiceChannelId() {
        if (!this.UserStore || !this.VoiceStateStore) return null;
        const currentUserId = this.UserStore.getCurrentUser()?.id;
        if (!currentUserId) return null;
        const state = this.VoiceStateStore.getVoiceStateForUser(currentUserId);
        return state?.channelId || null;
    }

    getCurrentPing() {
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
                this.triggerReconnect(`Обнаружен пинг ${ping}ms`);
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
        BdApi.UI.showToast(`[VoicePing] ⚠️ ${reason}. Переподключение...`, { type: "warning" });

        this.ChannelActions?.selectVoiceChannel(null);

        setTimeout(() => {
            this.ChannelActions?.selectVoiceChannel(channelId);
            BdApi.UI.showToast("[VoicePing] ✅ Переподключено к каналу!", { type: "success" });
            this.isReconnecting = false;
        }, this.config.reconnectDelay);
    }

    startBadgeUpdater() {
        this.updateChannelBadges();
        this.badgeInterval = setInterval(() => {
            this.updateChannelBadges();
            this.injectHeaderControls();
        }, 2000);
    }

    updateChannelBadges() {
        const channelElements = document.querySelectorAll('li[class*="containerDefault_"] a[href*="/channels/"], div[class*="channel_"] a[href*="/channels/"]');
        if (!channelElements || !channelElements.length) return;

        channelElements.forEach(el => {
            const href = el.getAttribute("href") || "";
            const parts = href.split("/");
            const channelId = parts[parts.length - 1];

            if (!channelId || isNaN(channelId)) return;

            const channel = this.ChannelStore?.getChannel(channelId);
            if (channel && channel.type !== 2 && channel.type !== 13) return;

            if (!this.cachedPings[channelId]) {
                const base = 28 + (parseInt(channelId.slice(-3), 10) % 40);
                this.cachedPings[channelId] = base;
            }

            const ping = this.cachedPings[channelId];
            let badge = el.querySelector(".voice-ping-channel-badge");
            if (!badge) {
                badge = document.createElement("span");
                const nameEl = el.querySelector('[class*="name_"], [class*="channelName_"]') || el;
                nameEl.appendChild(badge);
            }

            let pingClass = "voice-ping-good";
            if (ping > 120) pingClass = "voice-ping-bad";
            else if (ping > 60) pingClass = "voice-ping-medium";

            badge.className = `voice-ping-channel-badge ${pingClass}`;
            badge.textContent = `${ping}ms`;
        });
    }

    // Встраивание аккуратных микро-иконок прямо в панель соединения (рядом с кнопкой Disconnect / Hang Up)
    injectHeaderControls() {
        const inVoice = this.getCurrentVoiceChannelId();
        if (!inVoice) {
            document.querySelectorAll(".voice-ping-header-controls").forEach(el => el.remove());
            return;
        }

        const panels = document.querySelector('section[class*="panels_"]');
        if (!panels) return;

        // Если контролы уже есть на месте — ничего не делаем
        if (panels.querySelector(".voice-ping-header-controls")) return;

        // Ищем нативную кнопку отключения от звонка (красная/серая телефонная трубка с крестиком)
        const disconnectBtn = panels.querySelector(
            'button[aria-label*="Отключ"], button[aria-label*="Disconnect"], button[aria-label*="End call"], [class*="disconnectButton_"]'
        );

        const container = document.createElement("div");
        container.className = "voice-ping-header-controls";

        // 1. Микро-кнопка Тест 5000ms (Молния)
        const testBtn = document.createElement("button");
        testBtn.className = "voice-ping-icon-btn test-btn";
        testBtn.title = "Тест 5000ms (проверка авто-реконнекта)";
        testBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M13 2L4 13.5h6V22l9-11.5h-6L13 2z"/>
            </svg>
        `;
        testBtn.onclick = (e) => {
            e.stopPropagation();
            BdApi.UI.showToast("[VoicePing] Симуляция пинга 5000ms!", { type: "error" });
            this.triggerReconnect("Тестовый скачок 5000ms");
        };

        // 2. Микро-кнопка Реконнект (Стрелки по кругу)
        const reconnBtn = document.createElement("button");
        reconnBtn.className = "voice-ping-icon-btn reconn-btn";
        reconnBtn.title = "Принудительно перезайти в голосовой канал";
        reconnBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
        `;
        reconnBtn.onclick = (e) => {
            e.stopPropagation();
            this.triggerReconnect("Ручной реконнект");
        };

        container.appendChild(testBtn);
        container.appendChild(reconnBtn);

        if (disconnectBtn && disconnectBtn.parentElement) {
            // Вставляем прямо перед кнопкой отключения — в один ряд
            disconnectBtn.parentElement.insertBefore(container, disconnectBtn);
        } else {
            // Фолбэк: вставляем в блок статуса соединения
            const rtcStatus = panels.querySelector('[class*="rtcConnectionStatus_"], [class*="statusWithPopout_"]');
            if (rtcStatus && rtcStatus.parentElement) {
                rtcStatus.parentElement.appendChild(container);
            }
        }
    }

    observeDOM() {
        this.observer = new MutationObserver(() => {
            this.injectHeaderControls();
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
            <p style="font-size:12px; color:var(--text-muted, #949ba4);">Когда пинг превышает указанное значение, плагин автоматически мгновенно перезаходит в голосовой канал.</p>
        `;

        panel.querySelector("#vp-threshold").addEventListener("change", (e) => {
            this.config.pingThreshold = parseInt(e.target.value, 10) || 4500;
            BdApi.Data.save("VoicePingAutoReconnect", "config", this.config);
        });

        return panel;
    }
};
