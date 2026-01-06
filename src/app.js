const express = require('express');
require('dotenv').config();


const vehicleRoutes = require('./api/vehicle.route');
const userRoutes = require('./api/user.route');


// tạo object app 
const app = express();

// đọc dữ liệu json 
app.use(express.json());

app.use('/api/user', userRoutes);
app.use('/api/vehicle', vehicleRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(` Server is running on port ${PORT}`);
});