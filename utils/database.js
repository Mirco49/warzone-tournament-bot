const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Crea la cartella se non esiste
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'tournament.db');

console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Errore apertura database:', err.message);
  } else {
    console.log('Database connesso con successo!');
  }
});
