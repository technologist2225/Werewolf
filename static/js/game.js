const session = getSession();
if (!session.room || !session.name) {
  window.location.href = "/";
}

document.getElementById("room-code-label").textContent = session.room;

let finalFetched = false;
let seerLocalResult = null; // { target, role_hint } — giữ lại trên máy để refresh() không xoá mất

async function refresh() {
  const { ok, data } = await apiGet(`/api/my-role?room_code=${session.room}&name=${encodeURIComponent(session.name)}`);
  if (!ok || !data.success) {
    showToast(data.message || "Mất kết nối với phòng", true);
    return;
  }
  render(data);
}

const STAGE_SECTIONS = {
  election: "election-panel", hunter_shoot: "hunter-panel", transition: "transition-panel",
  night: "night-panel", day: "day-panel", ended: "end-panel",
};
const lastSig = {};
function setHtmlIfChanged(key, el, html) {
  if (lastSig[key] === html) return false;
  lastSig[key] = html;
  el.innerHTML = html;
  return true;
}

function render(info) {
  const room = info.room;

  if (!room.is_started) {
    window.location.href = "/room";
    return;
  }

  document.getElementById("phase-tag").innerHTML = phaseTag(room.phase);

  const ri = roleInfo(info.role);
  document.getElementById("role-side").textContent = ri.side ? ri.side.toUpperCase() + " · " : "";
  document.getElementById("role-name").textContent = info.role || "";
  document.getElementById("role-desc").textContent = ri.desc;
  document.getElementById("alive-status").innerHTML = info.is_alive
    ? `<span class="avatar-status"></span> Bạn vẫn còn sống${info.is_chief ? ' · <strong style="color:#f3d98a">Trưởng Làng</strong>' : ''}`
    : `<span class="avatar-status dead"></span> Bạn đã bị loại — tiếp tục theo dõi ván đấu trong im lặng`;

  // Chỉ hiện đúng một màn trong "sân khấu" theo giai đoạn
  Object.values(STAGE_SECTIONS).forEach(id => document.getElementById(id).style.display = "none");
  const activeId = STAGE_SECTIONS[room.phase];
  if (activeId) document.getElementById(activeId).style.display = "block";
  document.getElementById("stage-empty").style.display = activeId ? "none" : "block";

  if (room.phase === "ended") renderEnd(info, room);
  else if (room.phase === "election") renderElection(info, room);
  else if (room.phase === "hunter_shoot") renderHunter(info, room);
  else if (room.phase === "transition") renderTransition(info, room);
  else if (room.phase === "night") renderNight(info, room);
  else if (room.phase === "day") renderDay(info, room);

  renderRoleCards(info, room);
  renderRoster(info, room);
  renderLog(room);
  syncTimer(room);
  renderChat(info, room);
  updateActionBar(info, room);
  updateStageTitle(room);
}

function updateStageTitle(room) {
  const ctx = room.transition_context || {};
  const titles = {
    election: "Bầu Trưởng Làng",
    night: `Đêm ${room.day_count}`,
    day: `Ngày ${room.day_count} — Thảo luận`,
    hunter_shoot: "Thợ Săn bắn trả",
    ended: "Ván đấu kết thúc",
  };
  let t = titles[room.phase];
  if (!t && room.phase === "transition") {
    t = ctx.type === "night_pause" ? `Đêm ${room.day_count}` : "Công bố kết quả";
  }
  document.getElementById("stage-title").textContent = t || "Kịch bản / Nhật ký";
}

function renderRoleCards(info, room) {
  const cards = (room.roles_in_play || []).map(r => {
    const st = roleStyle(r.role);
    const mine = r.role === info.role;
    return `
      <div class="rc ${mine ? "mine" : ""}" style="--rc:${st.color};--rc-glow:${st.glow}" title="${escapeHtml(r.role)}">
        <div class="rc-art">${st.icon}${st.slug ? `<img src="/static/img/roles/${st.slug}.png" alt="" onerror="this.remove()">` : ""}</div>
        ${r.count > 1 ? `<span class="rc-count">x${r.count}</span>` : ""}
        <div class="rc-name">${escapeHtml(r.role)}</div>
      </div>`;
  }).join("");
  setHtmlIfChanged("cards", document.getElementById("role-cards"), cards + `<!--${info.role}-->`);
}

function renderRoster(info, room) {
  const html = room.players.map(p => {
    const isMe = p.name === info.name;
    const chief = p.name === room.chief_name;
    let badge = "";
    if (!p.is_alive) badge = `<span class="pl-badge">💀</span>`;
    else if (isMe) badge = `<span class="pl-badge">${roleStyle(info.role).icon}</span>`;
    return `
      <div class="pl-tile ${p.is_alive ? "" : "dead"} ${isMe ? "me" : ""}" title="${escapeHtml(p.name)}${isMe ? " (bạn)" : ""}">
        <div class="pl-avatar">
          <div class="face" style="background:${avatarColor(p.name)}">${escapeHtml(initials(p.name))}</div>
          ${badge}${chief ? `<span class="pl-badge chief" title="Trưởng Làng">👑</span>` : ""}
        </div>
        <div class="pl-name">${escapeHtml(p.name)}${isMe ? " ★" : ""}</div>
        <div class="pl-status">${p.is_alive ? "Sống" : "Loại"}</div>
      </div>`;
  }).join("");
  setHtmlIfChanged("roster", document.getElementById("roster-list"), html);
}

function renderLog(room) {
  const feed = document.getElementById("log-feed");
  const logs = (room.log || []).slice(-12);
  const html = logs.length
    ? logs.map((l, i) => `<div class="log-strip ${i % 2 === 0 ? "red" : "blue"}">${escapeHtml(l.message)}</div>`).join("")
    : `<div class="log-empty">Chưa có diễn biến nào.</div>`;
  if (setHtmlIfChanged("log", feed, html)) feed.scrollTop = feed.scrollHeight;
}

// ---------------------------------------------------------------------------
// Đồng hồ đếm ngược (khung TIMER cột phải)
// ---------------------------------------------------------------------------
let timerKey = null, timerTotal = 1, timerEnd = null, timerActive = false, timerStarted = false;

function timerInfo(room) {
  const t = (room.transition_context || {}).type;
  if (room.phase === "night") return { label: "Ban đêm", night: true };
  if (room.phase === "election") return { label: "Bầu cử", night: false };
  if (room.phase === "day") return { label: "Thảo luận", night: false };
  if (room.phase === "hunter_shoot") return { label: "Thợ Săn", night: true };
  if (room.phase === "ended") return { label: "Kết thúc", night: false };
  if (room.phase === "transition") {
    if (t === "night_pause") return { label: "Ban đêm", night: true };
    if (t === "night_result") return { label: "Trời sáng", night: false };
    if (t === "day_result") return { label: "Kết quả", night: false };
    if (t === "election_result") return { label: "Trưởng Làng", night: false };
    return { label: "Thợ Săn", night: true };
  }
  return { label: "Chờ", night: true };
}

function paintTimer() {
  const digits = document.getElementById("timer-digits");
  const fill = document.getElementById("timer-fill");
  if (!timerActive) { digits.textContent = "--:--"; digits.classList.remove("urgent"); fill.style.width = "0%"; return; }
  const left = Math.max(0, (timerEnd - Date.now()) / 1000);
  digits.textContent = fmtTime(Math.ceil(left));
  digits.classList.toggle("urgent", left <= 10 && left > 0);
  fill.style.width = Math.max(0, Math.min(100, (left / timerTotal) * 100)) + "%";
}

function syncTimer(room) {
  const t = timerInfo(room);
  document.getElementById("timer-label").textContent = t.label + ":";
  const iconEl = document.getElementById("timer-icon");
  const want = t.night ? "moon" : "sun";
  if (iconEl.dataset.kind !== want) { iconEl.innerHTML = t.night ? MOON_SVG : SUN_SVG; iconEl.dataset.kind = want; }

  const s = room.seconds_left;
  if (s === null || s === undefined) { timerActive = false; paintTimer(); return; }
  const key = [room.phase, room.subphase, room.day_count, (room.transition_context || {}).type, room.hunter_pending_name].join("|");
  const serverEnd = Date.now() + s * 1000;
  if (key !== timerKey) { timerKey = key; timerTotal = Math.max(s, 1); timerEnd = serverEnd; }
  else {
    timerTotal = Math.max(timerTotal, s);
    if (Math.abs(serverEnd - timerEnd) > 1600) timerEnd = serverEnd;   // chỉ đồng bộ lại khi lệch đáng kể → số không giật
  }
  timerActive = true;
  paintTimer();
  if (!timerStarted) { timerStarted = true; setInterval(paintTimer, 250); }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const CHANNEL_LABEL = { general: "Chat chung", wolf: "Sói chat riêng", dead: "Chat của người chết" };
let lastChatSig = "", chatCanSend = false, chatSending = false;

function renderChat(info, room) {
  const feed = document.getElementById("chat-feed");
  const msgs = info.chat || [];
  const sig = msgs.map(m => m.id).join(",") + "|" + info.name;
  if (sig !== lastChatSig) {
    const first = lastChatSig === "";
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
    feed.innerHTML = msgs.length
      ? msgs.map(m => `
          <div class="bubble ${m.channel} ${m.author === info.name ? "mine" : ""}">
            <span class="who">${CHANNEL_LABEL[m.channel] || m.channel} <em>· ${escapeHtml(m.author)}</em></span>
            ${escapeHtml(m.text)}
          </div>`).join("")
      : `<div class="chat-empty">Chưa có tin nhắn nào.<br>Hãy là người mở lời!</div>`;
    if (first || atBottom) feed.scrollTop = feed.scrollHeight;
    lastChatSig = sig;
  }
  chatCanSend = !!info.chat_can_send;
  document.getElementById("chat-hint").textContent = info.chat_hint || "";
  const input = document.getElementById("chat-input");
  input.disabled = !chatCanSend;
  input.placeholder = chatCanSend ? "Tin nhắn hiện hành..." : "Hiện chưa thể nhắn tin";
  updateSendBtn();
}

function updateSendBtn() {
  const input = document.getElementById("chat-input");
  document.getElementById("chat-send").disabled = !(chatCanSend && input.value.trim() && !chatSending);
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !chatCanSend || chatSending) return;
  chatSending = true; updateSendBtn();
  const { ok, data } = await apiPost("/api/chat-send", { room_code: session.room, name: session.name, text });
  chatSending = false;
  if (!ok || !data.success) { updateSendBtn(); return showToast(data.message || "Không gửi được", true); }
  input.value = "";
  updateSendBtn();
  refresh();
}

// ---------------------------------------------------------------------------
// Bảng điều khiển hành động (nút tắt → đưa người chơi tới đúng chỗ thao tác)
// ---------------------------------------------------------------------------
function updateActionBar(info, room) {
  const canVote = info.is_alive &&
    ((room.phase === "day" && !info.has_voted) || (room.phase === "election" && !info.has_voted_election));
  const canSkill = !!(info.my_turn || info.hunter_turn);
  const vote = document.getElementById("btn-action-vote");
  const skill = document.getElementById("btn-action-skill");
  vote.disabled = !canVote;  vote.classList.toggle("ready", canVote);
  skill.disabled = !canSkill; skill.classList.toggle("ready", canSkill);
  vote.title = canVote ? "Đi tới phần bỏ phiếu" : "Chưa tới lúc bỏ phiếu (hoặc bạn đã bỏ phiếu rồi)";
  skill.title = canSkill ? "Đi tới phần dùng kỹ năng" : "Chưa tới lượt kỹ năng của bạn";
}

function flashStage() {
  const st = document.getElementById("stage");
  st.scrollIntoView({ behavior: "smooth", block: "nearest" });
  st.classList.remove("flash"); void st.offsetWidth; st.classList.add("flash");
}

document.getElementById("btn-action-vote").addEventListener("click", flashStage);
document.getElementById("btn-action-skill").addEventListener("click", flashStage);
document.getElementById("btn-action-chat").addEventListener("click", () => {
  const input = document.getElementById("chat-input");
  input.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (!input.disabled) input.focus(); else showToast(document.getElementById("chat-hint").textContent || "Hiện chưa thể nhắn tin", true);
});
document.getElementById("chat-send").addEventListener("click", sendChat);
document.getElementById("chat-input").addEventListener("input", updateSendBtn);
document.getElementById("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } });

function avatarCardHtml(name, ringClass, skull) {
  return `
    <div class="reveal-victim">
      <div class="avatar-card-ring ${ringClass}">
        <span class="avatar" style="background:${avatarColor(name)}">${initials(name)}</span>
        ${skull ? `<span class="skull-badge">${skull}</span>` : ""}
      </div>
      <div class="name">${name}</div>
    </div>
  `;
}

function renderTransition(info, room) {
  const ctx = room.transition_context || {};
  const box = document.getElementById("transition-panel");
  let icon = "🌙";
  let title = "Chuẩn bị...";
  let body = "";

  if (ctx.type === "night_pause") {
    icon = "🌙";
    title = "Chuẩn bị...";
    body = `<p class="muted mb-0">Tiếp theo: <strong style="color:var(--cyan)">${ctx.role || ""}</strong></p>`;
  } else if (ctx.type === "hunter_pause") {
    icon = "🏹";
    title = "Thợ Săn lên nòng";
    body = `<p class="muted mb-0"><strong style="color:var(--cyan)">${ctx.hunter || ""}</strong> là Thợ Săn — chuẩn bị bắn trả trước khi gục ngã...</p>`;
  } else if (ctx.type === "hunter_result") {
    icon = "🏹";
    title = "Phát bắn của Thợ Săn";
    if (ctx.victim) {
      body = avatarCardHtml(ctx.victim, "", "💀");
      body += `<p class="reveal-sub">Đã bị Thợ Săn bắn theo</p>`;
    } else {
      body = `<p class="reveal-sub" style="margin-top:14px;">Thợ Săn không bắn ai.</p>`;
    }
  } else if (ctx.type === "night_result") {
    icon = "☀️";
    title = "Trời sáng";
    if (ctx.victims && ctx.victims.length) {
      body = ctx.victims.map(v => avatarCardHtml(v, "", "💀")).join("");
      body += `<p class="reveal-sub">Đã bị Sói tấn công trong đêm</p>`;
    } else {
      body = `<p class="reveal-sub" style="margin-top:14px;">Đêm qua không có ai chết — cả làng bình an.</p>`;
    }
  } else if (ctx.type === "election_result") {
    icon = "👑";
    title = "Kết quả bầu Trưởng Làng";
    if (ctx.chief) {
      body = avatarCardHtml(ctx.chief, "chief", "👑");
      body += `<p class="reveal-sub">Trưởng Làng — phiếu tính gấp đôi khi biểu quyết</p>`;
    } else {
      body = `<p class="reveal-sub" style="margin-top:14px;">Không có ai còn sống để làm Trưởng Làng.</p>`;
    }
  } else if (ctx.type === "day_result") {
    icon = "⚖️";
    title = "Kết quả biểu quyết";
    if (ctx.hanged) {
      body = avatarCardHtml(ctx.hanged, "", "💀");
      body += `<p class="reveal-sub">Đã bị cả làng treo cổ</p>`;
    } else {
      body = `<p class="reveal-sub" style="margin-top:14px;">Làng không thống nhất được — không ai bị treo cổ hôm nay.</p>`;
    }
  }

  box.innerHTML = `
    <div class="reveal-card">
      <div class="reveal-icon">${icon}</div>
      <h3 class="mt-0" style="text-transform:none; letter-spacing:0; color:var(--text-100); font-size:1.3rem;">${title}</h3>
      ${body}
      <div class="countdown-wrap">
        <div class="countdown-track"><div class="countdown-fill" id="transition-countdown-fill" style="width:100%;"></div></div>
        <div class="countdown-text" id="transition-countdown-text"></div>
      </div>
    </div>
  `;
  if (room.seconds_left !== null && room.seconds_left !== undefined) {
    startCountdown(room.seconds_left, "transition-countdown-fill", "transition-countdown-text",
      (ctx.type === "night_pause" || ctx.type === "hunter_pause") ? "Bắt đầu sau" : "Chuyển cảnh sau");
  }
  seerLocalResult = null;
}

function renderHunter(info, room) {
  if (room.seconds_left !== null && room.seconds_left !== undefined) {
    startCountdown(room.seconds_left, "hunter-countdown-fill", "hunter-countdown-text", "Thời gian bắn");
  }
  const area = document.getElementById("hunter-area");
  if (!info.hunter_turn) {
    area.innerHTML = `<p class="muted">Thợ Săn <strong>${room.hunter_pending_name || ""}</strong> đang chọn người bắn theo...</p>`;
    area.dataset.gridKey = "";
    return;
  }
  renderSelectionGrid(area, {
    key: `hunter:${room.day_count}:${room.hunter_pending_name}`,
    names: info.alive_players || [],
    danger: true,
    allowAbstain: true,
    abstainLabel: "Không bắn ai",
    confirmLabel: "Bắn!",
    onConfirm: async (name) => {
      const { ok, data } = await apiPost("/api/hunter-shoot", { room_code: session.room, hunter_name: session.name, target_name: name });
      if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
      showToast(data.message);
      refresh();
    },
  });
}

function renderElection(info, room) {
  if (room.seconds_left !== null && room.seconds_left !== undefined) {
    startCountdown(room.seconds_left, "election-countdown-fill", "election-countdown-text", "Thời gian bầu cử");
  }
  document.getElementById("election-progress").textContent = `${room.election_votes_count ?? 0}/${room.alive_count} người đã bỏ phiếu`;

  const area = document.getElementById("election-area");
  if (!info.is_alive) {
    area.innerHTML = `<p class="muted">Bạn đã bị loại, chỉ có thể theo dõi.</p>`;
    return;
  }
  if (info.has_voted_election) {
    area.innerHTML = `<p class="muted">Bạn đã bỏ phiếu. Đang chờ những người còn lại...</p>`;
    return;
  }

  renderSelectionGrid(area, {
    key: "election",
    names: info.all_alive_players || [],
    selfName: session.name,
    allowAbstain: true,
    abstainLabel: "Không bầu ai",
    confirmLabel: "Khoá phiếu bầu",
    onConfirm: async (choice) => {
      const { ok, data } = await apiPost("/api/election-vote", { room_code: session.room, voter_name: session.name, choice_name: choice });
      if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
      showToast(data.message);
      refresh();
    },
  });
}

function renderNightTracker(room) {
  const sequence = room.night_sequence || [];
  const currentIdx = sequence.indexOf(room.subphase);
  const steps = NIGHT_STEPS.filter(s => sequence.includes(s.key));
  const html = steps.map(s => {
    const idx = sequence.indexOf(s.key);
    let cls = "";
    if (s.key === room.subphase) cls = "active";
    else if (currentIdx >= 0 && idx < currentIdx) cls = "done";
    return `<div class="night-step ${cls}">${s.label}</div>`;
  });
  document.getElementById("night-tracker").innerHTML = html.join(`<div class="night-connector"></div>`);
}

// Đồng hồ giờ do syncTimer() điều khiển ở khung TIMER; hàm này giữ lại cho tương thích.
function startCountdown() {}

function renderNight(info, room) {
  document.getElementById("night-day-num").textContent = room.day_count;
  renderNightTracker(room);

  if (room.seconds_left !== null && room.seconds_left !== undefined) {
    startCountdown(room.seconds_left, "countdown-fill", "countdown-text", room.subphase_label || "Đang xử lý");
  }

  const banner = document.getElementById("turn-banner");
  const actionPanel = document.getElementById("action-panel");

  if (!info.is_alive) {
    banner.innerHTML = `<div class="turn-banner waiting">Bạn đã bị loại — hãy nhắm mắt và giữ im lặng.</div>`;
    actionPanel.style.display = "none";
    return;
  }

  if (info.my_turn) {
    banner.innerHTML = `<div class="turn-banner">Đến lượt bạn — hãy thao tác trong im lặng.</div>`;
    actionPanel.style.display = "block";
    renderAction(info, room);
  } else {
    banner.innerHTML = `<div class="turn-banner waiting">${room.subphase_label || "Đang chờ"}... Hãy nhắm mắt và giữ im lặng.</div>`;
    actionPanel.style.display = "none";
    seerLocalResult = null;
  }
}

function renderAction(info, room) {
  const targetList = document.getElementById("target-list");
  const witchBox = document.getElementById("witch-actions");
  const seerBox = document.getElementById("seer-result");
  witchBox.innerHTML = "";
  seerBox.innerHTML = "";
  // Lưu ý: KHÔNG xoá targetList.innerHTML ở đây — để renderSelectionGrid tự
  // quyết định có cần dựng lại hay không (dựa vào key), tránh xoá mất lựa
  // chọn người dùng đang chọn dở mỗi khi trang tự làm mới sau vài giây.
  const targets = info.alive_players || [];

  if (info.role === "Ma Sói") {
    if (info.wolf_total_count > 1) {
      document.getElementById("action-desc").textContent =
        `Bầy có ${info.wolf_total_count} Sói — chỉ chuyển lượt khi TẤT CẢ đã khoá mục tiêu (${info.wolf_ready_count}/${info.wolf_total_count}).`;
    } else {
      document.getElementById("action-desc").textContent = "Im lặng, chọn người bạn muốn tiêu diệt rồi khoá lựa chọn.";
    }

    if (info.i_am_ready) {
      targetList.innerHTML = `<p class="muted">Bạn đã khoá mục tiêu: <strong style="color:var(--red)">${info.wolf_current_target || ""}</strong>. Đang chờ ${info.wolf_total_count - info.wolf_ready_count} Sói còn lại...</p>`;
      targetList.dataset.gridKey = "";
      return;
    }

    renderSelectionGrid(targetList, {
      key: `night:wolf:${room.day_count}`,
      names: targets, danger: true, confirmLabel: "Khoá mục tiêu",
      onConfirm: async (name) => {
        if (!name) return;
        const { ok, data } = await apiPost("/api/wolf-action", { room_code: session.room, wolf_name: session.name, target_name: name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        showToast(data.message);
        refresh();
      },
    });
  }

  if (info.role === "Bảo Vệ") {
    document.getElementById("action-desc").textContent = "Chọn người bạn muốn che chở đêm nay rồi khoá lựa chọn.";
    renderSelectionGrid(targetList, {
      key: `night:guard:${room.day_count}`,
      names: targets, confirmLabel: "Khoá lựa chọn che chở",
      onConfirm: async (name) => {
        if (!name) return;
        const { ok, data } = await apiPost("/api/guard-action", { room_code: session.room, guard_name: session.name, target_name: name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        showToast(data.message);
        refresh();
      },
    });
  }

  if (info.role === "Tiên Tri") {
    document.getElementById("action-desc").textContent = "Chọn một người để soi danh tính.";

    if (seerLocalResult) {
      targetList.innerHTML = "";
      targetList.dataset.gridKey = "";
      seerBox.innerHTML = `
        <div class="reveal-victim">
          <div class="avatar-card-ring ${seerLocalResult.role_hint === 'Ma Sói' ? '' : 'safe'}">
            <span class="avatar" style="background:${avatarColor(seerLocalResult.target)}">${initials(seerLocalResult.target)}</span>
          </div>
          <div class="name">${seerLocalResult.target}</div>
        </div>
        <p style="margin-top:6px;">Là: <strong style="color:${seerLocalResult.role_hint === 'Ma Sói' ? 'var(--red)' : 'var(--green)'}">${seerLocalResult.role_hint}</strong></p>
        <button class="btn-primary btn-small" id="seer-continue-btn" style="margin-top:8px;">Tiếp tục (nhường lượt)</button>
      `;
      document.getElementById("seer-continue-btn").addEventListener("click", async () => {
        const { ok, data } = await apiPost("/api/seer-done", { room_code: session.room, seer_name: session.name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        seerLocalResult = null;
        refresh();
      });
      return;
    }

    renderSelectionGrid(targetList, {
      key: `night:seer:${room.day_count}`,
      names: targets, allowAbstain: true, abstainLabel: "Bỏ qua lượt", confirmLabel: "Soi danh tính",
      onConfirm: async (name) => {
        if (!name) {
          const { ok, data } = await apiPost("/api/seer-pass", { room_code: session.room, seer_name: session.name });
          if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
          refresh();
          return;
        }
        const { ok, data } = await apiPost("/api/seer-action", { room_code: session.room, seer_name: session.name, target_name: name });
        if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
        seerLocalResult = { target: data.target, role_hint: data.role_hint };
        refresh();
      },
    });
  }

  if (info.role === "Phù Thủy") {
    document.getElementById("action-desc").textContent = "Bạn có một bình cứu và một bình độc, mỗi bình chỉ dùng được một lần trong cả ván.";
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
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const { ok, data } = await apiPost("/api/witch-action", { room_code: session.room, witch_name: session.name, action_type: "save" });
      if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
      showToast(data.message);
      refresh();
    });

    if (!info.witch_used_kill) {
      const killLabel = document.createElement("p");
      killLabel.className = "muted";
      killLabel.style.marginTop = "14px";
      killLabel.textContent = "Hoặc dùng bình độc lên:";
      witchBox.appendChild(killLabel);

      renderSelectionGrid(targetList, {
        key: `night:witch-kill:${room.day_count}`,
        names: targets, danger: true, allowAbstain: true, abstainLabel: "Không dùng độc", confirmLabel: "Dùng bình độc",
        onConfirm: async (name) => {
          if (!name) { showToast("Đã chọn không dùng độc đêm nay."); return; }
          const { ok, data } = await apiPost("/api/witch-action", { room_code: session.room, witch_name: session.name, action_type: "kill", target_name: name });
          if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
          showToast(data.message);
          refresh();
        },
      });
    } else {
      targetList.innerHTML = "";
      targetList.dataset.gridKey = "";
    }

    const doneBtn = document.createElement("button");
    doneBtn.className = "btn-ghost btn-small";
    doneBtn.style.marginTop = "14px";
    doneBtn.textContent = "Xong lượt của tôi";
    doneBtn.addEventListener("click", async () => {
      const { ok, data } = await apiPost("/api/witch-done", { room_code: session.room, witch_name: session.name });
      if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
      refresh();
    });
    witchBox.appendChild(doneBtn);
  }
}

function renderDay(info, room) {
  document.getElementById("day-day-num").textContent = room.day_count;
  document.getElementById("day-result-msg").textContent = room.last_night_msg || "Cả làng cùng thảo luận để tìm ra Sói.";

  if (room.seconds_left !== null && room.seconds_left !== undefined) {
    startCountdown(room.seconds_left, "day-countdown-fill", "day-countdown-text", "Thời gian bỏ phiếu");
  }

  document.getElementById("vote-progress").textContent = `${room.votes_count ?? 0}/${room.alive_count} người đã bỏ phiếu`;

  const area = document.getElementById("vote-area");
  if (!info.is_alive) {
    area.innerHTML = `<p class="muted">Bạn đã bị loại, chỉ có thể theo dõi cuộc bỏ phiếu.</p>`;
    return;
  }
  if (info.has_voted) {
    area.innerHTML = `<p class="muted">Bạn đã bỏ phiếu. Đang chờ những người còn lại...</p>`;
    return;
  }

  renderSelectionGrid(area, {
    key: `day:${room.day_count}`,
    names: info.alive_players || [],
    danger: true,
    allowAbstain: true,
    abstainLabel: "Bỏ phiếu trắng",
    confirmLabel: "Khoá phiếu bầu",
    onConfirm: async (suspect) => {
      const { ok, data } = await apiPost("/api/day-vote", { room_code: session.room, voter_name: session.name, suspect_name: suspect });
      if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
      showToast(data.message);
      refresh();
    },
  });
}

function renderEnd(info, room) {
  if (finalFetched) return;
  finalFetched = true;
  apiPost("/api/check-win", { room_code: session.room }).then(({ ok, data }) => {
    if (!ok || !data.success) return;
    const iWon = (data.winner === "soi" && info.role === "Ma Sói") || (data.winner === "dan" && info.role !== "Ma Sói");
    document.getElementById("end-title").textContent = data.message;
    const tag = document.getElementById("end-tag");
    tag.textContent = iWon ? "VICTORY" : "LOSE";
    tag.style.color = iWon ? "var(--green)" : "var(--red)";
    document.getElementById("end-role-reveal").textContent = `Vai trò của bạn là: ${info.role}`;
    document.getElementById("result-body").innerHTML = (data.results || []).map(r => `
      <tr>
        <td>${r.name}${r.was_chief ? ' <span class="host-badge">TL</span>' : ''}</td>
        <td>${r.role}</td>
        <td class="${r.result === 'VICTORY' ? 'result-victory' : 'result-lose'}">${r.result}</td>
      </tr>
    `).join("");
  });
}

document.getElementById("play-again-btn").addEventListener("click", async () => {
  const { ok, data } = await apiPost("/api/play-again", { room_code: session.room });
  if (!ok || !data.success) return showToast(data.message || "Lỗi", true);
  window.location.href = "/room";
});

document.getElementById("back-to-home-btn").addEventListener("click", () => {
  window.location.href = "/";
});

refresh();
setInterval(refresh, 1500);
