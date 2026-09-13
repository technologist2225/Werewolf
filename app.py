# -*- coding: utf-8 -*-
"""
Web Quản Trò Ma Sói
--------------------
Backend Flask phục vụ toàn bộ luồng chơi: tạo phòng, vào phòng, chia vai,
hành động ban đêm (Sói / Tiên Tri / Bảo Vệ / Phù Thủy), tổng kết đêm,
bỏ phiếu treo cổ ban ngày và kiểm tra điều kiện thắng thua.

Dữ liệu được lưu trong RAM (dict `rooms`). Phù hợp để chạy 1 bàn chơi
offline, mất dữ liệu khi restart server (đúng như thiết kế ban đầu).
"""

import random
import string
import time

from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Dữ liệu trong RAM
# ---------------------------------------------------------------------------
rooms = {}  # room_code -> GameRoom

MIN_PLAYERS = 5

# Vai trò thuộc phe Sói (dùng để tính thắng/thua)
WOLF_ROLES = {"Ma Sói"}


class Player:
    def __init__(self, name, is_host=False):
        self.name = name
        self.role = None
        self.is_alive = True
        self.is_host = is_host
        # Trạng thái dùng thuốc của Phù Thủy
        self.witch_used_save = False
        self.witch_used_kill = False

    def to_public_dict(self):
        return {
            "name": self.name,
            "is_alive": self.is_alive,
            "is_host": self.is_host,
        }

    def to_full_dict(self):
        d = self.to_public_dict()
        d["role"] = self.role
        return d


class GameRoom:
    def __init__(self, room_code):
        self.room_code = room_code
        self.players = []
        self.is_started = False
        self.phase = "lobby"  # lobby -> night -> day -> ended
        self.day_count = 0
        self.winner = None  # None | "soi" | "dan"

        # Hành động ban đêm (reset sau mỗi lần tổng kết đêm)
        self.wolf_target = None
        self.guard_target = None
        self.witch_save_target = None
        self.witch_kill_target = None

        self.last_night_result = None
        self.log = []

    # ------------------------------------------------------------------
    def find_player(self, name):
        return next((p for p in self.players if p.name == name), None)

    def alive_players(self):
        return [p for p in self.players if p.is_alive]

    def add_log(self, message):
        self.log.append({"time": time.time(), "message": message})
        # Giữ log gọn
        self.log = self.log[-100:]

    # ------------------------------------------------------------------
    def assign_roles(self):
        """Chia vai theo số lượng người chơi, dựa theo bảng thiết lập của
        quản trò (xem tài liệu thiết kế)."""
        n = len(self.players)
        random.shuffle(self.players)

        if n < MIN_PLAYERS:
            raise ValueError("Cần ít nhất 5 người chơi để bắt đầu!")

        if n <= 6:
            # 5-6 người: 1 Sói, 1 Tiên Tri, 1 Phù Thủy, còn lại Dân Làng
            roles = ["Ma Sói", "Tiên Tri", "Phù Thủy"] + ["Dân Làng"] * (n - 3)
        elif n == 7:
            # Không có trong bảng gốc -> nội suy hợp lý
            roles = ["Ma Sói", "Tiên Tri", "Bảo Vệ", "Phù Thủy"] + ["Dân Làng"] * (n - 4)
        elif 8 <= n <= 9:
            roles = ["Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ"] + ["Dân Làng"] * (n - 4)
        elif 10 <= n <= 11:
            roles = ["Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn"] + ["Dân Làng"] * (n - 6)
        elif 12 <= n <= 13:
            roles = ["Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu"] + ["Dân Làng"] * (n - 7)
        elif n == 14:
            roles = (
                ["Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy"]
                + ["Dân Làng"] * 5
                + ["Phản Bội"]
            )
        elif n == 15:
            roles = (
                ["Ma Sói", "Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy"]
                + ["Dân Làng"] * 6
            )
        elif n == 16:
            roles = (
                ["Ma Sói", "Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy", "Trưởng Làng"]
                + ["Dân Làng"] * 6
            )
        elif n == 17:
            roles = (
                ["Ma Sói", "Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy", "Trưởng Làng", "Thổi Sáo"]
                + ["Dân Làng"] * 6
            )
        elif n == 18:
            roles = (
                ["Ma Sói", "Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy", "Trưởng Làng", "Thổi Sáo", "Ăn Trộm"]
                + ["Dân Làng"] * 6
            )
        else:
            # Trên 18 người: mở rộng tỉ lệ Sói ~ 1/4 tổng số người
            special = ["Ma Sói", "Ma Sói", "Ma Sói", "Ma Sói", "Tiên Tri", "Bảo Vệ", "Thợ Săn", "Thần Tình Yêu", "Phù Thủy", "Trưởng Làng", "Thổi Sáo", "Ăn Trộm"]
            extra_wolves = max(0, (n // 4) - 4)
            roles = special + ["Ma Sói"] * extra_wolves
            roles += ["Dân Làng"] * (n - len(roles))

        for player, role in zip(self.players, roles):
            player.role = role
            player.witch_used_save = False
            player.witch_used_kill = False

        self.is_started = True
        self.phase = "night"
        self.day_count = 1
        self.add_log("Trò chơi bắt đầu, vai trò đã được chia xong.")

    # ------------------------------------------------------------------
    def reset_night_actions(self):
        self.wolf_target = None
        self.guard_target = None
        self.witch_save_target = None
        self.witch_kill_target = None

    def check_win(self):
        """Trả về 'soi' | 'dan' | None"""
        alive = self.alive_players()
        wolves_alive = [p for p in alive if p.role in WOLF_ROLES]
        others_alive = [p for p in alive if p.role not in WOLF_ROLES]

        if len(wolves_alive) == 0 and self.is_started:
            self.winner = "dan"
        elif self.is_started and len(wolves_alive) > 0 and len(wolves_alive) >= len(others_alive):
            self.winner = "soi"
        else:
            self.winner = None

        if self.winner:
            self.phase = "ended"
        return self.winner

    def to_state_dict(self):
        return {
            "room_code": self.room_code,
            "is_started": self.is_started,
            "phase": self.phase,
            "day_count": self.day_count,
            "winner": self.winner,
            "players": [p.to_public_dict() for p in self.players],
            "log": self.log[-15:],
            "last_result_msg": self.last_night_result["message"] if self.last_night_result else None,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def error(message, code=400):
    return jsonify({"success": False, "message": message}), code


def generate_room_code():
    code = "".join(random.choices(string.digits, k=4))
    while code in rooms:
        code = "".join(random.choices(string.digits, k=4))
    return code


def get_room_or_404(room_code):
    return rooms.get(room_code)


# ---------------------------------------------------------------------------
# Trang web (frontend)
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/host")
def host_page():
    return render_template("host.html")


@app.route("/player")
def player_page():
    return render_template("player.html")


# ---------------------------------------------------------------------------
# API 1: Tạo phòng mới
# ---------------------------------------------------------------------------
@app.route("/api/create-room", methods=["POST"])
def create_room():
    data = request.get_json(silent=True) or {}
    host_name = (data.get("name") or "").strip()
    if not host_name:
        return error("Vui lòng nhập tên của bạn!")

    room_code = generate_room_code()
    room = GameRoom(room_code)
    room.players.append(Player(host_name, is_host=True))
    rooms[room_code] = room

    return jsonify({
        "success": True,
        "room_code": room_code,
        "message": "Tạo phòng thành công!",
    })


# ---------------------------------------------------------------------------
# API 2: Tham gia phòng bằng mã code
# ---------------------------------------------------------------------------
@app.route("/api/join-room", methods=["POST"])
def join_room():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    player_name = (data.get("name") or "").strip()

    if not room_code or not player_name:
        return error("Vui lòng nhập đầy đủ mã phòng và tên!")

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)

    if room.is_started:
        return error("Trò chơi đã bắt đầu, không thể vào phòng!")

    if room.find_player(player_name):
        return error("Tên này đã có người dùng trong phòng, hãy chọn tên khác!")

    room.players.append(Player(player_name))
    room.add_log(f"{player_name} đã vào phòng.")

    return jsonify({
        "success": True,
        "message": f"Đã vào phòng {room_code}",
        "players": [p.name for p in room.players],
    })


# ---------------------------------------------------------------------------
# API 3: Bắt đầu trò chơi và phân vai
# ---------------------------------------------------------------------------
@app.route("/api/start-game", methods=["POST"])
def start_game():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)

    if room.is_started:
        return error("Trò chơi đã được bắt đầu rồi!")

    if len(room.players) < MIN_PLAYERS:
        return error(f"Cần ít nhất {MIN_PLAYERS} người chơi để bắt đầu!")

    try:
        room.assign_roles()
    except ValueError as e:
        return error(str(e))

    game_data = [{"name": p.name, "role": p.role} for p in room.players]
    return jsonify({
        "success": True,
        "message": "Trò chơi đã bắt đầu! Vai trò đã được chia (bí mật với từng người).",
        "data": game_data,  # host-only view; frontend host page hiển thị, player lấy qua /api/my-role
    })


# ---------------------------------------------------------------------------
# Trạng thái phòng / vai trò cá nhân
# ---------------------------------------------------------------------------
@app.route("/api/room-state", methods=["GET"])
def room_state():
    room_code = (request.args.get("room_code") or "").strip()
    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    return jsonify({"success": True, "room": room.to_state_dict()})


@app.route("/api/host-view", methods=["GET"])
def host_view():
    """Chỉ dành cho quản trò: xem đầy đủ vai trò của tất cả người chơi."""
    room_code = (request.args.get("room_code") or "").strip()
    host_name = (request.args.get("host_name") or "").strip()
    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)

    host_player = room.find_player(host_name)
    if not host_player or not host_player.is_host:
        return error("Bạn không phải quản trò của phòng này!", 403)

    state = room.to_state_dict()
    state["players"] = [p.to_full_dict() for p in room.players]
    state["night_status"] = {
        "wolf_done": room.wolf_target is not None,
        "guard_done": room.guard_target is not None,
        "witch_done": room.witch_save_target is not None or room.witch_kill_target is not None,
    }
    has_seer = any(p.role == "Tiên Tri" and p.is_alive for p in room.players)
    has_guard = any(p.role == "Bảo Vệ" and p.is_alive for p in room.players)
    has_witch = any(p.role == "Phù Thủy" and p.is_alive for p in room.players)
    has_wolf = any(p.role == "Ma Sói" and p.is_alive for p in room.players)
    state["night_roles_alive"] = {
        "wolf": has_wolf, "guard": has_guard, "witch": has_witch, "seer": has_seer,
    }
    return jsonify({"success": True, "room": state})


@app.route("/api/my-role", methods=["GET"])
def my_role():
    room_code = (request.args.get("room_code") or "").strip()
    name = (request.args.get("name") or "").strip()
    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)

    player = room.find_player(name)
    if not player:
        return error("Không tìm thấy người chơi trong phòng!", 404)

    payload = {
        "success": True,
        "is_started": room.is_started,
        "phase": room.phase,
        "day_count": room.day_count,
        "winner": room.winner,
        "name": player.name,
        "role": player.role,
        "is_alive": player.is_alive,
        "witch_used_save": player.witch_used_save,
        "witch_used_kill": player.witch_used_kill,
        "last_result_msg": room.last_night_result["message"] if room.last_night_result else None,
        "alive_players": [p.name for p in room.players if p.is_alive and p.name != player.name],
    }

    # Phù Thủy cần biết ai vừa bị Sói cắn để quyết định cứu hay không
    if player.role == "Phù Thủy" and room.phase == "night":
        payload["wolf_victim_hint"] = room.wolf_target

    return jsonify(payload)


# ---------------------------------------------------------------------------
# API 4: Ma Sói chọn mục tiêu vào ban đêm
# ---------------------------------------------------------------------------
@app.route("/api/wolf-action", methods=["POST"])
def wolf_action():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    target_name = (data.get("target_name") or "").strip()
    wolf_name = (data.get("wolf_name") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "night":
        return error("Không phải phiên ban đêm!")

    if wolf_name:
        wolf_player = room.find_player(wolf_name)
        if not wolf_player or not wolf_player.is_alive or wolf_player.role != "Ma Sói":
            return error("Bạn không phải Ma Sói còn sống, không thể cắn!", 403)

    target = room.find_player(target_name)
    if not target or not target.is_alive:
        return error("Mục tiêu không hợp lệ!")

    room.wolf_target = target_name
    room.add_log("Ma Sói đã chọn xong mục tiêu trong đêm.")
    return jsonify({"success": True, "message": f"Sói đã chọn tiêu diệt: {target_name}"})


# ---------------------------------------------------------------------------
# API 5: Tiên Tri soi danh tính
# ---------------------------------------------------------------------------
@app.route("/api/seer-action", methods=["POST"])
def seer_action():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    seer_name = (data.get("seer_name") or "").strip()
    target_name = (data.get("target_name") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "night":
        return error("Không phải phiên ban đêm!")

    seer_player = room.find_player(seer_name)
    if not seer_player or not seer_player.is_alive:
        return error("Tiên Tri đã chết hoặc không tồn tại, không thể soi!")
    if seer_player.role != "Tiên Tri":
        return error("Bạn không phải Tiên Tri!", 403)

    target = room.find_player(target_name)
    if not target:
        return error("Không tìm thấy mục tiêu!")

    role_hint = "Ma Sói" if target.role == "Ma Sói" else "Dân Làng/Phe Khác"

    return jsonify({
        "success": True,
        "target": target_name,
        "role_hint": role_hint,
        "message": f"Tiên tri đã soi {target_name}",
    })


# ---------------------------------------------------------------------------
# API 6: Bảo Vệ chọn người che chở
# ---------------------------------------------------------------------------
@app.route("/api/guard-action", methods=["POST"])
def guard_action():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    guard_name = (data.get("guard_name") or "").strip()
    target_name = (data.get("target_name") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "night":
        return error("Không phải phiên ban đêm!")

    guard_player = room.find_player(guard_name)
    if not guard_player or not guard_player.is_alive:
        return error("Bảo Vệ đã chết hoặc không tồn tại, không thể bảo vệ!")
    if guard_player.role != "Bảo Vệ":
        return error("Bạn không phải Bảo Vệ!", 403)

    target = room.find_player(target_name)
    if not target or not target.is_alive:
        return error("Mục tiêu không hợp lệ!")

    room.guard_target = target_name
    room.add_log("Bảo Vệ đã chọn xong người che chở trong đêm.")
    return jsonify({"success": True, "message": f"Bảo Vệ đã chọn bảo vệ: {target_name}"})


# ---------------------------------------------------------------------------
# API: Phù Thủy dùng thuốc (cứu / giết)
# ---------------------------------------------------------------------------
@app.route("/api/witch-action", methods=["POST"])
def witch_action():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    witch_name = (data.get("witch_name") or "").strip()
    action_type = (data.get("action_type") or "").strip().lower()
    target_name = (data.get("target_name") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "night":
        return error("Không phải phiên ban đêm!")

    witch_player = room.find_player(witch_name)
    if not witch_player or not witch_player.is_alive:
        return error("Phù Thủy đã chết hoặc không tồn tại, không thể dùng thuốc!")
    if witch_player.role != "Phù Thủy":
        return error("Bạn không phải Phù Thủy!", 403)

    if action_type == "save":
        if witch_player.witch_used_save:
            return error("Bạn đã dùng bình cứu rồi, không thể dùng thêm!")
        if not room.wolf_target:
            return error("Đêm nay chưa có ai bị Sói cắn để cứu!")
        room.witch_save_target = room.wolf_target
        witch_player.witch_used_save = True
        room.add_log("Phù Thủy đã dùng bình cứu.")
        return jsonify({"success": True, "message": f"Phù Thủy đã dùng bình cứu cho: {room.wolf_target}"})

    elif action_type == "kill":
        if witch_player.witch_used_kill:
            return error("Bạn đã dùng bình độc rồi, không thể dùng thêm!")
        target = room.find_player(target_name)
        if not target or not target.is_alive:
            return error("Mục tiêu không hợp lệ!")
        room.witch_kill_target = target_name
        witch_player.witch_used_kill = True
        room.add_log("Phù Thủy đã dùng bình độc.")
        return jsonify({"success": True, "message": f"Phù Thủy đã dùng bình độc tiêu diệt: {target_name}"})

    return error("Hành động không hợp lệ! (action_type phải là 'save' hoặc 'kill')")


# ---------------------------------------------------------------------------
# API 7: Tổng kết đêm
# ---------------------------------------------------------------------------
@app.route("/api/resolve-night", methods=["POST"])
def resolve_night():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "night":
        return error("Không phải phiên ban đêm, không thể tổng kết!")

    victims = []

    # 1) Xử lý nạn nhân của Sói: được cứu nếu Bảo Vệ hoặc Phù Thủy (bình cứu) trùng mục tiêu
    wolf_victim = room.wolf_target
    saved = wolf_victim is not None and (
        wolf_victim == room.guard_target or wolf_victim == room.witch_save_target
    )
    if wolf_victim and not saved:
        victims.append(wolf_victim)

    # 2) Xử lý mục tiêu bị Phù Thủy đầu độc (độc lập với Sói)
    if room.witch_kill_target and room.witch_kill_target not in victims:
        victims.append(room.witch_kill_target)

    # Áp dụng cái chết
    for name in victims:
        p = room.find_player(name)
        if p:
            p.is_alive = False

    room.reset_night_actions()
    room.phase = "day"

    if victims:
        msg = "Trời sáng! Nạn nhân đêm qua là: " + ", ".join(victims)
    else:
        msg = "Trời sáng! Đêm qua không có ai chết."
    room.add_log(msg)

    winner = room.check_win()
    room.last_night_result = {
        "day": room.day_count,
        "victims": victims,
        "message": msg,
    }

    alive_players = [p.name for p in room.players if p.is_alive]

    return jsonify({
        "success": True,
        "day": room.day_count,
        "victims_of_night": victims,
        "message": msg,
        "alive_players": alive_players,
        "phase": room.phase,
        "winner": winner,
    })


# ---------------------------------------------------------------------------
# API: Bỏ phiếu treo cổ ban ngày
# ---------------------------------------------------------------------------
@app.route("/api/vote-hang", methods=["POST"])
def vote_hang():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()
    suspect_name = (data.get("suspect_name") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)
    if room.phase != "day":
        return error("Không phải phiên ban ngày, không thể treo cổ!")

    suspect = room.find_player(suspect_name)
    if not suspect or not suspect.is_alive:
        return error("Nghi phạm không hợp lệ!")

    suspect.is_alive = False
    room.add_log(f"Làng đã quyết định treo cổ {suspect_name}.")

    winner = room.check_win()
    if not winner:
        room.phase = "night"
        room.day_count += 1

    alive_players = [p.name for p in room.players if p.is_alive]

    return jsonify({
        "success": True,
        "message": f"{suspect_name} đã bị treo cổ!",
        "hanged": suspect_name,
        "alive_players": alive_players,
        "phase": room.phase,
        "day_count": room.day_count,
        "winner": winner,
    })


# ---------------------------------------------------------------------------
# API: Kiểm tra thắng thua
# ---------------------------------------------------------------------------
@app.route("/api/check-win", methods=["POST"])
def check_win():
    data = request.get_json(silent=True) or {}
    room_code = (data.get("room_code") or "").strip()

    room = get_room_or_404(room_code)
    if not room:
        return error("Phòng không tồn tại!", 404)

    winner = room.check_win()

    result = {
        "success": True,
        "winner": winner,
        "phase": room.phase,
    }

    if winner:
        # Gắn nhãn VICTORY / LOSE cho từng người chơi theo yêu cầu thiết kế
        results = []
        for p in room.players:
            if winner == "soi":
                tag = "VICTORY" if p.role == "Ma Sói" else "LOSE"
            else:
                tag = "VICTORY" if p.role != "Ma Sói" else "LOSE"
            results.append({"name": p.name, "role": p.role, "result": tag})
        result["results"] = results
        result["message"] = "Phe Ma Sói đã chiến thắng! 🐺" if winner == "soi" else "Phe Dân Làng đã chiến thắng! 🎉"
    else:
        result["message"] = "Trò chơi vẫn đang tiếp diễn."

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
