import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('No API key found in .env');
    return;
  }
  
  try {
    // We can fetch directly using the API key to avoid dependency version mismatch
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error('API Error:', data.error);
      return;
    }
    
    console.log('Available Models:');
    data.models.forEach(m => {
      if (m.supportedGenerationMethods.includes('generateContent')) {
        console.log(`- ${m.name} (${m.displayName})`);
      }
    });
  } catch (e) {
    console.error('Error fetching models:', e.message);
  }
}

main();
