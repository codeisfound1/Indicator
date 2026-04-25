// server.js
// Express + Socket.IO server for Grid Finder (fixed sync & selection issues)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const shortid = require('shortid');

const PORT = process.env.PORT || 3000;
const PERSIST_FILE = path.join(__dirname, 'best_times.json');
const DISCONNECT_GRACE_MS = 30 * 1000; // 30s

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores
const rooms = {};
const players = {};
let bestTimes = {};

// Load persisted best times
try {
  if (fs.existsSync(PERSIST_FILE)) {
    bestTimes = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8')) || {};
  }
} catch (e) {
  console.error('Failed to load best times:', e);
}

function persistBestTimes() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(bestTimes, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to persist best times:', e);
  }
}

const TOKENS = [
  "bop","ziv","mek","lun","tor","sai","ka","ri","mo","fen","sam","tuk","vel","jun","pib","noz","gim","rax","koi","yul",
  "az","be","ci","do","ek","fi","go","hu","il","jo","ku","li","ni","op","pi","qu","ru","si","ta","ul","vo","wi","xo","ye","zu"
];
function randomName() {
  const a = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const b = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  return (a + '-' + b).slice(0, 18);
}

function levelToN(level) {
  if (level === 'easy') return 5;
  if (level === 'medium') return 7;
  if (level === 'hard') return 10;
  return 10;
}

function roomLevelKey(level, n) {
  if (level === 'custom') return `custom_${n}`;
  return `${level}_${n}`;
}

function createRoom({ level = 'easy', n = null, settings = {} } = {}) {
  const roomId = shortid.generate();
  const actualN = (level === 'custom') ? (n || 10) : levelToN(level);
  const room = {
    id: roomId,
    level,
    n: actualN,
    settings: Object.assign({
      countdown: 600,
      cellSize: 60,
      fontCell: 25,
      fontTarget: 65,
      highContrast: false,
    }, settings),
    players: {}, // playerId -> playerState
    createdAt: Date.now(),
    status: 'lobby',
    startTime: null,
    timerInterval: null,
    timeLeft: null,
    seed: null,
  };
  rooms[roomId] = room;
  return room;
}

function broadcastRoomList() {
  const list = Object.values(rooms).map(r => ({
    id: r.id,
    level: r.level,
    n: r.n,
    players: Object.keys(r.players).length,
    status: r.status,
  }));
  io.emit('room_list_update', list);
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const id of Object.keys(rooms)) {
    if (Object.keys(rooms[id].players).length === 0 && rooms[id].createdAt < cutoff) {
      delete rooms[id];
    }
  }
  broadcastRoomList();
}, 60 * 60 * 1000);

io.on('connection', (socket) => {
  const socketPlayer = {
    socketId: socket.id,
    playerId: shortid.generate(),
    name: randomName(),
    roomId: null,
    disconnectedAt: null,
  };
  players[socket.id] = socketPlayer;

  socket.emit('room_list_update', Object.values(rooms).map(r => ({
    id: r.id, level: r.level, n: r.n, players: Object.keys(r.players).length, status: r.status
  })));

  socket.on('create_room', (data = {}) => {
    const { level = 'easy', n = 5, playerName, settings = {} } = data;
    const room = createRoom({ level, n, settings });
    const playerId = socketPlayer.playerId;
    const name = playerName || socketPlayer.name;
    room.players[playerId] = {
      playerId,
      socketId: socket.id,
      name,
      isHost: true,
      ready: false,
      nextNumber: 1,
      selectedNumbers: [],
      finished: false,
      finishTime: null,
      bestTime: null,
      disconnectTimer: null,
    };
    socketPlayer.name = name;
    socketPlayer.roomId = room.id;
    socket.join(room.id);

    const key = roomLevelKey(room.level, room.n);
    const existing = bestTimes[key] && bestTimes[key][playerId];
    if (existing) room.players[playerId].bestTime = existing;

    socket.emit('room_update', sanitizeRoom(room));
    broadcastRoomList();
  });

  socket.on('join_room', (data = {}) => {
    const { roomId, playerName } = data;
    const room = rooms[roomId];
    if (!room) {
      socket.emit('player_kicked', { reason: 'room_not_found' });
      return;
    }
    if (Object.keys(room.players).length >= 4) {
      socket.emit('player_kicked', { reason: 'room_full' });
      return;
    }
    const playerId = socketPlayer.playerId;
    const name = playerName || socketPlayer.name;
    room.players[playerId] = {
      playerId,
      socketId: socket.id,
      name,
      isHost: false,
      ready: false,
      nextNumber: 1,
      selectedNumbers: [],
      finished: false,
      finishTime: null,
      bestTime: null,
      disconnectTimer: null,
    };
    socketPlayer.name = name;
    socketPlayer.roomId = room.id;
    socket.join(room.id);

    const key = roomLevelKey(room.level, room.n);
    const existing = bestTimes[key] && bestTimes[key][playerId];
    if (existing) room.players[playerId].bestTime = existing;

    io.to(room.id).emit('room_update', sanitizeRoom(room));
    broadcastRoomList();
  });

  socket.on('set_ready', (data = {}) => {
    const { roomId, playerId, ready } = data;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[playerId];
    if (!p) return;
    p.ready = !!ready;
    io.to(room.id).emit('room_update', sanitizeRoom(room));
  });

  socket.on('start_game', (data = {}) => {
    const { roomId } = data;
    const room = rooms[roomId];
    if (!room) return;
    const host = Object.values(room.players).find(x => x.isHost);
    if (!host || host.socketId !== socket.id) return;
    if (room.status === 'running') return;

    room.status = 'running';
    room.startTime = Date.now();
    room.timeLeft = room.settings.countdown;
    room.seed = Math.floor(Math.random() * 1e9);
    for (const pid in room.players) {
      const p = room.players[pid];
      p.nextNumber = 1;
      p.selectedNumbers = [];
      p.finished = false;
      p.finishTime = null;
    }

    room.timerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - room.startTime) / 1000);
      const remaining = Math.max(room.settings.countdown - elapsedSec, 0);
      room.timeLeft = remaining;
      io.to(room.id).emit('game_state', {
        roomId: room.id,
        playersState: summarizePlayers(room),
        timeLeft: remaining
      });
      if (remaining === 0) {
        finalizeRoomOnTimeout(room);
      }
    }, 1000);

    io.to(room.id).emit('game_start', {
      roomId: room.id,
      startTime: room.startTime,
      gridSeed: room.seed,
      levelSettings: { level: room.level, n: room.n, settings: room.settings }
    });
    broadcastRoomList();
  });

  socket.on('cell_selected', (data = {}) => {
    const { roomId, playerId, cellNumber } = data;
    const room = rooms[roomId];
    if (!room || room.status !== 'running') return;
    const p = room.players[playerId];
    if (!p) return;
    const num = Number(cellNumber);
    if (!Number.isInteger(num) || num < 1 || num > room.n * room.n) {
      socket.emit('invalid_selection', { reason: 'out_of_range', got: cellNumber });
      return;
    }
    if (p.finished) return;

    // Validate order: next expected number is p.nextNumber
    if (num !== p.nextNumber) {
      socket.emit('invalid_selection', { reason: 'wrong_order', expected: p.nextNumber, got: num });
      return;
    }

    // Accept selection
    p.selectedNumbers.push(num);
    p.nextNumber += 1;

    const total = room.n * room.n;
    if (p.nextNumber > total && !p.finished) {
      p.finished = true;
      p.finishTime = Date.now() - room.startTime;
      // update best times
      const key = roomLevelKey(room.level, room.n);
      if (!bestTimes[key]) bestTimes[key] = {};
      const prev = bestTimes[key][p.playerId];
      if (!prev || p.finishTime < prev) {
        bestTimes[key][p.playerId] = p.finishTime;
        persistBestTimes();
        io.to(room.id).emit('best_time_update', { playerId: p.playerId, bestTime: p.finishTime });
      }
      io.to(room.id).emit('player_finished', { playerId: p.playerId, finishTime: p.finishTime });
    }

    io.to(room.id).emit('game_state', {
      roomId: room.id,
      playersState: summarizePlayers(room),
      timeLeft: room.timeLeft
    });
  });

  socket.on('send_chat', (data = {}) => {
    const { roomId, playerId, message } = data;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[playerId];
    if (!p) return;
    const payload = { playerId, name: p.name, message, ts: Date.now() };
    io.to(room.id).emit('chat_message', payload);
  });

  socket.on('disconnect', () => {
    const sp = players[socket.id];
    if (!sp) return;
    const { roomId, playerId } = sp;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      const p = room.players[playerId];
      if (p) {
        p.disconnectedAt = Date.now();
        p.disconnectTimer = setTimeout(() => {
          delete room.players[playerId];
          io.to(room.id).emit('player_kicked', { playerId, reason: 'disconnected_timeout' });
          io.to(room.id).emit('room_update', sanitizeRoom(room));
          broadcastRoomList();
          if (Object.keys(room.players).length === 0) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            delete rooms[roomId];
            broadcastRoomList();
          }
        }, DISCONNECT_GRACE_MS);
        io.to(room.id).emit('room_update', sanitizeRoom(room));
      }
    }
    delete players[socket.id];
  });

  // utilities
  function sanitizeRoom(room) {
    return {
      id: room.id,
      level: room.level,
      n: room.n,
      settings: room.settings,
      players: Object.values(room.players).map(p => ({
        playerId: p.playerId,
        name: p.name,
        isHost: p.isHost,
        ready: p.ready,
        finished: p.finished,
        finishTime: p.finishTime,
        bestTime: p.bestTime,
        disconnected: !!p.disconnectedAt
      })),
      status: room.status
    };
  }

  function summarizePlayers(room) {
    const res = {};
    for (const pid in room.players) {
      const p = room.players[pid];
      res[pid] = {
        playerId: p.playerId,
        name: p.name,
        selectedNumbers: p.selectedNumbers.slice(),
        selectedCount: p.selectedNumbers.length,
        nextNumber: p.nextNumber,
        finished: p.finished,
        finishTime: p.finishTime,
        bestTime: p.bestTime,
        disconnected: !!p.disconnectedAt
      };
    }
    return res;
  }

  function finalizeRoomOnTimeout(room) {
    for (const pid in room.players) {
      const p = room.players[pid];
      if (!p.finished) {
        p.finished = true;
        p.finishTime = null;
      }
    }
    room.status = 'finished';
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    io.to(room.id).emit('game_state', {
      roomId: room.id,
      playersState: summarizePlayers(room),
      timeLeft: 0
    });
    broadcastRoomList();
  }
});

server.listen(PORT, () => {
  console.log(`Grid Finder server running on http://localhost:${PORT}`);
});
