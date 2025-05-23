﻿import { registerSettings } from "./settings.js";

export let debugEnabled = 0;

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: monks-chat-timer | ", ...args);
};
export let log = (...args) => console.log("monks-chat-timer | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("WARN: monks-chat-timer | ", ...args);
};
export let error = (...args) => console.error("monks-chat-timer | ", ...args);

export const setDebugLevel = (debugText) => {
    debugEnabled = { none: 0, warn: 1, debug: 2, all: 3 }[debugText] || 0;
    // 0 = none, warnings = 1, debug = 2, all = 3
    if (debugEnabled >= 3)
        CONFIG.debug.hooks = true;
};

export let i18n = key => {
    return game.i18n.localize(key);
};
export let setting = key => {
    if (MonksChatTimer._setting.hasOwnProperty(key))
        return MonksChatTimer._setting[key];
    else
        return game.settings.get("monks-chat-timer", key);
};

export class MonksChatTimer {
    static init() {
        if (game.MonksChatTimer == undefined)
            game.MonksChatTimer = MonksChatTimer;

        try {
            Object.defineProperty(User.prototype, "isTheGM", {
                get: function isTheGM() {
                    return this == (game.users.find(u => u.hasRole("GAMEMASTER") && u.active) || game.users.find(u => u.hasRole("ASSISTANT") && u.active));
                }
            });
        } catch { }

        MonksChatTimer.SOCKET = "module.monks-chat-timer";

        registerSettings();

        MonksChatTimer.registerHotKeys();

        let oldMessagePatterns = ChatLog.prototype.constructor.MESSAGE_PATTERNS;
        foundry.applications.sidebar.tabs.ChatLog.prototype.constructor.MESSAGE_PATTERNS = (() => {
            let MESSAGE_PATTERNS = {
                timer: new RegExp('^(/timer )(-?[0-9:]+)(?: ([^()]+?))?(?: \((.+?)\))?$', "i")
            };
            return foundry.utils.mergeObject(MESSAGE_PATTERNS, oldMessagePatterns);
        })();
    }

    static async ready() {
        game.socket.on(MonksChatTimer.SOCKET, MonksChatTimer.onMessage);
    }

    static registerHotKeys() {
        
    }

    static getSpeakerFromUser({ scene, user, alias }) {
        return {
            scene: (scene || canvas.scene)?.id || null,
            actor: null,
            token: null,
            alias: alias || user.name
        };
    }

    static createTimer(time = "5", options = {}) {
        let strTime = time.toString();
        let timePart = strTime.split(':').reverse();
        let calcTime = ((Math.abs(timePart[0]) + (timePart.length > 1 ? Math.abs(timePart[1]) * 60 : 0) + (timePart.length > 2 ? Math.abs(timePart[2]) * 3600 : 0)) * 1000) * (strTime.startsWith('-') ? -1 : 1);

        let frmtTime = new Date(calcTime < 0 ? 0 : calcTime).toISOString().substr(11, 8);
        let content = `<div class="timer-msg"><div class="timer-flavor">${options.flavor}</div><div class="timer-time">${frmtTime}</div><div class="timer-bar"><div></div></div><div class="complete-msg">${i18n('MonksChatTimer.Complete')}</div></div>`;

        const speaker = this.getSpeakerFromUser({ user: game.user });

        let messageData = {
            user: game.user.id,
            speaker: speaker,
            type: CONST.CHAT_MESSAGE_STYLES.OOC,
            content: content,
            flags: {
                core: { canPopout: true },
                'monks-chat-timer': {
                    time: calcTime,
                    start: Date.now(),
                    flavor: options.flavor,
                    followup: options.followup
                }
            }
        };

        if (options.whisper)
            messageData.whisper = options.whisper;

        ChatMessage.create(messageData);
    }
}

Hooks.once('init', MonksChatTimer.init);
Hooks.on("ready", MonksChatTimer.ready);

Hooks.on("chatCommandsReady", (chatCommands) => {
    if (chatCommands.register != undefined) {
        chatCommands.register({
            name: "/timer",
            module: "monks-chat-timer",
            callback: (chatlog, messageText, chatdata) => {
                let regex = new RegExp('^(-?[0-9:]+)\s?(.*)?$', "i");
                let match = messageText.match(regex);

                let timePart = (match[1] || '5').split(':').reverse();
                let time = ((Math.abs(timePart[0]) + (timePart.length > 1 ? Math.abs(timePart[1]) * 60 : 0) + (timePart.length > 2 ? Math.abs(timePart[2]) * 3600 : 0)) * 1000) * (match[1].startsWith('-') ? -1 : 1);


                let flavor = match.length > 2 ? match[2].trim() : "";
                let followup = "";
                if (flavor && flavor.startsWith("flavor:"))
                    flavor = flavor.substr(7).trim();
                let idx = flavor.indexOf("followup:");
                if (idx > -1) {
                    followup = flavor.substr(idx + 9).trim();
                    flavor = flavor.substr(0, idx).trim();
                }
                if (flavor.endsWith(")") && flavor.indexOf("(") > -1) {
                    let idx = flavor.indexOf("(");
                    followup = flavor.slice(idx + 1, flavor.length - 1).trim();
                    flavor = flavor.substr(0, idx).trim();
                }

                chatdata.speaker = MonksChatTimer.getSpeakerFromUser({ user: game.user });
                chatdata.flags = {
                    core: { canPopout: true },
                    'monks-chat-timer': {
                        time: time,
                        start: Date.now(),
                        flavor: flavor,
                        followup: followup
                    }
                };
                let frmtTime = new Date(time < 0 ? 0 : time).toISOString().slice(11, 8);
                return {
                    content: `<div class="timer-msg"><div class="timer-flavor">${flavor}</div><div class="timer-time">${frmtTime}</div><div class="timer-bar"><div></div></div><div class="complete-msg">${i18n("MonksChatTimer.Complete")}</div></div>`
                };
            },
            shouldDisplayToChat: true,
            icon: '<i class="fas fa-clock"></i>',
            description: i18n("MonksChatTimer.CreateChatCountdownTimer")
        });
    }
});

Hooks.on("chatMessage", (message, chatData) => {
    if (!game.modules.get("_chatcommands")?.active) {
        const parsed = this.constructor.parse(message);
        let command = parsed[0];
        const match = parsed[1];

        if (command == "timer") {
            let timePart = (match[2] || '5').split(':').reverse();
            let time = ((Math.abs(timePart[0]) + (timePart.length > 1 ? Math.abs(timePart[1]) * 60 : 0) + (timePart.length > 2 ? Math.abs(timePart[2]) * 3600 : 0)) * 1000) * (match[0].startsWith('-') ? -1 : 1);
            let flavor = match[3]?.trim() || "";
            let followup = (match[4]?.trim() || "");
            if (flavor && flavor.startsWith("flavor:"))
                flavor = flavor.substr(7).trim();
            let idx = flavor.indexOf("followup:");
            if (idx > -1) {
                followup = flavor.substr(idx + 9).trim();
                flavor = flavor.substr(0, idx).trim();
            }
            if (flavor.endsWith(")") && flavor.indexOf("(") > -1) {
                let idx = flavor.indexOf("(");
                followup = flavor.slice(idx + 1, flavor.length - 1).trim();
                flavor = flavor.substr(0, idx).trim();
            }

            let options = {
                flavor: flavor,
                followup: followup
            };
            MonksChatTimer.createTimer(time, options);
            return false;
        }
    }
});

Hooks.on("renderChatMessageHTML", (message, html, data) => {
    if (message.getFlag('monks-chat-timer', 'time') && !message.getFlag('monks-chat-timer', 'complete')) {
        let updateTime = function (time, start) {
            let dif = (Date.now() - start);
            let realTime = Math.abs(time);
            let remaining = (time < 0 ? realTime - dif : dif);
            if (time < 0)
                remaining = remaining + 1000;

            let frmtTime = new Date(remaining).toISOString().substr(11, 8);
            $('.timer-time', html).html(frmtTime);
            $('.timer-bar div', html).css({ width: ((dif / Math.abs(time)) * 100) + '%' });

            return dif < Math.abs(time);
        }

        let time = message.getFlag('monks-chat-timer', 'time');
        let start = message.getFlag('monks-chat-timer', 'start');

        if ((Date.now() - start) >= Math.abs(time)) {
            //the timer is finished
            let content = $(message.content);
            $(content).addClass('completed');
            updateTime(time, start);
            //$('.timer-time', content).html(parseInt(Math.abs(time) / 1000) + ' sec');
            message.update({ content: content[0].outerHTML, flags: { 'monks-chat-timer': { 'complete': true } } });
            if (message.getFlag('monks-chat-timer', 'followup'))
                ChatMessage.create({ user: game.user.id, content: message.getFlag('monks-chat-timer', 'followup') }, {});
        } else {
            //start that timer up!
            updateTime(time, start);
            /*
            let dif = (Date.now() - start);
            let remaining = parseInt(dif / 1000);
            $('.timer-time', html).html((time < 0 ? Math.abs(time) - remaining : remaining) + ' sec');
            $('.timer-bar div', html).css({ width: ((dif / Math.abs(time)) * 100) + '%' });
            */

            let timer = window.setInterval(function () {
                /*
                let dif = (Date.now() - start);
                let remaining = parseInt(dif / 1000);
                $('.timer-time', html).html((time < 0 ? Math.abs(time) - remaining : remaining) + ' sec');
                $('.timer-bar div', html).css({ width: ((dif / Math.abs(time)) * 100) + '%'});
                */
                //+++ check if message still exists
                if (!updateTime(time, start)) {
                    //the timer is finished
                    let content = $(message.content);
                    $(content).addClass('complete');
                    updateTime(time, start);
                    //$('.timer-time', content).html((time < 0 ? Math.abs(time) - remaining : remaining) + ' sec');
                    if (game.user.isTheGM) {
                        message.update({ content: content[0].outerHTML, flags: { 'monks-chat-timer': { 'complete': true } } });
                        if (message.getFlag('monks-chat-timer', 'followup')) {
                            ChatMessage.create({
                                user: game.user.id,
                                flavor: message.getFlag('monks-chat-timer', 'flavor'),
                                content: message.getFlag('monks-chat-timer', 'followup'),
                                speaker: null,
                                type: CONST.CHAT_MESSAGE_STYLES.OOC,
                                whisper: message.whisper
                            }, {});
                        }
                    }

                    window.clearInterval(timer);
                }
            }, 100);
        }
    }
});

Hooks.on("setupTileActions", (app) => {
    if (app.triggerGroups['monks-chat-timer'] == undefined)
        app.registerTileGroup('monks-chat-timer', "Monk's Chat Timer");
    app.registerTileAction('monks-chat-timer', 'chat-timer', {
        name: 'Chat Timer',
        ctrls: [
            {
                id: "duration",
                name: i18n("MonksChatTimer.Duration"),
                type: "text",
                defvalue: "5",
                required: true,
            },
            {
                id: "for",
                name: i18n("MonksChatTimer.For"),
                list: "for",
                type: "list",
            },
            {
                id: "flavor",
                name: i18n("MonksChatTimer.Flavor"),
                type: "text",
            },
            {
                id: "followup",
                name: i18n("MonksChatTimer.FollowUp"),
                type: "text",
            },
        ],
        values: {
            'for': {
                "everyone": i18n("MonksChatTimer.for.Everyone"),
                "gm": i18n("MonksChatTimer.for.GMOnly"),
                'token': i18n("MonksChatTimer.for.TriggeringPlayer")
            }
        },
        group: 'monks-chat-timer',
        fn: async (args = {}) => {
            const { action, tokens } = args;

            let options = {
                flavor: action.data.flavor,
                followup: action.data.followup
            };

            if (action.data.for == 'gm')
                options.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
            else if (action.data.for == 'token') {
                let entities = await game.MonksActiveTiles.getEntities(args);
                let entity = (entities.length > 0 ? entities[0] : null);
                let tkn = (entity?.object || tokens[0]?.object);
                let tokenOwners = (tkn ? Object.entries(tkn?.actor.ownership).filter(([k, v]) => { return v == CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }).map(a => { return a[0]; }) : []);
                options.whisper = Array.from(new Set(ChatMessage.getWhisperRecipients("GM").map(u => u.id).concat(tokenOwners)));
            }

            MonksChatTimer.createTimer(action.data.duration, options);
        },
        content: async (trigger, action) => {
            return `<span class="logic-style">${trigger.name}</span> count <span class="details-style">"${action.data.duration}"</span> for <span class="value-style">&lt;${i18n(trigger.values.for[action.data?.for])}&gt;</span>`;
        }
    });
});