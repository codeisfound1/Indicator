// server.js
// Express + Socket.IO server implementing lobby, rooms, realtime sync, server-authoritative timer.
// Simple in-memory store with optional JSON persistence for best times.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ShortUniqueId = require('short-unique-id');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uid = new ShortUniqueId({ length: 4 });

// Configurable defaults
const DEFAULTS = {
  cellSize: 60,
  fontCell: 25,
  fontTarget: 65,
  countdown: 600 // seconds
};

// Persistence file for best times (optional)
const BEST_TIMES_FILE = path.join(__dirname, 'best_times.json');
let bestTimes = {}; // {roomLevelKey: { playerName: bestSeconds, ... }, ...}
try {
  if (fs.existsSync(BEST_TIMES_FILE)) {
    bestTimes = JSON.parse(fs.readFileSync(BEST_TIMES_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Could not read best times file', e);
}

// In-memory rooms store
// rooms: { roomId: { id, name, hostId, settings, players: { socketId: playerObj }, state: { running, startTime, endTime, countdownLeft }, gridsSeeds, timers } }
const rooms = {};
const socketsToRooms = {}; // socketId -> roomId

// Utility: random short room/player names (2-3 syllables like "lumo", "bexa")
const syllables = ['la','mi','so','ra','be','tu','xi','na','zo','ke','pa','ri','vo','da','te'];
function genName(tokens = 2) {
  let s = [];
  for (let i = 0; i < tokens; i++) s.push(syllables[Math.floor(Math.random()*syllables.length)]);
  return s.join('');
}

// Utility: save bestTimes file
function persistBestTimes() {
  try {
    fs.writeFileSync(BEST_TIMES_FILE, JSON.stringify(bestTimes, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to persist best times', e);
  }
}

// Create grid seed (deterministic seed string)
function genGridSeed() {
  return UID();
}

// When server authoritative timer runs, use setInterval per room
function startRoomCountdown(room) {
  if (room.state.timer) clearInterval(room.state.timer);
  room.state.timeLeft = room.settings.countdown || DEFAULTS.countdown;
  room.state.startTime = Date.now();
  room.state.running = true;

  room.state.timer = setInterval(() => {
    room.state.timeLeft -= 1;
    // Broadcast game_state timeLeft for all players (server authoritative)
    io.to(room.id).emit('game_state', {
      timeLeft: room.state.timeLeft,
      players: Object.values(room.players).map(p => ({
        id: p.id,
        name: p.name,
        selected: p.selectedNumbers || []
      }))
    });

    if (room.state.timeLeft <= 0) {
      // time up: mark unfinished players as finished with null or large value
      clearInterval(room.state.timer);
      room.state.running = false;
      room.state.timer = null;
      room.state.endTime = Date.now();

      for (const pid in room.players) {
        const p = room.players[pid];
        if (!p.finished) {
          p.finished = true;
          p.finishTime = null;
          io.to(room.id).emit('player_finished', { playerId: p.id, finishTime: null });
        }
      }
      // broadcast final state
      io.to(room.id).emit('room_update', roomSummary(room));
    }
  }, 1000);
}

function stopRoomCountdown(room) {
  if (room.state.timer) {
    clearInterval(room.state.timer);
    room.state.timer = null;
  }
  room.state.running = false;
  room.state.timeLeft = null;
  room.state.endTime = Date.now();
}

// Room summary to send clients
function roomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    settings: room.settings,
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      ready: !!p.ready,
      finished: !!p.finished,
      bestTimes: p.bestTimes || {}
    })),
    state: {
      running: room.state.running,
      timeLeft: room.state.timeLeft || room.settings.countdown
    }
  };
}

// Create room
function createRoom(hostSocket, opts) {
  const id = uid();
  const name = genName(Math.random() > 0.5 ? 2 : 3);
  const settings = {
    level: opts.level || 'easy',
    n: opts.n || null,
    cellSize: (opts.settings && opts.settings.cellSize) || DEFAULTS.cellSize,
    fontCell: (opts.settings && opts.settings.fontCell) || DEFAULTS.fontCell,
    fontTarget: (opts.settings && opts.settings.fontTarget) || DEFAULTS.fontTarget,
    countdown: (opts.settings && opts.settings.countdown) || DEFAULTS.countdown
  };
  const room = {
    id, name, hostId: hostSocket.id, settings,
    players: {}, chat: [],
    state: { running: false, timeLeft: settings.countdown, timer: null },
    gridSeeds: {}, // playerId -> seed
  };
  rooms[id] = room;
  return room;
}

// Utility: build grid size from level
function levelToN(level, nOverride) {
  if (level === 'easy') return 5;
  if (level === 'medium') return 7;
  if (level === 'hard') return 10;
  if (level === 'extreme') return Math.max(10, parseInt(nOverride) || 10);
  // accept numeric level
  const num = parseInt(level);
  if (!isNaN(num) && num >= 2) return Math.max(2, num);
  return 5;
}

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // Provide lobby room list on connect
  socket.emit('room_list_update', Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    players: Object.keys(r.players).length,
    settings: r.settings
  })));

  // create_room
  socket.on('create_room', (payload, ack) => {
    const playerName = payload.playerName || genName(2);
    const room = createRoom(socket, payload);
    // add host player
    const player = {
      id: socket.id,
      name: playerName,
      socketId: socket.id,
      ready: false,
      selectedNumbers: [],
      finished: false,
      finishTime: null,
      bestTimes: {} // per level
    };
    room.players[socket.id] = player;
    room.gridSeeds[socket.id] = genGridSeed();
    socketsToRooms[socket.id] = room.id;
    socket.join(room.id);
    // send ack with room info
    socket.emit('room_update', roomSummary(room));
    // broadcast updated lobby list
    io.emit('room_list_update', Object.values(rooms).map(r => ({
      id: r.id, name: r.name, players: Object.keys(r.players).length, settings: r.settings
    })));
    if (ack) ack({ ok: true, roomId: room.id });
  });

  // join_room
  socket.on('join_room', (payload, ack) => {
    const roomId = payload.roomId;
    const room = rooms[roomId];
    if (!room) {
      if (ack) ack({ ok: false, error: 'Room not found' });
      return;
    }
    if (Object.keys(room.players).length >= 4) {
      if (ack) ack({ ok: false, error: 'Room full' });
      return;
    }
    const playerName = payload.playerName || genName(2);
    const player = {
      id: socket.id,
      name: playerName,
      socketId: socket.id,
      ready: false,
      selectedNumbers: [],
      finished: false,
      finishTime: null,
      bestTimes: {} // per level
    };
    room.players[socket.id] = player;
    room.gridSeeds[socket.id] = genGridSeed();
    socketsToRooms[socket.id] = room.id;
    socket.join(room.id);

    // send room update to all in room
    io.to(room.id).emit('room_update', roomSummary(room));
    io.emit('room_list_update', Object.values(rooms).map(r => ({
      id: r.id, name: r.name, players: Object.keys(r.players).length, settings: r.settings
    })));
    // ack with room and personal seed
    if (ack) ack({ ok: true, roomId: room.id, playerId: socket.id, seed: room.gridSeeds[socket.id] });
  });

  // set_ready
  socket.on('set_ready', (payload) => {
    const roomId = socketsToRooms[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    player.ready = !!payload.ready;
    io.to(room.id).emit('room_update', roomSummary(room));
  });

  // start_game (host-only)
  socket.on('start_game', (payload, ack) => {
    const roomId = payload.roomId || socketsToRooms[socket.id];
    const room = rooms[roomId];
    if (!room) { if (ack) ack({ ok: false }); return; }
    if (socket.id !== room.hostId) { if (ack) ack({ ok: false, error: 'Not host' }); return; }
    // assign seeds for players if absent
    for (const pid in room.players) {
      if (!room.gridSeeds[pid]) room.gridSeeds[pid] = genGridSeed();
      // reset player state
      room.players[pid].selectedNumbers = [];
      room.players[pid].finished = false;
      room.players[pid].finishTime = null;
    }
    // start countdown
    room.state.timeLeft = room.settings.countdown;
    room.state.running = true;
    room.state.startTime = Date.now();
    startRoomCountdown(room);

    // Broadcast game_start with seeds and levelSettings
    const levelN = levelToN(room.settings.level, room.settings.n);
    io.to(room.id).emit('game_start', {
      roomId: room.id,
      startTime: room.state.startTime,
      levelSettings: { level: room.settings.level, n: levelN },
      gridSeeds: room.gridSeeds
    });
    io.to(room.id).emit('room_update', roomSummary(room));
    if (ack) ack({ ok: true });
  });

  // cell_selected
  socket.on('cell_selected', (payload) => {
    const roomId = socketsToRooms[socket.id];
    const room = rooms[roomId];
    if (!room || !room.state.running) return;
    const player = room.players[socket.id];
    if (!player || player.finished) return;

    const cellNumber = payload.cellNumber;
    // validate that next expected number is correct: expected = player.selectedNumbers.length + 1
    const expected = (player.selectedNumbers.length || 0) + 1;
    const correct = (cellNumber === expected);
    if (correct) {
      player.selectedNumbers.push(cellNumber);
      // check if finished
      const levelN = levelToN(room.settings.level, room.settings.n);
      const total = levelN * levelN;
      if (player.selectedNumbers.length >= total) {
        // player finished
        player.finished = true;
        // compute finishTime in seconds relative to server start
        const finishTimeSeconds = Math.max(0, Math.round((Date.now() - room.state.startTime) / 1000));
        player.finishTime = finishTimeSeconds;
        // update bestTimes (keyed by level string)
        const levelKey = `${room.settings.level}:${room.settings.n || ''}`;
        bestTimes[levelKey] = bestTimes[levelKey] || {};
        const prevBest = bestTimes[levelKey][player.name];
        if (!prevBest || finishTimeSeconds < prevBest) {
          bestTimes[levelKey][player.name] = finishTimeSeconds;
          persistBestTimes();
          // notify room of best time update
          io.to(room.id).emit('best_time_update', { playerId: player.id, playerName: player.name, bestTime: finishTimeSeconds, levelKey });
        }
        io.to(room.id).emit('player_finished', { playerId: player.id, finishTime: finishTimeSeconds });
      }
      // Broadcast updated player selectedNumbers to room
      io.to(room.id).emit('game_state', {
        players: Object.values(room.players).map(p => ({ id: p.id, selected: p.selectedNumbers })),
        timeLeft: room.state.timeLeft
      });
    } else {
      // wrong selection: broadcast to player only (or to room as 'mistake' optionally)
      socket.emit('cell_wrong', { expected });
      io.to(room.id).emit('player_mistake', { playerId: player.id, at: cellNumber });
    }
  });

  // send_chat
  socket.on('send_chat', (payload) => {
    const roomId = socketsToRooms[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const msg = {
      playerId: player.id,
      playerName: player.name,
      text: payload.message,
      ts: Date.now()
    };
    room.chat.push(msg);
    io.to(room.id).emit('chat_message', msg);
  });

  // disconnect handling
  socket.on('disconnect', (reason) => {
    console.log('socket disconnect', socket.id, reason);
    const roomId = socketsToRooms[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    // remove player, broadcast
    const player = room.players[socket.id];
    delete room.players[socket.id];
    delete room.gridSeeds[socket.id];
    delete socketsToRooms[socket.id];

    io.to(room.id).emit('player_kicked', { playerId: socket.id, reason: 'disconnected' });
    io.to(room.id).emit('room_update', roomSummary(room));
    io.emit('room_list_update', Object.values(rooms).map(r => ({
      id: r.id, name: r.name, players: Object.keys(r.players).length, settings: r.settings
    })));

    // if room has no players, cleanup
    if (Object.keys(room.players).length === 0) {
      // clear timers
      if (room.state.timer) clearInterval(room.state.timer);
      delete rooms[roomId];
    } else {
      // if host left, reassign host
      if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
      }
    }
  });

  // quick helper to request room list
  socket.on('get_rooms', () => {
    socket.emit('room_list_update', Object.values(rooms).map(r => ({
      id: r.id, name: r.name, players: Object.keys(r.players).length, settings: r.settings
    })));
  });
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Grid Finder server running on http://localhost:${PORT}`);
});
