const session = getSession();
if (!session.room || !session.name || !session.isHost) {
  window.location.href = "/";
}

document.getElementById("room-code").textContent = session.room;
document.getElementById("host-title").textContent = `Quản trò: ${session.name}`;

let selectedSuspect = null;
let lastPhase = null;

async function refresh() {
  const { ok, data } = await apiGet(`/api/host-view?room_code=${session.room}&host_name=${encodeURIComponent(session.name)}`);
  if (!ok || !data.success) {
    showToast(data.message || "Không tải được phòng", true);
    return;
  }
  render(data.room);
}

function render(room) {
  document.getElementById("phase-tag").innerHTML = phaseTag(room.phase);

  // --- Lobby ---
  const lobbyPanel = document.getElementById("lobby-panel");
  const nightPanel = document.getElementById("night-panel");
  const dayPanel = document.getElementById("day-panel");
  const endPanel = document.getElementById("end-panel");
  const codePanel = document.getElementById("code-panel");
  const alivePanel = document.getElementById("alive-panel");
  const logPanel = document.getElementById("log-panel");

  lobbyPanel.style.display = room.phase === "lobby" ? "block" : "none";
  nightPanel.style.display = room.phase === "night" ? "block" : "none";
  dayPanel.style.display = room.phase === "day" ? "block" : "none";
  endPanel.style.display = room.phase === "ended" ? "block" : "none";
  codePanel.style.display = room.phase === "lobby" ? "block" : "none";
  alivePanel.style.display = room.phase === "lobby" ? "none" : "block";
  logPanel.style.display = room.phase === "lobby" ? "none" : "block";

  if (room.phase === "lobby") {
    document.getElementById("player-count").textContent = room.players.length;
    document.getElementById("player-list").innerHTML = room.players.map(p => `
      <div class="player-row">
        <span>${p.name}${p.is_host ? '<span class="host-badge">QUẢN TRÒ</span>' : ''}</span>
      </div>
    `).join("");
    const startBtn = document.getElementById("start-btn");
    if (room.players.length >= 5) {
      startBtn.disabled = false;
      startBtn.textContent = `Bắt đầu trò chơi (${room.players.length} người)`;
    } else {
      startBtn.disabled = true;
      startBtn.textContent = `Cần thêm người chơi (${room.players.length}/5)`;
    }
  }

  if (room.phase === "night") {
    document.getElementById("night-day-num").textContent = room.day_count;
    const chips = [];
    const ns = room.night_status, nra = room.night_roles_alive;
    if (nra.wolf) chips.push(chip("Ma Sói", ns.wolf_done));
    if (nra.guard) chips.push(chip("Bảo Vệ", ns.guard_done));
    if (nra.witch) chips.push(chip("Phù Thủy", ns.witch_done));
    if (nra.seer) chips.push(`<span class="status-chip">Tiên Tri (tự soi, không cần chờ)</span>`);
    document.getElementById("night-status").innerHTML = chips.join("");
  }

  if (room.phase === "day") {
    if (room.last_result_msg) document.getElementById("day-result-msg").textContent = room.last_result_msg;
    document.getElementById("day-day-num").textContent = room.day_count;
    const alive = room.players.filter(p => p.is_alive);
    document.getElementById("vote-list").innerHTML = alive.map(p => `
      <label class="radio-item">
        <input type="radio" name="suspect" value="${p.name}">
        <span>${p.name}</span>
      </label>
    `).join("");
    document.querySelectorAll('input[name="suspect"]').forEach(el => {
      el.addEventListener("change", (e) => {
        selectedSuspect = e.target.value;
        document.getElementById("vote-btn").disabled = false;
      });
    });
  }

  if (room.phase === "ended") {
    fetchFinalResults(room);
  }

  if (room.phase !== "lobby") {
    document.getElementById("alive-list").innerHTML = room.players.map(p => `
      <div class="player-row ${p.is_alive ? '' : 'dead'}">
        <span><span class="dot ${p.is_alive ? 'dot-alive' : 'dot-dead'}"></span>${p.name}${p.is_host ? '<span class="host-badge">QT</span>' : ''}</span>
      </div>
    `).join("");

    document.getElementById("log-list").innerHTML = (room.log || []).slice().reverse().map(l => `
      <div class="log-line">${l.message}</div>
    `).join("") || `<div class="log-line">Chưa có diễn biến nào.</div>`;
  }

  lastPhase = room.phase;
}

function chip(label, done) {
  return `<span class="status-chip ${done ? 'done' : ''}">${done ? '✓ ' : '⏳ '}${label}</span>`;
}

let finalFetched = false;
async function fetchFinalResults(room) {
  if (finalFetched) return;
  finalFetched = true;
  const { ok, data } = await apiPost("/api/check-win", { room_code: session.room });
  if (!ok || !data.success) return;
  document.getElementById("end-title").textContent = data.message;
  document.getElementById("result-body").innerHTML = (data.results || []).map(r => `
    <tr>
      <td>${r.name}</td>
      <td>${r.role}</td>
      <td class="${r.result === 'VICTORY' ? 'result-victory' : 'result-lose'}">${r.result}</td>
    </tr>
  `).join("");
}

document.getElementById("start-btn").addEventListener("click", async () => {
  const { ok, data } = await apiPost("/api/start-game", { room_code: session.room });
  if (!ok || !data.success) return showToast(data.message || "Không thể bắt đầu", true);
  showToast("Trò chơi bắt đầu! Vai trò đã được gửi tới từng người chơi.");
  refresh();
});

document.getElementById("resolve-btn").addEventListener("click", async () => {
  const { ok, data } = await apiPost("/api/resolve-night", { room_code: session.room });
  if (!ok || !data.success) return showToast(data.message || "Không thể tổng kết", true);
  showToast(data.message);
  refresh();
});

document.getElementById("vote-btn").addEventListener("click", async () => {
  if (!selectedSuspect) return;
  const { ok, data } = await apiPost("/api/vote-hang", { room_code: session.room, suspect_name: selectedSuspect });
  if (!ok || !data.success) return showToast(data.message || "Không thể treo cổ", true);
  showToast(data.message);
  selectedSuspect = null;
  document.getElementById("vote-btn").disabled = true;
  refresh();
});

refresh();
setInterval(refresh, 2000);
