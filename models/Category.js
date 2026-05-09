const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    icon: { type: String, default: '📂' },
    // If this is null, it's a Parent category. 
    // If it has an ID, it's a Subcategory.
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Category', categorySchema);