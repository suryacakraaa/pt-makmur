const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb+srv://suryacakra00gt_db_user:lXVPMNYR4ebOiBeM@ptmakmur.xxym0ia.mongodb.net/?retryWrites=true&w=majority&appName=PTMAKMUR';

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const db = client.db('ptmakmur');
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

module.exports = async (req, res) => {
  // Polyfill status and json if running on vanilla Node.js http server
  if (!res.status) {
    res.status = function(code) {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.json) {
    res.json = function(data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  // Set CORS and Cache-Control headers (prevent mobile browser caching)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('state');

    if (req.method === 'GET') {
      const doc = await collection.findOne({ _id: 'shared_state' });
      if (!doc) {
        return res.status(200).json({ exists: false, state: null });
      }
      return res.status(200).json({ exists: true, state: doc.state, updatedAt: doc.updatedAt });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      const state = body?.state || body;
      if (!state) {
        return res.status(400).json({ error: 'Missing state body' });
      }
      const now = Date.now();
      await collection.replaceOne(
        { _id: 'shared_state' },
        { _id: 'shared_state', state, updatedAt: now },
        { upsert: true }
      );
      return res.status(200).json({ success: true, updatedAt: now });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('MongoDB API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
