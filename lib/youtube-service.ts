import { google } from "googleapis";
import { VideoMetadata, SearchOptions } from "./types";
import { DateTime } from "luxon";
import { TranscriptService } from "./transcript-service";
import { safeLog } from "./logger";

export class YouTubeService {
  private youtube;
  private apiKeys: string[];
  private currentApiKeyIndex: number = 0;
  private transcriptService: TranscriptService;

  constructor() {
    const apiKeysString = process.env.YOUTUBE_API_KEYS || "";
    this.apiKeys = apiKeysString.split(",").map(key => key.trim()).filter(key => key.length > 0);
    if (this.apiKeys.length === 0) {
      throw new Error("No YouTube API keys provided in YOUTUBE_API_KEYS environment variable");
    }

    safeLog("info", `[DEBUG] Loaded ${this.apiKeys.length} YouTube API keys`);
    this.youtube = google.youtube({
      version: "v3",
      auth: this.apiKeys[this.currentApiKeyIndex],
    });
    this.transcriptService = new TranscriptService();
  }

  private switchApiKey(): boolean {
    if (this.currentApiKeyIndex + 1 < this.apiKeys.length) {
      this.currentApiKeyIndex++;
      safeLog("info", `Switching to API key ${this.currentApiKeyIndex + 1}/${this.apiKeys.length}`);
      this.youtube = google.youtube({
        version: "v3",
        auth: this.apiKeys[this.currentApiKeyIndex],
      });
      return true;
    } else {
      safeLog("error", "❗ Exhausted all API keys, cannot continue fetching videos.");
      return false;
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await this.youtube.channels.list({
        part: ["snippet"],
        id: ["UC_x5XG1OV2P6uZZ5FSM9Ttw"],
        maxResults: 1,
      });
      return response.status === 200;
    } catch (error) {
      safeLog("error", "[DEBUG] API key validation failed:", error.message);
      return false;
    }
  }

  async searchVideos(
    query: string,
    options: SearchOptions & { yearsBack?: number } = {},
    onVideosFetched: (videos: VideoMetadata[]) => Promise<void>
  ): Promise<number> {
    try {
      const maxResultsPerRequest = 50;
      const totalResults = options.maxResults;
      let resultsFetched = 0;

      const endDateTime = options.endDate 
        ? DateTime.fromISO(options.endDate) 
        : DateTime.now();

      const startDateTime = options.startDate 
        ? DateTime.fromISO(options.startDate) 
        : endDateTime.minus({ years: options.yearsBack || 5 });

      safeLog("error", `[DEBUG] Full date range: ${startDateTime.toISO()} to ${endDateTime.toISO()}`);
      
      const dateChunkIntervalDays = 14;
      let currentStartDate = startDateTime;

      while (currentStartDate < endDateTime) {
        let chunkEndDate = currentStartDate.plus({ days: dateChunkIntervalDays });
        if (chunkEndDate > endDateTime) {
          chunkEndDate = endDateTime;
        }

        safeLog("error", `[DEBUG] Processing date chunk: ${currentStartDate.toISO()} to ${chunkEndDate.toISO()}`);

        const chunkResults = await this.fetchVideosByDateRange(
          query,
          currentStartDate.toISO(),
          chunkEndDate.toISO(),
          options,
          totalResults ? totalResults - resultsFetched : undefined,
          onVideosFetched
        );

        resultsFetched += chunkResults;

        if (totalResults !== undefined && resultsFetched >= totalResults) {
          safeLog("error", `[DEBUG] Reached total requested results limit of ${totalResults}`);
          break;
        }

        currentStartDate = chunkEndDate;
      }

      safeLog("error", `✅ Completed all date chunks. Total videos processed in this run: ${resultsFetched}`);

      if (resultsFetched === 0) {
        safeLog("error", "❗ No videos found across all date chunks. Check query, API limits, or date range.");
      }

      return resultsFetched;
    } catch (error) {
      safeLog("error", "Error searching videos:", error);
      throw error;
    }
  }

  private async fetchVideosByDateRange(
    query: string,
    startDate: string,
    endDate: string,
    options: SearchOptions,
    maxResults: number | undefined,
    onVideosFetched: (videos: VideoMetadata[]) => Promise<void>
  ): Promise<number> {
    const maxResultsPerRequest = 50;
    let resultsFetched = 0;
    let nextPageToken: string | null = null;

    safeLog(
      "error",
      `🔍 Fetching videos for "${query}" (chunk range: ${startDate} to ${endDate}, max: ${maxResults || 'all'})`
    );

    do {
      safeLog("error", `[DEBUG] Fetching page ${nextPageToken ? `with token ${nextPageToken}` : '1 (no token)'}`);

      const requestParams: any = {
        part: ["snippet"],
        q: query,
        type: ["video"],
        maxResults: maxResultsPerRequest,
        order: options.order || "relevance",
        regionCode: "US",
        relevanceLanguage: options.language || "en",
        publishedAfter: startDate,
        publishedBefore: endDate,
        videoDuration: "any",
      };

      if (options.channelId) {
        requestParams.channelId = options.channelId;
      }

      if (nextPageToken) {
        requestParams.pageToken = nextPageToken;
      }

      safeLog("error", "[DEBUG] Request params:", JSON.stringify(requestParams, null, 2));

      let fetchSuccessful = false;
      while (!fetchSuccessful) {
        try {
          const response = await this.youtube.search.list(requestParams);
          safeLog("error", `[DEBUG] Response status: ${response.status}`);
          safeLog("error", `[DEBUG] Items received: ${response.data.items?.length || 0}`);

          if (!response.data.items || response.data.items.length === 0) {
            safeLog("error", "[DEBUG] No items in response, breaking loop");
            break;
          }

          const videos = response.data.items;
          const videoIds = videos.map((item) => item.id?.videoId).filter((id): id is string => id !== undefined);

          safeLog("error", `[DEBUG] Video IDs found: ${videoIds.join(', ')}`);

          if (!videoIds.length) {
            safeLog("error", "[DEBUG] No valid video IDs in this batch");
            break;
          }

          const detailsResponse = await this.youtube.videos.list({
            part: ["snippet", "contentDetails", "statistics"],
            id: videoIds.join(","),
          });

          safeLog("error", `[DEBUG] Details received for ${detailsResponse.data.items?.length || 0} videos`);

          const videoDetails = detailsResponse.data.items || [];
          const videoMetadata = videoDetails.map((video) => {
            const videoId = video.id;
            if (!videoId) return null;

            const durationInSeconds = this.parseDuration(video.contentDetails?.duration || "PT0S");

            return {
              id: videoId,
              title: video.snippet?.title || "",
              description: video.snippet?.description || "",
              publishedDate: video.snippet?.publishedAt || "",
              durationInSeconds,
              viewCount: parseInt(video.statistics?.viewCount || "0", 10),
              url: `https://www.youtube.com/watch?v=${videoId}`,
              thumbnail: video.snippet?.thumbnails?.high?.url || "",
              channel_name: video.snippet?.channelTitle || "",
            };
          }).filter((result): result is VideoMetadata => result !== null);

          // Filter out Shorts (videos under 60 seconds) and invalid durations
          const filteredMetadata = videoMetadata.filter(video => {
            if (video.durationInSeconds <= 0) {
              safeLog("info", `🗑️ Dropped video ${video.id}: Invalid duration (${video.durationInSeconds}s)`);
              return false;
            }
            if (video.durationInSeconds < 60) {
              safeLog("info", `🗑️ Dropped video ${video.id}: Duration ${video.durationInSeconds}s (likely a Short)`);
              return false;
            }
            return true;
          });

          const uniqueVideos = this.removeDuplicateVideos(filteredMetadata);
          resultsFetched += uniqueVideos.length;

          await onVideosFetched(uniqueVideos);

          nextPageToken = response.data.nextPageToken || null;
          safeLog("error", `[DEBUG] Next page token: ${nextPageToken || 'None (end of results)'}`);

          safeLog("error", `✅ Fetched ${resultsFetched} videos so far for this date chunk`);

          fetchSuccessful = true;

          if (maxResults !== undefined && resultsFetched >= maxResults) {
            safeLog("error", `[DEBUG] Reached maxResults limit of ${maxResults} for this chunk`);
            break;
          }

        } catch (error) {
          safeLog("error", "❗ Error fetching videos batch:", error);

          if (error.response) {
            safeLog("error", `[DEBUG] Error status: ${error.response.status}`);
            safeLog("error", `[DEBUG] Error data: ${JSON.stringify(error.response.data, null, 2)}`);
            if (error.response.status === 403 && error.response.data?.error?.errors?.some((e: any) => e.reason === "quotaExceeded")) {
              const canSwitch = this.switchApiKey();
              if (!canSwitch) {
                safeLog("error", "❗ No more API keys available, stopping fetch.");
                break;
              }
              safeLog("info", "Retrying with new API key...");
              continue;
            }
          }

          throw error;
        }
      }
    } while (nextPageToken !== null);

    safeLog("error", `✅ Date chunk complete. Processed ${resultsFetched} videos for "${query}"`);
    return resultsFetched;
  }

  private removeDuplicateVideos(videos: VideoMetadata[]): VideoMetadata[] {
    const uniqueIds = new Set<string>();
    return videos.filter(video => {
      if (uniqueIds.has(video.id)) {
        return false;
      }
      uniqueIds.add(video.id);
      return true;
    });
  }

  async getVideoDetails(videoId: string): Promise<VideoMetadata | null> {
    let fetchSuccessful = false;
    while (!fetchSuccessful) {
      try {
        const response = await this.youtube.videos.list({
          part: ["snippet", "contentDetails", "statistics"],
          id: [videoId],
        });

        const video = response.data.items?.[0];
        if (!video) {
          safeLog("info", `🗑️ Video ${videoId} not found`);
          return null;
        }

        const durationInSeconds = this.parseDuration(video.contentDetails?.duration || "PT0S");

        // Apply Shorts filter
        if (durationInSeconds <= 0) {
          safeLog("info", `🗑️ Dropped video ${videoId}: Invalid duration (${durationInSeconds}s)`);
          return null;
        }
        if (durationInSeconds < 60) {
          safeLog("info", `🗑️ Dropped video ${videoId}: Duration ${durationInSeconds}s (likely a Short)`);
          return null;
        }

        const metadata: VideoMetadata = {
          id: videoId,
          title: video.snippet?.title || "",
          description: video.snippet?.description || "",
          publishedDate: video.snippet?.publishedAt || "",
          durationInSeconds,
          viewCount: parseInt(video.statistics?.viewCount || "0", 10),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: video.snippet?.thumbnails?.high?.url || "",
          channel_name: video.snippet?.channelTitle || "",
        };

        fetchSuccessful = true;
        return metadata;
      } catch (error) {
        safeLog("error", "Error fetching video details:", error);
        if (error.response && error.response.status === 403 && error.response.data?.error?.errors?.some((e: any) => e.reason === "quotaExceeded")) {
          const canSwitch = this.switchApiKey();
          if (!canSwitch) {
            safeLog("error", "❗ No more API keys available, stopping fetch.");
            return null;
          }
          safeLog("info", "Retrying with new API key...");
          continue;
        }
        return null;
      }
    }
    return null;
  }

  async fetchTranscript(videoId: string): Promise<{ fullText: string; language: string } | null> {
    try {
      safeLog("error", "[DEBUG] Fetching transcript for video:", videoId);
      const { segments, language } = await this.transcriptService.getTranscriptWithTimestamps(videoId);

      if (!segments || segments.length === 0) {
        safeLog("error", "[DEBUG] No transcript available for video:", videoId);
        return null;
      }

      const fullText = segments.map(segment => segment.text).join(" ");
      safeLog("error", `[DEBUG] Fetched complete transcript for video ${videoId} in language ${language}`);
      return { fullText, language };
    } catch (error) {
      safeLog("error", `Error fetching transcript for video ${videoId}:`, error);
      return null;
    }
  }

  private parseDuration(duration: string): number {
    try {
      // Handle empty or malformed duration strings
      if (!duration || typeof duration !== "string" || !duration.startsWith("PT")) {
        safeLog("error", `[DEBUG] Invalid duration format: ${duration || "undefined"}`);
        return 0;
      }

      const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
      if (!match) {
        safeLog("error", `[DEBUG] Failed to parse duration: ${duration}`);
        return 0;
      }

      const hours = match[1] ? parseInt(match[1].replace("H", ""), 10) * 3600 : 0;
      const minutes = match[2] ? parseInt(match[2].replace("M", ""), 10) * 60 : 0;
      const seconds = match[3] ? parseInt(match[3].replace("S", ""), 10) : 0;

      const totalSeconds = hours + minutes + seconds;
      if (totalSeconds <= 0) {
        safeLog("error", `[DEBUG] Parsed duration is 0 or negative: ${duration}`);
        return 0;
      }

      return totalSeconds;
    } catch (error) {
      safeLog("error", `[DEBUG] Error parsing duration ${duration}:`, error);
      return 0;
    }
  }
}