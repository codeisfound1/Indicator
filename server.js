const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ShortUniqueId = require('short-unique-id');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const uid = new ShortUniqueId({ length: 4 }); // short room/player ids

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const DEFAULT_COUNTDOWN = 600; // seconds

// In-memory store (for demo). For production, persist to DB.
const rooms = {}; // roomId -> {players: {socketId: {...}}, hostId, level, countdown, bestTimes: {playerName: time}, createdAt}

function makeRandomName(prefix) {
  return prefix + '-' + uid().toLowerCase();
}

io.on('connection', (socket) => {
  // create player with random short name
  socket.data.playerName = makeRandomName('P');

  // send initial lobby rooms list
  const getRoomSummaries = () => Object.keys(rooms).map(id => ({
    id,
    name: rooms[id].name,
    count: Object.keys(rooms[id].players).length,
    level: rooms[id].level
  }));
  socket.emit('lobbyRooms', getRoomSummaries());

  socket.on('createRoom', ({roomName, level, countdown}) => {
    const roomId = makeRandomName('R');
    const rName = roomName || roomId;
    rooms[roomId] = {
      id: roomId,
      name: rName,
      hostId: socket.id,
      level: level || 'easy',
      countdown: typeof countdown === 'number' ? countdown : DEFAULT_COUNTDOWN,
      players: {},
      bestTimes: {}, // playerName -> best time (seconds)
      createdAt: Date.now()
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = {
      name: socket.data.playerName,
      socketId: socket.id,
      ready: false,
      currentTime: null,
      lastSeen: Date.now(),
      levelOverride: null // allow player to pick separate level locally
    };
    io.emit('lobbyRooms', getRoomSummaries());
    io.to(roomId).emit('roomUpdate', getPublicRoom(rooms[roomId]));
  });

  socket.on('joinRoom', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorMessage', 'Room not found');
      return;
    }
    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      socket.emit('errorMessage', 'Room full');
      return;
    }
    socket.join(roomId);
    room.players[socket.id] = {
      name: socket.data.playerName,
      socketId: socket.id,
      ready: false,
      currentTime: null,
      lastSeen: Date.now(),
      levelOverride: null
    };
    io.emit('lobbyRooms', getRoomSummaries());
    io.to(roomId).emit('roomUpdate', getPublicRoom(room));
  });

  socket.on('setName', ({name}) => {
    if (!name) return;
    socket.data.playerName = name;
    // update in rooms
    Object.values(rooms).forEach(room => {
      if (room.players[socket.id]) room.players[socket.id].name = name;
    });
    broadcastRoomUpdates();
  });

  socket.on('leaveRoom', ({roomId}) => {
    leaveRoomCleanup(socket, roomId);
    io.emit('lobbyRooms', getRoomSummaries());
  });

  socket.on('sendChat', ({roomId, text}) => {
    const ts = Date.now();
    io.to(roomId).emit('chatMessage', {from: socket.data.playerName, text, ts});
  });

  socket.on('setLevel', ({roomId, level}) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id === room.hostId) {
      room.level = level;
      io.to(roomId).emit('roomUpdate', getPublicRoom(room));
    } else {
      // player local override (they can choose their own grid level)
      if (room.players[socket.id]) {
        room.players[socket.id].levelOverride = level;
        io.to(roomId).emit('roomUpdate', getPublicRoom(room));
      }
    }
  });

  socket.on('startGame', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return; // only host can start for room-wide? We'll broadcast start
    // send start signal with timestamp and per-player level
    const startAt = Date.now() + 1500; // small wait to sync clients
    const playersInfo = {};
    Object.values(room.players).forEach(p => {
      playersInfo[p.socketId] = {
        name: p.name,
        level: p.levelOverride || room.level,
      };
    });
    io.to(roomId).emit('gameStart', {startAt, countdown: room.countdown, playersInfo});
  });

  socket.on('playerFinished', ({roomId, timeTaken}) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    player.currentTime = timeTaken;
    // update best time
    const pname = player.name;
    if (!room.bestTimes[pname] || timeTaken < room.bestTimes[pname]) {
      room.bestTimes[pname] = timeTaken;
    }
    io.to(roomId).emit('roomUpdate', getPublicRoom(room));
  });

  socket.on('disconnect', () => {
    // mark last seen and remove from rooms
    Object.keys(rooms).forEach(roomId => {
      if (rooms[roomId].players[socket.id]) {
        // auto kick others? For now, remove immediately
        leaveRoomCleanup(socket, roomId, true);
      }
    });
    io.emit('lobbyRooms', getRoomSummaries());
  });

  function leaveRoomCleanup(socket, roomId, isDisconnect) {
    const room = rooms[roomId];
    if (!room) return;
    delete room.players[socket.id];
    socket.leave(roomId);
    // if host left, reassign host or close room
    if (room.hostId === socket.id) {
      const remaining = Object.keys(room.players);
      if (remaining.length > 0) {
        room.hostId = remaining[0];
      } else {
        delete rooms[roomId];
        return;
      }
    }
    io.to(roomId).emit('roomUpdate', getPublicRoom(room));
  }

  function getPublicRoom(room) {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      level: room.level,
      countdown: room.countdown,
      players: Object.values(room.players).map(p => ({
        socketId: p.socketId,
        name: p.name,
        currentTime: p.currentTime,
        levelOverride: p.levelOverride
      })),
      bestTimes: room.bestTimes
    };
  }

  function broadcastRoomUpdates() {
    Object.values(rooms).forEach(r => {
      io.to(r.id).emit('roomUpdate', getPublicRoom(r));
    });
  }
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));
