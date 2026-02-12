require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');

global.activeSockets = new Map();
const { initWebSocket, broadcastVehicleState } = require('./ws/ws.server');

const app = express();
app.use(express.json({ type: '*/*' }));
app.use(cors());

const server = http.createServer(app);

initWebSocket(server);

const vehicleRoutes = require('./api/vehicle.route');
const userRoutes = require('./api/user.route');
app.use('/api/user', userRoutes);
app.use('/api/vehicle', vehicleRoutes);

const { setBroadcastFunction } = require('./services/mqtt.service');
setBroadcastFunction(broadcastVehicleState);


const mqttClient = require('./config/mqtt');
const mqttService = require('./services/mqtt.service');
mqttClient.on('message', (topic, message) => {
    mqttService.handleMqttMessage(topic, message);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server & WebSocket running on port ${PORT}`);
});