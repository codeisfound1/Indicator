const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Data stores ────────────────────────────────────────────────────────────
const rooms = {}; // roomId -> room object
const players = {}; // socketId -> player object

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ADJECTIVES = ['Swift','Bold','Keen','Wise','Bright','Sharp','Quick','Cool','Wild','Calm'];
const NOUNS      = ['Fox','Bear','Wolf','Hawk','Lion','Tiger','Eagle','Shark','Lynx','Puma'];
const ROOM_WORDS = ['Alpha','Beta','Gamma','Delta','Echo','Foxtrot','Nova','Pulse','Zenith','Apex'];

function randomName() {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = Math.floor(Math.random() * 90) + 10;
  return `${adj}${noun}${num}`;
}

function randomRoomName() {
  const w1 = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)];
  const w2 = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${w1}${w2}${num}`;
}

function generateGrid(size) {
  const count = size * size;
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  // Fisher-Yates shuffle
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

function getLevelConfig(level, customN) {
  switch (level) {
    case 'easy':   return { size: 5,  max: 25 };
    case 'medium': return { size: 7,  max: 49 };
    case 'hard':   return { size: 10, max: 100 };
    case 'custom': {
      const n = Math.max(10, parseInt(customN) || 10);
      return { size: n, max: n * n };
    }
    default: return { size: 5, max: 25 };
  }
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playersData = room.playerIds.map(pid => {
    const p = players[pid];
    if (!p) return null;
    return {
      id: pid,
      name: p.name,
      level: p.level,
      customN: p.customN,
      grid: p.grid,
      current: p.current,
      completed: p.completed,
      completionTime: p.completionTime,
      bestTime: p.bestTime,
      startTime: p.startTime,
      gridSize: p.gridSize
    };
  }).filter(Boolean);

  io.to(roomId).emit('room_state', {
    roomId,
    roomName: room.name,
    hostId: room.hostId,
    level: room.level,
    customN: room.customN,
    started: room.started,
    countdown: room.countdown,
    players: playersData,
    chat: room.chat
  });
}

function startCountdown(roomId) {
  const room = rooms[roomId];
  if (!room || room.countdownInterval) return;

  room.countdown = 600;
  room.countdownInterval = setInterval(() => {
    if (!rooms[roomId]) { clearInterval(room.countdownInterval); return; }
    room.countdown--;
    io.to(roomId).emit('countdown', room.countdown);
    if (room.countdown <= 0) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
      io.to(roomId).emit('time_up');
    }
  }, 1000);
}

function cleanupPlayer(socketId) {
  const player = players[socketId];
  if (!player) return;

  const roomId = player.roomId;
  if (roomId && rooms[roomId]) {
    const room = rooms[roomId];
    room.playerIds = room.playerIds.filter(id => id !== socketId);
    room.chat.push({ system: true, text: `${player.name} đã rời phòng.`, time: Date.now() });

    if (room.playerIds.length === 0) {
      // Delete empty room
      if (room.countdownInterval) clearInterval(room.countdownInterval);
      delete rooms[roomId];
    } else {
      if (room.hostId === socketId) {
        room.hostId = room.playerIds[0];
        room.chat.push({ system: true, text: `${players[room.hostId]?.name} trở thành chủ phòng.`, time: Date.now() });
      }
      broadcastRoomState(roomId);
      io.to(roomId).emit('player_left', { socketId, name: player.name });
    }
  }
  delete players[socketId];
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Register player
  socket.on('register', ({ name }) => {
    const playerName = (name && name.trim()) ? name.trim().substring(0, 20) : randomName();
    players[socket.id] = {
      id: socket.id,
      name: playerName,
      roomId: null,
      level: 'easy',
      customN: 10,
      grid: [],
      gridSize: 5,
      current: 1,
      completed: false,
      completionTime: null,
      bestTime: null,
      startTime: null
    };
    socket.emit('registered', { id: socket.id, name: playerName });
    socket.emit('lobby_update', getLobbyData());
  });

  // Get lobby
  socket.on('get_lobby', () => {
    socket.emit('lobby_update', getLobbyData());
  });

  // Create room
  socket.on('create_room', ({ level, customN }) => {
    const player = players[socket.id];
    if (!player) return;

    const roomId   = uuidv4().substring(0, 8);
    const roomName = randomRoomName();
    rooms[roomId]  = {
      id: roomId,
      name: roomName,
      hostId: socket.id,
      level: level || 'easy',
      customN: customN || 10,
      playerIds: [],
      chat: [],
      started: false,
      countdown: 600,
      countdownInterval: null
    };

    joinRoom(socket, roomId);
    io.emit('lobby_update', getLobbyData());
  });

  // Join room
  socket.on('join_room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error_msg', 'Phòng không tồn tại.'); return; }
    if (room.playerIds.length >= 4) { socket.emit('error_msg', 'Phòng đã đầy (tối đa 4 người).'); return; }
    joinRoom(socket, roomId);
    io.emit('lobby_update', getLobbyData());
  });

  function joinRoom(socket, roomId) {
    const player = players[socket.id];
    const room   = rooms[roomId];
    if (!player || !room) return;

    if (player.roomId) {
      socket.leave(player.roomId);
    }

    // Setup player grid based on room level (default) or player's own choice
    const lvl = player.level || room.level;
    const cfg = getLevelConfig(lvl, player.customN || room.customN);
    player.roomId   = roomId;
    player.level    = lvl;
    player.gridSize = cfg.size;
    player.grid     = generateGrid(cfg.size);
    player.current  = 1;
    player.completed   = false;
    player.completionTime = null;
    player.startTime = Date.now();

    room.playerIds.push(socket.id);
    socket.join(roomId);

    if (!room.started && room.playerIds.length === 1) {
      room.started = true;
      startCountdown(roomId);
    }

    room.chat.push({ system: true, text: `${player.name} đã vào phòng.`, time: Date.now() });
    broadcastRoomState(roomId);
    socket.emit('joined_room', { roomId, roomName: room.name });
  }

  // Leave room
  socket.on('leave_room', () => {
    cleanupPlayer(socket.id);
    const player = players[socket.id];
    // Re-add player entry after cleanup
    if (!players[socket.id]) {
      // Restore a minimal player record
      players[socket.id] = {
        id: socket.id,
        name: (player && player.name) || randomName(),
        roomId: null, level: 'easy', customN: 10,
        grid: [], gridSize: 5, current: 1,
        completed: false, completionTime: null,
        bestTime: null, startTime: null
      };
    }
    players[socket.id].roomId = null;
    socket.emit('left_room');
    socket.emit('lobby_update', getLobbyData());
    io.emit('lobby_update', getLobbyData());
  });

  // Change level (player chooses their own level)
  socket.on('change_level', ({ level, customN }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const cfg = getLevelConfig(level, customN);
    player.level    = level;
    player.customN  = customN;
    player.gridSize = cfg.size;
    player.grid     = generateGrid(cfg.size);
    player.current  = 1;
    player.completed   = false;
    player.completionTime = null;
    player.startTime = Date.now();
    broadcastRoomState(player.roomId);
  });

  // Cell click
  socket.on('cell_click', ({ number }) => {
    const player = players[socket.id];
    if (!player || player.completed) return;

    if (number === player.current) {
      player.current++;
      const cfg = getLevelConfig(player.level, player.customN);
      if (player.current > cfg.max) {
        player.completed = true;
        const elapsed = Math.floor((Date.now() - player.startTime) / 1000);
        player.completionTime = elapsed;
        if (!player.bestTime || elapsed < player.bestTime) {
          player.bestTime = elapsed;
        }
        io.to(player.roomId).emit('player_completed', {
          playerId: socket.id,
          name: player.name,
          time: elapsed
        });
      }
      broadcastRoomState(player.roomId);
    }
  });

  // Chat
  socket.on('chat_msg', ({ text }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const msg = { name: player.name, text: text.substring(0, 200), time: Date.now() };
    rooms[player.roomId].chat.push(msg);
    if (rooms[player.roomId].chat.length > 100) rooms[player.roomId].chat.shift();
    io.to(player.roomId).emit('new_chat', msg);
  });

  // Restart (host only)
  socket.on('restart_game', () => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || room.hostId !== socket.id) return;

    if (room.countdownInterval) { clearInterval(room.countdownInterval); room.countdownInterval = null; }
    room.countdown = 600;
    room.started   = true;

    room.playerIds.forEach(pid => {
      const p = players[pid];
      if (!p) return;
      const cfg = getLevelConfig(p.level, p.customN);
      p.grid     = generateGrid(cfg.size);
      p.current  = 1;
      p.completed = false;
      p.completionTime = null;
      p.startTime = Date.now();
    });

    room.chat.push({ system: true, text: 'Game đã được khởi động lại!', time: Date.now() });
    startCountdown(player.roomId);
    broadcastRoomState(player.roomId);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    cleanupPlayer(socket.id);
    io.emit('lobby_update', getLobbyData());
  });
});

function getLobbyData() {
  return Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    level: r.level,
    playerCount: r.playerIds.length,
    maxPlayers: 4,
    started: r.started
  }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 NumGrid server running at http://localhost:${PORT}`));
