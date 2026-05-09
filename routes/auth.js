const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/User');

// Display Login/Signup Page
router.get('/auth', (req, res) => {
    res.render('auth');
});

// Handle Manual Registration
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Create new user object manually
        const newUser = new User({ 
            username: username, 
            email: email, 
            password: password // Storing as plain text per your request
        });

        await newUser.save();

        // Automatically log them in after signup
        req.login(newUser, (err) => {
            if (err) return res.redirect('/auth');
            res.redirect('/');
        });
    } catch (err) {
        console.error("Register Error:", err);
        res.redirect('/auth');
    }
});

// Handle Login
router.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/auth'
}));

// Handle Logout
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/auth');
    });
});

module.exports = router;