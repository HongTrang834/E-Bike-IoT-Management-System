const express = require('express');
const router = express.Router();
const eventService = require('../services/event.service');

router.post('/connect', async (req, res) => {
    try {
        const result = await eventService.registerVehicle(req.body);
        // Trả về code 200 nếu thành công
        res.status(200).json(result);
    } catch (error) {
        // Trả về code 400 và thông báo lỗi nếu thiếu dữ liệu
        res.status(error.statusCode || 500).send(error.message);
    }
});

module.exports = router;