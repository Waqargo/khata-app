const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g., "Cash", "Personal Bank", "Business Fund"
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'PKR' }
});

module.exports = mongoose.model('Account', AccountSchema);