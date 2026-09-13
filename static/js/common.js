// Tiện ích dùng chung cho các trang

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function showToast(message, isError) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("error", !!isError);
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 3200);
}

function phaseTag(phase) {
  const map = {
    lobby: { text: "Phòng chờ", cls: "tag-lobby" },
    night: { text: "Ban đêm", cls: "tag-night" },
    day: { text: "Ban ngày", cls: "tag-day" },
    ended: { text: "Kết thúc", cls: "tag-ended" },
  };
  const info = map[phase] || map.lobby;
  return `<span class="tag ${info.cls}">${info.text}</span>`;
}

function getSession() {
  return {
    room: localStorage.getItem("mawoi_room") || "",
    name: localStorage.getItem("mawoi_name") || "",
    isHost: localStorage.getItem("mawoi_is_host") === "1",
  };
}

function setSession(room, name, isHost) {
  localStorage.setItem("mawoi_room", room);
  localStorage.setItem("mawoi_name", name);
  localStorage.setItem("mawoi_is_host", isHost ? "1" : "0");
}

const ROLE_INFO = {
  "Ma Sói": { side: "Phe Sói", desc: "Mỗi đêm, cùng bầy chọn một người để tiêu diệt. Ban ngày phải giả làm dân, tránh bị treo cổ." },
  "Tiên Tri": { side: "Phe Dân", desc: "Mỗi đêm được soi một người để biết họ có phải Ma Sói hay không." },
  "Bảo Vệ": { side: "Phe Dân", desc: "Mỗi đêm che chở một người, giúp họ miễn nhiễm với vết cắn của Sói đêm đó." },
  "Phù Thủy": { side: "Phe Dân", desc: "Có một bình cứu và một bình độc, mỗi bình chỉ dùng được một lần trong cả ván." },
  "Thợ Săn": { side: "Phe Dân", desc: "Nếu bị loại, có thể bắn theo một người khác. (Quản trò xử lý trực tiếp khi bạn bị loại)" },
  "Thần Tình Yêu": { side: "Phe Dân", desc: "Đêm đầu tiên chọn hai người thành đôi uyên ương gắn kết số phận. (Quản trò hướng dẫn trực tiếp)" },
  "Trưởng Làng": { side: "Phe Dân", desc: "Lá phiếu có giá trị gấp đôi khi biểu quyết ban ngày." },
  "Thổi Sáo": { side: "Phe thứ ba", desc: "Mỗi đêm thôi miên hai người. Thắng khi tất cả người còn sống đều bị thôi miên." },
  "Ăn Trộm": { side: "Phe thứ ba", desc: "Đêm đầu tiên được đổi sang một trong hai vai dự phòng." },
  "Phản Bội": { side: "Phe thứ ba", desc: "Ban đầu là dân nhưng nếu bị Sói cắn mà không chết, sẽ ngả theo phe Sói." },
  "Dân Làng": { side: "Phe Dân", desc: "Không có khả năng đặc biệt. Dùng lý lẽ và quan sát để tìm ra Sói vào ban ngày." },
};

function roleInfo(role) {
  return ROLE_INFO[role] || { side: "", desc: "Hãy chờ hướng dẫn của quản trò." };
}
