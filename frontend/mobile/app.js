// Game State
let currentRoom = null;
let playerName = null;
let mediaRecorder = null;
let audioChunks = [];
let ws = null;

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
        testMicBtn: document.getElementById('test-mic-btn')
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

// Auto-fill room code if present in URL (e.g. from scanning a QR code on TV)
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
        // Validate room exists on backend
        const res = await fetch(`/api/game/${code}`);
        if (!res.ok) throw new Error("Комната не найдена");
        
        currentRoom = code;
        playerName = name;
        
        ui.lobby.roomCodeDisplay.textContent = currentRoom;
        switchState('lobby');
        
        connectWebSocket();
        
    } catch (e) {
        ui.join.error.textContent = e.message;
        ui.join.error.classList.remove('hidden');
    }
});

// Request Microphone early so iOS Safari doesn't block it later during game loop
ui.lobby.testMicBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ui.lobby.testMicBtn.textContent = "Микрофон готов ✓";
        ui.lobby.testMicBtn.classList.replace('text-gray-300', 'text-green-400');
        // Stop tracks immediately to avoid keeping mic hot indefinitely
        stream.getTracks().forEach(t => t.stop());
    } catch (err) {
        alert("ОШИБКА: Нет доступа к микрофону! Зайдите по HTTPS или дайте разрешение в настройках.");
    }
});

// --- WebSocket logic ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/${playerName}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
    };
    
    ws.onclose = () => {
        console.warn("WebSocket closed. Attempting reconnect...");
        setTimeout(connectWebSocket, 2000); // auto-reconnect
    };
}

let activeLine = null;
let progressBarInterval = null;

function handleServerEvent(msg) {
    if (msg.room_id && msg.room_id !== currentRoom) return;
    
    const data = msg.data || msg;
    const action = data.action || msg.action;
    if (!action) return;

    // Host assigns a character role to this player
    if (action === "assign_role" && (data.player === playerName || msg.player === playerName)) {
        const role = data.role || msg.role;
        document.getElementById('player-role').textContent = role;
    }

    // Host presents a line
    if (action === "prepare_line") {
        switchState('recording');
        activeLine = data;
        
        // Update line information
        document.getElementById('mobile-line-progress').textContent = `Фраза ${data.line_index + 1}/${data.total_lines}`;
        document.getElementById('mobile-character-badge').textContent = data.role_name || "Персонаж";
        document.getElementById('acting-cue-text').textContent = data.acting_cue || "";
        document.getElementById('teleprompter-text').textContent = `"${data.text}"`;
        document.getElementById('take-status-text').textContent = "";
        
        // Reset sub-boxes
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
            
            // Light vibration alert on phone when turn arrives
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
            myTurnBox.classList.add('hidden');
            notMyTurnBox.classList.remove('hidden');
            document.getElementById('active-speaker-name').textContent = `${data.player} (${data.role_name || "Персонаж"})`;
        }
    }

    // Countdown signal from host
    if (action === "do_countdown") {
        if (activeLine && activeLine.player === playerName) {
            runMobileCountdown();
        }
    }

    // Recording start signal
    if (action === "start_recording") {
        if (activeLine && activeLine.player === playerName) {
            startRecordingActiveLine(activeLine.line_index, activeLine.duration_ms, activeLine.start_ms);
        }
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
