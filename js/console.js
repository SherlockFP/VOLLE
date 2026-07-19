// console.js — Source Engine-style in-game console. Toggle with `~`.
// Host (lobby creator) can change game vars via commands.
import { GAME_MODES } from './gamemodes.js';
import { MAPS } from './arena.js';

export const COMMANDS = {
    help: {
        desc: 'Show all commands',
        run: (game, args, log) => {
            log('╔══ Available Commands ══╗');
            Object.entries(COMMANDS).forEach(([cmd, info]) => {
                log(`  ${cmd} ${info.args || ''} — ${info.desc}${commandNeedsHost(info) ? ' [HOST]' : ''}`);
            });
            log('╚════════════════════════╝');
            return true;
        }
    },
    sv_prematchduration: {
        desc: 'Set pre-game countdown in seconds',
        hostOnly: true,
        args: '<seconds>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 1) { log('Usage: sv_prematchduration <seconds> (min 1)'); return false; }
            game.preGameDuration = val;
            log(`pre-match countdown → ${val}s`);
            return true;
        }
    },
    sv_roundrestartdelay: {
        desc: 'Set round-end restart delay',
        hostOnly: true,
        args: '<seconds>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 0.5) { log('Usage: sv_roundrestartdelay <seconds> (min 0.5)'); return false; }
            game.roundRestartDelay = val;
            log(`round restart delay → ${val}s`);
            return true;
        }
    },
    sv_restartround: {
        desc: 'Restart the current round',
        hostOnly: true,
        run: (game, args, log) => {
            if (game.state === 'PLAYING' || game.state === 'ROUND_END' || game.state === 'COUNTDOWN') {
                game.startRound();
                log('Round restarted');
                return true;
            }
            log('No active round to restart');
            return false;
        }
    },
    sv_bot_add: {
        desc: 'Add a bot to a team',
        hostOnly: true,
        args: '<red|blue>',
        run: (game, args, log) => {
            const team = args[0] === 'blue' ? 'blue' : 'red';
            game.addBot(team);
            log(`Bot added to ${team}`);
            return true;
        }
    },
    sv_bot_remove: {
        desc: 'Remove the last bot',
        hostOnly: true,
        run: (game, args, log) => {
            game.removeBot();
            log('Bot removed');
            return true;
        }
    },
    sv_selectmap: {
        desc: 'Switch to a different map',
        hostOnly: true,
        args: '<mapid>',
        run: (game, args, log) => {
            const id = args[0];
            if (!MAPS[id]) { log(`Unknown map: ${id}. Try: ${Object.keys(MAPS).join(', ')}`); return false; }
            game.selectMap(id);
            log(`Map changed → ${MAPS[id].name}`);
            return true;
        }
    },
    sv_selectmode: {
        desc: 'Change game mode',
        hostOnly: true,
        args: '<modeid>',
        run: (game, args, log) => {
            const id = args[0];
            if (!GAME_MODES[id]) { log(`Unknown mode: ${id}. Try: ${Object.keys(GAME_MODES).join(', ')}`); return false; }
            game.selectMode(id);
            log(`Mode changed → ${GAME_MODES[id].name}`);
            return true;
        }
    },
    sv_timescale: {
        desc: 'Set game speed multiplier',
        hostOnly: true,
        args: '<0.1-5>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 0.1 || val > 5) { log('Range: 0.1 to 5'); return false; }
            game._timeScale = val;
            log(`Time scale → ${val}x`);
            return true;
        }
    },
    sv_gravity: {
        desc: 'Set ball gravity',
        hostOnly: true,
        args: '<value>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val)) { log('Usage: sv_gravity <number>'); return false; }
            game.ball.gravity = val;
            log(`Ball gravity → ${val}`);
            return true;
        }
    },
    sv_ballspeed: {
        desc: 'Set base ball speed',
        hostOnly: true,
        args: '<value>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 1) { log('Usage: sv_ballspeed <number> (min 1)'); return false; }
            game.ball.baseSpeed = val;
            game.ball.currentSpeed = val;
            log(`Base ball speed → ${val}`);
            return true;
        }
    },
    sv_maxspeed: {
        desc: 'Set max speed multiplier (base × mult)',
        hostOnly: true,
        args: '<multiplier>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 1) { log('Usage: sv_maxspeed <multiplier> (min 1)'); return false; }
            game.ball.maxSpeed = game.ball.baseSpeed * val;
            log(`Max ball speed → ${game.ball.baseSpeed} × ${val} = ${game.ball.maxSpeed}`);
            return true;
        }
    },
    sv_ricochet: {
        desc: 'Set ricochet chance (0-1)',
        hostOnly: true,
        args: '<0-1>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 0 || val > 1) { log('Range: 0 to 1'); return false; }
            game.ball.ricochetChance = val;
            log(`Ricochet chance → ${Math.round(val * 100)}%`);
            return true;
        }
    },
    sv_difficulty: {
        desc: 'Set bot difficulty',
        hostOnly: true,
        args: '<easy|medium|hard>',
        run: (game, args, log) => {
            const d = args[0];
            if (!['easy','medium','hard'].includes(d)) { log('Options: easy, medium, hard'); return false; }
            game.setBotDifficulty(d);
            log(`Bot difficulty → ${d}`);
            return true;
        }
    },
    sv_portals: {
        desc: 'Toggle portal system',
        hostOnly: true,
        args: '<0|1>',
        run: (game, args, log) => {
            const val = parseInt(args[0]);
            if (val !== 0 && val !== 1) { log('Usage: sv_portals 0 (off) or 1 (on)'); return false; }
            game.arena.config.hasPortals = val === 1;
            if (val === 1 && (!game.arena.portals || game.arena.portals.length === 0)) {
                game.arena.buildPortals();
            } else if (val === 0 && game.arena.portals) {
                game.arena.portals.forEach(p => {
                    game.arena.remove(p.mesh);
                    game.arena.remove(p.core);
                    game.arena.remove(p.light);
                    game.arena.remove(p.particles);
                });
                game.arena.portals = null;
            }
            log(`Portals → ${val === 1 ? 'ON' : 'OFF'}`);
            return true;
        }
    },
    clear: {
        desc: 'Clear console',
        run: (game, args, log) => { return 'clear_only'; }
    },
    sv_hand: {
        desc: 'Toggle hand model visibility',
        args: '<0|1>',
        run: (game, args, log) => {
            const val = args[0] === undefined ? -1 : parseInt(args[0]);
            if (val === -1) {
                const next = !game.player.armGroup.visible;
                game.player.setHandVisible(next);
                log(`Hand model → ${next ? 'ON' : 'OFF'}`);
            } else if (val === 0 || val === 1) {
                game.player.setHandVisible(val === 1);
                log(`Hand model → ${val === 1 ? 'ON' : 'OFF'}`);
            } else {
                log('Usage: sv_hand 0 (off) or 1 (on) — no arg toggles');
                return false;
            }
            return true;
        }
    },
    sv_bot_kick: {
        desc: 'Kick a bot by name',
        hostOnly: true,
        args: '<name>',
        run: (game, args, log) => {
            const name = args.join(' ');
            if (!name) { log('Usage: sv_bot_kick <bot name>'); return false; }
            const bot = game.bots.find(b => b.name.toLowerCase() === name.toLowerCase());
            if (!bot) { log(`Bot "${name}" not found`); return false; }
            bot.remove();
            game.scoreboard.removePlayer(bot.name);
            game.bots = game.bots.filter(b => b.name !== bot.name);
            log(`Bot "${bot.name}" kicked`);
            return true;
        }
    },
    sv_bot_kickall: {
        desc: 'Kick all bots',
        hostOnly: true,
        run: (game, args, log) => {
            const count = game.bots.length;
            game.bots.forEach(b => { b.remove(); game.scoreboard.removePlayer(b.name); });
            game.bots = [];
            game.botCounter = 0;
            log(`All ${count} bots kicked`);
            return true;
        }
    },
    sv_playergravity: {
        desc: 'Set player gravity (default -20)',
        hostOnly: true,
        args: '<value>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val)) { log('Usage: sv_playergravity <number>'); return false; }
            game.player.gravity = val;
            log(`Player gravity → ${val}`);
            return true;
        }
    },
    sv_damagemul: {
        desc: 'Set damage multiplier',
        hostOnly: true,
        args: '<0.1-5>',
        run: (game, args, log) => {
            const val = parseFloat(args[0]);
            if (isNaN(val) || val < 0.1) { log('Usage: sv_damagemul <number> (min 0.1)'); return false; }
            game._damageMul = val;
            log(`Damage multiplier → ${val}x`);
            return true;
        }
    },
    mp_restartgame: {
        desc: 'Restart game after N seconds',
        hostOnly: true,
        args: '<seconds>',
        run: (game, args, log) => {
            const delay = parseFloat(args[0]) || 3;
            log(`Game restarting in ${delay}s...`);
            game.ui.showMessage?.(`🔄 Restarting in ${delay}s...`, delay * 1000);
            setTimeout(() => {
                game.scoreboard.reset();
                game.startGame();
                game.player.lock();
            }, delay * 1000);
            return true;
        }
    },
    endgame_1: {
        desc: 'Force end game — RED wins (30s celebration)',
        hostOnly: true,
        run: (game, args, log) => {
            game.scoreboard.redScore = 999;
            game.scoreboard.blueScore = 0;
            game.endGame();
            log('RED team wins! Celebration started.');
            return true;
        }
    },
    endgame_2: {
        desc: 'Force end game — BLUE wins (30s celebration)',
        hostOnly: true,
        run: (game, args, log) => {
            game.scoreboard.redScore = 0;
            game.scoreboard.blueScore = 999;
            game.endGame();
            log('BLUE team wins! Celebration started.');
            return true;
        }
    },
    cl_showfps: {
        desc: 'Show FPS counter (0/1)',
        args: '<0|1>',
        run: (game, args, log) => {
            const v = parseInt(args[0]) || 0;
            const el = document.getElementById('fps-counter') || (() => {
                const d = document.createElement('div');
                d.id = 'fps-counter';
                d.style.cssText = 'position:fixed;top:4px;right:80px;color:#0f0;font:12px monospace;z-index:999;pointer-events:none;';
                document.body.appendChild(d);
                return d;
            })();
            el.style.display = v ? '' : 'none';
            game._showFps = !!v;
            log(`FPS counter → ${v ? 'ON' : 'OFF'}`);
            return true;
        }
    },
    cl_showdamage: {
        desc: 'Show damage meter (0/1)',
        args: '<0|1>',
        run: (game, args, log) => {
            const v = parseInt(args[0]) || 0;
            const dm = document.getElementById('damage-meter');
            if (dm) dm.style.display = v ? '' : 'none';
            log(`Damage meter → ${v ? 'ON' : 'OFF'}`);
            return true;
        }
    },
    r_fullbright: {
        desc: 'Toggle fullbright lighting (0/1)',
        args: '<0|1>',
        run: (game, args, log) => {
            const v = parseInt(args[0]) || 0;
            if (game.renderer) {
                game.renderer.scene.traverse(c => {
                    if (c.isMesh && c.material && c.material.isMeshToonMaterial) {
                        c.material.uniforms.uLight.intensity = v ? 2 : 1;
                    }
                });
            }
            log(`Fullbright → ${v ? 'ON' : 'OFF'}`);
            return true;
        }
    },
    sv_ffa: {
        desc: 'Switch to FFA mode and restart',
        hostOnly: true,
        run: (game, args, log) => {
            game.selectMode('ffa');
            game.scoreboard.reset();
            game.startGame();
            game.player.lock();
            log('FFA mode activated! No teams, no net, last man standing.');
            return true;
        }
    },
};

export function commandNeedsHost(command) {
    return command?.hostOnly === true;
}

export class Console {
    constructor() {
        this.visible = false;
        this.history = [];
        this.historyIdx = -1;
        this.input = '';
        this.lines = [];
        this.maxLines = 50;
        this.element = null;
        this.inputEl = null;
        this.outputEl = null;
        this.game = null;
    }

    init(game) {
        this.game = game;
        this.buildUI();
        this.bindKeys();
        this.log('═══ DODGBALL Console ═══');
        this.log('Type help for commands');
    }

    buildUI() {
        const div = document.createElement('div');
        div.id = 'console-overlay';
        div.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0;
            height: 45vh; background: rgba(0,0,0,0.85);
            border-top: 2px solid var(--accent, #ff8800);
            z-index: 9999; display: none;
            flex-direction: column; font-family: monospace;
            font-size: 13px; color: #ccc;
        `;

        const output = document.createElement('div');
        output.style.cssText = `
            flex: 1; overflow-y: auto; padding: 8px 12px;
            white-space: pre-wrap; word-break: break-all;
        `;
        output.id = 'console-output';
        div.appendChild(output);

        const inputRow = document.createElement('div');
        inputRow.style.cssText = `
            display: flex; align-items: center;
            border-top: 1px solid rgba(255,255,255,0.1);
            padding: 4px 8px; gap: 6px; position: relative;
        `;

        const prompt = document.createElement('span');
        prompt.textContent = '] ';
        prompt.style.cssText = 'color: var(--accent, #ff8800); font-weight: bold;';
        inputRow.appendChild(prompt);

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'console-input';
        input.style.cssText = `
            flex: 1; background: transparent; border: none;
            color: #fff; font-family: monospace; font-size: 13px;
            outline: none;
        `;
        input.autocomplete = 'off';
        input.spellcheck = false;
        inputRow.appendChild(input);

        // Autocomplete dropdown
        const ac = document.createElement('div');
        ac.id = 'console-autocomplete';
        ac.style.cssText = `
            position: absolute; bottom: 100%; left: 0; right: 0;
            background: rgba(0,0,0,0.95);
            border: 1px solid rgba(255,255,255,0.15);
            border-bottom: none; max-height: 200px; overflow-y: auto;
            display: none; z-index: 10000;
        `;
        inputRow.appendChild(ac);
        this._acEl = ac;
        this._acIdx = -1;

        div.appendChild(inputRow);
        document.body.appendChild(div);
        this.element = div;
        this.outputEl = output;
        this.inputEl = input;
        this._acEl = ac;
    }

    _updateAutocomplete() {
        const text = this.inputEl.value.toLowerCase();
        if (!text) { this._acEl.style.display = 'none'; this._acIdx = -1; return; }
        const matches = Object.entries(COMMANDS).filter(([cmd, info]) => cmd.startsWith(text));
        if (!matches.length) { this._acEl.style.display = 'none'; this._acIdx = -1; return; }
        this._acEl.innerHTML = matches.map(([cmd, info], i) => {
            const sel = i === this._acIdx ? ' style="background: var(--accent, #ff8800); color: #000;"' : '';
            const hostLabel = commandNeedsHost(info) ? ' [HOST]' : '';
            return `<div${sel} data-cmd="${cmd}"><b>${cmd}</b> <span style="color:#888;font-size:11px">${info.desc}${hostLabel}</span></div>`;
        }).join('');
        this._acEl.querySelectorAll('div').forEach((d, i) => {
            d.style.cssText = 'padding: 3px 10px; cursor: pointer;' + (i === this._acIdx ? 'background: var(--accent, #ff8800); color: #000;' : '');
            d.addEventListener('mousedown', e => {
                e.preventDefault();
                this.inputEl.value = d.dataset.cmd + ' ';
                this._acEl.style.display = 'none';
                this._acIdx = -1;
                this.inputEl.focus();
            });
        });
        this._acEl.style.display = 'block';
    }

    bindKeys() {
        document.addEventListener('keydown', e => {
            if (e.code === 'Backquote') {
                e.preventDefault();
                this.toggle();
                return;
            }
            if (!this.visible) return;

            if (e.code === 'Enter') {
                e.preventDefault();
                this._acEl.style.display = 'none';
                this._acIdx = -1;
                this.submit();
            } else if (e.code === 'Escape') {
                e.preventDefault();
                this._acEl.style.display = 'none';
                this._acIdx = -1;
                this.hide();
            } else if (e.code === 'Tab') {
                e.preventDefault();
                // Autocomplete first match
                const first = this._acEl.querySelector('div');
                if (first && this._acEl.style.display !== 'none') {
                    this.inputEl.value = first.dataset.cmd + ' ';
                    this._acEl.style.display = 'none';
                    this._acIdx = -1;
                }
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                if (this._acEl.style.display !== 'none') {
                    // Navigate dropdown
                    const items = this._acEl.querySelectorAll('div');
                    if (items.length) {
                        this._acIdx = (this._acIdx <= 0 ? items.length - 1 : this._acIdx - 1);
                        this._updateAutocomplete();
                    }
                } else {
                    this.navigateHistory(-1);
                }
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                if (this._acEl.style.display !== 'none') {
                    const items = this._acEl.querySelectorAll('div');
                    if (items.length) {
                        this._acIdx = (this._acIdx >= items.length - 1 ? -1 : this._acIdx + 1);
                        this._updateAutocomplete();
                    }
                } else {
                    this.navigateHistory(1);
                }
            } else {
                // Defer autocomplete update to after the input value updates
                setTimeout(() => this._updateAutocomplete(), 10);
            }
        });
        this.inputEl.addEventListener('input', () => this._updateAutocomplete());
    }

    toggle() {
        if (this.visible) this.hide();
        else this.show();
    }

    show() {
        this.visible = true;
        this.element.style.display = 'flex';
        this.inputEl.focus();
        if (this.game && this.game.player) {
            try { this.game.player.unlock(); } catch {}
        }
    }

    hide() {
        this.visible = false;
        this.element.style.display = 'none';
        this.inputEl.blur();
        if (this.game && this.game.player && this.game.state === 'PLAYING') {
            this.game.player.lock();
        }
    }

    submit() {
        const text = this.inputEl.value.trim();
        this.inputEl.value = '';
        if (!text) return;

        this.log(`] ${text}`);
        this.history.push(text);
        this.historyIdx = this.history.length;

        this.execute(text);
    }

    execute(cmdStr) {
        const parts = cmdStr.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        const command = COMMANDS[cmd];
        if (!command) {
            this.log(`Unknown command: ${cmd}. Type help`);
            return false;
        }

        const isHost = !this.game?.network?.connected || this.game.network.isHost === true;
        if (commandNeedsHost(command) && !isHost) {
            this.log(`Host only command: ${cmd}`);
            return false;
        }

        const result = command.run(this.game, args, (msg) => this.log(msg));
        if (result === 'clear_only') {
            this.lines = [];
            this.outputEl.textContent = '';
        }
        return result;
    }

    navigateHistory(dir) {
        const newIdx = this.historyIdx + dir;
        if (newIdx < 0 || newIdx >= this.history.length) return;
        this.historyIdx = newIdx;
        this.inputEl.value = this.history[this.historyIdx] || '';
    }

    log(msg) {
        this.lines.push(msg);
        if (this.lines.length > this.maxLines) this.lines.shift();
        if (this.outputEl) {
            this.outputEl.textContent = this.lines.join('\n');
            this.outputEl.scrollTop = this.outputEl.scrollHeight;
        }
    }
}
