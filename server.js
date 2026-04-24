const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {}; // roomId -> {players: {socketId: name}, bestTimes: {socketId: ms}}
io.on('connection', (socket) => {
  socket.on('join-room', ({roomId, name}) => {
    socket.join(roomId);
    socket.data.name = name || 'Player';
    rooms[roomId] = rooms[roomId] || {players: {}, bestTimes: {}};
    rooms[roomId].players[socket.id] = socket.data.name;
    io.to(roomId).emit('room-update', {players: rooms[roomId].players});
  });

  socket.on('leave-room', ({roomId}) => {
    socket.leave(roomId);
    if (rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      delete rooms[roomId].bestTimes[socket.id];
      io.to(roomId).emit('room-update', {players: rooms[roomId].players});
    }
  });

  socket.on('chat', ({roomId, msg}) => {
    io.to(roomId).emit('chat', {from: socket.data.name || 'Player', msg});
  });

  socket.on('submit-time', ({roomId, ms}) => {
    rooms[roomId] = rooms[roomId] || {players: {}, bestTimes: {}};
    const prev = rooms[roomId].bestTimes[socket.id];
    if (!prev || ms < prev) rooms[roomId].bestTimes[socket.id] = ms;
    io.to(roomId).emit('best-times', {bestTimes: rooms[roomId].bestTimes, players: rooms[roomId].players});
  });

  socket.on('disconnecting', () => {
    const roomsLeft = Array.from(socket.rooms).filter(r => r !== socket.id);
    roomsLeft.forEach(roomId => {
      if (rooms[roomId]) {
        delete rooms[roomId].players[socket.id];
        delete rooms[roomId].bestTimes[socket.id];
        io.to(roomId).emit('room-update', {players: rooms[roomId].players});
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));
