const ui = {
    states: {
        setup: document.getElementById('setup-state'),
        lobby: document.getElementById('lobby-state'),
        cinema: document.getElementById('cinema-state'),
        mixing: document.getElementById('mixing-state'),
        premiere: document.getElementById('premiere-state')
    },
    roomBadge: document.getElementById('room-badge'),
    headerRoomCode: document.getElementById('header-room-code'),
    createBtn: document.getElementById('btn-create-room'),
    startGameBtn: document.getElementById('btn-start-game'),
    playersList: document.getElementById('players-list'),
    playerCount: document.getElementById('player-count'),
    video: document.getElementById('main-video'),
    premiereVideo: document.getElementById('premiere-video'),
    speakerDisplay: document.getElementById('current-speaker-display'),
    lineDisplay: document.getElementById('current-line-display')
};

let currentRoom = null;
let currentManifest = "demo.json";
let players = [];
let ws = null;

function switchState(stateName) {
    Object.values(ui.states).forEach(el => el.classList.add('hidden'));
    ui.states[stateName].classList.remove('hidden');
}

// --- 0. Upload Video ---
const uploadBtn = document.getElementById('btn-upload-video');
const fileInput = document.getElementById('video-upload-input');
const uploadStatus = document.getElementById('upload-status');

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadStatus.classList.remove('hidden');
    uploadStatus.textContent = "Загрузка на сервер...";

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch('/api/media/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        // Polling loop to wait for manifest generation
        uploadStatus.textContent = "ИИ анализирует видео (Whisper + Gemini)... это займет пару минут.";
        const manifestName = data.filename.split('.')[0] + '_manifest.json';
        
        const checkInterval = setInterval(async () => {
            const mRes = await fetch('/api/media/manifests');
            const manifests = await mRes.json();
            
            if (manifests.some(m => m.video_filename === data.filename)) {
                clearInterval(checkInterval);
                currentManifest = manifestName;
                uploadStatus.textContent = "Анализ завершен! Можно создавать комнату.";
                uploadStatus.classList.replace('text-yellow-400', 'text-green-400');
                
                ui.createBtn.disabled = false;
                ui.createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }, 5000);

    } catch (err) {
        uploadStatus.textContent = "Ошибка загрузки: " + err.message;
        uploadStatus.classList.replace('text-yellow-400', 'text-red-500');
    }
});

// --- 0. Check for already processed videos on startup ---
async function checkExistingManifests() {
    try {
        const res = await fetch('/api/media/manifests');
        const manifests = await res.json();
        
        // Filter out demo.json
        const realManifests = manifests.filter(m => m.video_filename && !m.video_filename.includes('dummy'));
        
        if (realManifests.length > 0) {
            const latest = realManifests[realManifests.length - 1];
            currentManifest = latest.video_filename.split('.')[0] + '_manifest.json';
            
            uploadStatus.classList.remove('hidden');
            uploadStatus.textContent = `Готово! Найдено обработанное видео: "${latest.video_filename}"`;
            uploadStatus.classList.remove('text-yellow-400');
            uploadStatus.classList.add('text-green-400');
            
            ui.createBtn.disabled = false;
            ui.createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    } catch (e) {
        console.error("Could not check manifests:", e);
    }
}
checkExistingManifests();

// --- 1. Create Room ---
let roleToPlayerMap = {}; // "СЕВЕРУС СНЕЙП" -> "Игрок 1"
let playerToRolesMap = {}; // "Игрок 1" -> ["СЕВЕРУС СНЕЙП"]

function assignRoles() {
    roleToPlayerMap = {};
    playerToRolesMap = {};
    if (!currentManifestData || !currentManifestData.lines || players.length === 0) return;

    // Get unique characters in order of appearance
    const uniqueRoles = [];
    currentManifestData.lines.forEach(line => {
        const r = line.role_name || "Персонаж 1";
        if (!uniqueRoles.includes(r)) uniqueRoles.push(r);
    });

    uniqueRoles.forEach((role, i) => {
        const assignedPlayer = players[i % players.length];
        roleToPlayerMap[role] = assignedPlayer;
        if (!playerToRolesMap[assignedPlayer]) playerToRolesMap[assignedPlayer] = [];
        playerToRolesMap[assignedPlayer].push(role);
    });

    // Notify each player about their assigned roles
    players.forEach(p => {
        const roles = playerToRolesMap[p] || ["Зритель"];
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "assign_role",
                player: p,
                role: roles.join(", ")
            }));
        }
    });
}

ui.createBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`/api/game/create?manifest_filename=${currentManifest}`, { method: 'POST' });
        const data = await res.json();
        
        currentRoom = data.room_code;
        
        // Immediately fetch the manifest for role distribution
        const roomRes = await fetch(`/api/game/${currentRoom}`);
        const roomData = await roomRes.json();
        currentManifestData = roomData.manifest;
        
        ui.headerRoomCode.textContent = currentRoom;
        ui.roomBadge.classList.remove('hidden');
        
        generateQRCode();
        switchState('lobby');
        connectWebSocket();
        
    } catch (e) {
        alert("Ошибка создания комнаты: " + e.message);
    }
});

function generateQRCode() {
    // Dynamic hostUrl for local, tunnel, or Infrlo cloud
    const hostUrl = window.location.origin;
    
    // URL for the mobile controller
    const joinUrl = `${hostUrl}/mobile/index.html?room=${currentRoom}`;
    
    document.getElementById('qr-url-text').textContent = joinUrl;
    
    document.getElementById('qrcode').innerHTML = ""; // clear previous
    new QRCode(document.getElementById("qrcode"), {
        text: joinUrl,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// --- 2. WebSocket Connection ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/HOST`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
    };
}

function handleServerEvent(msg) {
    if (msg.room_id && msg.room_id !== currentRoom) return;
    
    // If wrapped in generic data envelope
    const data = msg.data || msg;
    const action = data.action || msg.action;

    // A player joined the room
    if (action === "player_joined" && msg.player !== "HOST") {
        if (!players.includes(msg.player)) {
            players.push(msg.player);
            assignRoles();
            updatePlayersUI();
        }
    }
    
    if (action === "player_left" && msg.player !== "HOST") {
        players = players.filter(p => p !== msg.player);
        assignRoles();
        updatePlayersUI();
    }

    // Active player clicked "Я ГОТОВ! НАЧАТЬ" on phone
    if (action === "user_ready") {
        // Trigger countdown on all screens
        ws.send(JSON.stringify({ action: "do_countdown" }));
        
        runHostCountdown(() => {
            startLineRecording(currentLineIndex);
        });
    }

    // Active player finished recording and uploaded take
    if (action === "take_uploaded") {
        document.getElementById('host-instruction').textContent = "✔️ Дубль принят! Переходим к следующей фразе...";
        
        currentLineIndex++;
        if (currentLineIndex < currentManifestData.lines.length) {
            setTimeout(() => {
                presentLine(currentLineIndex);
            }, 1500);
        } else {
            // All takes recorded! Run FFmpeg mixdown!
            setTimeout(() => {
                finishAndMix();
            }, 1000);
        }
    }
}

function updatePlayersUI() {
    ui.playerCount.textContent = `(${players.length})`;
    
    if (players.length === 0) {
        ui.playersList.innerHTML = '<p class="text-gray-500 italic">Ждем подключения игроков...</p>';
        ui.startGameBtn.disabled = true;
        ui.startGameBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        ui.playersList.innerHTML = players.map(p => {
            const roles = (playerToRolesMap[p] && playerToRolesMap[p].length > 0) ? playerToRolesMap[p].join(", ") : "Ожидание...";
            return `
            <div class="bg-slate-800/80 p-3.5 rounded-2xl font-bold border border-white/10 flex justify-between items-center transition-all shadow-sm">
                <div class="flex flex-col text-left">
                    <span class="text-white text-base">👤 ${p}</span>
                    <span class="text-purple-400 text-xs font-semibold">🎭 Роль: ${roles}</span>
                </div>
                <span class="text-emerald-400 text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">В игре</span>
            </div>`;
        }).join('');
        
        ui.startGameBtn.disabled = false;
        ui.startGameBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// --- 3. Start Game ---
let currentManifestData = null;
let currentLineIndex = 0;
let videoStopTimeout = null;

ui.startGameBtn.addEventListener('click', async () => {
    switchState('cinema');
    
    // Fetch room state to get real manifest
    try {
        const res = await fetch(`/api/game/${currentRoom}`);
        const roomState = await res.json();
        currentManifestData = roomState.manifest;
        
        if (!currentManifestData || !currentManifestData.lines || currentManifestData.lines.length === 0) {
            alert("Ошибка: манифест пуст!");
            switchState('setup');
            return;
        }

        // Re-assign roles based on final player count
        assignRoles();

        // Set video source to the uploaded movie
        const videoUrl = `/media/movies/${encodeURIComponent(currentManifestData.video_filename)}`;
        ui.video.src = videoUrl;
        ui.video.load();
        ui.video.muted = true; // Mute during recording so original dialogue doesn't echo into player mic
        
        currentLineIndex = 0;
        presentLine(0);

    } catch (e) {
        alert("Ошибка старта: " + e.message);
        switchState('setup');
    }
});

function presentLine(index) {
    if (!currentManifestData || index >= currentManifestData.lines.length) return;
    
    const line = currentManifestData.lines[index];
    const role = line.role_name || "Персонаж 1";
    // Target player is the player assigned to this specific character!
    const targetPlayer = roleToPlayerMap[role] || players[index % players.length];
    const textToRead = line.clean_text || line.text;
    const durationMs = Math.round((line.end - line.start) * 1000);
    const startMs = Math.round(line.start * 1000);

    // Update TV Overlay
    document.getElementById('line-progress-badge').textContent = `Фраза ${index + 1} из ${currentManifestData.lines.length}`;
    document.getElementById('host-acting-cue').textContent = line.acting_cue || "";
    ui.speakerDisplay.innerHTML = `<span class="text-green-400 font-bold">${targetPlayer}</span> в роли <span class="text-purple-400 font-bold">${role}</span>`;
    ui.lineDisplay.textContent = `"${textToRead}"`;
    document.getElementById('host-instruction').textContent = `⏳ Ждем, пока ${targetPlayer} (${role}) нажмет «Я ГОТОВ» на телефоне...`;

    // Position video to start of dialogue
    ui.video.pause();
    ui.video.currentTime = Math.max(0, line.start - 0.2);

    // Broadcast to phones that we are preparing this line
    ws.send(JSON.stringify({
        action: "prepare_line",
        line_index: index,
        total_lines: currentManifestData.lines.length,
        player: targetPlayer,
        role_name: role,
        acting_cue: line.acting_cue,
        text: textToRead,
        duration_ms: durationMs,
        start_ms: startMs
    }));
}

// Countdown on Host TV
function runHostCountdown(callback) {
    const cdOverlay = document.getElementById('cinema-countdown');
    const cdNum = document.getElementById('cinema-countdown-num');
    cdOverlay.classList.remove('hidden');
    
    let count = 3;
    cdNum.textContent = count;
    
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            cdNum.textContent = count;
        } else {
            clearInterval(timer);
            cdOverlay.classList.add('hidden');
            callback();
        }
    }, 1000);
}

// Start playing the video clip and tell the active phone to record
function startLineRecording(index) {
    const line = currentManifestData.lines[index];
    const targetPlayer = players[index % players.length];
    const durationMs = Math.round((line.end - line.start) * 1000);
    
    document.getElementById('host-instruction').textContent = `🔴 Идет запись голоса... Говорит ${targetPlayer}!`;

    // Play video during line
    ui.video.currentTime = line.start;
    ui.video.play().catch(e => console.log("Video play prevented:", e));

    if (videoStopTimeout) clearTimeout(videoStopTimeout);
    videoStopTimeout = setTimeout(() => {
        ui.video.pause();
    }, durationMs + 800);

    // Signal phone to record
    ws.send(JSON.stringify({
        action: "start_recording",
        line_index: index,
        player: targetPlayer,
        duration_ms: durationMs
    }));
}

// Finish game and show premiere
async function finishAndMix() {
    switchState('mixing');
    
    try {
        const res = await fetch(`/api/game/${currentRoom}/mix`, { method: 'POST' });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "FFmpeg mixing failed on server.");
        }
        
        const data = await res.json();
        
        // Show dedicated Premiere State
        switchState('premiere');
        ui.premiereVideo.src = data.url;
        ui.premiereVideo.load();
        ui.premiereVideo.play().catch(e => console.log("Autoplay error:", e));
        
        // Setup download link
        const downloadBtn = document.getElementById('btn-download-video');
        downloadBtn.href = data.url;
        downloadBtn.download = `${currentRoom}_dubbed_${Date.now()}.mp4`;
        
    } catch (e) {
        alert("Ошибка склейки видео: " + e.message);
        switchState('setup');
    }
}

// --- Premiere Toolbar Actions ---
document.getElementById('btn-replay-video').addEventListener('click', () => {
    ui.premiereVideo.currentTime = 0;
    ui.premiereVideo.play();
});

document.getElementById('btn-redub-scene').addEventListener('click', async () => {
    try {
        // Reset room takes on server
        await fetch(`/api/game/${currentRoom}/reset`, { method: 'POST' });
        
        // Restart recording
        switchState('cinema');
        document.getElementById('director-overlay').classList.remove('hidden');
        currentLineIndex = 0;
        presentLine(0);
    } catch (e) {
        alert("Не удалось перезапустить сцену: " + e.message);
    }
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
    switchState('lobby');
});

document.getElementById('btn-new-video').addEventListener('click', () => {
    switchState('setup');
});
