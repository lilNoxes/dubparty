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
let currentManifest = "Северус Снейп о Справедливости [720p]_manifest.json";
let availableScenes = [];
let selectedScene = null;
let players = [];
let ws = null;
let currentManifestData = null;
let currentLineIndex = 0;
let videoStopTimeout = null;

function switchState(stateName) {
    // If preview modal was open, close and pause it when switching states
    closePreview();
    Object.values(ui.states).forEach(el => el.classList.add('hidden'));
    ui.states[stateName].classList.remove('hidden');
}

// --- Preview Modal Logic ---
const previewModal = document.getElementById('preview-modal');
const previewVideo = document.getElementById('preview-modal-video');
const previewTitle = document.getElementById('preview-modal-title');
const btnClosePreview = document.getElementById('btn-close-preview');
const btnModalCloseFooter = document.getElementById('btn-modal-close-footer');
const btnModalSelectScene = document.getElementById('btn-modal-select-scene');
const btnLobbyPreview = document.getElementById('btn-lobby-preview');
let previewManifestTarget = null;

function openPreview(videoUrl, title, manifestFilename = null) {
    previewTitle.textContent = title || "Оригинал сцены";
    previewVideo.src = videoUrl;
    previewVideo.muted = false; // Audio enabled for reference
    previewVideo.currentTime = 0;
    previewManifestTarget = manifestFilename;
    
    previewModal.classList.remove('hidden');
    previewVideo.load();
    previewVideo.play().catch(e => console.log("Auto-preview play blocked:", e));
}

function closePreview() {
    if (previewVideo) {
        previewVideo.pause();
        previewVideo.currentTime = 0;
    }
    if (previewModal) {
        previewModal.classList.add('hidden');
    }
}

if (btnClosePreview) btnClosePreview.addEventListener('click', closePreview);
if (btnModalCloseFooter) btnModalCloseFooter.addEventListener('click', closePreview);

// Close on backdrop click
if (previewModal) {
    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) closePreview();
    });
}

if (btnModalSelectScene) {
    btnModalSelectScene.addEventListener('click', () => {
        if (previewManifestTarget) {
            selectSceneByManifest(previewManifestTarget);
        }
        closePreview();
    });
}

if (btnLobbyPreview) {
    btnLobbyPreview.addEventListener('click', () => {
        if (selectedScene) {
            openPreview(selectedScene.video_url, selectedScene.title, currentManifest);
        } else if (currentManifestData && currentManifestData.video_filename) {
            const url = `/media/movies/${encodeURIComponent(currentManifestData.video_filename)}`;
            openPreview(url, currentManifestData.title || "Оригинал сцены", currentManifest);
        }
    });
}

// --- Scenes Catalog / Library Logic ---
const scenesContainer = document.getElementById('scenes-catalog-container');

async function loadScenesCatalog() {
    try {
        const res = await fetch('/api/media/manifests');
        const manifests = await res.json();
        
        // Filter out dummy/test manifests
        availableScenes = manifests.filter(m => m.video_filename && !m.video_filename.includes('dummy'));
        
        if (availableScenes.length === 0) {
            scenesContainer.innerHTML = `
                <div class="col-span-full py-10 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-white/5 p-6">
                    <p class="text-base font-bold text-slate-300 mb-1">Сцены еще не добавлены</p>
                    <p class="text-xs text-slate-500">Загрузите свой видеоролик (.mp4) через кнопку ниже</p>
                </div>`;
            return;
        }

        renderScenesGrid();

        // Default: select first scene or keep current if it still exists
        const toSelect = availableScenes.find(s => s.manifest_filename === currentManifest) || availableScenes[0];
        if (toSelect) {
            selectSceneByManifest(toSelect.manifest_filename);
        }

    } catch (e) {
        console.error("Could not load scenes catalog:", e);
        scenesContainer.innerHTML = `
            <div class="col-span-full py-8 text-center text-red-400">
                <p>Не удалось загрузить каталог сцен: ${e.message}</p>
            </div>`;
    }
}

function renderScenesGrid() {
    scenesContainer.innerHTML = availableScenes.map(scene => {
        const isSelected = (selectedScene && selectedScene.manifest_filename === scene.manifest_filename);
        const characters = scene.characters || ["Персонаж 1", "Персонаж 2"];
        const durationSec = scene.duration_sec || 0;
        const linesCount = scene.lines_count || (scene.lines ? scene.lines.length : 0);

        return `
        <div class="scene-card group relative bg-slate-900/90 hover:bg-slate-850 border ${isSelected ? 'border-purple-500 ring-2 ring-purple-400/80 shadow-purple-500/30' : 'border-white/10 hover:border-purple-500/40'} rounded-3xl p-5 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-lg hover:shadow-xl" data-manifest="${scene.manifest_filename}">
            
            ${isSelected ? `
            <div class="absolute -top-3 -right-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[11px] font-black px-3 py-1 rounded-full shadow-lg flex items-center gap-1 z-10">
                <span>✓</span> Выбрано
            </div>` : ''}

            <div>
                <!-- Top Badges -->
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="text-xs font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                        <span>⏱️</span> ${durationSec} сек
                    </span>
                    <span class="text-xs font-bold text-slate-300 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full flex items-center gap-1">
                        <span>💬</span> ${linesCount} реплик
                    </span>
                </div>

                <!-- Title -->
                <h3 class="text-lg font-black text-white group-hover:text-purple-300 transition-colors mb-2 line-clamp-2 leading-snug">
                    ${scene.title}
                </h3>

                <!-- Characters -->
                <div class="flex flex-wrap gap-1.5 mb-4">
                    ${characters.map(c => `
                        <span class="text-[11px] font-bold bg-slate-800/90 text-slate-300 border border-white/10 px-2 py-0.5 rounded-lg">
                            🎭 ${c}
                        </span>
                    `).join('')}
                </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center gap-2 pt-3 border-t border-white/5 mt-2">
                <button class="btn-card-preview flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold rounded-xl border border-white/10 transition-all flex items-center justify-center gap-1.5 shadow-sm" data-manifest="${scene.manifest_filename}">
                    <span>👁️</span> Смотреть
                </button>
                <button class="btn-card-select flex-1 py-2.5 px-3 ${isSelected ? 'bg-emerald-600 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'} text-xs font-black rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5" data-manifest="${scene.manifest_filename}">
                    <span>${isSelected ? '✓ Выбрано' : 'Выбрать'}</span>
                </button>
            </div>
        </div>`;
    }).join('');

    // Wire clicks on cards and buttons
    scenesContainer.querySelectorAll('.scene-card').forEach(card => {
        const manifest = card.getAttribute('data-manifest');
        
        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-card-preview')) return;
            selectSceneByManifest(manifest);
        });

        const previewBtn = card.querySelector('.btn-card-preview');
        if (previewBtn) {
            previewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const scene = availableScenes.find(s => s.manifest_filename === manifest);
                if (scene) {
                    openPreview(scene.video_url, scene.title, scene.manifest_filename);
                }
            });
        }
    });
}

function selectSceneByManifest(manifestFilename) {
    const scene = availableScenes.find(s => s.manifest_filename === manifestFilename);
    if (!scene) return;

    selectedScene = scene;
    currentManifest = manifestFilename;

    // Update buttons and titles
    ui.createBtn.disabled = false;
    ui.createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    ui.createBtn.innerHTML = `<span>🚀</span> Создать комнату: "${scene.title}"`;

    const lobbyTitle = document.getElementById('lobby-scene-title');
    if (lobbyTitle) lobbyTitle.textContent = scene.title;

    renderScenesGrid();
}

// Initial load of catalog
loadScenesCatalog();

// --- Video Upload Handler ---
const uploadBtn = document.getElementById('btn-upload-video');
const fileInput = document.getElementById('video-upload-input');
const uploadStatus = document.getElementById('upload-status');

if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        uploadStatus.classList.remove('hidden');
        uploadStatus.textContent = "Загрузка файла на сервер...";
        uploadStatus.classList.remove('text-green-400', 'text-red-500');
        uploadStatus.classList.add('text-yellow-400');

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch('/api/media/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            uploadStatus.textContent = "ИИ обрабатывает видео (Whisper + Gemini)... Пожалуйста, подождите пару минут.";
            const manifestName = data.filename.split('.')[0] + '_manifest.json';
            
            const checkInterval = setInterval(async () => {
                const mRes = await fetch('/api/media/manifests');
                const manifests = await mRes.json();
                
                if (manifests.some(m => m.video_filename === data.filename)) {
                    clearInterval(checkInterval);
                    uploadStatus.textContent = "Анализ завершен! Сцена добавлена в библиотеку.";
                    uploadStatus.classList.replace('text-yellow-400', 'text-green-400');
                    
                    await loadScenesCatalog();
                    selectSceneByManifest(manifestName);
                }
            }, 4000);

        } catch (err) {
            uploadStatus.textContent = "Ошибка загрузки: " + err.message;
            uploadStatus.classList.replace('text-yellow-400', 'text-red-500');
        }
    });
}

// --- Create Room & Lobby ---
let roleToPlayerMap = {}; // "Северус Снейп" -> "Игрок 1"
let playerToRolesMap = {}; // "Игрок 1" -> ["Северус Снейп"]

function assignRoles() {
    roleToPlayerMap = {};
    playerToRolesMap = {};
    if (!currentManifestData || !currentManifestData.lines || players.length === 0) return;

    // Get unique characters in order
    let uniqueRoles = [];
    if (currentManifestData.characters && currentManifestData.characters.length > 0) {
        uniqueRoles = [...currentManifestData.characters];
    } else {
        currentManifestData.lines.forEach(line => {
            const r = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
            if (!uniqueRoles.includes(r)) uniqueRoles.push(r);
        });
    }

    // Distribute characters among joined players
    uniqueRoles.forEach((role, i) => {
        const assignedPlayer = players[i % players.length];
        roleToPlayerMap[role] = assignedPlayer;
        if (!playerToRolesMap[assignedPlayer]) playerToRolesMap[assignedPlayer] = [];
        playerToRolesMap[assignedPlayer].push(role);
    });

    // Broadcast assigned roles to phones
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

function getTargetPlayerForLine(line, index) {
    const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
    if (roleToPlayerMap[role]) {
        return roleToPlayerMap[role];
    }
    if (players.length > 0) {
        return players[index % players.length];
    }
    return "Игрок";
}

ui.createBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`/api/game/create?manifest_filename=${encodeURIComponent(currentManifest)}`, { method: 'POST' });
        const data = await res.json();
        
        currentRoom = data.room_code;
        
        // Immediately fetch the manifest for room state
        const roomRes = await fetch(`/api/game/${currentRoom}`);
        const roomData = await roomRes.json();
        currentManifestData = roomData.manifest;
        
        ui.headerRoomCode.textContent = currentRoom;
        ui.roomBadge.classList.remove('hidden');

        const lobbyTitle = document.getElementById('lobby-scene-title');
        if (lobbyTitle) {
            lobbyTitle.textContent = (selectedScene && selectedScene.title) ? selectedScene.title : (currentManifestData.title || currentManifest);
        }
        
        generateQRCode();
        switchState('lobby');
        connectWebSocket();
        
    } catch (e) {
        alert("Ошибка создания комнаты: " + e.message);
    }
});

function generateQRCode() {
    const hostUrl = window.location.origin;
    const joinUrl = `${hostUrl}/mobile/index.html?room=${currentRoom}`;
    
    document.getElementById('qr-url-text').textContent = joinUrl;
    
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
        text: joinUrl,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// --- WebSocket Connection ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/HOST`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
    };

    ws.onclose = () => {
        console.warn("Host WS closed. Reconnecting...");
        setTimeout(() => {
            if (currentRoom) connectWebSocket();
        }, 2000);
    };
}

function handleServerEvent(msg) {
    if (msg.room_id && msg.room_id !== currentRoom) return;
    
    const data = msg.data || msg;
    const action = data.action || msg.action;

    // Player joined
    if (action === "player_joined" && msg.player !== "HOST") {
        if (!players.includes(msg.player)) {
            players.push(msg.player);
            assignRoles();
            updatePlayersUI();
        }
    }
    
    // Player left
    if (action === "player_left" && msg.player !== "HOST") {
        players = players.filter(p => p !== msg.player);
        assignRoles();
        updatePlayersUI();
    }

    // Player ready
    if (action === "user_ready") {
        ws.send(JSON.stringify({ action: "do_countdown" }));
        
        runHostCountdown(() => {
            startLineRecording(currentLineIndex);
        });
    }

    // Take uploaded
    if (action === "take_uploaded") {
        document.getElementById('host-instruction').textContent = "✔️ Дубль принят! Переходим к следующей фразе...";
        
        currentLineIndex++;
        if (currentLineIndex < currentManifestData.lines.length) {
            setTimeout(() => {
                presentLine(currentLineIndex);
            }, 1200);
        } else {
            setTimeout(() => {
                finishAndMix();
            }, 1000);
        }
    }
}

function updatePlayersUI() {
    ui.playerCount.textContent = `(${players.length})`;
    const roleHintEl = document.getElementById('lobby-role-hint');
    
    if (players.length === 0) {
        ui.playersList.innerHTML = '<p class="text-slate-500 italic text-center my-auto">Ждем подключения игроков по QR-коду...</p>';
        ui.startGameBtn.disabled = true;
        ui.startGameBtn.classList.add('opacity-50', 'cursor-not-allowed');
        if (roleHintEl) roleHintEl.textContent = "";
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

        // Dynamic Role Hint
        if (roleHintEl && currentManifestData) {
            const chars = currentManifestData.characters || ["Персонаж 1", "Персонаж 2"];
            if (players.length === 1 && chars.length > 1) {
                roleHintEl.innerHTML = `💡 В сцене ${chars.length} роли (${chars.join(', ')}). Подключите 2-й смартфон, чтобы разделить персонажей! Сейчас вы озвучите всех.`;
            } else if (players.length >= chars.length && chars.length > 0) {
                roleHintEl.innerHTML = `🎉 Отлично! Все роли распределены между игроками.`;
            } else {
                roleHintEl.innerHTML = "";
            }
        }
    }
}

// --- Start Game (Cinema & Recording) ---
ui.startGameBtn.addEventListener('click', async () => {
    switchState('cinema');
    
    try {
        const res = await fetch(`/api/game/${currentRoom}`);
        const roomState = await res.json();
        currentManifestData = roomState.manifest;
        
        if (!currentManifestData || !currentManifestData.lines || currentManifestData.lines.length === 0) {
            alert("Ошибка: манифест сцены пуст!");
            switchState('setup');
            return;
        }

        assignRoles();

        const videoUrl = `/media/movies/${encodeURIComponent(currentManifestData.video_filename)}`;
        ui.video.src = videoUrl;
        ui.video.load();
        ui.video.muted = true; // Muted on host TV during recording to prevent mic echo
        
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
    const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
    const targetPlayer = getTargetPlayerForLine(line, index);
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

    // Broadcast to phones
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

function startLineRecording(index) {
    const line = currentManifestData.lines[index];
    const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
    const targetPlayer = getTargetPlayerForLine(line, index);
    const durationMs = Math.round((line.end - line.start) * 1000);
    
    document.getElementById('host-instruction').textContent = `🔴 Идет запись голоса... Говорит ${targetPlayer} (${role})!`;

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

// --- Mixing and Premiere ---
async function finishAndMix() {
    switchState('mixing');
    
    try {
        const res = await fetch(`/api/game/${currentRoom}/mix`, { method: 'POST' });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "FFmpeg mixing failed on server.");
        }
        
        const data = await res.json();
        
        switchState('premiere');
        ui.premiereVideo.src = data.url;
        ui.premiereVideo.load();
        ui.premiereVideo.play().catch(e => console.log("Autoplay error:", e));
        
        const downloadBtn = document.getElementById('btn-download-video');
        if (downloadBtn) {
            downloadBtn.href = data.url;
            downloadBtn.download = `${currentRoom}_dubbed_${Date.now()}.mp4`;
        }
        
    } catch (e) {
        alert("Ошибка склейки видео: " + e.message);
        switchState('setup');
    }
}

// Premiere Actions
const btnReplay = document.getElementById('btn-replay-video');
if (btnReplay) {
    btnReplay.addEventListener('click', () => {
        ui.premiereVideo.currentTime = 0;
        ui.premiereVideo.play();
    });
}

const btnRedub = document.getElementById('btn-redub-scene');
if (btnRedub) {
    btnRedub.addEventListener('click', async () => {
        try {
            await fetch(`/api/game/${currentRoom}/reset`, { method: 'POST' });
            switchState('cinema');
            currentLineIndex = 0;
            presentLine(0);
        } catch (e) {
            alert("Не удалось перезапустить сцену: " + e.message);
        }
    });
}

const btnBackLobby = document.getElementById('btn-back-lobby');
if (btnBackLobby) {
    btnBackLobby.addEventListener('click', () => {
        switchState('lobby');
    });
}

const btnNewVideo = document.getElementById('btn-new-video');
if (btnNewVideo) {
    btnNewVideo.addEventListener('click', () => {
        switchState('setup');
        loadScenesCatalog();
    });
}
