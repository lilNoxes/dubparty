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

// Character Role Selection State
let roleAssignments = {}; // e.g. { "Северус Снейп": "Данил", "Гарри Поттер": null }
let roleToPlayerMap = {}; // Final mapping used during recording

function switchState(stateName) {
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
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="text-xs font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                        <span>⏱️</span> ${durationSec} сек
                    </span>
                    <span class="text-xs font-bold text-slate-300 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full flex items-center gap-1">
                        <span>💬</span> ${linesCount} реплик
                    </span>
                </div>

                <h3 class="text-lg font-black text-white group-hover:text-purple-300 transition-colors mb-2 line-clamp-2 leading-snug">
                    ${scene.title}
                </h3>

                <div class="flex flex-wrap gap-1.5 mb-4">
                    ${characters.map(c => `
                        <span class="text-[11px] font-bold bg-slate-800/90 text-slate-300 border border-white/10 px-2 py-0.5 rounded-lg">
                            🎭 ${c}
                        </span>
                    `).join('')}
                </div>
            </div>

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

    ui.createBtn.disabled = false;
    ui.createBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    ui.createBtn.innerHTML = `<span>🚀</span> Создать комнату: "${scene.title}"`;

    const lobbyTitle = document.getElementById('lobby-scene-title');
    if (lobbyTitle) lobbyTitle.textContent = scene.title;

    renderScenesGrid();
}

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

// --- Character Stats & Role Selection Engine ---
function getSceneCharactersWithStats() {
    if (!currentManifestData || !currentManifestData.lines) return [];
    
    const charStats = {};
    currentManifestData.lines.forEach(line => {
        const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
        if (!charStats[role]) {
            charStats[role] = { name: role, linesCount: 0, duration: 0 };
        }
        charStats[role].linesCount += 1;
        charStats[role].duration += ((line.end || 0) - (line.start || 0));
    });

    const totalLines = currentManifestData.lines.length;
    return Object.values(charStats).map(c => ({
        name: c.name,
        linesCount: c.linesCount,
        percent: totalLines > 0 ? Math.round((c.linesCount / totalLines) * 100) : 0,
        durationSec: Math.round(c.duration)
    }));
}

function initRoomRoles() {
    roleAssignments = {};
    const chars = getSceneCharactersWithStats();
    chars.forEach(c => {
        roleAssignments[c.name] = null;
    });
}

function broadcastRolesUpdate() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        action: "roles_update",
        characters: getSceneCharactersWithStats(),
        assignments: roleAssignments,
        players: players
    }));
}

function updateHostLobbyUI() {
    ui.playerCount.textContent = `(${players.length})`;
    const rolesContainer = document.getElementById('lobby-roles-container');
    const playersList = document.getElementById('players-list');
    const roleHintEl = document.getElementById('lobby-role-hint');
    const characters = getSceneCharactersWithStats();

    if (players.length === 0) {
        if (rolesContainer) {
            rolesContainer.innerHTML = '<p class="text-slate-500 italic text-center my-auto py-8">Ждем подключения игроков по QR-коду...</p>';
        }
        if (playersList) playersList.innerHTML = '';
        ui.startGameBtn.disabled = true;
        ui.startGameBtn.classList.add('opacity-50', 'cursor-not-allowed');
        if (roleHintEl) roleHintEl.textContent = "";
        return;
    }

    ui.startGameBtn.disabled = false;
    ui.startGameBtn.classList.remove('opacity-50', 'cursor-not-allowed');

    // Render Character Roles List with assigned players
    if (rolesContainer) {
        rolesContainer.innerHTML = characters.map(char => {
            const assignedPlayer = roleAssignments[char.name];
            const linesWord = char.linesCount === 1 ? 'реплика' : (char.linesCount < 5 ? 'реплики' : 'реплик');

            return `
            <div class="bg-slate-800/80 p-3 rounded-2xl border ${assignedPlayer ? 'border-emerald-500/30 bg-slate-800/95' : 'border-white/10'} flex items-center justify-between transition-all shadow-sm">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center text-lg">
                        🎭
                    </div>
                    <div class="flex flex-col text-left">
                        <span class="font-black text-white text-sm leading-tight">${char.name}</span>
                        <span class="text-[11px] text-purple-300 font-semibold mt-0.5">
                            ${char.linesCount} ${linesWord} (${char.percent}%)
                        </span>
                    </div>
                </div>
                <div>
                    ${assignedPlayer ? `
                        <span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm">
                            <span>👤</span> ${assignedPlayer}
                        </span>
                    ` : `
                        <span class="bg-amber-500/10 text-amber-300 border border-amber-500/20 px-3 py-1.5 rounded-xl text-xs font-semibold animate-pulse flex items-center gap-1">
                            <span>⏳</span> Выберите на телефоне
                        </span>
                    `}
                </div>
            </div>`;
        }).join('');
    }

    // Render Connected Players chips
    if (playersList) {
        playersList.innerHTML = `<span class="text-slate-400 font-medium mr-1">Подключены:</span>` + players.map(p => {
            const pRoles = Object.entries(roleAssignments).filter(([r, pl]) => pl === p).map(([r]) => r);
            const roleText = pRoles.length > 0 ? pRoles.join(', ') : 'выбирает роль...';
            return `
            <span class="bg-slate-800/90 border border-white/10 text-slate-200 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                <span>👤</span> <b>${p}</b> <span class="text-purple-400 text-[11px]">(${roleText})</span>
            </span>`;
        }).join('');
    }

    // Dynamic Role Hint
    if (roleHintEl) {
        const unassigned = characters.filter(c => !roleAssignments[c.name]);
        if (players.length === 1 && characters.length > 1 && unassigned.length > 0) {
            roleHintEl.innerHTML = `💡 В сцене ${characters.length} роли. Вы можете выбрать одну роль или нажать «Озвучить всех» на телефоне!`;
        } else if (unassigned.length > 0) {
            roleHintEl.innerHTML = `💡 Еще не все роли заняты (${unassigned.map(c => c.name).join(', ')}). Игроки могут выбрать их на смартфонах.`;
        } else {
            roleHintEl.innerHTML = `🎉 Все роли распределены! Можно начинать озвучку.`;
        }
    }
}

// --- Create Room & Join ---
ui.createBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`/api/game/create?manifest_filename=${encodeURIComponent(currentManifest)}`, { method: 'POST' });
        const data = await res.json();
        
        currentRoom = data.room_code;
        
        const roomRes = await fetch(`/api/game/${currentRoom}`);
        const roomData = await roomRes.json();
        currentManifestData = roomData.manifest;
        
        ui.headerRoomCode.textContent = currentRoom;
        ui.roomBadge.classList.remove('hidden');

        const lobbyTitle = document.getElementById('lobby-scene-title');
        if (lobbyTitle) {
            lobbyTitle.textContent = (selectedScene && selectedScene.title) ? selectedScene.title : (currentManifestData.title || currentManifest);
        }
        
        initRoomRoles();
        generateQRCode();
        switchState('lobby');
        connectWebSocket();
        updateHostLobbyUI();
        
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
            
            // Auto-assign first free character if available, but let them change anytime
            const freeRole = Object.keys(roleAssignments).find(r => !roleAssignments[r]);
            if (freeRole) {
                roleAssignments[freeRole] = msg.player;
            }
            
            updateHostLobbyUI();
            broadcastRolesUpdate();
        }
    }
    
    // Player left
    if (action === "player_left" && msg.player !== "HOST") {
        players = players.filter(p => p !== msg.player);
        Object.keys(roleAssignments).forEach(r => {
            if (roleAssignments[r] === msg.player) {
                roleAssignments[r] = null;
            }
        });
        updateHostLobbyUI();
        broadcastRolesUpdate();
    }

    // Mobile requested role list
    if (action === "request_roles") {
        broadcastRolesUpdate();
    }

    // Player chooses a specific role on smartphone
    if (action === "choose_role") {
        const targetPlayer = data.player || msg.player;
        const targetRole = data.role || msg.role;
        
        if (targetRole === "__ALL__") {
            Object.keys(roleAssignments).forEach(r => {
                roleAssignments[r] = targetPlayer;
            });
        } else {
            // Unassign previous role for this player
            Object.keys(roleAssignments).forEach(r => {
                if (roleAssignments[r] === targetPlayer) {
                    roleAssignments[r] = null;
                }
            });
            // Assign new role
            roleAssignments[targetRole] = targetPlayer;
        }

        updateHostLobbyUI();
        broadcastRolesUpdate();
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

        // Finalize Roles: DO NOT auto-assign unassigned characters.
        // If a player chose a specific role, unassigned characters will play
        // as original movie audio via presentUnassignedOriginalLine().
        // Only auto-assign if NO player has chosen ANY role yet (fallback).
        const characters = getSceneCharactersWithStats();
        const anyRoleChosen = Object.values(roleAssignments).some(p => p !== null);
        
        if (!anyRoleChosen && players.length > 0) {
            // Nobody picked anything — round-robin assign so game can proceed
            characters.forEach((char, i) => {
                roleAssignments[char.name] = players[i % players.length];
            });
        }
        // Otherwise: respect player choices. Unassigned roles = original audio.

        roleToPlayerMap = { ...roleAssignments };

        // Broadcast final role assignment
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: "roles_finalized",
                roleAssignments: roleToPlayerMap
            }));
        }

        const videoUrl = `/media/movies/${encodeURIComponent(currentManifestData.video_filename)}`;
        ui.video.src = videoUrl;
        ui.video.load();
        ui.video.muted = true; // Muted on TV during recording to prevent echo
        
        currentLineIndex = 0;
        presentLine(0);

    } catch (e) {
        alert("Ошибка старта: " + e.message);
        switchState('setup');
    }
});

function getTargetPlayerForLine(line, index) {
    const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
    if (roleToPlayerMap[role]) {
        return roleToPlayerMap[role];
    }
    if (players.length > 0) {
        return players[index % players.length];
    }
    return null;
}

function presentLine(index) {
    if (!currentManifestData || index >= currentManifestData.lines.length) return;
    
    const line = currentManifestData.lines[index];
    const role = line.role_name || (line.speaker === "SPEAKER_01" ? "Гарри Поттер" : "Северус Снейп");
    const targetPlayer = getTargetPlayerForLine(line, index);
    const textToRead = line.clean_text || line.text;
    const durationMs = Math.round((line.end - line.start) * 1000);
    const startMs = Math.round(line.start * 1000);

    // If role has no player assigned, play original movie dialogue
    if (!targetPlayer) {
        presentUnassignedOriginalLine(line, index);
        return;
    }

    // Update TV Overlay
    document.getElementById('line-progress-badge').textContent = `Фраза ${index + 1} из ${currentManifestData.lines.length}`;
    document.getElementById('host-acting-cue').textContent = line.acting_cue || "";
    ui.speakerDisplay.innerHTML = `<span class="text-green-400 font-bold">${targetPlayer}</span> в роли <span class="text-purple-400 font-bold">${role}</span>`;
    ui.lineDisplay.textContent = `"${textToRead}"`;
    document.getElementById('host-instruction').textContent = `⏳ Ждем, пока ${targetPlayer} (${role}) нажмет «Я ГОТОВ» на телефоне...`;

    // Position video to start of dialogue
    ui.video.muted = true;
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

function presentUnassignedOriginalLine(line, index) {
    const role = line.role_name || "Персонаж";
    const durationMs = Math.round((line.end - line.start) * 1000);

    document.getElementById('line-progress-badge').textContent = `Фраза ${index + 1} из ${currentManifestData.lines.length}`;
    document.getElementById('host-acting-cue').textContent = "Оригинальная реплика фильма";
    ui.speakerDisplay.innerHTML = `🎬 В кадре: <span class="text-amber-400 font-bold">${role} (Оригинал)</span>`;
    ui.lineDisplay.textContent = `"${line.clean_text || line.text}"`;
    document.getElementById('host-instruction').textContent = `🔊 Звучит оригинальный голос из фильма...`;

    // Play video with audio enabled for original line
    ui.video.muted = false;
    ui.video.currentTime = line.start;
    ui.video.play().catch(e => console.log("Play error:", e));

    ws.send(JSON.stringify({
        action: "prepare_original_line",
        line_index: index,
        role_name: role,
        text: line.clean_text || line.text
    }));

    if (videoStopTimeout) clearTimeout(videoStopTimeout);
    videoStopTimeout = setTimeout(() => {
        ui.video.pause();
        ui.video.muted = true;
        currentLineIndex++;
        if (currentLineIndex < currentManifestData.lines.length) {
            presentLine(currentLineIndex);
        } else {
            finishAndMix();
        }
    }, durationMs + 600);
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

    // Play video muted during recording so player mic doesn't catch echo
    ui.video.muted = true;
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
        updateHostLobbyUI();
    });
}

const btnNewVideo = document.getElementById('btn-new-video');
if (btnNewVideo) {
    btnNewVideo.addEventListener('click', () => {
        switchState('setup');
        loadScenesCatalog();
    });
}
