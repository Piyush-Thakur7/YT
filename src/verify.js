import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadDatabase } from './db.js';

const EPISODES_DIR = path.join(process.cwd(), 'episodes');

// Helper to check command availability
function commandExists(cmd) {
  try {
    execSync(`${cmd} -version`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function runVerification() {
  console.log('🏁 Starting YouTube Short-Drama Automation Verification System...');
  
  // 1. Verify FFmpeg and FFprobe
  console.log('\n⚙️  Step 1: Checking FFmpeg dependencies...');
  const ffmpegOk = commandExists('ffmpeg');
  const ffprobeOk = commandExists('ffprobe');
  
  if (!ffmpegOk || !ffprobeOk) {
    console.error('❌ CRITICAL ERROR: ffmpeg or ffprobe was not found on your system path.');
    console.log('💡 Please install FFmpeg (including ffprobe) and ensure it is added to your environment variables.');
    process.exit(1);
  }
  console.log('✅ FFmpeg and FFprobe are correctly installed!');

  // 2. Generate Story Scripts (Dry Run Mode)
  console.log('\n📖 Step 2: Generating mock Story Bible & Scripts (Dry Run)...');
  try {
    execSync('npm run generate', { stdio: 'inherit' });
    console.log('✅ Generated scripts and veo_prompts sheets.');
  } catch (err) {
    console.error('❌ Story generation failed:', err.message);
    process.exit(1);
  }

  // 3. Create dummy scene clips for Episode 1 to simulate Google Flow downloads
  console.log('\n🎥 Step 3: Creating mock video clips for Episode 1 to test assembly...');
  const ep1Dir = path.join(EPISODES_DIR, 'ep01');
  if (!fs.existsSync(ep1Dir)) {
    console.error('❌ ep01 directory was not created!');
    process.exit(1);
  }

  // Generate 9 mock scene clips (each 8 seconds long, with varying colors to distinguish scenes)
  const colors = ['blue', 'red', 'green', 'purple', 'teal', 'orange', 'yellow', 'pink', 'gray'];
  for (let s = 1; s <= 9; s++) {
    const filename = `scene_${String(s).padStart(2, '0')}.mp4`;
    const scenePath = path.join(ep1Dir, filename);
    const color = colors[s - 1];
    
    console.log(`   - Generating dummy ${filename} (solid ${color})...`);
    // Create 8s video with dummy silent audio channel
    const ffmpegCmd = `ffmpeg -y -f lavfi -i color=c=${color}:s=1080x1920:d=8:r=30 -f lavfi -i anullsrc=cl=stereo:r=44100:d=8 -vf "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Scene ${s}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${scenePath}"`;
    
    try {
      execSync(ffmpegCmd, { stdio: 'ignore' });
    } catch (e) {
      // Fallback in case drawtext font fails
      const fallbackCmd = `ffmpeg -y -f lavfi -i color=c=${color}:s=1080x1920:d=8:r=30 -f lavfi -i anullsrc=cl=stereo:r=44100:d=8 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${scenePath}"`;
      execSync(fallbackCmd, { stdio: 'ignore' });
    }
  }
  console.log('✅ Generated 9 mock clips inside episodes/ep01/');

  // 4. Run Video Assembly
  console.log('\n🔨 Step 4: Testing FFmpeg video assembler on Episode 1...');
  try {
    execSync('node src/assembler.js 1', { stdio: 'inherit' });
    const finalVideo = path.join(ep1Dir, 'assembled.mp4');
    if (fs.existsSync(finalVideo)) {
      console.log(`✅ Assembly complete! Rendered file: ${finalVideo}`);
    } else {
      console.error('❌ Assembly failed. Final video file was not created.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Assembly command failed:', err.message);
    process.exit(1);
  }

  // 5. Test YouTube Uploader (Dry Run Mode)
  console.log('\n📤 Step 5: Testing YouTube Upload queue & scheduling (Dry Run)...');
  try {
    execSync('node src/uploader.js 1 --dry-run', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Upload dry-run failed:', err.message);
    process.exit(1);
  }

  // 6. View Pipeline Status
  console.log('\n📊 Step 6: Reviewing final pipeline status...');
  try {
    execSync('npm run status', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Status check failed:', err.message);
    process.exit(1);
  }

  console.log('✨ SYSTEM VERIFIED! The entire automation pipeline is fully functional and ready.');
}

runVerification();
