const session = getSession();
if (!session.room || !session.name) {
  window.location.href = "/";
}

document.getElementById("room-code-label").textContent = session.room;

let submittedForDay = null; // day_count đã submit hành động, để tránh gửi lại vô ích
let seerResultShown = null;

async function refresh() {
  const { ok, data } = await apiGet(`/api/my-role?room_code=${session.room}&name=${encodeURIComponent(session.name)}`);
  if (!ok || !data.success) {
    showToast(data.message || "Mất kết nối với phòng", true);
    return;
  }
  render(data);
}

function hideAll() {
  ["waiting-panel", "role-panel", "status-panel", "action-panel", "idle-night-panel", "day-panel", "end-panel"]
    .forEach(id => document.getElementById(id).style.display = "none");
}

function render(info) {
  document.getElementById("phase-tag").innerHTML = phaseTag(info.phase);

  if (!info.is_started) {
    hideAll();
    document.getElementById("waiting-panel").style.display = "block";
    return;
  }

  if (info.phase === "ended") {
    hideAll();
    document.getElementById("end-panel").style.display = "block";
    const iWon = (info.winner === "soi" && info.role === "Ma Sói") || (info.winner === "dan" && info.role !== "Ma Sói");
    document.getElementById("end-title").textContent = info.winner === "soi" ? "Phe Ma Sói đã chiến thắng!" : "Phe Dân Làng đã chiến thắng!";
    const tag = document.getElementById("end-tag");
    tag.textContent = iWon ? "VICTORY" : "LOSE";
    tag.style.color = iWon ? "var(--leaf-400)" : "var(--blood-400)";
    document.getElementById("end-role-reveal").textContent = `Vai trò của bạn là: ${info.role}`;
    return;
  }

  // Role card luôn hiển thị từ lúc game bắt đầu
  document.getElementById("role-panel").style.display = "block";
  const ri = roleInfo(info.role);
  document.getElementById("role-side").textContent = ri.side.toUpperCase();
  document.getElementById("role-name").textContent = info.role;
  document.getElementById("role-desc").textContent = ri.desc;

  document.getElementById("status-panel").style.display = "block";
  document.getElementById("alive-status").innerHTML = info.is_alive
    ? `<span class="dot dot-alive"></span> Bạn vẫn còn sống`
    : `<span class="dot dot-dead"></span> Bạn đã bị loại — hãy giữ bí mật và tiếp tục theo dõi ván đấu`;

  document.getElementById("action-panel").style.display = "none";
  document.getElementById("idle-night-panel").style.display = "none";
  document.getElementById("day-panel").style.display = "none";

  if (info.phase === "day") {
    document.getElementById("day-panel").style.display = "block";
    document.getElementById("day-msg").textContent = info.last_result_msg || "Cả làng cùng thảo luận để tìm ra Sói.";
    return;
  }

  if (info.phase === "night" && info.is_alive) {
    renderNightAction(info);
  } else if (info.phase === "night") {
    document.getElementById("idle-night-panel").style.display = "block";
  }
}

function renderNightAction(info) {
  const actionRoles = ["Ma Sói", "Tiên Tri", "Bảo Vệ", "Phù Thủy"];
  if (!actionRoles.includes(info.role)) {
    document.getElementById("idle-night-panel").style.display = "block";
    return;
  }

  const panel = document.getElementById("action-panel");
  panel.style.display = "block";
  const targetList = document.getElementById("target-list");
  const witchBox = document.getElementById("witch-actions");
  const seerBox = document.getElementById("seer-result");
  witchBox.innerHTML = "";
  seerBox.innerHTML = "";
  targetList.innerHTML = "";

  const targets = info.alive_players || [];

  if (info.role === "Ma Sói") {
    document.getElementById("action-title").textContent = "Chọn con mồi";
    document.getElementById("action-desc").textContent = "Im lặng, chỉ tay vào người bạn muốn tiêu diệt.";
    targetList.innerHTML = targets.map(name => `<button class="target-btn" data-name="${name}">${name}</button>`).join("");
    targetList.querySelectorAll(".target-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { ok, data } = await apiPost("/api/wolf-action", { room_code: session.room, wolf_name: session.name, target_name: btn.dataset.name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        markSelected(targetList, btn);
        showToast(`Đã chọn: ${btn.dataset.name}`);
      });
    });
  }

  if (info.role === "Bảo Vệ") {
    document.getElementById("action-title").textContent = "Chọn người che chở";
    document.getElementById("action-desc").textContent = "Người này sẽ an toàn trước Sói đêm nay.";
    targetList.innerHTML = targets.map(name => `<button class="target-btn" data-name="${name}">${name}</button>`).join("");
    targetList.querySelectorAll(".target-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { ok, data } = await apiPost("/api/guard-action", { room_code: session.room, guard_name: session.name, target_name: btn.dataset.name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        markSelected(targetList, btn);
        showToast(`Đã bảo vệ: ${btn.dataset.name}`);
      });
    });
  }

  if (info.role === "Tiên Tri") {
    document.getElementById("action-title").textContent = "Soi danh tính";
    document.getElementById("action-desc").textContent = "Chọn một người để biết họ có phải Ma Sói không.";
    targetList.innerHTML = targets.map(name => `<button class="target-btn" data-name="${name}">${name}</button>`).join("");
    targetList.querySelectorAll(".target-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { ok, data } = await apiPost("/api/seer-action", { room_code: session.room, seer_name: session.name, target_name: btn.dataset.name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        markSelected(targetList, btn);
        seerBox.innerHTML = `<p style="margin-top:14px;"><strong>${data.target}</strong> là: <span style="color:var(--dawn-300)">${data.role_hint}</span></p>`;
      });
    });
  }

  if (info.role === "Phù Thủy") {
    document.getElementById("action-title").textContent = "Sử dụng bình thuốc";
    document.getElementById("action-desc").textContent = "Bạn có một bình cứu và một bình độc, mỗi bình chỉ dùng một lần.";

    let html = "";
    if (info.wolf_victim_hint) {
      html += `<p>Đêm nay <strong>${info.wolf_victim_hint}</strong> bị Sói cắn.</p>`;
      if (!info.witch_used_save) {
        html += `<button class="btn-leaf btn-small" id="witch-save">Dùng bình cứu cho ${info.wolf_victim_hint}</button>`;
      } else {
        html += `<p class="muted">Bạn đã dùng hết bình cứu.</p>`;
      }
    } else {
      html += `<p class="muted">Đêm nay chưa ai bị Sói cắn.</p>`;
    }
    witchBox.innerHTML = html;

    const saveBtn = document.getElementById("witch-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const { ok, data } = await apiPost("/api/witch-action", { room_code: session.room, witch_name: session.name, action_type: "save" });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        showToast(data.message);
        refresh();
      });
    }

    if (!info.witch_used_kill) {
      targetList.innerHTML = `<p class="muted" style="grid-column:1/-1;margin-bottom:4px;">Hoặc dùng bình độc lên:</p>` +
        targets.map(name => `<button class="target-btn" data-name="${name}">${name}</button>`).join("");
      targetList.querySelectorAll(".target-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const { ok, data } = await apiPost("/api/witch-action", { room_code: session.room, witch_name: session.name, action_type: "kill", target_name: btn.dataset.name });
          if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
          markSelected(targetList, btn);
          showToast(data.message);
        });
      });
    } else {
      targetList.innerHTML = `<p class="muted" style="grid-column:1/-1;">Bạn đã dùng hết bình độc.</p>`;
    }
  }
}

function markSelected(container, chosenBtn) {
  container.querySelectorAll(".target-btn").forEach(b => b.classList.remove("selected"));
  chosenBtn.classList.add("selected");
}

refresh();
setInterval(refresh, 2000);
