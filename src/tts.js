import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Clean text by stripping character names and quotes
export function cleanDialogueText(text) {
  let cleanText = text.trim();
  
  // Strip speaker name (e.g. "Ethan: " or "Chloe (angrily): ")
  const colonIndex = cleanText.indexOf(':');
  if (colonIndex > -1) {
    cleanText = cleanText.substring(colonIndex + 1).trim();
  }
  
  // Strip leading and trailing double/single quotes
  cleanText = cleanText.replace(/^["'“”‘]|["'“”’]$/g, '').trim();
  
  return cleanText;
}

// Generate text-to-speech WAV file using Windows PowerShell SAPI (Speech API)
export function generateTTS(text, outputPath, gender = 'Male') {
  const cleanText = cleanDialogueText(text);
  
  // Escape single quotes for PowerShell
  const escapedText = cleanText.replace(/'/g, "''");
  
  // Format absolute path for Windows
  const resolvedPath = path.resolve(outputPath);
  const escapedPath = resolvedPath.replace(/\\/g, '\\\\');
  
  const voiceGender = gender.toLowerCase() === 'female' ? 'Female' : 'Male';
  
  // PowerShell script block
  const psCommand = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::${voiceGender}); $synth.SetOutputToWaveFile('${escapedPath}'); $synth.Speak('${escapedText}'); $synth.Dispose();`;
  
  try {
    const cmd = `powershell -Command "${psCommand}"`;
    execSync(cmd, { stdio: 'ignore' });
    return fs.existsSync(resolvedPath);
  } catch (err) {
    console.error(`❌ SAPI TTS generation failed for text "${cleanText}":`, err.message);
    return false;
  }
}
