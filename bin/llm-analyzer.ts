#!/usr/bin/env -S npx tsx
// bin/llm-analyzer.ts

import { analyzeTranscript } from "../lib/ollama";
import { safeLog } from "../lib/logger";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

interface Options {
  inputFile?: string;
  outputFile?: string;
  videoId?: string;
  metadataFile?: string; // Optional metadata file to provide titles
}

async function main() {
  const options: Options = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input-file" && i + 1 < args.length) {
      options.inputFile = args[i + 1];
      i++;
    } else if (args[i] === "--output-file" && i + 1 < args.length) {
      options.outputFile = args[i + 1];
      i++;
    } else if (args[i] === "--video-id" && i + 1 < args.length) {
      options.videoId = args[i + 1];
      i++;
    } else if (args[i] === "--metadata-file" && i + 1 < args.length) {
      options.metadataFile = args[i + 1];
      i++;
    }
  }

  if (!options.inputFile && !options.videoId) {
    safeLog("error", "Usage: llm-analyzer.ts [--input-file <file>] [--output-file <file>] [--metadata-file <file>]");
    safeLog("error", "       llm-analyzer.ts --video-id <video_id> [--output-file <file>] [--metadata-file <file>]");
    process.exit(1);
  }

  let inputData: { videoId: string; transcript: string; language?: string; title?: string }[] = [];
  let metadataMap: Record<string, { title: string; description?: string }> = {};

  // Load metadata if provided
  if (options.metadataFile) {
    const metadataContent = await fs.readFile(options.metadataFile, "utf-8");
    const metadata = JSON.parse(metadataContent);
    if (Array.isArray(metadata)) {
      metadata.forEach(item => {
        if (item.id && item.title) {
          metadataMap[item.id] = { title: item.title, description: item.description };
        }
      });
    }
    safeLog("info", `[DEBUG] Loaded metadata for ${Object.keys(metadataMap).length} videos`);
  }

  if (options.videoId) {
    const transcript = await (await import("../lib/youtube")).getTranscript(options.videoId);
    if (transcript) {
      inputData = [{ videoId: options.videoId, transcript: transcript.transcript, title: metadataMap[options.videoId]?.title }];
    } else {
      safeLog("error", `❌ No transcript available for video ${options.videoId}`);
      process.exit(1);
    }
  } else if (options.inputFile) {
    const inputContent = await fs.readFile(options.inputFile, "utf-8");
    try {
      const parsedData = JSON.parse(inputContent);
      inputData = parsedData.map((item: any) => {
        // Handle YouTube transcript format
        if (item.videoId && item.transcript) {
          return {
            videoId: item.videoId,
            transcript: item.transcript,
            language: item.language,
            title: item.title || metadataMap[item.videoId]?.title
          };
        }
        // Handle web scraped data format
        if (item.id && item.content) {
          return {
            videoId: item.id, // Using URL as ID
            transcript: item.content,
            language: "en", // Default for web content
            title: item.title || metadataMap[item.id]?.title
          };
        }
        safeLog("error", `Invalid input item: ${JSON.stringify(item)}`);
        return null;
      }).filter(data => data !== null) as { videoId: string; transcript: string; language?: string; title?: string }[];
      
      if (inputData.length === 0) {
        safeLog("error", "No valid data to process");
        process.exit(1);
      }
    } catch (error) {
      safeLog("error", `Failed to parse input file ${options.inputFile}: ${error.message}`);
      process.exit(1);
    }
  }

  if (inputData.length === 0) {
    safeLog("error", "No transcript data to process");
    process.exit(1);
  }

  // Filter out "NOT AVAILABLE" transcripts
  const validInputData = inputData.filter(item => item.transcript !== "NOT AVAILABLE");
  safeLog("info", `Loaded ${inputData.length} total transcripts; processing ${validInputData.length} valid transcripts (skipped ${inputData.length - validInputData.length} unavailable)`);

  const outputData: any[] = [];
  for (const { videoId, transcript, title } of validInputData) {
    try {
      safeLog("info", `🔍 Analyzing transcript for ${videoId}...`);
      const result = await analyzeTranscript(videoId, transcript, title || `Content ${videoId}`);
      if (result) {
        safeLog("info", `[DEBUG] Raw LLM result: ${JSON.stringify(result, null, 2).substring(0, 1000)}...`);
        
        // Handle both single object and array
        const results = Array.isArray(result) ? result : [result];
        for (const item of results) {
          outputData.push({ videoId, ...item });
        }
        safeLog("info", `✅ Analysis completed for ${videoId}`);
      } else {
        safeLog("warn", `⚠️ No analysis result for ${videoId}`);
      }
    } catch (error) {
      safeLog("error", `❌ Error analyzing ${videoId}: ${error.message}`);
    }
  }

  if (options.outputFile) {
    await fs.writeFile(options.outputFile, JSON.stringify(outputData, null, 2));
    safeLog("info", `✅ Wrote ${outputData.length} analysis results to ${options.outputFile}`);
  } else {
    for (const data of outputData) {
      try {
        process.stdout.write(JSON.stringify(data) + "\n");
        safeLog("info", `[DEBUG] Wrote to stdout: ${JSON.stringify({ videoId: data.videoId })}`);
      } catch (error) {
        if (error.code !== 'EPIPE') {
          safeLog("error", `❌ Error writing to stdout: ${error.message}`);
        } else {
          safeLog("info", `[DEBUG] EPIPE detected, ignoring broken pipe`);
        }
      }
    }
  }

  safeLog("info", "✅ Analysis pipeline completed");
}

main().catch((error) => {
  safeLog("error", "🚨 Unhandled error:", error);
  process.exit(1);
});