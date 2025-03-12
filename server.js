const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// File paths for persistent storage
const usersFile = path.join(__dirname, 'users.json');
const messagesFile = path.join(__dirname, 'messages.json');

// Helper functions for file storage
function loadFile(file, defaultValue) {
    if (!fs.existsSync(file)) return defaultValue;
    try {
        const data = fs.readFileSync(file);
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading file ${file}:`, error);
        return defaultValue; // Return default value if parsing fails
    }
}

function saveFile(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error writing to file ${file}:`, error);
    }
}

// Load users and messages from persistent storage
let users = loadFile(usersFile, {}); // { "username": "password" }
let messages = loadFile(messagesFile, []); // [{ username, message, timestamp }]
const connectedUsers = {}; // { socketId: username }

// Middleware to serve static files
app.use(express.static('public'));

// Route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send existing messages to the connected user
    socket.emit('load messages', messages);

    // Handle signup event
    socket.on('signup', ({ username, password }) => {
        if (!username || !password || username.trim().length > 20 || password.trim().length > 20) {
            socket.emit('signup failed', 'Invalid username or password format.');
            return;
        }

        if (users[username]) {
            socket.emit('signup failed', 'Username already exists.');
        } else {
            users[username] = password;
            saveFile(usersFile, users); // Persist users
            socket.emit('signup success', 'Account created successfully!');
            console.log(`User signed up: ${username}`);
        }
    });

    // Handle login event
    socket.on('login', ({ username, password }) => {
        console.log(`Login attempt: Username - ${username}, Password - ${password}`);
        console.log('Current users:', users); // Log available users
        console.log('Connected users:', connectedUsers); // Log currently connected users

        if (users[username] && users[username] === password) {
            connectedUsers[socket.id] = username;
            console.log(`${username} logged in successfully`);

            socket.emit('login success', { username });
            io.emit('user list', Object.values(connectedUsers)); // Update the online user list
        } else {
            console.log('Login failed for:', username);
            socket.emit('login failed', 'Invalid username or password.');
        }
    });

    // Handle public chat messages
    socket.on('chat message', ({ username, message }) => {
        const newMessage = { username, message, timestamp: new Date().toISOString() };
        messages.push(newMessage);
    
        const MAX_MESSAGES = 100;
        if (messages.length > MAX_MESSAGES) {
            messages.shift();
        }
    
        saveFile(messagesFile, messages);
        io.emit('chat message', newMessage);
    });    

    // Handle private messages
    socket.on('private message', ({ recipient, message }) => {
        const sender = connectedUsers[socket.id];
        const recipientSocketId = Object.keys(connectedUsers).find(id => connectedUsers[id] === recipient);

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', { sender, message });
            console.log(`Private message sent from ${sender} to ${recipient}: ${message}`);
        } else {
            socket.emit('private message failed', 'Recipient is not online.');
            console.log(`Failed to send private message from ${sender} to ${recipient}: Recipient not online.`);
        }
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { sdp: data.sdp, sender: socket.id });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { sdp: data.sdp, sender: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
        const username = connectedUsers[socket.id];
        if (username) {
            console.log(`${username} disconnected.`);
            delete connectedUsers[socket.id];
            io.emit('user list', Object.values(connectedUsers)); // Update the online user list
        } else {
            console.log(`A user with socket ID ${socket.id} disconnected, but no associated username was found.`);
        }
    });
});

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
});
