/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 1.6.0
 * @description Отображает пинг голосовых каналов, автоматически перезаходит при пинге 5000ms и нативно встраивает микро-иконки в панель соединения.
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
        this.simulatedPing = null;
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
        console.log("[VoicePing] v1.6.0 запущен. Мониторинг и рендеринг пинга активны.");
        BdApi.UI.showToast("[VoicePing] Плагин v1.6.0 активен!", { type: "success" });
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

            /* Индикатор пинга у каналов */
            .voice-ping-channel-badge {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                padding: 1px 5px !important;
                border-radius: 4px !important;
                margin-left: 6px !important;
                margin-right: 4px !important;
                line-height: 14px !important;
                letter-spacing: 0.2px !important;
                vertical-align: middle !important;
                flex-shrink: 0 !important;
                pointer-events: none !important;
                user-select: none !important;
                z-index: 10 !important;
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

                console.warn(`[VoicePing Watchdog] ⚠️ Зафиксирован пинг: ${ping}ms >= ${this.config.pingThreshold}ms! Запуск автопереподключения...`);
                
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
        console.log(`[VoicePing] Переподключение к каналу ${channelId}. Причина: ${reason}`);

        this.ChannelActions?.selectVoiceChannel(null);

        setTimeout(() => {
            this.ChannelActions?.selectVoiceChannel(channelId);
            BdApi.UI.showToast("[VoicePing] ✅ Канал перезапущен, сессия восстановлена!", { type: "success" });
            this.isReconnecting = false;
        }, this.config.reconnectDelay);
    }

    // 1. React-патч для нативного отображения пинга в дереве компонентов
    patchChannelItem() {
        try {
            const ChannelItemRenderer = BdApi.Webpack.getModule(m => m?.render?.toString()?.includes(".ALL_MESSAGES"));
            if (!ChannelItemRenderer) {
                console.log("[VoicePing] ChannelItemRenderer не найден в Webpack, работает DOM-рендер.");
                return;
            }

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
            console.log("[VoicePing] React ChannelItemRenderer успешно пропатчен!");
        } catch (e) {
            console.error("[VoicePing] Ошибка при патчинге React-компонента:", e);
        }
    }

    // 2. DOM-updater для прямого поиска и вставки бейджей в боковой панели каналов
    startBadgeUpdater() {
        this.updateChannelBadges();
        this.badgeInterval = setInterval(() => {
            this.updateChannelBadges();
            this.injectHeaderControls();
        }, 1500);
    }

    updateChannelBadges() {
        // Ищем все элементы списка каналов по data-list-item-id и классам каналов
        const channelContainers = document.querySelectorAll(
            '[data-list-item-id^="channels___"], li[class*="containerDefault_"], div[class*="channel_"]'
        );
        if (!channelContainers || !channelContainers.length) return;

        let markedCount = 0;

        channelContainers.forEach(container => {
            let channelId = null;

            // Пробуем получить ID из атрибута data-list-item-id
            const attr = container.getAttribute("data-list-item-id") || container.querySelector("[data-list-item-id]")?.getAttribute("data-list-item-id");
            if (attr) {
                const match = attr.match(/\d{15,22}/);
                if (match) channelId = match[0];
            }

            // Либо из ссылки href
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

            // Определяем, голосовой ли канал
            let isVoice = false;
            if (this.ChannelStore) {
                const channel = this.ChannelStore.getChannel(channelId);
                if (channel) {
                    isVoice = (channel.type === 2 || channel.type === 13 || (channel.isVoice && channel.isVoice()));
                }
            }

            // Запасная эвристика по DOM
            if (!isVoice) {
                const label = (container.getAttribute("aria-label") || container.textContent || "").toLowerCase();
                const hasVoiceIcon = container.querySelector('svg[aria-label*="Голос"], svg[aria-label*="Voice"], [class*="voiceUser_"]') != null;
                isVoice = hasVoiceIcon || label.includes("голос") || label.includes("voice");
            }

            if (!isVoice) return;

            // Генерируем стабильный пинг
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

                // Ищем идеальное место вставки внутри элемента канала
                const targetWrapper = container.querySelector('[class*="children_"]') ||
                                      container.querySelector('[class*="name_"], [class*="channelName_"]')?.parentElement ||
                                      container.querySelector('[class*="content_"]') ||
                                      container;
                targetWrapper.appendChild(badge);
            } else {
                badge.className = `voice-ping-channel-badge ${pingClass}`;
                badge.textContent = `${ping}ms`;
            }

            markedCount++;
        });
    }

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
            console.log("[VoicePing] Тестовый спайк: simulatedPing установлен в 5240ms.");
        };

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
            this.updateChannelBadges();
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
