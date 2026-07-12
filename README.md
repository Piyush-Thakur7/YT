# YouTube Short-Drama Channel Automation System

A fully automated Node.js suite for generating vertical multi-episode drama scripts, organizing manually rendered Veo (Google Flow) clips, assembling video edits with burned subtitles/intro/outro cards via FFmpeg, scheduling, and auto-uploading to YouTube.

## 📁 Folder Structure

```
youtube-short-drama-automation/
├── config.json          # Main channel configuration (genre, language, interval, etc.)
├── .env                 # API Keys and credentials (GEMINI_API_KEY, YOUTUBE_CLIENT_ID, etc.)
├── package.json         # Node.js project manifests & commands
├── database.json        # Persistent local state tracking
├── README.md
├── src/
│   ├── generator.js     # Script to generate story, scenes, and prompts using Gemini API
│   ├── assembler.js     # Script to stitch clips, auto-generate SRT, and burn subtitles with FFmpeg
│   ├── uploader.js      # YouTube Data API upload coordinator & OAuth authorization flow
│   ├── db.js            # Pipeline state tracker & status reporter
│   └── verify.js        # Dry-run integration test runner
└── episodes/            # Contains all episode material
    ├── story_bible.json # Complete narrative arc & character guides
    └── ep01/
        ├── script.json  # Episode script and Veo prompts
        ├── veo_prompts.txt # Copy-paste text list of video generation prompts
        ├── scene_01.mp4 # Manually generated video clips from Google Flow
        ├── ...
        └── assembled.mp4 # Compiled vertical video file with subtitles
```

---

## 🛠️ Prerequisites

1. **Node.js**: Install Node.js (version 18 or above).
2. **FFmpeg & FFprobe**: Ensure that `ffmpeg` and `ffprobe` are installed and available on your system path.
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/), extract, and add the `/bin` directory to system Environment Variables.
   - **Verify installation**: Run `ffmpeg -version` in your terminal.

---

## 🚀 Quick Start / Verification

You can test the entire pipeline (mock script writing, dummy video rendering, assembly, subtitle overlays, database logging, and mock uploads) without configuring any APIs. 

Run the automated test suite:
```bash
npm run verify
```
This script will verify your FFmpeg installation, generate mock scripts, build dummy vertical scene videos, assemble them, and run a dry-run scheduled upload.

---

## 📖 Operational Pipeline

### 1. Project Configuration
Configure your channel settings in `config.json`:
```json
{
  "genre": "billionaire secret identity",
  "language": "English dialogue, dramatic short-drama style",
  "episodesCount": 10,
  "sceneDurationSeconds": 8,
  "scheduleIntervalDays": 2,
  "bgMusicPath": ""
}
```
*Tip: Set `bgMusicPath` to an audio file (e.g. an MP3 track) if you want to overlay background theme music onto all episodes.*

---

### 2. Story & Scene Generator (Step 1)
Create a `.env` file in the root directory based on `.env.example` and set your `GEMINI_API_KEY`:
```env
GEMINI_API_KEY=AIzaSy...
```

Execute the story generator:
```bash
npm run generate
```
This script uses the Gemini API (free tier `gemini-2.5-flash`) to generate a complete multi-episode story bible with visual character descriptions (for character consistency) and breaks down each episode into 8-second scenes.

Outputs will be saved under:
- `episodes/story_bible.json`
- `episodes/ep{XX}/script.json` (Structured JSON script)
- `episodes/ep{XX}/veo_prompts.txt` (Copy-paste friendly prompts list)

---

### 3. Google Flow Generation & Bridge (Step 2)
1. Open the generated `veo_prompts.txt` for the target episode (e.g., `/episodes/ep01/veo_prompts.txt`).
2. Copy the prompt for `Scene 1`.
3. Paste the prompt into **Google Flow** (Veo) and generate the clip.
4. Download the resulting video clip.
5. Save it inside the corresponding episode folder as `scene_01.mp4`.
6. Repeat this for all scenes (usually 9 scenes for a 72-second episode). The folder structure must look like this:
   - `episodes/ep01/scene_01.mp4`
   - `episodes/ep01/scene_02.mp4`
   - ...

To see which clips have been downloaded and which are still missing, run:
```bash
npm run status
```

---

### 4. Video Assembly (Step 3)
Once all scene clips for an episode are downloaded, run the compiler:
```bash
# Assemble a single episode
node src/assembler.js 1

# Assemble all ready episodes
node src/assembler.js all
```
**What this script does:**
1. Verifies that all scene files (`scene_01.mp4` to `scene_09.mp4`) are present.
2. Measures the actual duration of each clip using `ffprobe` to ensure millisecond-level subtitle sync.
3. Generates styled SubRip (`.srt`) subtitles containing the dialogues/narration.
4. Generates standard 3-second vertical intro bumpers ("Episode X: [Title]") and outro bumpers ("Subscribe for Episode X+1!") with modern styling.
5. Normalizes video resolutions (pillarboxing/letterboxing as needed), frame rates, and adds/normalizes audio channels.
6. Concatenates the bumpers and scene files.
7. Burns subtitles directly onto the video.
8. Saves the finished video as `episodes/ep{XX}/assembled.mp4` and updates `database.json`.

---

### 5. Scheduling & YouTube Upload (Step 4)
First, fill in your YouTube client credentials in `.env`:
```env
YOUTUBE_CLIENT_ID=your_id_here.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your_secret_here
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

To schedule and upload the next ready episode:
```bash
# Upload a specific episode
node src/uploader.js 1

# Upload the next ready episode in the queue
node src/uploader.js next

# Upload all ready episodes in the queue
node src/uploader.js all

# Perform a dry-run test (simulates upload, logs schedule date, doesn't consume API limit)
node src/uploader.js next --dry-run
```

**Key Upload Features:**
- **Automated Scheduling**: Automatically calculates sequential schedule dates (e.g. Episode 1 today, Episode 2 in 2 days, Episode 3 in 4 days) based on the `scheduleIntervalDays` config setting.
- **Private-Scheduled Method**: Uploads videos as `private` and specifies the scheduled release date using YouTube's `publishAt` parameter. Once uploaded, YouTube publishes the videos automatically—no need to run local background scripts!
- **Interactive OAuth**: On first run, it spins up a local server and prints a link. Click it to log in with your Google account. It will automatically capture the access credentials and save them to `token.json` for all subsequent runs.
- **SEO Optimization**: Auto-generates high-retention descriptions containing dramatic episode cliffhangers and tag groupings based on story content.
