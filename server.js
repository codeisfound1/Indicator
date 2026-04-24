const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const rooms = {}; // roomId -> { id, name, level, players: {sid: playerState}, options, maxPlayers }

function makeRoomName() {
  const adjectives = ['Cheeky','Merry','Silly','Zesty','Bouncy','Snappy'];
  const nouns = ['Panda','Gnome','Otter','Tofu','Pickle','Wombat'];
  return `${adjectives[Math.floor(Math.random()*adjectives.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}${Math.floor(Math.random()*90+10)}`;
}

io.on('connection', socket => {
  console.log('connect', socket.id);

  socket.on('createRoom', ({ playerName, level, options }) => {
    const roomId = shortid.generate();
    const roomName = makeRoomName();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      level: level || 'easy',
      players: {},
      options: options || {},
      maxPlayers: MAX_PLAYERS,
      createdAt: Date.now()
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = createPlayerState(playerName || 'Player', socket.id);
    console.log('room created', roomId);
    // Emit full room to everyone in room (creator only right now)
    io.in(roomId).emit('roomCreated', clone(rooms[roomId]));
    io.in(roomId).emit('roomUpdate', clone(rooms[roomId]));
  });

  socket.on('listRooms', () => {
    // safe list for UI
    const list = Object.values(rooms).map(r => ({ id: r.id, name: r.name, level: r.level, players: Object.keys(r.players).length }));
    socket.emit('roomsList', list);
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    console.log('joinRoom', roomId, playerName, socket.id);
    const room = rooms[roomId];
    if (!room) { socket.emit('errorMsg', 'Room not found'); return; }
    if (Object.keys(room.players).length >= room.maxPlayers) { socket.emit('errorMsg', 'Room full'); return; }
    socket.join(roomId);
    room.players[socket.id] = createPlayerState(playerName || 'Player', socket.id);
    // broadcast updated room to everyone in room
    io.in(roomId).emit('roomUpdate', clone(room));
    // also notify joiner with roomCreated-like payload for immediate UI
    io.to(socket.id).emit('joinedRoom', clone(room));
  });

  socket.on('startGame', ({ roomId, level, options }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.level = level || room.level;
    room.options = options || room.options;
    // initialize each player's grid spec and shuffle numbers
    for (const sid of Object.keys(room.players)) {
      const spec = gridSpecForLevel(room.level, room.options.customN);
      room.players[sid].spec = spec;
      room.players[sid].numbers = shuffleArray(Array.from({ length: spec.count }, (_, i) => i + 1));
      room.players[sid].next = 1;
      room.players[sid].timeStart = Date.now();
      room.players[sid].elapsed = 0;
      room.players[sid].finishedAt = null;
      room.players[sid].bestTime = room.players[sid].bestTime || null;
    }
    console.log('game started', roomId);
    io.in(roomId).emit('gameStarted', clone(room));
    io.in(roomId).emit('roomUpdate', clone(room));
  });

  socket.on('cellSelected', ({ roomId, value }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    // only accept valid number clicks
    if (value === player.next) {
      player.next++;
      if (player.next > player.spec.count) {
        player.finishedAt = Date.now();
        player.elapsed = Math.round((player.finishedAt - player.timeStart) / 1000);
        if (!player.bestTime || player.elapsed < player.bestTime) player.bestTime = player.elapsed;
      }
      // broadcast specific player update and full room update
      io.in(roomId).emit('playerUpdate', { socketId: socket.id, player: clone(player) });
      io.in(roomId).emit('roomUpdate', clone(room));
    } else {
      io.to(socket.id).emit('wrongSelection', { expected: player.next, got: value });
    }
  });

  socket.on('sendChat', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    const msg = { from: player ? player.name : 'Unknown', text: String(text).slice(0, 500), time: Date.now() };
    io.in(roomId).emit('chatMessage', msg);
  });

  socket.on('leaveRoom', ({ roomId }) => {
    leaveRoom(socket, roomId);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    for (const roomId of Object.keys(rooms)) {
      if (rooms[roomId].players[socket.id]) {
        leaveRoom(socket, roomId);
      }
    }
  });
});

function leaveRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;
  delete room.players[socket.id];
  socket.leave(roomId);
  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
    console.log('room deleted', roomId);
  } else {
    io.in(roomId).emit('roomUpdate', clone(room));
  }
}

function createPlayerState(name, socketId) {
  return {
    id: socketId,
    name: name,
    spec: null,
    numbers: [],
    next: 1,
    timeStart: null,
    elapsed: 0,
    finishedAt: null,
    bestTime: null
  };
}

function gridSpecForLevel(level, customN) {
  if (level === 'easy') return { n: 5, count: 25, sizePx: 60, fontSize: 25 };
  if (level === 'medium') return { n: 7, count: 49, sizePx: 60, fontSize: 25 };
  if (level === 'hard') return { n: 10, count: 100, sizePx: 60, fontSize: 25 };
  const n = Math.max(10, parseInt(customN) || 10);
  return { n, count: n * n, sizePx: 60, fontSize: 25 };
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on', PORT));
