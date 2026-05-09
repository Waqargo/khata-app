const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: [true, 'Transaction type is required'],
        enum: ['DEBIT', 'CREDIT'], // Mongoose is case-sensitive!
        uppercase: true // Automatically converts lowercase input to uppercase
    },
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [0, 'Amount cannot be negative']
    },
    description: {
        type: String,
        trim: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sourceAccount: {
        type: String,
        default: 'Cash'
    }
});

module.exports = mongoose.model('Transaction', transactionSchema);