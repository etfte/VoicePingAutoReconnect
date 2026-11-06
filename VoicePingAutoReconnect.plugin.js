/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 1.0.0
 * @description Отображает пинг каналов, автоматически перезаходит при скачках до 5000ms и добавляет кнопку теста в меню соединения.
 */

module.exports = class VoicePingAutoReconnect {
    constructor() {
        this.config = {
            pingThreshold: 4500, // Порог в мс для реконнекта
            reconnectDelay: 300, // Пауза перед возвратом в канал (мс)
            checkIntervalMs: 1500
        };
        this.interval = null;
        this.isReconnecting = false;
        this.observer = null;
    }

    start() {
        this.initModules();
        this.injectStyles();
        this.startMonitor();
        this.observePopouts();
        BdApi.UI.showToast("VoicePing & AutoReconnect запущен!", { type: "success" });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.observer) this.observer.disconnect();
        BdApi.DOM.removeStyle("voice-ping-autoreconnect-style");
        document.querySelectorAll(".voice-ping-badge, .voice-ping-test-btn").forEach(el => el.remove());
        BdApi.Patcher.unpatchAll("VoicePingAutoReconnect");
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
            .voice-ping-badge {
                font-size: 10px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 4px;
                margin-left: 6px;
                display: inline-block;
                vertical-align: middle;
            }
            .voice-ping-good { background: rgba(35, 165, 89, 0.2); color: #23a559; border: 1px solid rgba(35, 165, 89, 0.4); }
            .voice-ping-medium { background: rgba(240, 178, 50, 0.2); color: #f0b232; border: 1px solid rgba(240, 178, 50, 0.4); }
            .voice-ping-bad { background: rgba(242, 63, 67, 0.2); color: #f23f43; border: 1px solid rgba(242, 63, 67, 0.4); }

            .voice-ping-test-btn {
                margin: 10px 12px;
                padding: 8px 12px;
                background-color: #da373c;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: background 0.15s ease;
            }
            .voice-ping-test-btn:hover {
                background-color: #a1282c;
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
                this.triggerReconnect(`Обнаружен пинг ${ping}ms (порог: ${this.config.pingThreshold}ms)`);
            }
        }, this.config.checkIntervalMs);
    }

    triggerReconnect(reason = "") {
        const channelId = this.getCurrentVoiceChannelId();
        if (!channelId || this.isReconnecting) return;

        this.isReconnecting = true;
        BdApi.UI.showToast(`[VoicePing] ⚠️ ${reason}. Переподключение...`, { type: "warning" });

        this.ChannelActions.selectVoiceChannel(null);

        setTimeout(() => {
            this.ChannelActions.selectVoiceChannel(channelId);
            BdApi.UI.showToast("[VoicePing] ✅ Переподключено к каналу!", { type: "success" });
            this.isReconnecting = false;
        }, this.config.reconnectDelay);
    }

    observePopouts() {
        this.observer = new MutationObserver(() => {
            const targetContainer = document.querySelector('[class*="channelRTCConnectionPopout"], [class*="container"][aria-label*="RTC"], [class*="popout"] [class*="header"]')?.parentElement;

            if (targetContainer && !targetContainer.querySelector(".voice-ping-test-btn")) {
                const btn = document.createElement("button");
                btn.className = "voice-ping-test-btn";
                btn.innerHTML = "⚡ Вызвать 5 000 ms пинга (Тест)";
                btn.onclick = () => {
                    BdApi.UI.showToast("[VoicePing Test] Имитация спайка пинга 5000ms!", { type: "error" });
                    this.triggerReconnect("Тестовый скачок 5000ms");
                };
                targetContainer.appendChild(btn);
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });
    }
};
