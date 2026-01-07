const express = require('express');
require('dotenv').config();

const vehicleRoutes = require('./api/vehicle.route');
const userRoutes = require('./api/user.route');
const mqttClient = require('./config/mqtt');
const mqttService = require('./services/mqtt.service');

// tạo object app 
const app = express();

// đọc dữ liệu json 
app.use(express.json());

app.use('/api/user', userRoutes);
app.use('/api/vehicle', vehicleRoutes);

// for test only 
const simulator = require('./test/controller/simulator');
app.get('/test/simulate/control/:vehicleId', simulator.simulateUserControl);

mqttClient.on('message', (topic, message) => {
    mqttService.handleMqttMessage(topic, message);
}); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(` Server is running on port ${PORT}`);
});
