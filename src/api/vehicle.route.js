const express = require('express');
const router = express.Router();
const eventService = require('../services/event.service');

router.post('/connect', async (req, res) => {
    try {
        const result = await eventService.registerVehicle(req.body);
        res.status(200).json(result);
    } catch (error) {
        res.status(error.statusCode || 500).send(error.message);
    }
});

module.exports = router;