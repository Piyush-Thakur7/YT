import fs from 'fs';
import path from 'path';
import http from 'http';
import url from 'url';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { loadDatabase, saveDatabase, updateEpisode } from './db.js';

dotenv.config();

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

// Initialize OAuth2 client
function getOAuthClient() {
  const clientID = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectURI = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientID || !clientSecret || clientID.includes('your_client_id')) {
    throw new Error('❌ YouTube API credentials (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET) are missing in .env');
  }

  return new google.auth.OAuth2(clientID, clientSecret, redirectURI);
}

// Load token or perform interactive flow
async function getAuthenticatedClient() {
  const oauth2Client = getOAuthClient();
  
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);
    
    // Refresh token if expired
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        // Save updated tokens
        const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...currentToken, ...tokens }, null, 2));
      }
    });

    return oauth2Client;
  }

  console.log('🔑 No existing credentials found. Initializing YouTube OAuth2 flow...');
  return new Promise((resolve, reject) => {
    // Generate Auth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent' // Forces refresh_token delivery
    });

    // Spin up local server to handle callback
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/oauth2callback')) {
          const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
          const code = qs.get('code');
          
          res.end('Authentication successful! You can close this tab and return to the terminal.');
          server.close();

          console.log('⚡ Code received. Exchanging code for access tokens...');
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          
          // Save credentials
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
          console.log(`💾 Tokens saved to: ${TOKEN_PATH}`);
          resolve(oauth2Client);
        } else {
          res.end('Waiting for authorization...');
        }
      } catch (err) {
        res.end('Failed to exchange token. Check console.');
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('\n🔗 Visit this URL in your browser to authorize this application:');
      console.log('\x1b[36m%s\x1b[0m', authUrl);
      console.log('\n📡 Waiting for callback redirect on http://localhost:3000/oauth2callback ...\n');
    });
  });
}

// Calculate the next scheduling slot
function calculateScheduleSlot(db, config) {
  const episodes = db.episodes;
  const intervalDays = config.scheduleIntervalDays || 2;
  
  // Find all scheduled times
  const scheduledTimes = episodes
    .filter(ep => ep.scheduledTime)
    .map(ep => new Date(ep.scheduledTime).getTime());

  if (scheduledTimes.length === 0) {
    // If no uploads have been scheduled yet, schedule the first one for today at 9:00 AM (local time)
    const now = new Date();
    const firstSlot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    // If 9 AM has already passed today, set to tomorrow 9 AM
    if (firstSlot.getTime() < now.getTime()) {
      firstSlot.setDate(firstSlot.getDate() + 1);
    }
    return firstSlot.toISOString();
  }

  // Find the latest scheduled time
  const latestScheduled = Math.max(...scheduledTimes);
  const nextSlot = new Date(latestScheduled);
  nextSlot.setDate(nextSlot.getDate() + intervalDays);
  
  return nextSlot.toISOString();
}

// Perform upload of a specific episode
async function uploadEpisode(oauth2Client, epNum, dryRun = false) {
  const db = loadDatabase();
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  
  const ep = db.episodes.find(e => e.episodeNumber === epNum);
  if (!ep) {
    console.error(`❌ Episode ${epNum} not found in database. Run generation first.`);
    return false;
  }

  if (ep.status !== 'ASSEMBLED') {
    console.error(`❌ Episode ${epNum} is in status "${ep.status}". Needs to be "ASSEMBLED" to upload.`);
    console.log(`💡 Run: node src/assembler.js ${epNum} first.`);
    return false;
  }

  const videoPath = ep.assembledPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error(`❌ Assembled video file not found at ${videoPath}`);
    return false;
  }

  // 1. Calculate schedule date
  const publishTime = calculateScheduleSlot(db, config);
  console.log(`📅 Scheduling upload for: ${new Date(publishTime).toLocaleString()}`);

  // 2. Format YouTube details
  const seriesTitle = db.episodes[0] ? `"${db.episodes[0].title || 'Short Drama'}"` : 'Short Drama Series';
  const cleanSeriesTitle = seriesTitle.replace(/"/g, '');
  const title = `${cleanSeriesTitle} | Episode ${String(epNum).padStart(2, '0')} | Vertical Drama`;
  
  // High-retention Cliffhanger Description
  const description = `Episode ${epNum}: "${ep.title}"\n\n` +
    `Will Elena's quest for revenge succeed? Or will Alexander expose her secrets?\n` +
    `Cliffhanger: ${ep.cliffhanger}\n\n` +
    `👉 Subscribe for new episodes released every ${config.scheduleIntervalDays} days!\n` +
    `📢 Hit the bell icon to never miss a plot twist.\n\n` +
    `#shorts #drama #revenge #billionaire #reelshort #miniSeries #verticalDrama`;

  const tags = ['shorts', 'drama', 'mini series', 'revenge romance', 'billionaire', 'reelshort', 'love story', `episode ${epNum}`];

  if (dryRun) {
    console.log('\n🔮 [DRY RUN] Would upload with details:');
    console.log(`   - Title: ${title}`);
    console.log(`   - Publish Time: ${publishTime}`);
    console.log(`   - Video File: ${videoPath}`);
    console.log(`   - Description:\n---\n${description}\n---`);
    
    // Update local database status in dry-run
    updateEpisode(epNum, {
      status: 'UPLOADED',
      youtubeId: 'MOCK_YOUTUBE_ID_' + epNum,
      youtubeUrl: 'https://youtube.com/watch?v=MOCK_YOUTUBE_ID_' + epNum,
      scheduledTime: publishTime,
      uploadedAt: new Date().toISOString()
    });
    console.log(`✅ [DRY RUN] Episode ${epNum} marked as UPLOADED in database.`);
    return true;
  }

  console.log(`🚀 Uploading to YouTube... (this might take a few minutes depending on connection)`);
  
  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });

  const fileSize = fs.statSync(videoPath).size;

  try {
    const res = await youtube.videos.insert({
      part: 'id,snippet,status',
      notifySubscribers: false,
      requestBody: {
        snippet: {
          title: title.slice(0, 100), // YouTube titles max out at 100 chars
          description,
          tags,
          categoryId: '24' // Entertainment category
        },
        status: {
          privacyStatus: 'private', // Required for scheduled publishing
          publishAt: publishTime, // ISO 8601 schedule date
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    }, {
      // Use chunked transfer for large files, though short videos are tiny
      onUploadProgress: (evt) => {
        const progress = ((evt.bytesRead / fileSize) * 100).toFixed(2);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`Uploading: ${progress}%`);
      }
    });

    console.log('\n');
    const videoId = res.data.id;
    const videoUrl = `https://youtube.com/watch?v=${videoId}`;
    console.log(`✅ UPLOAD COMPLETE!`);
    console.log(`🔗 Video ID: ${videoId}`);
    console.log(`🔗 Watch Link: ${videoUrl}`);

    // Update database
    updateEpisode(epNum, {
      status: 'UPLOADED',
      youtubeId: videoId,
      youtubeUrl: videoUrl,
      scheduledTime: publishTime,
      uploadedAt: new Date().toISOString()
    });

    return true;
  } catch (err) {
    console.error('\n❌ YouTube Upload failed:', err.response?.data?.error || err.message);
    return false;
  }
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const epArg = args[0];
  const isDryRun = args.includes('--dry-run') || args.includes('-d');

  if (!epArg) {
    console.log('🤖 YouTube Short-Drama Uploader & Scheduler CLI');
    console.log('Usage: node src/uploader.js <episodeNumber|next|all> [--dry-run]');
    console.log('Example: node src/uploader.js next');
    process.exit(0);
  }

  try {
    let oauthClient = null;
    if (!isDryRun) {
      oauthClient = await getAuthenticatedClient();
    } else {
      console.log('🔮 Running in DRY RUN mode. Skipping OAuth token authentication.');
    }

    const db = loadDatabase();
    
    if (epArg.toLowerCase() === 'next') {
      // Find the first ASSEMBLED episode
      const nextEp = db.episodes
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .find(e => e.status === 'ASSEMBLED');

      if (!nextEp) {
        console.log('🤷 No assembled episodes found in queue. All episodes are uploaded or pending generation.');
        return;
      }
      
      console.log(`🚀 Next queued episode is Episode ${nextEp.episodeNumber}: "${nextEp.title}"`);
      await uploadEpisode(oauthClient, nextEp.episodeNumber, isDryRun);
    } else if (epArg.toLowerCase() === 'all') {
      const pendingEps = db.episodes
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .filter(e => e.status === 'ASSEMBLED');

      if (pendingEps.length === 0) {
        console.log('🤷 No assembled episodes to upload.');
        return;
      }

      console.log(`📦 Found ${pendingEps.length} assembled episodes to process.`);
      for (const ep of pendingEps) {
        console.log(`\n==================================================`);
        console.log(`📤 UPLOADING EPISODE ${ep.episodeNumber}`);
        console.log(`==================================================`);
        const success = await uploadEpisode(oauthClient, ep.episodeNumber, isDryRun);
        if (!success) {
          console.warn('⚠️ Stopping upload process due to upload failure.');
          break;
        }
      }
    } else {
      const epNum = parseInt(epArg, 10);
      if (isNaN(epNum)) {
        console.error('❌ Episode parameter must be a number, "next", or "all".');
        process.exit(1);
      }
      await uploadEpisode(oauthClient, epNum, isDryRun);
    }
  } catch (err) {
    console.error('❌ Execution error:', err.message);
  }
}

main();
