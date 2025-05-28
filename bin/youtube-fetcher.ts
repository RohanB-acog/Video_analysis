#!/usr/bin/env -S npx tsx
// bin/youtube-fetcher.ts
import { searchDiseaseVideos, VideoMetadata } from "../lib/youtube";
import { safeLog } from "../lib/logger";
import fs from "fs/promises";
import path from "path";
import { storeVideo } from "../lib/database";
import yaml from "js-yaml";

interface Options {
  searchName?: string;
  disease?: string;
  searchPhrases?: string[];
  channelName?: string[];
  maxResults?: number;
  outputFile?: string;
  videoIdsFile?: string;
  videoId?: string;
  startDate?: string;
  endDate?: string;
  configFile?: string;
  minViewCount?: number;
  minDuration?: number;
  hasContent?: boolean;
}

interface Config {
  searchName?: string;
  disease?: string;
  searchTerms?: string[];
  exclusionTerms?: string[];
  channelName?: string[];
  maxResults?: number;
  outputFile?: string;
  videoIdsFile?: string;
  startDate?: string;
  endDate?: string;
  minViewCount?: number;
  minDuration?: number;
  hasContent?: boolean;
}

async function loadConfig(configFile: string): Promise<Config> {
  try {
    const fileContent = await fs.readFile(configFile, "utf-8");
    const config = yaml.load(fileContent) as Config;
    return {
      searchName: config.searchName,
      disease: config.disease,
      searchTerms: config.searchTerms,
      exclusionTerms: config.exclusionTerms,
      channelName: config.channelName,
      maxResults: config.maxResults,
      outputFile: config.outputFile,
      videoIdsFile: config.videoIdsFile,
      startDate: config.startDate,
      endDate: config.endDate,
      minViewCount: config.minViewCount ?? 1,
      minDuration: config.minDuration ?? 60,
      hasContent: config.hasContent ?? true,
    };
  } catch (error) {
    safeLog("info", `No config file found at ${configFile}, using default values`);
    return {
      minViewCount: 1,
      minDuration: 60,
      hasContent: true,
    };
  }
}

async function storeSearchConfig(userId: string, searchPhrase: string, searchName: string) {
  try {
    const pool = await (await import("../lib/database")).getPool();
    await pool.query(
      `INSERT INTO SearchConfig (user_id, search_phrase, search_name, creation_date)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (search_name) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         search_phrase = EXCLUDED.search_phrase,
         creation_date = NOW()`,
      [userId, searchPhrase, searchName]
    );
    safeLog("info", `✅ Stored SearchConfig for search_name ${searchName}`);
  } catch (error) {
    safeLog("error", `❌ Error storing SearchConfig:`, error);
    throw error;
  }
}

async function appendToJsonFile(filePath: string, videos: VideoMetadata[]) {
  try {
    let existingData: VideoMetadata[] = [];
    try {
      const content = await fs.readFile(filePath, "utf-8");
      existingData = JSON.parse(content);
    } catch (error) {
      existingData = [];
    }

    const allVideos = [...existingData, ...videos];
    const uniqueVideos = Array.from(new Map(allVideos.map(video => [video.id, video])).values());

    await fs.writeFile(filePath, JSON.stringify(uniqueVideos, null, 2));
    safeLog("info", `✅ Appended ${videos.length} videos to ${filePath}, total unique videos: ${uniqueVideos.length}`);
  } catch (error) {
    safeLog("error", `❌ Error appending to ${filePath}:`, error);
    throw error;
  }
}

async function appendVideoIdsToJsonFile(filePath: string, videoIds: string[]) {
  try {
    let existingIds: string[] = [];
    try {
      const content = await fs.readFile(filePath, "utf-8");
      existingIds = JSON.parse(content);
    } catch (error) {
      existingIds = [];
    }

    const allIds = [...existingIds, ...videoIds];
    const uniqueIds = Array.from(new Set(allIds));

    await fs.writeFile(filePath, JSON.stringify(uniqueIds, null, 2));
    safeLog("info", `✅ Appended ${videoIds.length} video IDs to ${filePath}, total unique IDs: ${uniqueIds.length}`);
  } catch (error) {
    safeLog("error", `❌ Error appending to ${filePath}:`, error);
    throw error;
  }
}

function constructSearchQuery(searchName: string, searchTerms: string[], exclusionTerms: string[]): string {
  const baseTerms = searchTerms.length > 0 ? `(${searchTerms.join(" | ")})` : "";
  const exclusions = exclusionTerms.length > 0 ? exclusionTerms.map(term => `-${term}`).join(" ") : "";
  return `"${searchName}" ${baseTerms} ${exclusions}`.trim();
}

async function main() {
  const options: Options = {};
  const args = process.argv.slice(2);

  // Parse CLI arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--search-name" && i + 1 < args.length) {
      options.searchName = args[i + 1];
      i++;
    } else if (args[i] === "--disease" && i + 1 < args.length) {
      options.disease = args[i + 1];
      i++;
    } else if (args[i] === "--search-phrase" && i + 1 < args.length) {
      options.searchPhrases = args[i + 1].split(",").map(phrase => phrase.trim());
      i++;
    } else if (args[i] === "--channel-name" && i + 1 < args.length) {
      options.channelName = args[i + 1].split(",").map(channel => channel.trim());
      i++;
    } else if (args[i] === "--max-results" && i + 1 < args.length) {
      options.maxResults = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--output-file" && i + 1 < args.length) {
      options.outputFile = args[i + 1];
      i++;
    } else if (args[i] === "--video-ids-file" && i + 1 < args.length) {
      options.videoIdsFile = args[i + 1];
      i++;
    } else if (args[i] === "--video-id" && i + 1 < args.length) {
      options.videoId = args[i + 1];
      i++;
    } else if (args[i] === "--start-date" && i + 1 < args.length) {
      options.startDate = args[i + 1];
      i++;
    } else if (args[i] === "--end-date" && i + 1 < args.length) {
      options.endDate = args[i + 1];
      i++;
    } else if (args[i] === "--config-file" && i + 1 < args.length) {
      options.configFile = args[i + 1];
      i++;
    } else if (args[i] === "--min-view-count" && i + 1 < args.length) {
      options.minViewCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--min-duration" && i + 1 < args.length) {
      options.minDuration = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--has-content" && i + 1 < args.length) {
      options.hasContent = args[i + 1].toLowerCase() === "true";
      i++;
    }
  }

  // Load configuration from YAML file
  const config = await loadConfig(options.configFile || "config.yaml");

  // Merge CLI options with config, CLI takes precedence
  const finalOptions: Options = {
    searchName: options.searchName || options.disease || config.searchName || config.disease,
    searchPhrases: options.searchPhrases,
    channelName: options.channelName || config.channelName,
    maxResults: options.maxResults || config.maxResults,
    outputFile: options.outputFile || config.outputFile,
    videoIdsFile: options.videoIdsFile || config.videoIdsFile,
    startDate: options.startDate || config.startDate,
    endDate: options.endDate || config.endDate,
    minViewCount: options.minViewCount ?? config.minViewCount ?? 1,
    minDuration: options.minDuration ?? config.minDuration ?? 60,
    hasContent: options.hasContent ?? config.hasContent ?? true,
    videoId: options.videoId,
  };

  const searchName = finalOptions.searchName;
  if (!searchName && !finalOptions.videoId) {
    safeLog("error", "Usage: youtube-fetcher.ts [--config-file <file>] [--search-name <search_name>] [--search-phrase <phrases>] [--channel-name <channel_ids>] [--max-results <number>] [--output-file <file>] [--video-ids-file <file>] [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--min-view-count <number>] [--min-duration <seconds>] [--has-content <true/false>] [--video-id <video_id>]");
    process.exit(1);
  }

  try {
    let totalVideosFetched = 0;

    if (finalOptions.videoId) {
      const youtubeService = new (await import("../lib/youtube-service")).YouTubeService();
      const video = await youtubeService.getVideoDetails(finalOptions.videoId, {
        minViewCount: finalOptions.minViewCount,
        minDuration: finalOptions.minDuration,
        hasContent: finalOptions.hasContent,
      });
      if (video) {
        const videoWithSearchName = { ...video, search_name: searchName || finalOptions.videoId };
        if (finalOptions.outputFile) {
          await fs.mkdir(path.dirname(finalOptions.outputFile), { recursive: true });
          await appendToJsonFile(finalOptions.outputFile, [videoWithSearchName]);
        }
        if (finalOptions.videoIdsFile) {
          await fs.mkdir(path.dirname(finalOptions.videoIdsFile), { recursive: true });
          await appendVideoIdsToJsonFile(finalOptions.videoIdsFile, [videoWithSearchName.id]);
        }
        await storeVideo(videoWithSearchName);
        safeLog("info", `✅ Processed and stored video ${videoWithSearchName.id}`);
        totalVideosFetched = 1;
      } else {
        safeLog("warn", `❌ No metadata found for video ${finalOptions.videoId}`);
      }
    } else {
      // Handle search terms and exclusions
      let searchTerms: string[] = [];
      let exclusionTerms: string[] = [];
      
      if (finalOptions.searchPhrases) {
        // CLI search phrases may include exclusions with "-"
        searchTerms = finalOptions.searchPhrases.filter(phrase => !phrase.startsWith("-"));
        exclusionTerms = finalOptions.searchPhrases
          .filter(phrase => phrase.startsWith("-"))
          .map(phrase => phrase.substring(1).trim());
      } else {
        // Use config searchTerms and exclusionTerms
        searchTerms = config.searchTerms || [searchName!];
        exclusionTerms = config.exclusionTerms || [];
      }

      const searchOptions: any = { 
        maxResults: finalOptions.maxResults,
        startDate: finalOptions.startDate,
        endDate: finalOptions.endDate,
        minViewCount: finalOptions.minViewCount,
        minDuration: finalOptions.minDuration,
        hasContent: finalOptions.hasContent,
      };

      if (finalOptions.outputFile) {
        await fs.mkdir(path.dirname(finalOptions.outputFile), { recursive: true });
        await fs.writeFile(finalOptions.outputFile, "[]");
      }
      if (finalOptions.videoIdsFile) {
        await fs.mkdir(path.dirname(finalOptions.videoIdsFile), { recursive: true });
        await fs.writeFile(finalOptions.videoIdsFile, "[]");
      }

      // Construct the general search query
      const combinedQuery = constructSearchQuery(searchName!, searchTerms, exclusionTerms);
      safeLog("info", `🔍 Fetching videos for combined query "${combinedQuery}" with options: ${JSON.stringify(searchOptions)}`);
      let totalVideosFetchedForQuery = 0;

      // General search with combined query
      const fetchedCount = await searchDiseaseVideos(combinedQuery, searchOptions, async (videos: VideoMetadata[]) => {
        // Apply searchName filter
        const filteredVideos = videos.filter(video => {
          const lowerTitle = video.title.toLowerCase();
          const lowerDescription = video.description.toLowerCase();
          if (!lowerTitle.includes(searchName!.toLowerCase()) && !lowerDescription.includes(searchName!.toLowerCase())) {
            safeLog("info", `🗑️ Dropped video ${video.id}: No mention of ${searchName} in title or description`);
            return false;
          }
          return true;
        });

        const videosWithSearchName = filteredVideos.map(video => ({ ...video, search_name: searchName }));

        if (finalOptions.outputFile) {
          await appendToJsonFile(finalOptions.outputFile, videosWithSearchName);
        }

        if (finalOptions.videoIdsFile) {
          const videoIds = videosWithSearchName.map(video => video.id);
          await appendVideoIdsToJsonFile(finalOptions.videoIdsFile, videoIds);
        }

        for (const video of videosWithSearchName) {
          try {
            await storeVideo(video);
            safeLog("info", `✅ Stored video ${video.id} in database`);
          } catch (error) {
            safeLog("error", `❌ Error storing video ${video.id}:`, error);
          }
        }

        totalVideosFetchedForQuery += videosWithSearchName.length;
      });

      totalVideosFetched += fetchedCount;
      safeLog("info", `✅ Completed fetching videos for combined query "${combinedQuery}", total fetched: ${fetchedCount}`);

      // Additional search for specified advocacy group channels (if provided)
      if (finalOptions.channelName && finalOptions.channelName.length > 0) {
        for (const channelId of finalOptions.channelName) {
          // Use the same combined query for channel searches
          safeLog("info", `🔍 Fetching videos from channel ${channelId} with query "${combinedQuery}"`);
          
          const channelSearchOptions = {
            ...searchOptions,
            channelId: channelId,
          };

          let totalVideosFetchedForChannel = 0;
          const channelFetchedCount = await searchDiseaseVideos(combinedQuery, channelSearchOptions, async (videos: VideoMetadata[]) => {
            safeLog("info", `Fetched ${videos.length} videos from channel ${channelId} before filtering`);
            // Apply searchName filter
            const filteredVideos = videos.filter(video => {
              const lowerTitle = video.title.toLowerCase();
              const lowerDescription = video.description.toLowerCase();
              if (!lowerTitle.includes(searchName!.toLowerCase()) && !lowerDescription.includes(searchName!.toLowerCase())) {
                safeLog("info", `🗑️ Dropped video ${video.id}: No mention of ${searchName} in title or description`);
                return false;
              }
              return true;
            });

            const videosWithSearchName = filteredVideos.map(video => ({ ...video, search_name: searchName }));

            if (finalOptions.outputFile) {
              await appendToJsonFile(finalOptions.outputFile, videosWithSearchName);
            }

            if (finalOptions.videoIdsFile) {
              const videoIds = videosWithSearchName.map(video => video.id);
              await appendVideoIdsToJsonFile(finalOptions.videoIdsFile, videoIds);
            }

            for (const video of videosWithSearchName) {
              try {
                await storeVideo(video);
                safeLog("info", `✅ Stored video ${video.id} in database`);
              } catch (error) {
                safeLog("error", `❌ Error storing video ${video.id}:`, error);
              }
            }

            totalVideosFetchedForChannel += videosWithSearchName.length;
          });

          totalVideosFetched += channelFetchedCount;
          safeLog("info", `✅ Completed fetching videos from channel ${channelId}, total fetched: ${channelFetchedCount}`);
        }
      }
    }

    const searchPhraseToStore = finalOptions.searchPhrases 
      ? finalOptions.searchPhrases.join(", ") 
      : [...(config.searchTerms || [searchName!]), ...(config.exclusionTerms || []).map(term => `-${term}`)].join(", ");
    await storeSearchConfig("default_user", searchPhraseToStore, searchName!);

    if (finalOptions.outputFile) {
      const finalData = JSON.parse(await fs.readFile(finalOptions.outputFile, "utf-8"));
      safeLog("info", `✅ Final metadata file ${finalOptions.outputFile} contains ${finalData.length} unique videos`);
    }
    if (finalOptions.videoIdsFile) {
      const finalIds = JSON.parse(await fs.readFile(finalOptions.videoIdsFile, "utf-8"));
      safeLog("info", `✅ Final video IDs file ${finalOptions.videoIdsFile} contains ${finalIds.length} unique IDs`);
    }

    safeLog("info", `✅ Total videos fetched and stored: ${totalVideosFetched}`);
  } catch (error) {
    safeLog("error", "❌ Error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  safeLog("error", "Unhandled error:", error);
  process.exit(1);
});