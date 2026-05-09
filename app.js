require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('./models/User'); // Ensure models/User.js is updated too

const app = express();

// DATABASE CONNECTION
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
    .then(() => console.log('✅ MongoDB Connected (Manual Auth Mode)'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// VIEW ENGINE & MIDDLEWARE
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// SESSION CONFIG
app.use(session({
    secret: 'zumclo_secret_key',
    resave: false,
    saveUninitialized: false
}));

// PASSPORT CONFIG (The Manual Way)
app.use(passport.initialize());
app.use(passport.session());


passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await User.findOne({ username: username });
        if (!user) return done(null, false, { message: 'User not found' });
        
        // Plain text comparison (Simple & effective for private apps)
        if (user.password !== password) return done(null, false, { message: 'Invalid password' });
        
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Global User Variable for EJS
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    next();
});

// ROUTES
const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');

app.use('/', authRouter);
app.use('/', indexRouter);


app.use((req, res) => {
    res.status(404).render('error', {
        status: 404,
        title: "Lost in Space?",
        message: "The page you are looking for doesn't exist or has been moved."
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        status: 500,
        title: "System Glitch",
        message: "Something went wrong on our end. We're looking into it."
    });
});

// const PORT = process.env.PORT || 3001;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
module.exports = app;