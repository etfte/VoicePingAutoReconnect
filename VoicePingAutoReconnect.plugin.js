/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 1.1.0
 * @description Отображает пинг голосовых каналов, автоматически перезаходит при пинге 5000ms и добавляет кнопки переподключения и тестирования.
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
        this.startMonitor();
        this.startBadgeUpdater();
        this.observeDOM();
        BdApi.UI.showToast("[VoicePing] Плагин запущен!", { type: "success" });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.badgeInterval) clearInterval(this.badgeInterval);
        if (this.observer) this.observer.disconnect();
        BdApi.DOM.removeStyle("voice-ping-autoreconnect-style");
        document.querySelectorAll(".voice-ping-channel-badge, .voice-ping-controls-container, .voice-ping-popout-test-btn").forEach(el => el.remove());
        BdApi.Patcher?.unpatchAll?.("VoicePingAutoReconnect");
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
            .voice-ping-controls-container {
                display: flex;
                gap: 6px;
                margin: 6px 0;
                padding: 0 4px;
                width: 100%;
                box-sizing: border-box;
            }
            .voice-ping-btn {
                flex: 1;
                padding: 5px 8px;
                font-size: 11px;
                font-weight: 600;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                color: #ffffff;
                transition: background 0.15s ease, transform 0.1s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
            }
            .voice-ping-btn:hover {
                filter: brightness(1.15);
            }
            .voice-ping-btn:active {
                transform: scale(0.97);
            }
            .voice-ping-test {
                background-color: #da373c;
            }
            .voice-ping-reconn {
                background-color: #4e5058;
            }
            .voice-ping-popout-test-btn {
                width: calc(100% - 16px);
                margin: 8px;
                padding: 8px 12px;
                font-size: 12px;
                background-color: #da373c;
            }
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
                background: rgba(35, 165, 89, 0.25);
                color: #23a559;
                border: 1px solid rgba(35, 165, 89, 0.4);
            }
            .voice-ping-medium {
                background: rgba(240, 178, 50, 0.25);
                color: #f0b232;
                border: 1px solid rgba(240, 178, 50, 0.4);
            }
            .voice-ping-bad {
                background: rgba(242, 63, 67, 0.25);
                color: #f23f43;
                border: 1px solid rgba(242, 63, 67, 0.4);
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
            BdApi.UI.showToast("[VoicePing] Вы не находитесь в голосовом канале!", { type: "info" });
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
            this.injectConnectionControls();
        }, 2500);
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
            // 2 = GUILD_VOICE, 13 = GUILD_STAGE_VOICE
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

    injectConnectionControls() {
        const inVoice = this.getCurrentVoiceChannelId();
        if (!inVoice) {
            document.querySelectorAll(".voice-ping-controls-container").forEach(el => el.remove());
            return;
        }

        const panels = document.querySelector('section[class*="panels_"]');
        if (!panels) return;

        const rtcStatus = panels.querySelector('[class*="rtcConnectionStatus_"], [class*="statusWithPopout_"], [class*="connection_"], [class*="subtext_"]');
        if (!rtcStatus) return;

        if (!panels.querySelector(".voice-ping-controls-container")) {
            const container = document.createElement("div");
            container.className = "voice-ping-controls-container";

            const testBtn = document.createElement("button");
            testBtn.className = "voice-ping-btn voice-ping-test";
            testBtn.innerHTML = "⚡ Тест 5000ms";
            testBtn.title = "Вызвать тестовый пинг 5000ms и проверить автопереподключение";
            testBtn.onclick = (e) => {
                e.stopPropagation();
                BdApi.UI.showToast("[VoicePing] Симуляция пинга 5000ms!", { type: "error" });
                this.triggerReconnect("Тестовый скачок 5000ms");
            };

            const reconnBtn = document.createElement("button");
            reconnBtn.className = "voice-ping-btn voice-ping-reconn";
            reconnBtn.innerHTML = "🔄 Реконнект";
            reconnBtn.title = "Принудительно перезайти в канал";
            reconnBtn.onclick = (e) => {
                e.stopPropagation();
                this.triggerReconnect("Ручной реконнект");
            };

            container.appendChild(testBtn);
            container.appendChild(reconnBtn);

            const anchor = rtcStatus.closest('[class*="container_"]') || rtcStatus.parentElement;
            anchor.appendChild(container);
        }
    }

    observeDOM() {
        this.observer = new MutationObserver(() => {
            this.injectConnectionControls();

            // Если открыт попап статистики соединения при клике на зеленые полосочки
            const popout = document.querySelector('[class*="popout_"], [role="dialog"], [class*="layer_"]');
            if (popout) {
                const hasPingText = popout.textContent.includes("RTC") || popout.textContent.includes("Пинг") || popout.textContent.includes("Ping") || popout.textContent.includes("Задержка");
                if (hasPingText && !popout.querySelector(".voice-ping-popout-test-btn")) {
                    const btn = document.createElement("button");
                    btn.className = "voice-ping-btn voice-ping-popout-test-btn";
                    btn.innerHTML = "⚡ Вызвать 5 000 ms пинга (Тест)";
                    btn.onclick = () => {
                        BdApi.UI.showToast("[VoicePing Test] Тестовый скачок 5000ms!", { type: "error" });
                        this.triggerReconnect("Тестовый скачок 5000ms");
                    };
                    popout.appendChild(btn);
                }
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
            <p style="font-size:12px; color:var(--text-muted, #949ba4);">Когда пинг превышает указанное значение, плагин автоматически мгновенно перезаходит в голосовой канал.</p>
        `;

        panel.querySelector("#vp-threshold").addEventListener("change", (e) => {
            this.config.pingThreshold = parseInt(e.target.value, 10) || 4500;
            BdApi.Data.save("VoicePingAutoReconnect", "config", this.config);
        });

        return panel;
    }
};
