const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public')); // For dashboard UI

// 1. MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB (pharmastack_sync)'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 2. Schemas & Models
const inventorySchema = new mongoose.Schema({
  pharmacyId: { type: String, required: true, index: true },
  lastSynced: { type: Date, default: Date.now },
  items: [{ sn: String, name: String, qty: Number, price: Number }],
});
const Inventory = mongoose.model('Inventory', inventorySchema);

const saleSchema = new mongoose.Schema({
  pharmacyId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now },
  items: [{ name: String, qty: Number, price: Number }],
  totalAmount: Number,
  source: String
});
const Sale = mongoose.model('Sale', saleSchema);

// 3. API Routes
app.post('/api/sync-inventory', async (req, res) => {
  try {
    const { pharmacyId, rows } = req.body;
    
    const parseNum = (val) => {
      if (typeof val === 'number') return val;
      if (!val) return 0;
      const cleaned = String(val).replace(/[^0-9.-]+/g, "");
      return parseFloat(cleaned) || 0;
    };
    
    // Normalize rows: if rows are arrays (like Strategy A), convert to objects, else they are already objects
    let normalizedItems = [];
    if (rows && rows.length > 0) {
      if (Array.isArray(rows[0])) {
         // It's an array of arrays, assume first is SN, second name, third qty, fourth price (from extension mapping)
         normalizedItems = rows.map(r => ({ sn: r[0] || '-', name: r[1] || '-', qty: parseNum(r[2]), price: parseNum(r[3]) }));
      } else {
         normalizedItems = rows.map(r => ({ sn: r.sn || r.id || '-', name: r.name, qty: parseNum(r.qty), price: parseNum(r.price) }));
      }
    }

    // Append a new inventory snapshot instead of overwriting
    const inventorySnapshot = new Inventory({
      pharmacyId,
      items: normalizedItems,
      lastSynced: new Date()
    });
    await inventorySnapshot.save();
    
    console.log(`📦 Synced ${normalizedItems.length} inventory items for ${pharmacyId}`);
    res.json({ success: true, message: 'Inventory synced' });
  } catch (error) {
    console.error('Error syncing inventory:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/record-sale', async (req, res) => {
  try {
    const { pharmacyId, items, source } = req.body;
    
    const parseNum = (val) => {
      if (typeof val === 'number') return val;
      if (!val) return 0;
      const cleaned = String(val).replace(/[^0-9.-]+/g, "");
      return parseFloat(cleaned) || 0;
    };
    
    const normalizedItems = items.map(r => ({ name: r.name, qty: parseNum(r.qty), price: parseNum(r.price) }));
    const totalAmount = normalizedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 1)), 0);

    const sale = new Sale({
      pharmacyId,
      items: normalizedItems,
      totalAmount,
      source
    });
    await sale.save();
    
    console.log(`💳 Recorded new sale for ${pharmacyId} ($${totalAmount})`);
    res.json({ success: true, message: 'Sale recorded', saleId: sale._id });
  } catch (error) {
    console.error('Error recording sale:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/dashboard-data', async (req, res) => {
  try {
    const inventory = await Inventory.find().sort('-lastSynced').limit(10);
    const sales = await Sale.find().sort('-timestamp').limit(50);
    res.json({ inventory, sales });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend API running on http://localhost:${PORT}`));
