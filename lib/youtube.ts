// lib/youtube.ts
import { YouTubeService } from "./youtube-service";
import { TranscriptService } from "./transcript-service";
import { VideoMetadata, SearchOptions } from "./types";
import { safeLog } from "./logger";

const youtubeService = new YouTubeService();
const transcriptService = new TranscriptService();

export async function searchDiseaseVideos(
  query: string,
  options: SearchOptions = {},
  onVideosFetched?: (videos: VideoMetadata[]) => Promise<void>
): Promise<number> { // Return the number of videos fetched
  const searchOptions: SearchOptions = {
    ...options,
    yearsBack: options.yearsBack || 5,
    startDate: options.startDate,
    endDate: options.endDate,
  };
  safeLog("error", `🔍 Fetching videos for "${query}" with options: ${JSON.stringify(searchOptions)}`);
  if (onVideosFetched) {
    return await youtubeService.searchVideos(query, searchOptions, onVideosFetched);
  } else {
    const allVideos: VideoMetadata[] = [];
    const count = await youtubeService.searchVideos(query, searchOptions, async (videos) => {
      allVideos.push(...videos);
    });
    return count;
  }
}

export async function getTranscript(videoId: string): Promise<{ transcript: string; language: string } | null> {
  try {
    safeLog("error", `[DEBUG] Attempting to fetch transcript for ${videoId}`);
    const { segments, language } = await transcriptService.getTranscriptWithTimestamps(videoId);
    safeLog("error", `[DEBUG] Fetched ${segments.length} segments for ${videoId} in language ${language}`);
    if (segments.length > 0) {
      const transcriptText = segments.map(item => item.text).join(" ");
      safeLog("error", `[DEBUG] Fetched transcript for ${videoId} in language ${language}`);
      return { transcript: transcriptText, language };
    }
    safeLog("error", `[DEBUG] No segments found for ${videoId} after all attempts`);
    return null;
  } catch (error) {
    safeLog("error", `Error fetching transcript for ${videoId}: ${error.message}`);
    return null;
  }
}