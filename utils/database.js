const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Su Render Free, usa la cartella corrente dell'app
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tournament.db');

console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Errore apertura database:', err.message);
  } else {
    console.log('Database connesso con successo!');
  }
});
