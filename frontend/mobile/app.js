// Game State
let currentRoom = null;
let playerName = null;
let mediaRecorder = null;
let audioChunks = [];
let ws = null;

// Role Selection State
let currentSceneCharacters = [];
let roleAssignments = {};
let myChosenRole = null;

// UI Elements
const ui = {
    states: {
        join: document.getElementById('join-state'),
        lobby: document.getElementById('lobby-state'),
        recording: document.getElementById('recording-state'),
    },
    join: {
        codeInput: document.getElementById('room-code-input'),
        nameInput: document.getElementById('player-name-input'),
        btn: document.getElementById('join-btn'),
        error: document.getElementById('join-error')
    },
    lobby: {
        roomCodeDisplay: document.getElementById('lobby-room-code'),
        testMicBtn: document.getElementById('test-mic-btn'),
        playerBadge: document.getElementById('player-badge'),
        playerRole: document.getElementById('player-role'),
        charList: document.getElementById('character-selection-list'),
        voiceAllBtn: document.getElementById('btn-voice-all')
    },
    record: {
        prompter: document.getElementById('teleprompter-text'),
        countdown: document.getElementById('countdown-text'),
        micBtn: document.getElementById('mic-button')
    }
};

// --- Initialization ---
function switchState(stateName) {
    Object.values(ui.states).forEach(el => el.classList.add('hidden'));
    ui.states[stateName].classList.remove('hidden');
}

// Auto-fill room code if present in URL (e.g. from scanning QR code on TV)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('room')) {
    ui.join.codeInput.value = urlParams.get('room');
}

// --- Interactions ---
ui.join.btn.addEventListener('click', async () => {
    const code = ui.join.codeInput.value.trim().toUpperCase();
    const name = ui.join.nameInput.value.trim();

    if (!code || !name) {
        ui.join.error.textContent = "Введите код комнаты и свое имя!";
        ui.join.error.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`/api/game/${code}`);
        if (!res.ok) throw new Error("Комната не найдена");
        
        currentRoom = code;
        playerName = name;
        
        ui.lobby.roomCodeDisplay.textContent = currentRoom;
        if (ui.lobby.playerBadge) ui.lobby.playerBadge.textContent = `👤 ${playerName}`;
        
        switchState('lobby');
        connectWebSocket();
        
    } catch (e) {
        ui.join.error.textContent = e.message;
        ui.join.error.classList.remove('hidden');
    }
});

// Request Microphone early so mobile browsers don't block it later
ui.lobby.testMicBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ui.lobby.testMicBtn.textContent = "Микрофон готов ✓";
        ui.lobby.testMicBtn.classList.replace('text-slate-300', 'text-green-400');
        stream.getTracks().forEach(t => t.stop());
    } catch (err) {
        alert("ОШИБКА: Нет доступа к микрофону! Зайдите по HTTPS или дайте разрешение в настройках.");
    }
});

// Voice All Characters button click
if (ui.lobby.voiceAllBtn) {
    ui.lobby.voiceAllBtn.addEventListener('click', () => {
        selectRole("__ALL__");
    });
}

// --- WebSocket logic ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/${playerName}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        // Request latest scene character list immediately
        ws.send(JSON.stringify({
            action: "request_roles",
            player: playerName
        }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
    };
    
    ws.onclose = () => {
        console.warn("WebSocket closed. Attempting reconnect...");
        setTimeout(connectWebSocket, 2000);
    };
}

let activeLine = null;
let progressBarInterval = null;

function handleServerEvent(msg) {
    if (msg.room_id && msg.room_id !== currentRoom) return;
    
    const data = msg.data || msg;
    const action = data.action || msg.action;
    if (!action) return;

    // Real-time Role updates from Host TV
    if (action === "roles_update") {
        currentSceneCharacters = data.characters || [];
        roleAssignments = data.assignments || {};
        
        // Check which role(s) are assigned to this player
        const myRoles = [];
        Object.entries(roleAssignments).forEach(([r, p]) => {
            if (p === playerName) myRoles.push(r);
        });

        const roleEl = ui.lobby.playerRole;
        if (myRoles.length === 0) {
            myChosenRole = null;
            if (roleEl) {
                roleEl.textContent = "Не выбрана (нажми ниже)";
                roleEl.className = "text-sm sm:text-base font-black text-amber-400";
            }
        } else if (myRoles.length === currentSceneCharacters.length && myRoles.length > 1) {
            myChosenRole = "__ALL__";
            if (roleEl) {
                roleEl.textContent = "🌟 Все персонажи";
                roleEl.className = "text-sm sm:text-base font-black text-purple-400";
            }
        } else {
            myChosenRole = myRoles.join(", ");
            if (roleEl) {
                roleEl.textContent = myChosenRole;
                roleEl.className = "text-sm sm:text-base font-black text-emerald-400";
            }
        }

        renderCharacterSelectionList();
    }

    // Backward-compatible individual role assignment
    if (action === "assign_role" && (data.player === playerName || msg.player === playerName)) {
        const role = data.role || msg.role;
        myChosenRole = role;
        if (ui.lobby.playerRole) {
            ui.lobby.playerRole.textContent = role;
            ui.lobby.playerRole.className = "text-sm sm:text-base font-black text-emerald-400";
        }
    }

    // Original movie dialogue played without recording
    if (action === "prepare_original_line") {
        switchState('recording');
        activeLine = null;

        document.getElementById('mobile-line-progress').textContent = `Фраза ${data.line_index + 1}`;
        document.getElementById('mobile-character-badge').textContent = `Оригинал: ${data.role_name}`;
        document.getElementById('acting-cue-text').textContent = "Оригинальная реплика фильма";
        document.getElementById('teleprompter-text').textContent = `"${data.text}"`;
        document.getElementById('take-status-text').textContent = "";

        document.getElementById('my-turn-box').classList.add('hidden');
        document.getElementById('not-my-turn-box').classList.remove('hidden');
        document.getElementById('active-speaker-name').textContent = `🎬 Оригинал (${data.role_name})`;
    }

    // Host presents a line for recording
    if (action === "prepare_line") {
        switchState('recording');
        activeLine = data;
        
        document.getElementById('mobile-line-progress').textContent = `Фраза ${data.line_index + 1}/${data.total_lines}`;
        document.getElementById('mobile-character-badge').textContent = data.role_name || "Персонаж";
        document.getElementById('acting-cue-text').textContent = data.acting_cue || "";
        document.getElementById('teleprompter-text').textContent = `"${data.text}"`;
        document.getElementById('take-status-text').textContent = "";
        
        document.getElementById('mobile-countdown').classList.add('hidden');
        document.getElementById('recording-indicator-box').classList.add('hidden');
        
        const isMyTurn = (data.player === playerName);
        const myTurnBox = document.getElementById('my-turn-box');
        const notMyTurnBox = document.getElementById('not-my-turn-box');
        const readyBtn = document.getElementById('ready-btn');

        if (isMyTurn) {
            myTurnBox.classList.remove('hidden');
            notMyTurnBox.classList.add('hidden');
            readyBtn.classList.remove('hidden');
            readyBtn.disabled = false;
            readyBtn.classList.remove('opacity-50');
            readyBtn.textContent = `🎙️ Я ГОТОВ (${data.role_name || "Твоя роль"})`;
            
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
            myTurnBox.classList.add('hidden');
            notMyTurnBox.classList.remove('hidden');
            document.getElementById('active-speaker-name').textContent = `${data.player} (${data.role_name || "Персонаж"})`;
        }
    }

    // Countdown signal from host
    if (action === "do_countdown") {
        const isMyTurn = (data.player ? data.player === playerName : (activeLine && activeLine.player === playerName));
        if (isMyTurn) {
            runMobileCountdown();
        }
    }

    // Recording start signal
    if (action === "start_recording") {
        const isMyTurn = (data.player ? data.player === playerName : (activeLine && activeLine.player === playerName));
        if (isMyTurn && activeLine) {
            const durationMs = data.duration_ms || activeLine.duration_ms;
            startRecordingActiveLine(activeLine.line_index, durationMs, activeLine.start_ms);
        }
    }
}

// --- Character Selection UI Rendering ---
function renderCharacterSelectionList() {
    const listEl = ui.lobby.charList;
    if (!listEl) return;

    if (!currentSceneCharacters || currentSceneCharacters.length === 0) {
        listEl.innerHTML = `<p class="text-slate-500 text-xs italic py-4">Ожидание списка ролей от ТВ...</p>`;
        return;
    }

    listEl.innerHTML = currentSceneCharacters.map(char => {
        const assignee = roleAssignments[char.name];
        const isMyRole = (assignee === playerName);
        const isTaken = (assignee && assignee !== playerName);

        let cardClass = "bg-slate-800/80 border-white/10 hover:border-purple-500/40";
        if (isMyRole) {
            cardClass = "bg-emerald-500/15 border-emerald-400 ring-2 ring-emerald-400/50 shadow-emerald-500/20";
        } else if (isTaken) {
            cardClass = "bg-slate-900/60 border-white/5 opacity-80";
        }

        const linesWord = char.linesCount === 1 ? 'реплика' : (char.linesCount < 5 ? 'реплики' : 'реплик');

        return `
        <div class="role-card p-3 rounded-2xl border transition-all text-left flex items-center justify-between cursor-pointer ${cardClass}" data-role="${char.name}">
            <div class="flex flex-col">
                <span class="text-sm font-black text-white flex items-center gap-1.5">
                    <span>🎭</span> ${char.name}
                </span>
                <span class="text-[11px] text-purple-300 font-semibold mt-0.5">
                    ${char.linesCount} ${linesWord} (${char.percent}%)
                </span>
            </div>
            <div>
                ${isMyRole ? `
                    <span class="bg-emerald-500 text-white text-xs font-black px-3 py-1.5 rounded-xl shadow-md flex items-center gap-1">
                        <span>✓</span> Выбран
                    </span>
                ` : (isTaken ? `
                    <button class="bg-slate-700/80 hover:bg-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1.5 rounded-xl border border-white/5 transition-all">
                        Занят: ${assignee}
                    </button>
                ` : `
                    <button class="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-md active:scale-95 transition-all">
                        Выбрать
                    </button>
                `)}
            </div>
        </div>`;
    }).join('');

    // Attach click listeners to role cards
    listEl.querySelectorAll('.role-card').forEach(card => {
        const role = card.getAttribute('data-role');
        card.addEventListener('click', () => {
            selectRole(role);
        });
    });

    // Update Voice All button appearance
    if (ui.lobby.voiceAllBtn) {
        if (myChosenRole === "__ALL__") {
            ui.lobby.voiceAllBtn.className = "mt-2 w-full py-2.5 px-3 bg-purple-600 text-white font-black border border-purple-400 rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/30 shrink-0";
            ui.lobby.voiceAllBtn.innerHTML = `<span>✓</span> Вы озвучиваете ВСЕХ персонажей`;
        } else {
            ui.lobby.voiceAllBtn.className = "mt-2 w-full py-2.5 px-3 bg-slate-900/60 hover:bg-slate-800 border border-purple-500/20 hover:border-purple-500/50 rounded-2xl text-xs font-bold text-purple-300 flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0";
            ui.lobby.voiceAllBtn.innerHTML = `<span>🌟</span> Озвучить всех персонажей (Соло)`;
        }
    }
}

function selectRole(role) {
    if (navigator.vibrate) navigator.vibrate(40);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: "choose_role",
            player: playerName,
            role: role
        }));
    }
}

// Player taps "Я ГОТОВ!"
document.getElementById('ready-btn').addEventListener('click', () => {
    const readyBtn = document.getElementById('ready-btn');
    readyBtn.disabled = true;
    readyBtn.classList.add('opacity-50');
    readyBtn.textContent = "⏳ Запуск...";

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: "user_ready",
            line_index: activeLine ? activeLine.line_index : 0
        }));
    }
});

// Mobile Countdown (3, 2, 1)
function runMobileCountdown() {
    document.getElementById('ready-btn').classList.add('hidden');
    const cdEl = document.getElementById('mobile-countdown');
    cdEl.classList.remove('hidden');

    let count = 3;
    cdEl.textContent = count;
    if (navigator.vibrate) navigator.vibrate(50);

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            cdEl.textContent = count;
            if (navigator.vibrate) navigator.vibrate(50);
        } else {
            clearInterval(timer);
            cdEl.classList.add('hidden');
            if (navigator.vibrate) navigator.vibrate(200);
        }
    }, 1000);
}

// Audio Recording Logic
async function startRecordingActiveLine(lineId, durationMs, startMs) {
    const recBox = document.getElementById('recording-indicator-box');
    const progressBar = document.getElementById('record-progress-bar');
    const statusText = document.getElementById('take-status-text');

    recBox.classList.remove('hidden');
    statusText.textContent = "";
    
    // Add extra buffer time (1000ms) so speech is never cut off
    const totalRecordTime = durationMs + 1000;
    
    // Animate progress bar
    let elapsed = 0;
    progressBar.style.width = "0%";
    if (progressBarInterval) clearInterval(progressBarInterval);
    
    progressBarInterval = setInterval(() => {
        elapsed += 100;
        const pct = Math.min(100, (elapsed / totalRecordTime) * 100);
        progressBar.style.width = `${pct}%`;
        if (elapsed >= totalRecordTime) {
            clearInterval(progressBarInterval);
        }
    }, 100);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            recBox.classList.add('hidden');
            statusText.textContent = "⏳ Отправка дубля на ТВ...";
            
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            await uploadTake(blob, lineId, startMs);
            
            statusText.textContent = "✔️ Дубль успешно отправлен!";
            stream.getTracks().forEach(t => t.stop());

            // Signal host that upload is done!
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    action: "take_uploaded",
                    line_index: lineId
                }));
            }
        };

        mediaRecorder.start();

        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
            }
        }, totalRecordTime);

    } catch (err) {
        statusText.textContent = "Ошибка доступа к микрофону!";
        console.error(err);
    }
}

async function uploadTake(audioBlob, lineId, startMs) {
    const formData = new FormData();
    formData.append('file', audioBlob, `take_${lineId}.webm`);
    formData.append('line_id', lineId);
    formData.append('start_ms', startMs);

    try {
        await fetch(`/api/game/${currentRoom}/upload_take`, {
            method: 'POST',
            body: formData
        });
    } catch (e) {
        console.error("Failed to upload take", e);
    }
}
