import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const DATABASE_PATH = path.join(process.cwd(), 'database.json');
const EPISODES_DIR = path.join(process.cwd(), 'episodes');

// Helper to format Windows paths for FFmpeg filters (e.g. escape colons and replace backslashes)
function formatFFmpegPath(p) {
  let formatted = p.replace(/\\/g, '/');
  if (formatted.match(/^[a-zA-Z]:/)) {
    formatted = formatted.replace(/^([a-zA-Z]):/, '$1\\:');
  }
  return formatted;
}

// Find appropriate system font
function getSystemFont() {
  const platform = os.platform();
  if (platform === 'win32') {
    // Common Windows font location
    const paths = [
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\segoeui.ttf',
      'C:\\Windows\\Fonts\\calibri.ttf'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return 'C:\\Windows\\Fonts\\arial.ttf';
  } else if (platform === 'darwin') {
    return '/Library/Fonts/Arial.ttf';
  } else {
    // Linux font paths
    const paths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  }
}

// Format seconds into SRT timestamp HH:MM:SS,mmm
function formatSRTTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const timeStr = date.toISOString().substring(11, 19);
  return `${timeStr},${ms}`;
}

// Get clip duration using ffprobe
function getClipDuration(filePath) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const output = execSync(cmd).toString().trim();
    return parseFloat(output);
  } catch (err) {
    console.error(`⚠️ Could not probe duration for ${path.basename(filePath)}. Defaulting to 8.0s.`);
    return 8.0;
  }
}

// Get video width, height, and frame rate
function getClipInfo(filePath) {
  try {
    const widthCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const heightCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const rFrameRateCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    
    const width = parseInt(execSync(widthCmd).toString().trim(), 10);
    const height = parseInt(execSync(heightCmd).toString().trim(), 10);
    const rFrameRate = execSync(rFrameRateCmd).toString().trim();
    
    return { width, height, rFrameRate };
  } catch (err) {
    console.warn(`⚠️ Probing info failed for ${path.basename(filePath)}. Using defaults (1080x1920, 30fps).`);
    return { width: 1080, height: 1920, rFrameRate: '30/1' };
  }
}

// Check if a clip has audio stream
function hasAudioStream(filePath) {
  try {
    const cmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const output = execSync(cmd).toString().trim();
    return output.length > 0;
  } catch (e) {
    return false;
  }
}

// Create intro/outro text bumpers
function createBumper(text, duration, outputPath, width, height, rFrameRate, fontPath) {
  const tempTextPath = path.join(path.dirname(outputPath), 'temp_bumper_text.txt');
  fs.writeFileSync(tempTextPath, text, 'utf8');
  
  const formattedFont = formatFFmpegPath(fontPath);
  const formattedTextPath = formatFFmpegPath(tempTextPath);
  
  // Create solid background with silent audio
  const cmd = `ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=${width}x${height}:d=${duration}:r=${rFrameRate} -f lavfi -i anullsrc=cl=stereo:r=44100:d=${duration} -vf "drawtext=fontfile='${formattedFont}':textfile='${formattedTextPath}':fontcolor=white:fontsize=48:line_spacing=20:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
  
  execSync(cmd, { stdio: 'ignore' });
  if (fs.existsSync(tempTextPath)) {
    fs.unlinkSync(tempTextPath);
  }
}

// Normalize a clip to target specs (video scale/pad, audio track addition/normalization)
function normalizeClip(inputPath, outputPath, width, height, rFrameRate) {
  const hasAudio = hasAudioStream(inputPath);
  
  // standard visual scale/pad to keep vertical layout
  const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  
  let cmd;
  if (hasAudio) {
    // Scale video and copy/encode audio
    cmd = `ffmpeg -y -i "${inputPath}" -vf "${videoFilter}" -c:v libx264 -r ${rFrameRate} -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 "${outputPath}"`;
  } else {
    // Scale video and add silent audio track
    cmd = `ffmpeg -y -i "${inputPath}" -f lavfi -i anullsrc=cl=stereo:r=44100 -vf "${videoFilter}" -c:v libx264 -r ${rFrameRate} -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -shortest "${outputPath}"`;
  }
  
  execSync(cmd, { stdio: 'ignore' });
}

// Assembles a specific episode
async function assembleEpisode(epNum) {
  const epFolder = path.join(EPISODES_DIR, `ep${String(epNum).padStart(2, '0')}`);
  const scriptPath = path.join(epFolder, 'script.json');
  
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ Episode ${epNum} script not found in ${scriptPath}. Run generation first.`);
    return false;
  }
  
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const scenesCount = script.scenes.length;
  
  console.log(`🔍 Checking scene clips for Episode ${epNum}...`);
  const sceneFiles = [];
  const missingScenes = [];
  
  for (let s = 1; s <= scenesCount; s++) {
    const sceneName = `scene_${String(s).padStart(2, '0')}.mp4`;
    const scenePath = path.join(epFolder, sceneName);
    if (!fs.existsSync(scenePath)) {
      missingScenes.push(sceneName);
    } else {
      sceneFiles.push(scenePath);
    }
  }
  
  if (missingScenes.length > 0) {
    console.error(`❌ Cannot assemble Episode ${epNum}. Missing scene files:`);
    missingScenes.forEach(m => console.log(`   - ${m}`));
    return false;
  }
  
  console.log(`⚡ Found all ${scenesCount} scene clips. Starting normalization & stitching...`);
  
  // Create a temporary workspace for ffmpeg processing
  const tempDir = path.join(epFolder, 'temp_build');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Target specifications from the first clip
  const targetSpecs = getClipInfo(sceneFiles[0]);
  const fontPath = getSystemFont();
  
  console.log(`📊 Video parameters resolved: ${targetSpecs.width}x${targetSpecs.height} @ ${targetSpecs.rFrameRate}`);
  console.log(`✍️  Selected System Font: ${fontPath}`);
  
  // 1. Create Bumper Files
  const introBumperPath = path.join(tempDir, 'intro.mp4');
  const outroBumperPath = path.join(tempDir, 'outro.mp4');
  
  const introText = `EPISODE ${epNum}\n\n${script.title}`;
  const outroText = `TO BE CONTINUED...\n\nSubscribe for Episode ${epNum + 1}!`;
  
  console.log(`🎬 Creating intro & outro bumpers...`);
  createBumper(introText, 3, introBumperPath, targetSpecs.width, targetSpecs.height, targetSpecs.rFrameRate, fontPath);
  createBumper(outroText, 3, outroBumperPath, targetSpecs.width, targetSpecs.height, targetSpecs.rFrameRate, fontPath);
  
  // 2. Normalize and copy scene files into temp
  console.log(`🔄 Normalizing scene clips to target specifications...`);
  const normalizedClips = [introBumperPath];
  
  for (let s = 0; s < sceneFiles.length; s++) {
    const scenePath = sceneFiles[s];
    const normalizedPath = path.join(tempDir, `norm_scene_${String(s + 1).padStart(2, '0')}.mp4`);
    normalizeClip(scenePath, normalizedPath, targetSpecs.width, targetSpecs.height, targetSpecs.rFrameRate);
    normalizedClips.push(normalizedPath);
  }
  normalizedClips.push(outroBumperPath);
  
  // 3. Measure actual clip durations and generate SRT Subtitles
  console.log(`📝 Syncing subtitle track with actual clip durations...`);
  let currentTime = 3.0; // Starts after 3s intro bumper
  let srtContent = '';
  
  for (let s = 0; s < sceneFiles.length; s++) {
    const scenePath = sceneFiles[s];
    const duration = getClipDuration(scenePath);
    const sceneScript = script.scenes[s];
    
    const startTimeStr = formatSRTTime(currentTime);
    const endTimeStr = formatSRTTime(currentTime + duration);
    
    // We clean up characters like quotes or special tags in dialogue
    const dialogue = sceneScript.dialogueOrVoiceover.trim();
    
    srtContent += `${s + 1}\n`;
    srtContent += `${startTimeStr} --> ${endTimeStr}\n`;
    srtContent += `${dialogue}\n\n`;
    
    currentTime += duration;
  }
  
  const srtPath = path.join(tempDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  console.log(`💾 Subtitle file written to: ${srtPath}`);
  
  // 4. Concatenate normalized videos
  console.log(`🔗 Concatenating normalized video files...`);
  const concatListPath = path.join(tempDir, 'concat_list.txt');
  const concatLines = normalizedClips.map(filePath => `file '${filePath.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListPath, concatLines, 'utf8');
  
  const mergedSilentPath = path.join(tempDir, 'merged_raw.mp4');
  const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${mergedSilentPath}"`;
  execSync(concatCmd, { stdio: 'ignore' });
  
  // 5. Final Subtitle Burn-In and Optional Background Music mix
  console.log(`🔥 Burning subtitles and rendering final episode video...`);
  const finalOutputPath = path.join(epFolder, 'assembled.mp4');
  
  // Read config to check for background music
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const bgMusic = config.bgMusicPath;
  const formattedSrtPath = formatFFmpegPath(srtPath);
  
  let finalCmd;
  if (bgMusic && fs.existsSync(bgMusic)) {
    console.log(`🎵 Overlaying background music from: ${bgMusic}`);
    finalCmd = `ffmpeg -y -i "${mergedSilentPath}" -i "${bgMusic}" -filter_complex "[0:a]volume=1.0[a0]; [1:a]volume=0.15[a1]; [a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]" -map 0:v -map "[a]" -vf "subtitles='${formattedSrtPath}':force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3'" -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 -shortest "${finalOutputPath}"`;
  } else {
    // Normal burn-in with subtitle styling
    finalCmd = `ffmpeg -y -i "${mergedSilentPath}" -vf "subtitles='${formattedSrtPath}':force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3'" -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 "${finalOutputPath}"`;
  }
  
  execSync(finalCmd, { stdio: 'ignore' });
  
  // 6. Clean up temporary files
  console.log(`🧹 Cleaning up temporary build workspace...`);
  try {
    fs.readdirSync(tempDir).forEach(file => {
      fs.unlinkSync(path.join(tempDir, file));
    });
    fs.rmdirSync(tempDir);
  } catch (e) {
    console.warn('⚠️ Could not remove temp directory:', e.message);
  }
  
  // 7. Update Database status
  const db = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  const epIdx = db.episodes.findIndex(e => e.episodeNumber === epNum);
  if (epIdx > -1) {
    db.episodes[epIdx].status = 'ASSEMBLED';
    db.episodes[epIdx].assembledPath = finalOutputPath;
    db.episodes[epIdx].durationSeconds = currentTime + 3.0; // adding 3s outro
    db.episodes[epIdx].assembledAt = new Date().toISOString();
  }
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(db, null, 2), 'utf8');
  
  console.log(`🎉 SUCCESS! Episode ${epNum} assembled successfully.`);
  console.log(`📂 Output file: ${finalOutputPath}`);
  return true;
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const epArg = args[0];
  
  if (!epArg) {
    console.log('🤖 YouTube Short-Drama Assembler CLI');
    console.log('Usage: node src/assembler.js <episodeNumber|all>');
    console.log('Example: node src/assembler.js 1');
    process.exit(0);
  }
  
  if (epArg.toLowerCase() === 'all') {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (let i = 1; i <= config.episodesCount; i++) {
      console.log(`\n==================================================`);
      console.log(`🔨 PROCESSING EPISODE ${i}`);
      console.log(`==================================================`);
      await assembleEpisode(i);
    }
  } else {
    const epNum = parseInt(epArg, 10);
    if (isNaN(epNum)) {
      console.error('❌ Episode number must be a valid integer.');
      process.exit(1);
    }
    await assembleEpisode(epNum);
  }
}

main();
