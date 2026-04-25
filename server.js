// server.js
// Express + Socket.IO server for Grid Finder
// Run: node server.js
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

// Serve /public as static
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store
const rooms = {}; // roomId -> room object
const players = {}; // socketId -> player meta
let bestTimes = {}; // key = roomLevelKey -> { playerId: bestMs, ... }

// Load persisted best times if exists
try {
  if (fs.existsSync(PERSIST_FILE)) {
    bestTimes = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8')) || {};
  }
} catch (e) {
  console.error('Failed to load best times:', e);
}

// Utility: save bestTimes optionally
function persistBestTimes() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(bestTimes, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to persist best times:', e);
  }
}

// Simple random short name generator using two-token approach
const TOKENS = [
  "bop","ziv","mek","lun","tor","sai","ka","ri","mo","fen","sam","tuk","vel","jun","pib","noz","gim","rax","koi","yul",
  "az","be","ci","do","ek","fi","go","hu","il","jo","ku","li","mo","ni","op","pi","qu","ru","si","ta","ul","vo","wi","xo","ye","zu",
  // (add up to 200 tokens as needed)
];
function randomName() {
  const a = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  const b = TOKENS[Math.floor(Math.random() * TOKENS.length)];
  return (a + '-' + b).slice(0, 18);
}

// Room helper: create key for bestTimes storage based on level settings
function roomLevelKey(level, n) {
  if (level === 'custom') return `custom_${n}`;
  return `${level}`;
}

// Create room
function createRoom({ level = 'easy', n = 5, settings = {} } = {}) {
  const roomId = shortid.generate();
  const room = {
    id: roomId,
    level,
    n,
    settings: Object.assign({
      countdown: 600, // seconds
      cellSize: 60,
      fontCell: 25,
      fontTarget: 65,
      highContrast: false,
    }, settings),
    players: {}, // playerId -> playerState
    createdAt: Date.now(),
    status: 'lobby', // 'lobby' | 'running' | 'finished'
    startTime: null, // epoch ms
    timerInterval: null,
    timeLeft: null,
    seed: null,
  };
  rooms[roomId] = room;
  return room;
}

// Validate cell_selected server-side ordering
function validateSelection(playerState, cellNumber) {
  if (!playerState) return false;
  if (playerState.finished) return false;
  return cellNumber === playerState.nextNumber;
}

// Broadcast room list to all connected clients
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

// Periodic cleanup for empty old rooms (optional)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
  for (const id of Object.keys(rooms)) {
    if (Object.keys(rooms[id].players).length === 0 && rooms[id].createdAt < cutoff) {
      delete rooms[id];
    }
  }
  broadcastRoomList();
}, 60 * 60 * 1000);

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Assign ephemeral player record
  const socketPlayer = {
    socketId: socket.id,
    playerId: shortid.generate(),
    name: randomName(),
    roomId: null,
    disconnectedAt: null,
  };
  players[socket.id] = socketPlayer;

  // Send current room list immediately
  socket.emit('room_list_update', Object.values(rooms).map(r => ({
    id: r.id, level: r.level, n: r.n, players: Object.keys(r.players).length, status: r.status
  })));

  // Create room
  socket.on('create_room', (data = {}) => {
    const { level = 'easy', n = 5, playerName, settings = {} } = data;
    const room = createRoom({ level, n, settings });
    // Add player as host
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

    // attach best time if exists
    const key = roomLevelKey(room.level, room.n);
    const existing = bestTimes[key] && bestTimes[key][playerId];
    if (existing) room.players[playerId].bestTime = existing;

    socket.emit('room_update', sanitizeRoom(room));
    broadcastRoomList();
  });

  // Join room
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

    // attach best time if exists
    const key = roomLevelKey(room.level, room.n);
    const existing = bestTimes[key] && bestTimes[key][playerId];
    if (existing) room.players[playerId].bestTime = existing;

    io.to(room.id).emit('room_update', sanitizeRoom(room));
    broadcastRoomList();
  });

  // Set ready
  socket.on('set_ready', (data = {}) => {
    const { roomId, playerId, ready } = data;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[playerId];
    if (!p) return;
    p.ready = !!ready;
    io.to(room.id).emit('room_update', sanitizeRoom(room));
  });

  // Start game (host only)
  socket.on('start_game', (data = {}) => {
    const { roomId } = data;
    const room = rooms[roomId];
    if (!room) return;
    // Only host may start
    const host = Object.values(room.players).find(x => x.isHost);
    if (!host || host.socketId !== socket.id) {
      return;
    }
    if (room.status === 'running') return;
    // initialize per-player state
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
    // Start authoritative countdown tick
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
        // game over: mark unfinished players as lost/finished with timeout
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

  // cell_selected: client sends selection attempt
  socket.on('cell_selected', (data = {}) => {
    const { roomId, playerId, cellNumber } = data;
    const room = rooms[roomId];
    if (!room || room.status !== 'running') return;
    const p = room.players[playerId];
    if (!p) return;
    // validate order
    if (!validateSelection(p, cellNumber)) {
      // invalid selection — ignore or optionally send feedback
      socket.emit('invalid_selection', { reason: 'wrong_order', expected: p.nextNumber, got: cellNumber });
      return;
    }
    // accept selection
    p.selectedNumbers.push(cellNumber);
    p.nextNumber += 1;
    // check finished
    const total = room.level === 'custom' ? room.n * room.n : levelToN(room.level);
    const isFinished = p.nextNumber > total;
    if (isFinished && !p.finished) {
      p.finished = true;
      p.finishTime = Date.now() - room.startTime; // ms
      // store best times
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
    // broadcast updated room state
    io.to(room.id).emit('game_state', {
      roomId: room.id,
      playersState: summarizePlayers(room),
      timeLeft: room.timeLeft
    });
  });

  // chat
  socket.on('send_chat', (data = {}) => {
    const { roomId, playerId, message } = data;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[playerId];
    if (!p) return;
    const payload = {
      playerId: playerId,
      name: p.name,
      message,
      ts: Date.now()
    };
    io.to(room.id).emit('chat_message', payload);
  });

  // disconnect handling: mark disconnect time and set kick timer
  socket.on('disconnect', () => {
    const sp = players[socket.id];
    if (!sp) return;
    const { roomId, playerId } = sp;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      const p = room.players[playerId];
      if (p) {
        p.disconnectedAt = Date.now();
        // start grace timer
        p.disconnectTimer = setTimeout(() => {
          // remove player
          delete room.players[playerId];
          io.to(room.id).emit('player_kicked', { playerId, reason: 'disconnected_timeout' });
          io.to(room.id).emit('room_update', sanitizeRoom(room));
          broadcastRoomList();
          // if room empty, clear timers and delete
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

  // Reconnect support: client can rejoin with same playerId by join_room (client side must handle)
  // For simplicity we assume new connection gets new playerId. Implementing true reconnect requires token mapping.

  // Utility responses
  function sanitizeRoom(room) {
    // return a light representation for clients
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

  function levelToN(level) {
    if (level === 'easy') return 5;
    if (level === 'medium') return 7;
    if (level === 'hard') return 10;
    return 10;
  }

  function finalizeRoomOnTimeout(room) {
    // mark unfinished players as finished with null/timeout
    for (const pid in room.players) {
      const p = room.players[pid];
      if (!p.finished) {
        p.finished = true;
        p.finishTime = null; // indicate timeout/fail
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
