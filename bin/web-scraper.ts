#!/usr/bin/env -S npx tsx
// bin/web-scraper.ts
import { safeLog } from "../lib/logger";
import fs from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import axios from "axios";

interface Options {
  url?: string;
  outputFile?: string;
}

interface ScrapedData {
  url: string;
  title: string;
  content: string;
}

async function scrapeWebpage(url: string): Promise<ScrapedData | null> {
  try {
    safeLog("info", `🔍 Scraping webpage: ${url}`);
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const $ = cheerio.load(response.data);
    
    // Extract title
    const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";
    
    // Extract main content (remove scripts, styles, and navigation)
    $("script, style, nav, header, footer, aside").remove();
    const content = $("body").text().replace(/\s+/g, " ").trim();
    
    if (!content) {
      safeLog("warn", `No content found for ${url}`);
      return null;
    }

    safeLog("info", `✅ Successfully scraped ${url}`);
    return {
      url,
      title,
      content
    };
  } catch (error) {
    safeLog("error", `❌ Error scraping ${url}: ${error.message}`);
    return null;
  }
}

async function main() {
  const options: Options = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && i + 1 < args.length) {
      options.url = args[i + 1];
      i++;
    } else if (args[i] === "--output-file" && i + 1 < args.length) {
      options.outputFile = args[i + 1];
      i++;
    }
  }

  if (!options.url) {
    safeLog("error", "Usage: web-scraper.ts --url <webpage_url> [--output-file <file>]");
    process.exit(1);
  }

  try {
    const scrapedData = await scrapeWebpage(options.url);
    if (!scrapedData) {
      safeLog("error", `No data scraped from ${options.url}`);
      process.exit(1);
    }

    const outputData = [{
      id: options.url, // Using URL as ID
      title: scrapedData.title,
      content: scrapedData.content
    }];

    if (options.outputFile) {
      await fs.writeFile(options.outputFile, JSON.stringify(outputData, null, 2));
      safeLog("info", `✅ Wrote scraped data to ${options.outputFile}`);
    } else {
      process.stdout.write(JSON.stringify(outputData) + "\n");
    }
  } catch (error) {
    safeLog("error", `❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  safeLog("error", "Unhandled error:", error);
  process.exit(1);
});