const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const INACTIVITY_MS = 60_000; // kick if inactive 60s

// Rooms store: { roomId: { players: {socketId: {name, lastSeen, ready, bestTime, gridSpec}}, level, owner } }
const rooms = {};

function randomRoomName() {
  return shortid.generate().slice(0,6);
}
function randomPlayerName() {
  return 'P' + Math.floor(1000 + Math.random()*9000);
}

io.on('connection', socket => {
  socket.on('create_room', (opts, cb) => {
    const roomId = randomRoomName();
    const name = opts.name || randomPlayerName();
    const level = opts.level || 'easy';
    rooms[roomId] = { players: {}, level, owner: socket.id };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = { name, lastSeen: Date.now(), bestTime: null, gridSpec: null, active: true };
    socket.data.roomId = roomId;
    socket.data.name = name;
    cb({ ok: true, roomId, name });
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('join_room', ({roomId, name}, cb) => {
    if (!rooms[roomId]) return cb({ ok:false, error:'Room not found' });
    const room = rooms[roomId];
    if (Object.keys(room.players).length >= MAX_PLAYERS) return cb({ ok:false, error:'Room full' });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name || randomPlayerName();
    room.players[socket.id] = { name: socket.data.name, lastSeen: Date.now(), bestTime: null, gridSpec: null, active: true };
    cb({ ok:true, roomId, name: socket.data.name });
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('set_level', (level) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.owner !== socket.id) return;
    room.level = level;
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('chat', (msg) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit('chat', { from: socket.data.name, msg, ts: Date.now() });
  });

  socket.on('player_grid_ready', (gridSpec) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].players[socket.id].gridSpec = gridSpec;
    rooms[roomId].players[socket.id].lastSeen = Date.now();
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('player_progress', ({current, time}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const p = rooms[roomId].players[socket.id];
    p.lastSeen = Date.now();
    if (current && current.doneAtMs) {
      const elapsed = current.doneAtMs;
      if (!p.bestTime || elapsed < p.bestTime) p.bestTime = elapsed;
    }
    io.to(roomId).emit('player_progress', { socketId: socket.id, name: p.name, current, bestTime: p.bestTime });
  });

  socket.on('keepalive', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].lastSeen = Date.now();
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[socket.id];
    // if empty room, delete
    if (Object.keys(rooms[roomId].players).length === 0) {
      delete rooms[roomId];
    } else {
      // transfer owner if needed
      if (rooms[roomId].owner === socket.id) {
        rooms[roomId].owner = Object.keys(rooms[roomId].players)[0];
      }
      io.to(roomId).emit('room_update', publicRoomState(roomId));
    }
  });
});

// Periodic inactivity check
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    for (const [sid, p] of Object.entries(room.players)) {
      if (now - p.lastSeen > INACTIVITY_MS) {
        io.sockets.sockets.get(sid)?.disconnect(true);
        delete room.players[sid];
      }
    }
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
  }
}, 5000);

function publicRoomState(roomId) {
  const r = rooms[roomId];
  if (!r) return null;
  return {
    roomId,
    level: r.level,
    owner: r.owner,
    players: Object.entries(r.players).map(([sid, p]) => ({ socketId: sid, name: p.name, bestTime: p.bestTime, gridSpec: p.gridSpec }))
  };
}

server.listen(PORT, () => console.log('Server on', PORT));
