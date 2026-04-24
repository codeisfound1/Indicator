const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const rooms = {}; // roomId -> { players: {socketId: {name, gridState,...}}, level, createdBy }

function makeRoomName() {
  const adjectives = ['Cheeky','Merry','Silly','Zesty','Bouncy','Snappy'];
  const nouns = ['Panda','Gnome','Otter','Tofu','Pickle','Wombat'];
  return `${adjectives[Math.floor(Math.random()*adjectives.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}${Math.floor(Math.random()*90+10)}`;
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', ({playerName, level, options}) => {
    const roomId = shortid.generate();
    const roomName = makeRoomName();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      level: level || 'easy',
      players: {},
      maxPlayers: MAX_PLAYERS,
      createdAt: Date.now(),
      options: options || {}
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = createPlayerState(playerName || 'Player', socket.id);
    console.log('room created', roomId, Object.keys(rooms[roomId].players));
    io.in(roomId).emit('roomCreated', { roomId, roomName, room: cloneSafe(rooms[roomId]) });
    io.in(roomId).emit('roomUpdate', cloneSafe(rooms[roomId]));
  });

  socket.on('joinRoom', ({roomId, playerName}) => {
  console.log('joinRoom request', roomId, playerName);
  // try find by id first, then by name
  let room = rooms[roomId];
  if (!room) {
    room = Object.values(rooms).find(r=> r.name === roomId);
  }
  if (!room) { socket.emit('errorMsg', 'Room not found'); return; }
  if (Object.keys(room.players).length >= room.maxPlayers) { socket.emit('errorMsg', 'Room full'); return; }
  socket.join(room.id);
  room.players[socket.id] = createPlayerState(playerName || 'Player', socket.id);
  io.in(room.id).emit('roomUpdate', room);
});

  socket.on('startGame', ({roomId, level, options}) => {
    const room = rooms[roomId];
    if (!room) return;
    room.level = level || room.level;
    room.options = options || room.options;
    // initialize each player's grid spec and shuffle numbers
    for (const sid of Object.keys(room.players)) {
      const spec = gridSpecForLevel(room.level, room.options.customN);
      room.players[sid].spec = spec;
      room.players[sid].numbers = shuffleArray(Array.from({length: spec.count}, (_,i)=>i+1));
      room.players[sid].next = 1;
      room.players[sid].timeStart = Date.now();
      room.players[sid].elapsed = 0;
      room.players[sid].finishedAt = null;
      room.players[sid].bestTime = room.players[sid].bestTime || null;
    }
    console.log('starting game for room', roomId, Object.keys(room.players).length);
    io.in(roomId).emit('gameStarted', cloneSafe(room));
    io.in(roomId).emit('roomUpdate', cloneSafe(room));
  });

  socket.on('cellSelected', ({roomId, value}) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    if (value === player.next) {
      player.next++;
      if (player.next > player.spec.count) {
        player.finishedAt = Date.now();
        player.elapsed = Math.round((player.finishedAt - player.timeStart)/1000);
        if (!player.bestTime || player.elapsed < player.bestTime) player.bestTime = player.elapsed;
      }
      io.in(roomId).emit('playerUpdate', { socketId: socket.id, player: cloneSafe(player) });
      io.in(roomId).emit('roomUpdate', cloneSafe(room));
    } else {
      // optional: feedback
      io.to(socket.id).emit('wrongSelection', { expected: player.next, got: value });
    }
  });

  socket.on('leaveRoom', ({roomId}) => {
    leaveRoom(socket, roomId);
  });

  socket.on('disconnect', () => {
    console.log('socket disconnect', socket.id);
    // remove from any room
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
  console.log('player left', socket.id, 'room', roomId);
  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
    console.log('room deleted', roomId);
  } else {
    io.in(roomId).emit('roomUpdate', cloneSafe(room));
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
  if (level === 'easy') return {n:5, count:25, sizePx:60, fontSize:25};
  if (level === 'medium') return {n:7, count:49, sizePx:60, fontSize:25};
  if (level === 'hard') return {n:10, count:100, sizePx:60, fontSize:25};
  const n = Math.max(10, parseInt(customN) || 10);
  return {n, count: n*n, sizePx:60, fontSize:25};
}

function shuffleArray(arr) {
  for (let i = arr.length -1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function cloneSafe(obj){
  return JSON.parse(JSON.stringify(obj));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Server running on ${PORT}`));
