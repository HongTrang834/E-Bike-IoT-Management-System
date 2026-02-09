require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');

global.activeSockets = new Map();
const initWebSocket = require('./ws/ws.server');

const app = express();
// Accept JSON bodies even when clients omit Content-Type.
app.use(express.json({ type: '*/*' }));
app.use(cors());

const server = http.createServer(app);

// KHỞI TẠO WEBSOCKET
initWebSocket(server);

// Routes
const vehicleRoutes = require('./api/vehicle.route');
const userRoutes = require('./api/user.route');
app.use('/api/user', userRoutes);
app.use('/api/vehicle', vehicleRoutes);

// MQTT setup 
const mqttClient = require('./config/mqtt');
const mqttService = require('./services/mqtt.service');
mqttClient.on('message', (topic, message) => {
    mqttService.handleMqttMessage(topic, message);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server & WebSocket running on port ${PORT}`);
});