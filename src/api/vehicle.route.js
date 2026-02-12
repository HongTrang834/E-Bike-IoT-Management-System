const express = require('express');
const router = express.Router();
const eventService = require('../services/vehicle.service');
const authenticate = require('../middleware/auth');
const mqttService = require('../services/mqtt.service');
const mqttClient = require('../config/mqtt');
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

// Get vehicle state from Redis for simulation
router.get('/state/:vehicleId', async (req, res) => {
    try {
        const result = await eventService.getVehicleState(req.params.vehicleId);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// Send command to vehicle (for testing via Postman)
router.post('/command', authenticate, async (req, res) => {
    try {
        const { vehicle_id, type, data } = req.body;

        if (!vehicle_id || !type || data === undefined) {
            return res.status(400).send("Missing required fields: vehicle_id, type, data");
        }

        console.log(`[API] Command endpoint called: vehicle=${vehicle_id}, type=${type}, data=${data}`);

        await mqttService.sendCommand(mqttClient, vehicle_id, type, data);

        res.status(200).send('OK');
    } catch (error) {
        console.error(`[API] Command endpoint error:`, error.message);
        res.status(error.statusCode || 500).send(error.message);
    }
});
router.post('/test/command', async (req, res) => {
    try {
        const { vehicle_id, type, data } = req.body;

        if (!vehicle_id || !type || data === undefined) {
            return res.status(400).send("Missing required fields: vehicle_id, type, data");
        }

        console.log(`[API] TEST Command endpoint called: vehicle=${vehicle_id}, type=${type}, data=${data}`);

        // Send command via MQTT
        await mqttService.sendCommand(mqttClient, vehicle_id, type, data);

        res.status(200).send('OK');
    } catch (error) {
        console.error(`[API] TEST Command endpoint error:`, error.message);
        res.status(error.statusCode || 500).send(error.message);
    }
});

module.exports = router;