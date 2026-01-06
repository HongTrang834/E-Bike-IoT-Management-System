const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

// API Đăng ký
router.post('/signup', async (req, res) => {
  try {
    const result = await userService.signup(req.body);
    res.status(200).json({ message: "OK", data: result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

// API Đăng nhập    
router.post('/login', async (req, res) => {
  try {
    const { user_name, password } = req.body; 
    const result = await userService.login(user_name, password);

    res.status(200).json(result); 
  } catch (error) {
    res.status(error.statusCode || 401).send(error.message);
  }
});
module.exports = router;