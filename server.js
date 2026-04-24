// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);

// allow socket.io to work on any host/port and client served from same origin
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

const MAX_PLAYERS = 4;
const INACTIVITY_MS = 60_000; // 60s

const rooms = {}; // { roomId: { players: {sid: {...}}, level, owner } }

function genRoomId() { return shortid.generate().slice(0,6); }
function genName() { return 'P' + Math.floor(1000 + Math.random()*9000); }

io.on('connection', socket => {
  console.log('[conn]', socket.id);

  socket.on('create_room', (opts, cb) => {
    try {
      const roomId = genRoomId();
      const name = opts?.name || genName();
      const level = opts?.level || 'easy';
      rooms[roomId] = { players: {}, level, owner: socket.id };
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = name;
      rooms[roomId].players[socket.id] = { name, lastSeen: Date.now(), bestTime: null, gridSpec: null };
      console.log(`[room created] ${roomId} by ${socket.id}`);
      cb?.({ ok:true, roomId, name });
      io.to(roomId).emit('room_update', publicRoomState(roomId));
    } catch(e) {
      console.error(e);
      cb?.({ ok:false, error: 'server_error' });
    }
  });

  socket.on('join_room', ({roomId, name}, cb) => {
    try {
      if(!roomId || !rooms[roomId]) return cb?.({ ok:false, error:'Room not found' });
      const room = rooms[roomId];
      if(Object.keys(room.players).length >= MAX_PLAYERS) return cb?.({ ok:false, error:'Room full' });
      const uname = name || genName();
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = uname;
      room.players[socket.id] = { name: uname, lastSeen: Date.now(), bestTime: null, gridSpec: null };
      console.log(`[join] ${socket.id} -> ${roomId}`);
      cb?.({ ok:true, roomId, name: uname });
      io.to(roomId).emit('room_update', publicRoomState(roomId));
    } catch(e) {
      console.error(e);
      cb?.({ ok:false, error:'server_error' });
    }
  });

  socket.on('set_level', level => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if(room.owner !== socket.id) return;
    room.level = level;
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('chat', msg => {
    const roomId = socket.data.roomId;
    if(!roomId) return;
    const name = socket.data.name || 'Anonymous';
    io.to(roomId).emit('chat', { from:name, msg, ts: Date.now() });
  });

  socket.on('player_grid_ready', gridSpec => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    rooms[roomId].players[socket.id].gridSpec = gridSpec;
    rooms[roomId].players[socket.id].lastSeen = Date.now();
    io.to(roomId).emit('room_update', publicRoomState(roomId));
  });

  socket.on('player_progress', ({ current, time }) => {
    const roomId = socket.data.roomId;
    if(!roomId || !rooms[roomId]) return;
    const p = rooms[roomId].players[socket.id];
    if(!p) return;
    p.lastSeen = Date.now();
    if(current?.doneAtMs) {
      if(!p.bestTime || current.doneAtMs < p.bestTime) p.bestTime = current.doneAtMs;
    }
    io.to(roomId).emit('player_progress', { socketId: socket.id, name: p.name, current, bestTime: p.bestTime });
  });

  socket.on('keepalive', () => {
    const roomId = socket.data.roomId;
    if(roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].lastSeen = Date.now();
    }
  });

  socket.on('disconnect', reason => {
    const roomId = socket.data.roomId;
    console.log('[disc]', socket.id, reason);
    if(!roomId || !rooms[roomId]) return;
    delete rooms[roomId].players[socket.id];
    if(Object.keys(rooms[roomId].players).length === 0) {
      delete rooms[roomId];
      console.log('[room deleted]', roomId);
    } else {
      if(rooms[roomId].owner === socket.id) {
        rooms[roomId].owner = Object.keys(rooms[roomId].players)[0];
      }
      io.to(roomId).emit('room_update', publicRoomState(roomId));
    }
  });
});

// inactivity sweep
setInterval(() => {
  const now = Date.now();
  for(const [roomId, room] of Object.entries(rooms)) {
    for(const [sid, p] of Object.entries(room.players)) {
      if(now - p.lastSeen > INACTIVITY_MS) {
        const sock = io.sockets.sockets.get(sid);
        try { sock?.disconnect(true); } catch(e){/*ignore*/ }
        delete room.players[sid];
        console.log('[kick inactive]', sid, 'from', roomId);
      }
    }
    if(Object.keys(room.players).length === 0) {
      delete rooms[roomId];
      console.log('[room auto-deleted]', roomId);
    }
  }
}, 5000);

function publicRoomState(roomId) {
  const r = rooms[roomId];
  if(!r) return null;
  return {
    roomId,
    level: r.level,
    owner: r.owner,
    players: Object.entries(r.players).map(([sid,p]) => ({ socketId: sid, name: p.name, bestTime: p.bestTime, gridSpec: p.gridSpec }))
  };
}

server.listen(PORT, () => console.log('Server on', PORT));
