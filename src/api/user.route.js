const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');
const authenticate = require('../middleware/auth');
const { broadcastVehicleChanged } = require('../ws/ws.server');


// API Đăng ký
router.post('/sigup', async (req, res) => {
  try {
    const result = await userService.sigup(req.body);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Đăng nhập    
router.post('/login', async (req, res) => {
  try {
    const { user_name, password } = req.body;
    const result = await userService.login(user_name, password);

    // Set tokens in headers
    res.set({
      'access_token': result.access_token,
      'refresh_token': result.refresh_token,
      'expires_in': result.expires_in.toString()
    });

    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 401).send(error.message);
  }
});

// API THêm XE cho user
router.post('/add_vehicle', authenticate, async (req, res) => {
  try {
    const result = await userService.addVehicle(req.token, req.body);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Chọn XE hiện tại
router.get('/select', authenticate, async (req, res) => {
  try {
    const { vehicle_id, vehicel_id } = req.query; 
    const vehicleId = vehicle_id || vehicel_id;

    if (!vehicleId) {
      return res.status(400).send("vehicle_id is required");
    }

    await userService.selectVehicle(req.token, vehicleId);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Lấy thông tin của process hiện tại 
router.get('/info', authenticate, async (req, res) => {
  try {
    const result = await userService.getUserInfo(req.token);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Lấy lịch sử vị trí xe
router.get('/his_location', authenticate, async (req, res) => {
  try {
    const { start_time, stop_time } = req.query;

    if (!start_time || !stop_time) {
      return res.status(400).send("start_time and stop_time are required");
    }

    const result = await userService.getLocationHistory(req.token, start_time, stop_time);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Lấy lịch sử event xe
router.get('/his_event', authenticate, async (req, res) => {
  try {
    const { since } = req.query;

    if (!since) {
      return res.status(400).send("since is required");
    }

    const result = await userService.getEventHistory(req.token, since);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Lấy thông tin chi tiết xe
router.get('/vehi_info', authenticate, async (req, res) => {
  try {
    const result = await userService.getVehicleInfo(req.token);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Xóa xe khỏi danh sách user
router.delete('/delete_vehicle', authenticate, async (req, res) => {
  try {
    const { vehicle_id, vehicel_id } = req.query; // Accept both spellings
    const vehicleId = vehicle_id || vehicel_id;

    if (!vehicleId) {
      return res.status(400).send("vehicle_id is required");
    }

    const result = await userService.deleteVehicle(req.token, vehicleId);

    if (result && result.vehicleChanged) {
      const redisClient = require('../config/redis');
      const sessionKey = `user:token:${req.token}`;
      const sessionData = await redisClient.hGetAll(sessionKey);
      const email = sessionData.email;

      await broadcastVehicleChanged(email, result.nextVehicleId, result.vehicleName);
      console.log(`[API] Broadcasted vehicle change for ${email}: ${vehicleId} → ${result.nextVehicleId}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Quên mật khẩu
router.get('/forgot', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).send("email is required");
    }

    await userService.forgotPassword(email);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

// API Xác nhận verify code và đổi mật khẩu
router.post('/verify', async (req, res) => {
  try {
    const { email, password, verify_code } = req.body;

    if (!email || !password || !verify_code) {
      return res.status(400).send("Invalid JSON format!");
    }

    await userService.verifyCode(email, password, verify_code);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send("Missing or invalid token");
  }
});

// API Đổi mật khẩu (cho user đã đăng nhập)
router.post('/chg_password', authenticate, async (req, res) => {
  try {
    const { password } = req.body;

    // kiểm tra định dạng JSON
    if (!password) {
      return res.status(400).send("Invalid JSON format!");
    }
    await userService.changePassword(req.token, password);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send("Missing or invalid token");
  }
});

// API Đăng xuất
router.get('/logout', authenticate, async (req, res) => {
  try {
    await userService.logout(req.token);
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 401).send(error.message);
  }
});

// API Cập nhật cài đặt tài khoản
router.post('/setting', authenticate, async (req, res) => {
  try {
    const { phone_num, user_name, gender, region, setting } = req.body;

    if (
      phone_num === undefined || phone_num === null ||
      user_name === undefined || user_name === null ||
      gender === undefined || gender === null ||
      region === undefined || region === null ||
      setting === undefined || setting === null
    ) {
      return res.status(400).send("Invalid JSON format!");
    }

    await userService.updateAccountSetting(req.token, {
      phone_num,
      user_name,
      gender,
      region,
      setting
    });
    res.status(200).send('OK');
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message);
  }
});

module.exports = router;