import express from "express";
import path from "path";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper function to extract video_id from a YouTube URL
function extractVideoId(url: string): string | null {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// API endpoint to fetch dashboard data, video analysis, or content items
app.post("/api/dashboard", async (req, res) => {
  const { searchName, contentType, contentUrl, desiredOutcomes } = req.body;

  // Validate input
  if (!searchName && !contentUrl) {
    return res.status(400).json({ error: "Either search name or video URL is required" });
  }

  // If videoUrl is provided, search by video_id
  if (contentType && contentUrl) {
    const videoId = extractVideoId(contentUrl);
    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    try {
      const videoResult = await pool.query(
        "SELECT * FROM videos WHERE video_id = $1",
        [videoId]
      );

      if (videoResult.rows.length === 0) {
        return res.status(404).json({
          error: `Video with ID ${videoId} not found in the database.`,
        });
      }

      const video = videoResult.rows[0];

      const transcriptResult = await pool.query(
        "SELECT full_transcript FROM transcripts WHERE video_id = $1",
        [videoId]
      );
      const transcriptAvailable = transcriptResult.rows.length > 0 && transcriptResult.rows[0].full_transcript !== "NOT AVAILABLE";

      const analysisResult = await pool.query(
        "SELECT * FROM analysis WHERE video_id = $1",
        [videoId]
      );
      const analysis = analysisResult.rows.length > 0 ? analysisResult.rows[0] : null;

      const videoAnalysis = {
        video: {
          video_id: video.video_id,
          search_name: video.search_name,
          title: video.title,
          description: video.description,
          published_date: video.published_date ? video.published_date.toISOString() : null,
          duration_seconds: video.duration_seconds,
          view_count: video.view_count,
          url: video.url,
          channel_name: video.channel_name,
        },
        transcriptAvailable,
        analysis: analysis
          ? {
              video_type: analysis.video_type,
              name: analysis.name,
              current_age: analysis.current_age,
              onset_age: analysis.onset_age,
              sex: analysis.sex,
              location: analysis.location,
              symptoms: analysis.symptoms,
              medical_history_of_patient: analysis.medical_history_of_patient,
              family_medical_history: analysis.family_medical_history,
              challenges_faced_during_diagnosis: analysis.challenges_faced_during_diagnosis,
              key_opinion: analysis.key_opinion,
              topic_of_information: analysis.topic_of_information,
              details_of_information: analysis.details_of_information,
              headline: analysis.headline,
              summary_of_news: analysis.summary_of_news,
            }
          : null,
      };

      return res.json({ type: "videoAnalysis", data: videoAnalysis });
    } catch (error) {
      console.error("Error querying video analysis:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  const normalizedSearchName = searchName?.toLowerCase();

  try {
    const searchConfigResult = await pool.query(
      "SELECT creation_date FROM SearchConfig WHERE LOWER(search_name) = LOWER($1)",
      [normalizedSearchName]
    );

    if (searchConfigResult.rows.length === 0) {
      return res.status(404).json({
        error: `No data found for search name "${normalizedSearchName}". Please run the pipeline for this search term.`,
      });
    }

    const lastUpdated = searchConfigResult.rows[0].creation_date;

    if (desiredOutcomes?.patientStories || desiredOutcomes?.kolInterviews) {
      console.log("Processing content items for desired outcomes:", desiredOutcomes);
      let videoTypeConditions: string[] = [];
      if (desiredOutcomes.patientStories && desiredOutcomes.kolInterviews) {
        videoTypeConditions.push(`LOWER(a.video_type) IN ('patient story', 'kol interview')`);
      } else if (desiredOutcomes.patientStories) {
        videoTypeConditions.push(`LOWER(a.video_type) = 'patient story'`);
      } else if (desiredOutcomes.kolInterviews) {
        videoTypeConditions.push(`LOWER(a.video_type) = 'kol interview'`);
      }

      const conditions: string[] = [];
      const params: any[] = [normalizedSearchName];
      let paramIndex = 2;

      if (videoTypeConditions.length > 0) {
        conditions.push(videoTypeConditions.join(" AND "));
      }

      const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

      const contentItemsQuery = `
        SELECT v.video_id, v.title, v.description, v.url, v.published_date, v.view_count, a.video_type
        FROM videos v
        JOIN analysis a ON v.video_id = a.video_id
        WHERE LOWER(v.search_name) = LOWER($1) ${whereClause}
        ORDER BY v.published_date DESC
      `;
      const contentItemsResult = await pool.query(contentItemsQuery, params);
      const contentItems = contentItemsResult.rows.map((row: any) => ({
        video_id: row.video_id,
        title: row.title,
        description: row.description,
        url: row.url,
        published_date: row.published_date ? row.published_date.toISOString() : null,
        view_count: row.view_count,
        video_type: row.video_type,
      }));

      return res.json({ type: "contentItems", data: contentItems });
    }

    console.log("Processing dashboard data for search name:", normalizedSearchName);
    const videoCountResult = await pool.query(
      "SELECT COUNT(*) FROM videos WHERE LOWER(search_name) = LOWER($1)",
      [normalizedSearchName]
    );
    const videoCount = parseInt(videoCountResult.rows[0].count, 10);

    const transcriptCountResult = await pool.query(
      "SELECT COUNT(*) FROM transcripts WHERE video_id IN (SELECT video_id FROM videos WHERE LOWER(search_name) = LOWER($1)) AND full_transcript != 'NOT AVAILABLE'",
      [normalizedSearchName]
    );
    const transcriptCount = parseInt(transcriptCountResult.rows[0].count, 10);

    const patientStoriesCountResult = await pool.query(
      "SELECT COUNT(*) FROM analysis WHERE LOWER(video_type) = 'patient story' AND video_id IN (SELECT video_id FROM videos WHERE LOWER(search_name) = LOWER($1))",
      [normalizedSearchName]
    );
    const patientStoriesCount = parseInt(patientStoriesCountResult.rows[0].count, 10);

    const kolInterviewsCountResult = await pool.query(
      "SELECT COUNT(*) FROM analysis WHERE LOWER(video_type) = 'kol interview' AND video_id IN (SELECT video_id FROM videos WHERE LOWER(search_name) = LOWER($1))",
      [normalizedSearchName]
    );
    const kolInterviewsCount = parseInt(kolInterviewsCountResult.rows[0].count, 10);

    return res.json({
      type: "dashboardData",
      data: {
        videoCount,
        transcriptCount,
        patientStoriesCount,
        kolInterviewsCount,
        lastUpdated: lastUpdated.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error querying database:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// New endpoint to handle analysis by calling the video_analysis container's API
app.post("/api/analyze", async (req, res) => {
  const { contentType, contentUrl, therapeuticArea } = req.body;

  // Validate input
  if (!contentType || !contentUrl) {
    return res.status(400).json({ error: "Content type and URL are required" });
  }

  if (contentType === "web" && !therapeuticArea) {
    return res.status(400).json({ error: "Therapeutic area is required for web URL analysis" });
  }

  try {
    // Call the video_analysis container's API to run the script
    const response = await axios.post("http://app:4000/api/run-pipeline", {
      contentType,
      contentUrl,
      therapeuticArea, // Include therapeuticArea in the request
    });

    console.log("Video analysis API response:", response.data);

    // Return the response from the video_analysis container
    return res.json(response.data);
  } catch (error) {
    console.error("Error calling video analysis API:", error);
    return res.status(500).json({ error: "Failed to run analysis script", details: error.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Dashboard server running on port ${port}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing database connections");
  await pool.end();
  process.exit(0);
});