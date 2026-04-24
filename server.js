// server.js (ESM)
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory rooms store
const rooms = {};
const nano = customAlphabet('abcdefghijklmnopqrstuvwxyz', 4);

function makeRoomName() {
  const words = ['Zippy','Bongo','Quack','Mango','Fizz','Noodle','Pip','Jolt','Buzzy','Tofu'];
  return words[Math.floor(Math.random()*words.length)] + '-' + nano();
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name, level }) => {
    const roomId = makeRoomName();
    rooms[roomId] = {
      players: {},
      level,
      bestTimes: {},
      createdAt: Date.now()
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = { id: socket.id, name: name || 'Player', ready: false };
    socket.emit('roomCreated', { roomId, name: rooms[roomId].players[socket.id].name, level });
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('err', 'Room not found');
    if (Object.keys(room.players).length >= 4) return socket.emit('err', 'Room full');
    socket.join(roomId);
    room.players[socket.id] = { id: socket.id, name: name || 'Player', ready: false };
    socket.emit('joinedRoom', { roomId, name: room.players[socket.id].name, level: room.level });
    io.to(roomId).emit('roomUpdate', room);
  });

  socket.on('leaveRoom', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    delete room.players[socket.id];
    delete room.bestTimes[socket.id];
    socket.leave(roomId);
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
    else io.to(roomId).emit('roomUpdate', room);
  });

  socket.on('startGame', ({ roomId, gameState }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].level = gameState.level || rooms[roomId].level;
    io.to(roomId).emit('gameStarted', { gameState });
  });

  socket.on('complete', ({ roomId, timeSec }) => {
    if (!rooms[roomId]) return;
    const best = rooms[roomId].bestTimes[socket.id];
    if (!best || timeSec < best) rooms[roomId].bestTimes[socket.id] = timeSec;
    io.to(roomId).emit('playerComplete', { playerId: socket.id, name: rooms[roomId].players[socket.id].name, timeSec, best: rooms[roomId].bestTimes[socket.id] });
  });

  socket.on('statusUpdate', ({ roomId, status }) => {
    if (!rooms[roomId]) return;
    io.to(roomId).emit('peerStatus', { playerId: socket.id, status });
  });

  socket.on('disconnecting', () => {
    const srooms = Array.from(socket.rooms);
    srooms.forEach(r => {
      if (rooms[r]) {
        delete rooms[r].players[socket.id];
        delete rooms[r].bestTimes[socket.id];
        if (Object.keys(rooms[r].players).length === 0) delete rooms[r];
        else io.to(r).emit('roomUpdate', rooms[r]);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
