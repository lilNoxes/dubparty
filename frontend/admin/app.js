const API_BASE = "http://localhost:8000/api/media";
const MEDIA_BASE = "http://localhost:8000/media";

let manifests = [];
let currentManifest = null;
let currentManifestFilename = null;

const selectElement = document.getElementById("scene-select");
const videoPlayer = document.getElementById("video-player");
const linesContainer = document.getElementById("lines-container");
const charactersContainer = document.getElementById("characters-container");
const btnSave = document.getElementById("btn-save");
const btnAddChar = document.getElementById("btn-add-char");

// Load Manifests
async function loadManifests() {
    try {
        const response = await fetch(`${API_BASE}/manifests`);
        manifests = await response.json();
        
        selectElement.innerHTML = '<option value="">-- Выберите сцену --</option>';
        manifests.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.manifest_filename;
            opt.textContent = m.title;
            selectElement.appendChild(opt);
        });
    } catch (err) {
        console.error("Error loading manifests:", err);
    }
}

// Select a scene
selectElement.addEventListener("change", (e) => {
    const filename = e.target.value;
    if (!filename) {
        currentManifest = null;
        linesContainer.innerHTML = '<div class="text-center text-muted mt-5">Выберите сцену для редактирования...</div>';
        return;
    }
    
    const m = manifests.find(x => x.manifest_filename === filename);
    if (m) {
        currentManifestFilename = filename;
        // Deep copy so we can edit without saving immediately
        currentManifest = JSON.parse(JSON.stringify(m)); 
        videoPlayer.src = `${MEDIA_BASE}/movies/${currentManifest.video_filename}`;
        renderEditor();
    }
});

// Render Editor UI
function renderEditor() {
    renderCharacters();
    renderLines();
}

function renderCharacters() {
    charactersContainer.innerHTML = "";
    if (!currentManifest.characters) currentManifest.characters = [];
    
    currentManifest.characters.forEach((char, idx) => {
        const div = document.createElement("div");
        div.className = "d-flex gap-2 mb-2";
        div.innerHTML = `
            <input type="text" class="form-control form-control-sm" value="${char.replace(/"/g, '&quot;')}" data-idx="${idx}" onchange="updateCharacter(${idx}, this.value)">
            <button class="btn btn-sm btn-danger" onclick="removeCharacter(${idx})">X</button>
        `;
        charactersContainer.appendChild(div);
    });
}

window.updateCharacter = (idx, val) => {
    currentManifest.characters[idx] = val;
};

window.removeCharacter = (idx) => {
    currentManifest.characters.splice(idx, 1);
    renderCharacters();
};

btnAddChar.addEventListener("click", () => {
    currentManifest.characters.push("Новый Персонаж");
    renderCharacters();
});

function renderLines() {
    linesContainer.innerHTML = "";
    const lines = currentManifest.lines || [];
    
    lines.forEach((line, idx) => {
        const card = document.createElement("div");
        card.className = "line-card";
        
        card.innerHTML = `
            <div class="line-header">
                <span>[${line.speaker}] Таймкод: ${line.start.toFixed(2)} - ${line.end.toFixed(2)}</span>
                <button class="btn-play" onclick="playSegment(${line.start})">▶ Play</button>
            </div>
            <div class="row g-2">
                <div class="col-md-4">
                    <label class="form-label" style="font-size:0.8em; color:#a2a2bd;">Имя персонажа</label>
                    <input type="text" class="form-control form-control-sm" value="${line.role_name ? line.role_name.replace(/"/g, '&quot;') : ''}" onchange="updateLine(${idx}, 'role_name', this.value)">
                </div>
                <div class="col-md-8">
                    <label class="form-label" style="font-size:0.8em; color:#a2a2bd;">Ремарка (Подсказка)</label>
                    <input type="text" class="form-control form-control-sm" value="${line.acting_cue ? line.acting_cue.replace(/"/g, '&quot;') : ''}" onchange="updateLine(${idx}, 'acting_cue', this.value)">
                </div>
                <div class="col-md-12 mt-2">
                    <label class="form-label" style="font-size:0.8em; color:#a2a2bd;">Текст для суфлера</label>
                    <input type="text" class="form-control" value="${line.clean_text ? line.clean_text.replace(/"/g, '&quot;') : line.text.replace(/"/g, '&quot;')}" onchange="updateLine(${idx}, 'clean_text', this.value)">
                </div>
                <div class="col-md-12 mt-1">
                    <small class="text-muted">Оригинал (от Whisper): <i>${line.text}</i></small>
                </div>
            </div>
        `;
        linesContainer.appendChild(card);
    });
}

window.updateLine = (idx, field, val) => {
    currentManifest.lines[idx][field] = val;
};

window.playSegment = (startTime) => {
    videoPlayer.currentTime = startTime;
    videoPlayer.play();
};

// Save changes
btnSave.addEventListener("click", async () => {
    if (!currentManifest) return;
    
    try {
        // Strip out the extra fields we added in GET /manifests so we don't save them in the file
        const payload = {
            video_filename: currentManifest.video_filename,
            characters: currentManifest.characters,
            lines: currentManifest.lines
        };
        
        const res = await fetch(`${API_BASE}/manifests/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                manifest_filename: currentManifestFilename,
                manifest_data: payload
            })
        });
        
        const data = await res.json();
        if (data.status === "success") {
            btnSave.textContent = "Сохранено ✓";
            btnSave.classList.replace("btn-success", "btn-outline-success");
            setTimeout(() => {
                btnSave.textContent = "Сохранить изменения";
                btnSave.classList.replace("btn-outline-success", "btn-success");
            }, 2000);
            
            // Reload the local manifests list so memory is fresh
            await loadManifests();
            selectElement.value = currentManifestFilename;
        } else {
            alert("Ошибка сохранения: " + data.message);
        }
    } catch (err) {
        console.error(err);
        alert("Не удалось сохранить.");
    }
});

// Init
loadManifests();
