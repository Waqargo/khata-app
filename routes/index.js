const mongoose = require('mongoose');
const User = require('../models/User'); // Add this line!
const express = require('express');
const axios = require('axios');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Fund = require('../models/Fund');
const Account = require('../models/Account');
const moment = require('moment');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const Category = require('../models/Category'); 
const PDFDocument = require('pdfkit');


// Middleware to check authentication
function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        if (req.user.isApproved) {
            return next(); // Fully authorized
        }
        // Logged in but not yet approved by you
        return res.render('pending'); 
    }
    res.redirect('/auth');
}
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.username === 'Bismillah') {
        return next();
    }
    res.status(403).render('error', { 
        status: 403,
        title: "Access Denied",
        message: "You need administrator privileges to manage partners." 
    });
}


// 1. View User Management Page
router.get('/manage-partners', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const users = await User.find({ username: { $ne: req.user.username } }); // Show everyone except you
        res.render('manage-partners', { users });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 2. Toggle Access (Grant/Remove)
router.post('/toggle-access/:id', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        user.isApproved = !user.isApproved; // Flip the status
        await user.save();
        res.redirect('/manage-partners');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post('/add-expense', async (req, res) => {
    const { amount, description, sourceAccount, category, recipient } = req.body;

    try {
        // 1. Create the transaction record
        const newTransaction = new Transaction({
            type: 'DEBIT',
            amount,
            description,
            sourceAccount, // e.g., 'Cash' or 'Bank'
            category,      // e.g., 'Study Abroad', 'Loan', 'General'
            recipient,     // Kisko diya (if applicable)
            date: Date.now()
        });

        await newTransaction.save();

        // 2. Logic: Subtract from your Source Account balance
        await Account.findOneAndUpdate(
            { name: sourceAccount },
            { $inc: { balance: -amount } }
        );

        res.status(200).json({ message: "Expense recorded and balance updated!" });
    } catch (err) {
        res.status(500).json({ error: "Transaction failed", details: err });
    }
});

router.get('/', (req, res) => {
    res.redirect('/dashboard'); // index.ejs render hoga
});

router.get('/dashboard', isLoggedIn, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const categories = await Category.find({ user: userId });

        const categoryStats = await Transaction.aggregate([
            { $match: { user: userId } },
            { $group: {
                _id: "$category",
                balance: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } }
            }}
        ]);

        let balances = {};
        categoryStats.forEach(s => { if (s._id) balances[s._id.toString()] = s.balance; });

        // Calculate Global Total (The "Bank" balance)
        const grandTotal = Object.values(balances).reduce((a, b) => a + b, 0);

        // Rollup for display
        let finalDisplayBalances = {};
        categories.forEach(cat => {
            const id = cat._id.toString();
            finalDisplayBalances[id] = (finalDisplayBalances[id] || 0) + (balances[id] || 0);
        });
        categories.forEach(cat => {
            if (cat.parent) {
                const parentId = cat.parent.toString();
                finalDisplayBalances[parentId] = (finalDisplayBalances[parentId] || 0) + (balances[cat._id.toString()] || 0);
            }
        });

        res.render('dashboard', { categories, categoryBalances: finalDisplayBalances, grandTotal });
    } catch (err) { res.status(500).send("Dashboard Error"); }
});

router.get('/add-category', isLoggedIn, async (req, res) => {
    try {
        // Fetch only categories that DON'T have a parent (these are the potential parents)
        const parentCategories = await Category.find({ 
            user: req.user.id, 
            parent: null 
        });
        res.render('add-category', { parentCategories });
    } catch (err) {
        res.status(500).send("Error loading page");
    }
});

router.post('/add-category', isLoggedIn, async (req, res) => {
    const { name, icon, parentId } = req.body;

    try {
        await Category.create({
            name,
            icon: icon || '📂',
            user: req.user.id,
            // If parentId is "none" or empty, save as null
            parent: parentId && parentId !== "none" ? parentId : null
        });
        res.redirect('/dashboard');
    } catch (err) {
        res.status(500).send("Error creating category");
    }
});

router.get('/transactions/:id', isLoggedIn, async (req, res) => {
    try {
        const categoryId = new mongoose.Types.ObjectId(req.params.id);
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const { startDate, endDate } = req.query;

        const category = await Category.findById(categoryId);
        if (!category) return res.status(404).send("Category not found");

        // 1. Fetch ALL categories for the edit modal dropdown (The missing part)
        const categories = await Category.find({ user: userId });

        // 2. Build the transaction query
        let query = { category: categoryId, user: userId };
        
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        // 3. Fetch transactions
        const transactions = await Transaction.find(query).sort({ date: -1 });

        // 4. Calculate Totals
        const allStats = await Transaction.aggregate([
            { $match: { user: userId } },
            { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }
        ]);
        const grandTotal = allStats.length > 0 ? allStats[0].total : 0;

        const catStats = await Transaction.aggregate([
            { $match: { category: categoryId, user: userId } },
            { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }
        ]);
        const categoryTotal = catStats.length > 0 ? catStats[0].total : 0;

        // 5. Render with 'categories' included
        res.render('transactions', { 
            category, 
            transactions, 
            categories, // This fixes the ReferenceError
            categoryTotal, 
            grandTotal,
            filters: { startDate, endDate } 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// POST: Handle Edit Transaction
router.post('/transactions/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const { amount, date, category, description, type } = req.body;
        const transactionId = req.params.id;

        // 1. Find the transaction and update it
        // We include 'category' here so it can be moved to a different group
        await Transaction.findByIdAndUpdate(transactionId, {
            amount: parseFloat(amount),
            date: new Date(date),
            category: category, 
            description: description,
            type: type
        });

        // 2. Redirect back to the page the user was on
        // Using 'back' is useful because it returns the user to the specific 
        // category history page they were viewing.
        res.redirect('back');

    } catch (err) {
        console.error("Transaction Update Error:", err);
        // If it fails, redirect to dashboard as a safety fallback
        res.redirect('/dashboard');
    }
});

router.post('/transactions/delete/:id', isLoggedIn, async (req, res) => {
    try {
        await Transaction.findOneAndDelete({ _id: req.params.id, user: req.user.id });
        res.redirect('back');
    } catch (err) { res.status(500).send("Delete Failed"); }
});

router.get('/add-transaction', isLoggedIn, async (req, res) => {
    try {
        const categories = await Category.find({ user: req.user.id }).lean();
        
        // Separate parents and children
        const parents = categories.filter(c => !c.parent);
        const children = categories.filter(c => c.parent);

        res.render('add-transaction', { parents, children });
    } catch (err) {
        res.status(500).send("Error loading transaction page");
    }
});

router.post('/add-transaction', isLoggedIn, async (req, res) => {
    const { amount, description, date, categoryId, type } = req.body;

    try {
        const newTransaction = new Transaction({
            // Force to uppercase here to satisfy the Enum check
            type: type.toUpperCase(), 
            amount: parseFloat(amount),
            description: description || "",
            date: date ? new Date(date) : Date.now(),
            category: new mongoose.Types.ObjectId(categoryId), 
            user: new mongoose.Types.ObjectId(req.user.id)
        });

        await newTransaction.save();
        res.redirect('/dashboard');

    } catch (err) {
        console.error("DATABASE ERROR:", err); 
        res.status(500).send("Transaction failed: " + err.message);
    }
});

router.get('/category/:id', isLoggedIn, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const parentId = new mongoose.Types.ObjectId(req.params.id);

        // Get All User Stats for the "Bank" total
        const allStats = await Transaction.aggregate([
            { $match: { user: userId } },
            { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }
        ]);
        const grandTotal = allStats.length > 0 ? allStats[0].total : 0;

        // Get Category Specific Rollup
        const parent = await Category.findById(parentId);
        const children = await Category.find({ parent: parentId, user: userId });
        const allCatIds = [parentId, ...children.map(c => c._id)];

        const catStats = await Transaction.aggregate([
            { $match: { category: { $in: allCatIds }, user: userId } },
            { $group: { _id: "$category", balance: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }
        ]);

        const balanceMap = {};
        catStats.forEach(s => { balanceMap[s._id.toString()] = s.balance; });
        const totalRollup = Object.values(balanceMap).reduce((a, b) => a + b, 0);

        res.render('category-detail', { parent, children, balanceMap, totalRollup, grandTotal });
    } catch (err) { res.status(500).send("Error"); }
});

router.get('/reports', isLoggedIn, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        
        const transactions = await Transaction.find({ user: userId })
            .populate('category')
            .sort({ date: -1 });

        const allStats = await Transaction.aggregate([
            { $match: { user: userId } },
            { $group: { 
                _id: null, 
                total: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } 
            }}
        ]);
        
        const grandTotal = allStats.length > 0 ? allStats[0].total : 0;

        res.render('reports', { 
            transactions, 
            grandTotal // This is what the EJS will now use
        });
    } catch (err) {
        res.status(500).send("Report Page Error");
    }
});
// Example of how your updated route should look
router.get('/transactions/:categoryId', isLoggedIn, async (req, res) => {
    try {
        const categoryId = req.params.categoryId;
        
        // 1. Fetch the specific category the user is viewing
        const currentCategory = await Category.findById(categoryId);
        
        // 2. Fetch the transactions for this category
        const transactions = await Transaction.find({ category: categoryId }).sort({ date: -1 });

        // 3. FETCH ALL CATEGORIES (This is the missing part causing the error)
        const categories = await Category.find({ user: req.user.id });

        // 4. Send EVERYTHING to the EJS template
        res.render('transactions', { 
            category: currentCategory, 
            transactions: transactions, 
            categories: categories, // MUST include this
            user: req.user 
        });

    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});
// 2. Generate and Download PDF
router.post('/reports/download', isLoggedIn, async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const query = { 
            user: userId,
            date: { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59') }
        };

        const transactions = await Transaction.find(query).populate('category').sort({ date: 1 });

        let totalCredit = 0;
        let totalDebit = 0;
        transactions.forEach(t => {
            if (t.type === 'CREDIT') totalCredit += t.amount;
            else totalDebit += t.amount;
        });

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let filename = `Statement_${startDate}_to_${endDate}.pdf`;

        res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // --- HEADER ---
        doc.fillColor('#093C5D').fontSize(24).font('Helvetica-Bold').text('SMART KHATA', 50, 50);
        doc.fillColor('#718096').fontSize(9).font('Helvetica').text('PERSONAL FINANCIAL STATEMENT', 50, 78);
        
        doc.fillColor('#2d3436').fontSize(11).font('Helvetica-Bold').text('TRANSACTION LEDGER', 350, 55, { align: 'right' });
        doc.fillColor('#718096').fontSize(9).font('Helvetica').text(`${startDate} to ${endDate}`, 350, 70, { align: 'right' });

        // Horizontal Line
        doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#edf2f7').lineWidth(1).stroke();

        // --- SUMMARY SECTION ---
        const summaryY = 130;
        // Inflow
        doc.rect(50, summaryY, 155, 55).fill('#f8fafc');
        doc.fillColor('#718096').fontSize(8).font('Helvetica-Bold').text('TOTAL INFLOW', 65, summaryY + 15);
        doc.fillColor('#2ed573').fontSize(13).text(`+ Rs. ${totalCredit.toLocaleString()}`, 65, summaryY + 30);

        // Outflow
        doc.rect(220, summaryY, 155, 55).fill('#f8fafc');
        doc.fillColor('#718096').fontSize(8).font('Helvetica-Bold').text('TOTAL OUTFLOW', 235, summaryY + 15);
        doc.fillColor('#ff4757').fontSize(13).text(`- Rs. ${totalDebit.toLocaleString()}`, 235, summaryY + 30);

        // Net Balance
        const net = totalCredit - totalDebit;
        doc.rect(390, summaryY, 155, 55).fill('#093C5D');
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold').text('NET POSITION', 405, summaryY + 15);
        doc.fontSize(13).text(`Rs. ${net.toLocaleString()}`, 405, summaryY + 30);

        // --- TABLE COLUMN SETTINGS ---
        let y = 220;
        const colDate = 60;
        const colCat = 140;
        const colDesc = 240;
        const colAmt = 450; // Right aligned

        // Table Header
        doc.fillColor('#f8fafc').rect(50, y, 495, 25).fill();
        doc.fillColor('#718096').fontSize(9).font('Helvetica-Bold');
        doc.text('DATE', colDate, y + 8);
        doc.text('CATEGORY', colCat, y + 8);
        doc.text('DESCRIPTION', colDesc, y + 8);
        doc.text('AMOUNT (PKR)', colAmt, y + 8, { align: 'right', width: 85 });

        y += 35;

        // --- DATA ROWS ---
        doc.font('Helvetica').fontSize(10);
        
        transactions.forEach((t, i) => {
            // Stripe rows
            if (i % 2 === 0) {
                doc.fillColor('#fcfcfc').rect(50, y - 8, 495, 24).fill();
            }

            // Row Data
            doc.fillColor('#2d3436').text(t.date.toLocaleDateString('en-GB'), colDate, y);
            doc.text(t.category ? t.category.name : 'General', colCat, y);
            doc.fillColor('#718096').fontSize(9).text(t.description || 'No description', colDesc, y, { width: 190, height: 12, ellipsis: true });
            
            // Amount Logic: Sign and Color
            const isDebit = t.type === 'DEBIT';
            const sign = isDebit ? '-' : '+';
            const amountColor = isDebit ? '#ff4757' : '#2ed573';
            
            doc.fillColor(amountColor).font('Helvetica-Bold').fontSize(10);
            doc.text(`${sign} ${t.amount.toLocaleString()}`, colAmt, y, { align: 'right', width: 85 });

            y += 24;

            // Page Management
            if (y > 750) {
                doc.addPage();
                y = 50;
                // Re-draw minimalist headers on new page
                doc.fillColor('#718096').fontSize(8).text('DATE', colDate, y);
                doc.text('AMOUNT', colAmt, y, { align: 'right', width: 85 });
                y += 20;
            }
        });

        // --- FOOTER ---
        doc.fontSize(8).fillColor('#a0aec0').text(
            'Generated by Smart Khata. This is a computer-generated document.',
            50, 785, { align: 'center', width: 500 }
        );

        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});
module.exports = router;
