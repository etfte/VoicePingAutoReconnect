/**
 * @name VoicePingAutoReconnect
 * @author etfte
 * @version 2.1.0
 * @description Отображает реальный пинг каналов, перезаходит при обрывах (5000ms), и оптимизирует регион голосового канала для администраторов.
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
        this.simulatedPing = null;
        this.pingVisibleUntil = 0;
        this.lastMeasuredRealPing = 0;
        this.isMeasuring = false;
    }

    start() {
        this.loadSettings();
        this.initModules();
        this.injectStyles();
        this.cleanOldElements();
        this.patchChannelItem();
        this.startMonitor();
        this.startPeriodicUpdates();
        this.measureRealNetworkPing();
        console.log("[VoicePing] v2.1.0: Смена региона голосового канала и оптимизатор подключены.");
        BdApi.UI.showToast("[VoicePing] v2.1.0 активен (Регионы + Пинг)!", { type: "success" });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.badgeInterval) clearInterval(this.badgeInterval);
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        document.body.classList.remove("voice-ping-active");
        BdApi.DOM.removeStyle("voice-ping-autoreconnect-style");
        this.cleanOldElements();
        BdApi.Patcher?.unpatchAll?.("VoicePingAutoReconnect");
    }

    onSwitch() {
        this.injectToolbarButton();
        this.injectHeaderControls();
        this.updateChannelBadges();
    }

    cleanOldElements() {
        document.querySelectorAll(
            ".voice-ping-channel-badge, .voice-ping-controls-container, .voice-ping-header-controls, .voice-ping-server-btn, .voice-ping-toolbar-btn"
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
        this.GuildStore = BdApi.Webpack.getStore("GuildStore");
        this.ChannelPermissionStore = BdApi.Webpack.getStore("ChannelPermissionStore");
        this.RTCConnectionStore = BdApi.Webpack.getStore("RTCConnectionStore") || BdApi.Webpack.getByKeys("getRTCConnection");
        this.HTTP = BdApi.Webpack.getByKeys("patch", "post", "get");
    }

    injectStyles() {
        BdApi.DOM.addStyle("voice-ping-autoreconnect-style", `
            .voice-ping-toolbar-btn {
                width: 24px;
                height: 24px;
                margin: 0 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--interactive-normal, #b5bac1);
                transition: color 0.15s ease, transform 0.1s ease;
                position: relative;
                outline: none;
                user-select: none;
            }
            .voice-ping-toolbar-btn:hover {
                color: var(--interactive-hover, #ffffff);
            }
            .voice-ping-toolbar-btn:active {
                transform: scale(0.9);
            }
            .voice-ping-toolbar-btn.active {
                color: #23a559 !important;
            }
            .voice-ping-toolbar-btn svg {
                width: 20px;
                height: 20px;
                fill: currentColor;
            }
            .voice-ping-toolbar-counter {
                position: absolute;
                bottom: -3px;
                right: -4px;
                background: #23a559;
                color: #ffffff;
                font-size: 8px;
                font-weight: 800;
                padding: 0 3px;
                border-radius: 4px;
                line-height: 11px;
                pointer-events: none;
            }

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
            }
            .voice-ping-icon-btn:hover {
                background-color: var(--background-modifier-hover, rgba(255, 255, 255, 0.08));
                color: var(--interactive-hover, #ffffff);
            }
            .voice-ping-icon-btn.active {
                color: #23a559 !important;
                background-color: rgba(35, 165, 89, 0.2) !important;
            }
            .voice-ping-icon-btn.region-btn:hover {
                color: #5865f2;
                background-color: rgba(88, 101, 242, 0.15);
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
            }

            body.voice-ping-active .voice-ping-channel-badge {
                display: inline-flex !important;
            }

            .voice-ping-good {
                background: rgba(35, 165, 89, 0.25) !important;
                color: #23a559 !important;
                border: 1px solid rgba(35, 165, 89, 0.45) !important;
            }
            .voice-ping-medium {
                background: rgba(240, 178, 50, 0.25) !important;
                color: #f0b232 !important;
                border: 1px solid rgba(240, 178, 50, 0.45) !important;
            }
            .voice-ping-bad {
                background: rgba(242, 63, 67, 0.25) !important;
                color: #f23f43 !important;
                border: 1px solid rgba(242, 63, 67, 0.45) !important;
            }
        `);
    }

    async measureRealNetworkPing() {
        if (this.isMeasuring) return this.lastMeasuredRealPing;
        this.isMeasuring = true;
        try {
            const start = performance.now();
            await fetch("https://discord.com/api/v9/gateway", {
                method: "GET",
                cache: "no-store",
                signal: AbortSignal.timeout(3500)
            });
            const rtt = Math.round(performance.now() - start);
            if (rtt > 0) {
                this.lastMeasuredRealPing = rtt;
            }
        } catch (e) {
        } finally {
            this.isMeasuring = false;
        }
        return this.lastMeasuredRealPing;
    }

    getRealActiveVoicePing() {
        try {
            if (this.RTCConnectionStore) {
                if (typeof this.RTCConnectionStore.getPing === "function") {
                    const p = Math.round(this.RTCConnectionStore.getPing());
                    if (p > 0) return p;
                }
                if (typeof this.RTCConnectionStore.getAveragePing === "function") {
                    const p = Math.round(this.RTCConnectionStore.getAveragePing());
                    if (p > 0) return p;
                }
                if (typeof this.RTCConnectionStore.getRTCConnection === "function") {
                    const conn = this.RTCConnectionStore.getRTCConnection();
                    const p = Math.round(conn?.lastPing || conn?.ping || conn?.averagePing || 0);
                    if (p > 0) return p;
                }
            }
        } catch (e) {}
        return null;
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
        const activePing = this.getRealActiveVoicePing();
        if (activePing !== null && activePing > 0) {
            return activePing;
        }
        return this.lastMeasuredRealPing || 0;
    }

    async togglePingVisibility(seconds = 30) {
        const now = Date.now();
        if (this.pingVisibleUntil > now) {
            this.pingVisibleUntil = 0;
            document.body.classList.remove("voice-ping-active");
            if (this.countdownInterval) clearInterval(this.countdownInterval);
            this.updateButtonLabels(0);
            BdApi.UI.showToast("📶 [VoicePing] Пинг скрыт", { type: "info" });
            return;
        }

        this.pingVisibleUntil = now + (seconds * 1000);
        document.body.classList.add("voice-ping-active");

        this.measureRealNetworkPing().then(() => {
            this.updateChannelBadges();
        });

        BdApi.UI.showToast(`📶 [VoicePing] Пинг каналов включён на ${seconds} сек.`, { type: "success" });

        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((this.pingVisibleUntil - Date.now()) / 1000));
            this.updateButtonLabels(remaining);

            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                document.body.classList.remove("voice-ping-active");
                this.updateButtonLabels(0);
            }
        }, 1000);

        this.updateButtonLabels(seconds);
    }

    updateButtonLabels(remainingSeconds) {
        const isNowActive = remainingSeconds > 0;

        document.querySelectorAll(".voice-ping-toolbar-btn").forEach(btn => {
            let counter = btn.querySelector(".voice-ping-toolbar-counter");
            if (isNowActive) {
                btn.classList.add("active");
                btn.title = `Скрыть пинг (осталось ${remainingSeconds}с)`;
                if (!counter) {
                    counter = document.createElement("span");
                    counter.className = "voice-ping-toolbar-counter";
                    btn.appendChild(counter);
                }
                counter.textContent = `${remainingSeconds}`;
            } else {
                btn.classList.remove("active");
                btn.title = "Показать пинг каналов на 30 секунд";
                if (counter) counter.remove();
            }
        });

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

    // Проверка прав управления каналом (MANAGE_CHANNELS = 16n)
    userCanManageChannel(channel) {
        if (!channel) return false;
        try {
            if (this.ChannelPermissionStore?.can) {
                // 16n = MANAGE_CHANNELS
                return this.ChannelPermissionStore.can(16n, channel);
            }
        } catch (e) {}
        return true; // Разрешаем отображение, если модуль недоступен
    }

    // Смена региона голосового канала через API
    async switchChannelRegion(channelId, regionId) {
        try {
            if (this.HTTP?.patch) {
                await this.HTTP.patch({
                    url: `/channels/${channelId}`,
                    body: { rtc_region: regionId === "automatic" ? null : regionId }
                });
            } else {
                const token = BdApi.Webpack.getStore("AuthenticationStore")?.getToken?.() ||
                              BdApi.Webpack.getByKeys("getToken")?.getToken?.();
                await fetch(`https://discord.com/api/v9/channels/${channelId}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": token
                    },
                    body: JSON.stringify({ rtc_region: regionId === "automatic" ? null : regionId })
                });
            }

            const regionName = regionId === "automatic" ? "Автоматический" : regionId.toUpperCase();
            BdApi.UI.showToast(`🌐 Регион канала изменён на: ${regionName}! Перезапуск сессии...`, { type: "success" });
            
            // Быстрый перезаход для мгновенного подхвата нового сервера
            setTimeout(() => this.triggerReconnect("Смена региона голосового сервера"), 500);
        } catch (err) {
            console.error("[VoicePing] Ошибка смены региона:", err);
            BdApi.UI.showToast("❌ Не удалось изменить регион (проверьте права доступа)", { type: "error" });
        }
    }

    // Модальное окно оптимизации и выбора региона
    openRegionOptimizerModal() {
        const channelId = this.getCurrentVoiceChannelId();
        if (!channelId) {
            BdApi.UI.showToast("Сначала зайдите в голосовой канал!", { type: "warning" });
            return;
        }

        const channel = this.ChannelStore?.getChannel(channelId);
        const currentRegion = channel?.rtcRegion || "automatic";
        const currentPing = this.getCurrentPing();

        const regions = [
            { id: "automatic", name: "Автоматически (Выбор Discord)", flag: "🌐" },
            { id: "rotterdam", name: "Роттердам (Нидерланды)", flag: "🇳🇱" },
            { id: "frankfurt", name: "Франкфурт (Германия)", flag: "🇩🇪" },
            { id: "finland", name: "Финляндия", flag: "🇫🇮" },
            { id: "stockholm", name: "Стокгольм (Швеция)", flag: "🇸🇪" },
            { id: "warsaw", name: "Варшава (Польша)", flag: "🇵🇱" },
            { id: "madrid", name: "Мадрид (Испания)", flag: "🇪🇸" },
            { id: "russia", name: "Россия", flag: "🇷🇺" },
            { id: "us-central", name: "США (Центр)", flag: "🇺🇸" },
            { id: "us-east", name: "США (Восток)", flag: "🇺🇸" }
        ];

        let selectHtml = regions.map(r => `
            <option value="${r.id}" ${r.id === currentRegion ? "selected" : ""}>
                ${r.flag} ${r.name}
            </option>
        `).join("");

        const content = document.createElement("div");
        content.style.color = "var(--header-primary, #ffffff)";
        content.style.fontSize = "14px";
        content.style.lineHeight = "1.5";

        content.innerHTML = `
            <div style="margin-bottom: 14px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                <div>Текущий канал: <b>${channel?.name || "Голосовой канал"}</b></div>
                <div>Текущий регион: <b style="color:#5865f2;">${currentRegion.toUpperCase()}</b></div>
                <div>Текущий пинг: <b style="color: ${currentPing > 150 ? '#f23f43' : '#23a559'};">${currentPing} ms</b></div>
            </div>
            <label style="display:block; margin-bottom: 6px; font-weight:600;">Выберите новый регион сервера:</label>
            <select id="vp-region-select" style="width: 100%; padding: 8px 12px; background: var(--input-background, #1e1f22); color: #fff; border: 1px solid #444; border-radius: 6px; outline: none;">
                ${selectHtml}
            </select>
            <p style="margin-top: 10px; font-size: 12px; color: var(--text-muted, #949ba4);">
                💡 <b>Совет:</b> Если пинг > 200 ms, часто помогает смена между <b>Frankfurt</b> и <b>Rotterdam</b>. Смена применится для всех участников в канале.
            </p>
        `;

        BdApi.UI.showConfirmationModal(
            "🌐 Оптимизация региона канала",
            content,
            {
                confirmText: "Применить регион",
                cancelText: "Отмена",
                onConfirm: () => {
                    const sel = content.querySelector("#vp-region-select");
                    if (sel && sel.value) {
                        this.switchChannelRegion(channelId, sel.value);
                    }
                }
            }
        );
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
                const currentVoiceId = this.getCurrentVoiceChannelId();
                
                let ping = 0;
                if (channelId === currentVoiceId) {
                    ping = this.getCurrentPing();
                } else {
                    ping = this.lastMeasuredRealPing || 0;
                }

                if (!ping || ping <= 0) return res;

                let pingClass = "voice-ping-good";
                if (ping > 180) pingClass = "voice-ping-bad";
                else if (ping > 90) pingClass = "voice-ping-medium";

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

    startPeriodicUpdates() {
        this.injectToolbarButton();
        this.injectHeaderControls();
        this.updateChannelBadges();

        this.badgeInterval = setInterval(() => {
            this.injectToolbarButton();
            this.injectHeaderControls();
            if (Date.now() < this.pingVisibleUntil) {
                this.updateChannelBadges();
            }
        }, 2000);
    }

    updateChannelBadges() {
        const channelContainers = document.querySelectorAll(
            '[data-list-item-id^="channels___"], li[class*="containerDefault_"], div[class*="channel_"]'
        );
        if (!channelContainers || !channelContainers.length) return;

        const currentVoiceId = this.getCurrentVoiceChannelId();
        const activeRealVoicePing = this.getRealActiveVoicePing();

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

            let ping = 0;
            if (channelId === currentVoiceId && activeRealVoicePing) {
                ping = activeRealVoicePing;
            } else {
                ping = this.lastMeasuredRealPing || activeRealVoicePing || 0;
            }

            if (!ping || ping <= 0) return;

            let pingClass = "voice-ping-good";
            if (ping > 180) pingClass = "voice-ping-bad";
            else if (ping > 90) pingClass = "voice-ping-medium";

            let badge = container.querySelector(".voice-ping-channel-badge");
            const text = `${ping}ms`;

            if (!badge) {
                badge = document.createElement("span");
                badge.className = `voice-ping-channel-badge ${pingClass}`;
                badge.textContent = text;

                const targetWrapper = container.querySelector('[class*="children_"]') ||
                                      container.querySelector('[class*="name_"], [class*="channelName_"]')?.parentElement ||
                                      container.querySelector('[class*="content_"]') ||
                                      container;
                targetWrapper.appendChild(badge);
            } else if (badge.textContent !== text) {
                badge.className = `voice-ping-channel-badge ${pingClass}`;
                badge.textContent = text;
            }
        });
    }

    injectToolbarButton() {
        const toolbar = document.querySelector('section[class*="title_"] [class*="toolbar_"], [class*="toolbar_"]');
        if (!toolbar) return;

        if (toolbar.querySelector(".voice-ping-toolbar-btn")) return;

        const btn = document.createElement("div");
        btn.className = "voice-ping-toolbar-btn";
        btn.setAttribute("role", "button");
        btn.setAttribute("tabindex", "0");
        btn.title = "Показать пинг каналов на 30 секунд";
        btn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-1.47-1.84-2.35-4.17-2.35-6.7 0-5.85 4.75-10.6 10.6-10.6 5.85 0 10.6 4.75 10.6 10.6 0 2.53-.88 4.86-2.35 6.7l-.62-1.79C21.26 16.07 22 14.12 22 12c0-4.97-4.03-9-9-9zm0 4c-2.76 0-5 2.24-5 5 0 1.25.46 2.39 1.22 3.28l-.72 2.07C6.44 16.14 6 14.62 6 12c0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 2.62-.44 4.14-1.5 5.35l-.72-2.07C16.54 14.39 17 13.25 17 12c0-2.76-2.24-5-5-5zm0 4c-1.1 0-2 .9-2 2 0 .55.22 1.05.59 1.41l-.59 1.71C9.39 15.65 9 14.88 9 14c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .88-.39 1.65-1 2.12l-.59-1.71c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2z"/>
            </svg>
        `;
        btn.onclick = (e) => {
            e.stopPropagation();
            this.togglePingVisibility(this.config.displayDurationSec);
        };

        toolbar.insertBefore(btn, toolbar.firstChild);
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

        // 1. Иконка смены/оптимизации региона канала (Глобус)
        const channel = this.ChannelStore?.getChannel(inVoice);
        const canManage = this.userCanManageChannel(channel);

        if (canManage) {
            const regionBtn = document.createElement("button");
            regionBtn.className = "voice-ping-icon-btn region-btn";
            regionBtn.title = "Оптимизировать регион голосового канала (сменить сервер)";
            regionBtn.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
            `;
            regionBtn.onclick = (e) => {
                e.stopPropagation();
                this.openRegionOptimizerModal();
            };
            container.appendChild(regionBtn);
        }

        // 2. Иконка показа пинга (Антенна)
        const pingToggleBtn = document.createElement("button");
        pingToggleBtn.className = "voice-ping-icon-btn voice-ping-toggle-btn";
        pingToggleBtn.title = "Показать реальный пинг каналов на 30 секунд";
        pingToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-1.47-1.84-2.35-4.17-2.35-6.7 0-5.85 4.75-10.6 10.6-10.6 5.85 0 10.6 4.75 10.6 10.6 0 2.53-.88 4.86-2.35 6.7l-.62-1.79C21.26 16.07 22 14.12 22 12c0-4.97-4.03-9-9-9zm0 4c-2.76 0-5 2.24-5 5 0 1.25.46 2.39 1.22 3.28l-.72 2.07C6.44 16.14 6 14.62 6 12c0-3.31 2.69-6 6-6 3.31 0 6 2.69 6 6 0 2.62-.44 4.14-1.5 5.35l-.72-2.07C16.54 14.39 17 13.25 17 12c0-2.76-2.24-5-5-5zm0 4c-1.1 0-2 .9-2 2 0 .55.22 1.05.59 1.41l-.59 1.71C9.39 15.65 9 14.88 9 14c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .88-.39 1.65-1 2.12l-.59-1.71c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2z"/>
            </svg>
        `;
        pingToggleBtn.onclick = (e) => {
            e.stopPropagation();
            this.togglePingVisibility(this.config.displayDurationSec);
        };
        container.appendChild(pingToggleBtn);

        // 3. Тест 5000ms (Молния)
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
        container.appendChild(testBtn);

        // 4. Ручной реконнект (Стрелки)
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
            <p style="font-size:12px; color:var(--text-muted, #949ba4);">Когда пинг превышает порог, плагин мгновенно перезаходит в канал. При клике на иконку глобуса модераторы могут менять регион сервера.</p>
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
