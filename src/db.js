import fs from 'fs';
import path from 'path';

const DATABASE_PATH = path.join(process.cwd(), 'database.json');

export function loadDatabase() {
  if (!fs.existsSync(DATABASE_PATH)) {
    return { episodes: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  } catch (e) {
    console.error('⚠️ database.json was corrupted. Creating a new one.');
    return { episodes: [] };
  }
}

export function saveDatabase(db) {
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(db, null, 2), 'utf8');
}

export function updateEpisode(epNumber, updates) {
  const db = loadDatabase();
  const idx = db.episodes.findIndex(e => e.episodeNumber === epNumber);
  if (idx > -1) {
    db.episodes[idx] = { ...db.episodes[idx], ...updates, updatedAt: new Date().toISOString() };
  } else {
    db.episodes.push({ episodeNumber: epNumber, ...updates, createdAt: new Date().toISOString() });
  }
  saveDatabase(db);
}

// Function to print a status table in CLI
function printStatusTable() {
  const db = loadDatabase();
  if (db.episodes.length === 0) {
    console.log('📭 The pipeline is empty. Run: npm run generate');
    return;
  }

  console.log('\n========================================================================');
  console.log('                  🎬 SHORT-DRAMA AUTOMATION PIPELINE STATUS');
  console.log('========================================================================');
  console.log(
    'EP '.padEnd(5) + 
    '| STATUS'.padEnd(14) + 
    '| TITLE'.padEnd(30) + 
    '| SCHEDULED UPLOAD'.padEnd(21)
  );
  console.log('------------------------------------------------------------------------');

  db.episodes
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .forEach(ep => {
      let statusColor = ep.status;
      switch (ep.status) {
        case 'GENERATED':
          statusColor = '🟡 GENERATED';
          break;
        case 'ASSEMBLED':
          statusColor = '🟢 ASSEMBLED';
          break;
        case 'UPLOADED':
          statusColor = '🔵 UPLOADED';
          break;
        default:
          statusColor = `⚪ ${ep.status}`;
      }

      const epStr = `EP ${String(ep.episodeNumber).padStart(2, '0')}`;
      const statusStr = statusColor.padEnd(14);
      const titleStr = (ep.title.length > 27 ? ep.title.slice(0, 24) + '...' : ep.title).padEnd(28);
      const scheduleStr = ep.scheduledTime 
        ? new Date(ep.scheduledTime).toLocaleString() 
        : 'Not Scheduled';

      console.log(`${epStr} | ${statusStr} | ${titleStr} | ${scheduleStr}`);
    });
  console.log('========================================================================\n');
}

// Check if run directly
if (process.argv[1] && process.argv[1].endsWith('db.js')) {
  const args = process.argv.slice(2);
  if (args[0] === 'status') {
    printStatusTable();
  } else {
    console.log('Usage: node src/db.js status');
  }
}
