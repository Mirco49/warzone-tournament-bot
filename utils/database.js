const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Crea la cartella se non esiste
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Su Render Free, usa la cartella data/tournament.db
const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'tournament.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Errore apertura database:', err.message);
  } else {
    console.log('Database connesso con successo!');
  }
});

// ==========================================
// INIZIALIZZA LE TABELLE (La parte mancante!)
// ==========================================
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    captain_discord_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    username TEXT,
    team_id INTEGER,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    guild_id TEXT,
    channel_id TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    tournament_id INTEGER,
    kills INTEGER DEFAULT 0,
    placement INTEGER DEFAULT 0,
    multiplier REAL DEFAULT 1.0,
    points REAL DEFAULT 0,
    screenshot_url TEXT,
    verified BOOLEAN DEFAULT 0,
    verified_by TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  )`);
});

// ==========================================
// ESPORTA LE FUNZIONI (La parte mancante!)
// ==========================================
module.exports = {
  addTeam: (name, captainId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO teams (name, captain_discord_id) VALUES (?, ?)', [name, captainId], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  },
  addPlayer: (discordId, username, teamId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT OR REPLACE INTO players (discord_id, username, team_id) VALUES (?, ?, ?)', 
         [discordId, username, teamId], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  },
  getTeamByName: (name) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM teams WHERE name = ?', [name], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getTeamByCaptain: (captainId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM teams WHERE captain_discord_id = ?', [captainId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getPlayerTeam: (discordId) => {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT t.* FROM teams t
        JOIN players p ON t.id = p.team_id
        WHERE p.discord_id = ?
      `, [discordId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  addMatch: (teamId, tournamentId, kills, placement, multiplier, points, screenshotUrl) => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO matches (team_id, tournament_id, kills, placement, multiplier, points, screenshot_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [teamId, tournamentId, kills, placement, multiplier, points, screenshotUrl], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  },
  verifyMatch: (matchId, adminId) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE matches SET verified = 1, verified_by = ? WHERE id = ?', [adminId, matchId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  deleteMatch: (matchId) => {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM matches WHERE id = ?', [matchId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  getLeaderboard: (tournamentId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          t.name as team_name,
          COUNT(m.id) as games_played,
          SUM(m.kills) as total_kills,
          SUM(m.points) as total_points,
          ROUND(AVG(m.placement), 1) as avg_placement,
          MIN(m.placement) as best_placement,
          MAX(m.kills) as best_kills
        FROM teams t
        LEFT JOIN matches m ON t.id = m.team_id
        WHERE m.tournament_id = ? AND m.verified = 1
        GROUP BY t.id
        ORDER BY total_points DESC, avg_placement ASC
      `, [tournamentId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  getPendingMatches: (tournamentId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT m.*, t.name as team_name
        FROM matches m
        JOIN teams t ON m.team_id = t.id
        WHERE m.tournament_id = ? AND m.verified = 0
        ORDER BY m.timestamp DESC
      `, [tournamentId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  getMatchById: (matchId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM matches WHERE id = ?', [matchId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getTournament: (guildId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM tournaments WHERE guild_id = ? AND status = "active"', [guildId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  createTournament: (name, guildId, channelId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO tournaments (name, guild_id, channel_id) VALUES (?, ?, ?)', 
         [name, guildId, channelId], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  },
  closeTournament: (tournamentId) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE tournaments SET status = "closed" WHERE id = ?', [tournamentId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
