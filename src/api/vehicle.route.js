const express = require('express');
const router = express.Router();
const eventService = require('../services/event.service');
// dashboard 
const vehicleController = require('../controllers/vehicle.controller');

// vehicle connection 
router.post('/connect', async (req, res) => {
    try {
        const result = await eventService.registerVehicle(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.statusCode || 500).send(error.message);
    }
});

// quản lý xe đang chạy 
router.get('/dashboard', vehicleController.getFleetDashboard);


// trước khi làm websocket thì test tạm api này để gửi lệnh điều khiển xuống xe
router.post('/test-cmd', async (req, res) => {
    const { vehicle_id, type, value } = req.body;
    const mqttClient = require('../config/mqtt');
    const mqttService = require('../services/mqtt.service');
    
    await mqttService.sendCommand(mqttClient, vehicle_id, type, value);
    res.json({ success: true, message: "Lệnh đã được gửi" });
});
module.exports = router;