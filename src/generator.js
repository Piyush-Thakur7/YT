import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Resilient JSON parser to handle markdown wrapping or trailing characters
function cleanAndParseJSON(text) {
  let cleaned = text.trim();
  
  // Strip markdown code block wrappers if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
  }
  
  // Find the boundaries of the first JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('Could not find valid JSON object boundaries in response: ' + text.slice(0, 100) + '...');
  }
  
  cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(cleaned);
}


// Load environment variables
dotenv.config();

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const DATABASE_PATH = path.join(process.cwd(), 'database.json');
const EPISODES_DIR = path.join(process.cwd(), 'episodes');

// Ensure directories exist
if (!fs.existsSync(EPISODES_DIR)) {
  fs.mkdirSync(EPISODES_DIR, { recursive: true });
}

// Load configuration
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json not found! Run project setup first.');
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Initialize database
function loadDatabase() {
  if (!fs.existsSync(DATABASE_PATH)) {
    return { episodes: [] };
  }
  return JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
}

function saveDatabase(db) {
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// Initialize Gemini API
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('your_gemini_api_key_here')) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY is not configured or using placeholder in .env.');
    console.log('💡 Running in DRY RUN mode with mock story generation.');
    return null;
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  // Using gemini-3.5-flash for fast and high-quality structured generation
  return genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    }
  });
}

// Generate Mock Story Bible (Dry Run)
function generateMockStoryBible(config) {
  return {
    title: `The Secret of the ${config.genre.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`,
    genre: config.genre,
    theme: "Betrayal, power, love, and redemption.",
    synopsis: `A thrilling tale of a high-society drama focusing on the themes of ${config.genre}.`,
    characters: [
      {
        name: "Alexander Sterling",
        role: "Billionaire protagonist hiding his identity",
        description: "Cold, calculating, yet holds a deep sense of justice.",
        appearance: "A 28-year-old billionaire with a sharp jawline, short swept-back dark brown hair, wearing a custom navy blue suit, cold grey eyes. Must always look clean-shaven and wealthy."
      },
      {
        name: "Elena Vance",
        role: "The strong-willed love interest seeking revenge",
        description: "Fierce, smart, seeking to avenge her family's ruin.",
        appearance: "A 26-year-old woman with waist-length wavy auburn hair, high cheekbones, wearing a black trench coat, piercing emerald green eyes. Intense, dramatic expressions."
      }
    ],
    episodes: Array.from({ length: config.episodesCount }, (_, i) => ({
      episodeNumber: i + 1,
      title: `Episode ${i + 1}: ${i === 0 ? "The Betrayal" : i === config.episodesCount - 1 ? "The Ultimate Reveal" : "The Plot Thickens"}`,
      summary: `In this episode, Elena and Alexander cross paths under tense circumstances, leading to a dramatic cliffhanger.`
    }))
  };
}

// Generate Mock Episode (Dry Run)
function generateMockEpisode(epNumber, bible) {
  const sceneCount = 9; // ~72 seconds total (8 seconds per scene)
  const ep = bible.episodes[epNumber - 1];
  
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const sNum = i + 1;
    return {
      sceneNumber: sNum,
      sceneDescription: `Scene ${sNum} of Episode ${epNumber}: Development of conflict.`,
      veoPrompt: `Cinematic short-drama style, 4k. A medium shot of Alexander Sterling (28-year-old billionaire, sharp jawline, short swept-back dark brown hair, navy blue suit, cold grey eyes) and Elena Vance (26-year-old woman, auburn hair, black trench coat, green eyes). Dynamic slow tracking camera movement. Moody office lighting. ${i % 2 === 0 ? 'Elena looks suspicious.' : 'Alexander smirks coldly.'}`,
      dialogueOrVoiceover: i % 2 === 0 ? "Elena: 'You think you've won, don't you?'" : "Alexander: 'I know I have, Elena.'",
      durationSeconds: 8
    };
  });

  return {
    episodeNumber: epNumber,
    title: ep.title,
    cliffhanger: `Alexander receives a mysterious text showing Elena's true identity, setting up the next episode.`,
    scenes
  };
}

// Main execution function
async function main() {
  try {
    const config = loadConfig();
    const db = loadDatabase();
    const model = getGeminiModel();
    
    let bible;
    const biblePath = path.join(EPISODES_DIR, 'story_bible.json');
    
    if (fs.existsSync(biblePath)) {
      console.log('📖 Loading existing Story Bible from disk...');
      bible = JSON.parse(fs.readFileSync(biblePath, 'utf8'));
      console.log(`✅ Loaded Story Bible: "${bible.title}"`);
    } else if (model) {
      console.log('🔮 Generating Story Bible with Gemini API...');
      const biblePrompt = `
        You are an expert short-drama screenwriter. Generate a high-level story bible/outline for a vertical short-drama series (e.g. ReelShort style).
        
        Genre/Theme: ${config.genre}
        Language/Style: ${config.language}
        Number of Episodes: ${config.episodesCount}
        
        Return a JSON object conforming exactly to this schema:
        {
          "title": "A captivating, dramatic title for the series",
          "genre": "The genre",
          "theme": "The main theme",
          "synopsis": "A detailed 2-3 paragraph synopsis of the entire series",
          "characters": [
            {
              "name": "Character Name",
              "role": "Their role in the story (e.g. billionaire, avenger, rival)",
              "description": "Personality traits, motives, and background",
              "appearance": "CRITICAL: Detailed visual appearance description for image/video generator consistency. Specify hair color, style, eye color, typical clothing style, age, facial features. (e.g., 'A 28-year-old billionaire with sharp jawline, short swept-back dark brown hair, wearing a custom navy blue suit, cold grey eyes. Must always look clean-shaven and wealthy.')"
            }
          ],
          "episodes": [
            {
              "episodeNumber": 1,
              "title": "Title of Episode 1",
              "summary": "Summary of the main events and conflict of this episode"
            }
          ]
        }
      `;
      
      const result = await model.generateContent(biblePrompt);
      const text = result.response.text();
      bible = cleanAndParseJSON(text);
      console.log(`✅ Story Bible Generated: "${bible.title}"`);
      fs.writeFileSync(biblePath, JSON.stringify(bible, null, 2), 'utf8');
    } else {
      bible = generateMockStoryBible(config);
      console.log(`✅ Generated MOCK Story Bible: "${bible.title}"`);
      fs.writeFileSync(biblePath, JSON.stringify(bible, null, 2), 'utf8');
    }
    
    // Generate each episode script
    for (let i = 1; i <= config.episodesCount; i++) {
      const epFolder = path.join(EPISODES_DIR, `ep${String(i).padStart(2, '0')}`);
      const scriptFile = path.join(epFolder, 'script.json');
      const promptsFile = path.join(epFolder, 'veo_prompts.txt');
      
      // Resumable script check: Skip if already exists
      if (fs.existsSync(scriptFile) && fs.existsSync(promptsFile)) {
        console.log(`⏭️  Episode ${i} already exists. Skipping script generation.`);
        
        // Sync database entry just in case
        const episodeScript = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
        const existingEpIdx = db.episodes.findIndex(e => e.episodeNumber === i);
        const epDbEntry = {
          episodeNumber: i,
          title: episodeScript.title,
          status: db.episodes[existingEpIdx]?.status || 'GENERATED',
          cliffhanger: episodeScript.cliffhanger,
          totalScenes: episodeScript.scenes.length,
          createdAt: db.episodes[existingEpIdx]?.createdAt || new Date().toISOString()
        };
        if (existingEpIdx > -1) {
          db.episodes[existingEpIdx] = { ...db.episodes[existingEpIdx], ...epDbEntry };
        } else {
          db.episodes.push(epDbEntry);
        }
        continue;
      }

      console.log(`🎬 Generating Script for Episode ${i}/${config.episodesCount}...`);
      let episodeScript;
      
      if (model) {
        const charDescriptions = bible.characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n');
        const episodeOutline = bible.episodes[i - 1];
        
        const epPrompt = `
          You are an expert short-drama screenwriter. Write the complete script and scene-by-scene breakdown for Episode ${i} of the series: "${bible.title}".
          
          Episode Details:
          - Number: ${i}
          - Title: ${episodeOutline.title}
          - Summary: ${episodeOutline.summary}
          - Genre: ${bible.genre}
          - Language: ${bible.language}
          
          Character Visual Consistency References (use these exact character visuals in video prompts):
          ${charDescriptions}
          
          Requirements:
          - Break the episode into exactly 9 scenes. Each scene is exactly 8 seconds long.
          - Each scene must have a high-quality video prompt optimized for Veo (Google Flow).
          - The Veo prompt must include:
            1. Clear visual setting (e.g. vertical framing, 4k, cinematic lighting).
            2. Detailed descriptions of characters present (using the physical appearance notes for consistency).
            3. Camera movement instructions (e.g., "slow zoom in on her eyes", "panning shot left to right", "dramatic low angle").
            4. Emotional expression and action (e.g., "looking shocked", "slamming the folder onto the desk").
          - Each scene must have dialogue or a voiceover cue (synced to that scene).
          
          CRITICAL FORMATTING RULES:
          - Any double quotes inside string fields (like "dialogueOrVoiceover" or "veoPrompt") MUST be properly escaped with a backslash (e.g. \\"dialogue\\").
          - Do not use unescaped double quotes inside string values.
          
          Return a JSON object conforming exactly to this schema:
          {
            "episodeNumber": ${i},
            "title": "${episodeOutline.title}",
            "cliffhanger": "A high-tension cliffhanger description that ends this episode to make viewers click the next one",
            "scenes": [
              {
                "sceneNumber": 1,
                "sceneDescription": "Detailed narrative description of what happens in this scene",
                "veoPrompt": "A highly detailed, vertical video prompt for Veo generation, incorporating camera movement, precise character appearance consistency, and dramatic lighting",
                "dialogueOrVoiceover": "The dialogue spoken in this scene or voiceover narration. Example: 'Alexander (coldly): I have been waiting for this day, Elena.'",
                "durationSeconds": 8
              }
            ]
          }
        `;
        
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            const result = await model.generateContent(epPrompt);
            const text = result.response.text();
            episodeScript = cleanAndParseJSON(text);
            break;
          } catch (e) {
            attempts++;
            console.warn(`⚠️ Attempt ${attempts}/${maxAttempts} failed to parse JSON for Episode ${i}: ${e.message}`);
            if (attempts >= maxAttempts) throw e;
          }
        }
      } else {
        episodeScript = generateMockEpisode(i, bible);
      }
      
      // Create folder for the episode
      if (!fs.existsSync(epFolder)) {
        fs.mkdirSync(epFolder, { recursive: true });
      }
      
      // Save full script JSON
      fs.writeFileSync(
        path.join(epFolder, 'script.json'),
        JSON.stringify(episodeScript, null, 2),
        'utf8'
      );
      
      // Save copy-paste friendly prompt sheet
      let promptSheetText = `==================================================\n`;
      promptSheetText += `EPISODE ${i}: ${episodeScript.title}\n`;
      promptSheetText += `CLIFFHANGER: ${episodeScript.cliffhanger}\n`;
      promptSheetText += `==================================================\n\n`;
      
      episodeScript.scenes.forEach(scene => {
        promptSheetText += `--- Scene ${scene.sceneNumber} (${scene.durationSeconds}s) ---\n`;
        promptSheetText += `Narrative: ${scene.sceneDescription}\n\n`;
        promptSheetText += `[COPY VEO PROMPT]:\n${scene.veoPrompt}\n\n`;
        promptSheetText += `[DIALOGUE / VOICE OVER]:\n${scene.dialogueOrVoiceover}\n`;
        promptSheetText += `--------------------------------------------------\n\n`;
      });
      
      fs.writeFileSync(
        path.join(epFolder, 'veo_prompts.txt'),
        promptSheetText,
        'utf8'
      );
      
      // Update/add to database
      const existingEpIdx = db.episodes.findIndex(e => e.episodeNumber === i);
      const epDbEntry = {
        episodeNumber: i,
        title: episodeScript.title,
        status: 'GENERATED',
        cliffhanger: episodeScript.cliffhanger,
        totalScenes: episodeScript.scenes.length,
        createdAt: new Date().toISOString()
      };
      
      if (existingEpIdx > -1) {
        db.episodes[existingEpIdx] = { ...db.episodes[existingEpIdx], ...epDbEntry };
      } else {
        db.episodes.push(epDbEntry);
      }
      
      console.log(`💾 Saved Episode ${i} data to ${epFolder}/`);
    }
    
    saveDatabase(db);
    console.log('\n🚀 ALL EPISODES GENERATED SUCCESSFULLY! Check the "episodes/" directory.');
    console.log('👉 Next Step: Copy prompts from episodes/epXX/veo_prompts.txt to Google Flow.');
    console.log('💾 Place the generated clips in episodes/epXX/ as scene_01.mp4, scene_02.mp4, etc.');
    
  } catch (err) {
    console.error('❌ Error during story generation:', err);
  }
}

main();
