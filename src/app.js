const express = require('express');
require('dotenv').config();
const vehicleRoutes = require('./api/vehicle.route');

const app = express();

// Middleware để đọc dữ liệu JSON từ request body
app.use(express.json());

// Sử dụng route với prefix /api/vehicle theo tài liệu
app.use('/api/vehicle', vehicleRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});