import express from 'express';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';

const app = express();
const port = 4000;

// Middleware to parse JSON bodies
app.use(express.json());

// Function to extract YouTube video ID from a URL
function getYouTubeVideoId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check endpoint called');
  res.status(200).json({ status: 'ok' });
});

// Endpoint to run the video pipeline script
app.post('/api/run-pipeline', async (req, res) => {
  console.log('Run pipeline endpoint called with body:', req.body);
  const { contentType, contentUrl, therapeuticArea } = req.body;

  // Validate input
  if (!contentType || !contentUrl) {
    console.error('Missing contentType or contentUrl in request body');
    return res.status(400).json({ error: 'Content type and URL are required' });
  }

  if (contentType === 'web' && !therapeuticArea) {
    console.error('Therapeutic area is required for web URL analysis');
    return res.status(400).json({ error: 'Therapeutic area is required for web URL analysis' });
  }

  // Determine the search term based on content type
  let searchTerm;
  if (contentType === 'youtube') {
    const videoId = getYouTubeVideoId(contentUrl);
    if (!videoId) {
      console.error('Invalid YouTube URL:', contentUrl);
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    searchTerm = videoId; // Use video ID as the search term
  } else {
    searchTerm = therapeuticArea.replace(/\s+/g, '_').toLowerCase();
  }

  // Check if the script exists
  const scriptPath = './run-pipeline-wrapper.sh';
  if (!existsSync(scriptPath)) {
    console.error('Script not found:', scriptPath);
    return res.status(500).json({ error: 'Script not found', details: 'run-pipeline-wrapper.sh is missing' });
  }

  // Construct the command arguments
  let scriptArgs;
  if (contentType === 'youtube') {
    scriptArgs = [contentUrl];
    if (therapeuticArea) {
      scriptArgs.push('--search-phrase', therapeuticArea);
    }
  } else {
    scriptArgs = [searchTerm, '--web-url', contentUrl];
  }

  console.log(`Executing command: ${scriptPath} ${scriptArgs.join(' ')}`);

  // Execute the script with streaming output
  const child = execFile(scriptPath, scriptArgs, { cwd: '/app', timeout: 300000 }); // Increased timeout to 5 minutes

  let stdout = '';
  let stderr = '';

  // Sanitize output to remove non-UTF-8 characters
  const sanitizeOutput = (data) => {
    // Convert Buffer to string, replacing invalid characters
    return data.toString('utf8', 'replace').replace(/[^\x20-\x7E\n\r\t]/g, '?');
  };

  // Function to process log messages
  const processLog = (data, isErrorStream) => {
    const sanitizedData = sanitizeOutput(data);
    const lines = sanitizedData.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      if (line.includes('[ERROR]') || line.includes('❌') || (isErrorStream && !line.includes('[INFO]'))) {
        console.error('Script error:', line);
        stderr += line + '\n';
      } else {
        console.log('Script output:', line);
        stdout += line + '\n';
      }
    });
  };

  // Stream stdout
  child.stdout.on('data', (data) => {
    processLog(data, false);
  });

  // Stream stderr
  child.stderr.on('data', (data) => {
    processLog(data, true);
  });

  // Handle script completion or error
  child.on('close', async (code, signal) => {
    console.log(`Script completed with code ${code}${signal ? ` (signal: ${signal})` : ''}`);

    // Define paths to the expected output files
    const analysisFile = path.join('analysis_outputs', `${searchTerm}-analysis.json`);
    const transcriptsFile = path.join('analysis_outputs', `${searchTerm}-transcripts.json`);
    const webAnalysisFile = path.join('analysis_outputs', `${searchTerm}-web-analysis.json`);
    const scrapeFile = path.join('analysis_outputs', `${searchTerm}-webscrape.json`);

    // Check if the output files exist
    let filesExist = false;
    if (contentType === 'web') {
      filesExist = existsSync(webAnalysisFile) && existsSync(scrapeFile);
      console.log(`Checking output files: webAnalysisFile exists=${existsSync(webAnalysisFile)}, scrapeFile exists=${existsSync(scrapeFile)}`);
    } else if (contentType === 'youtube') {
      filesExist = existsSync(analysisFile) && existsSync(transcriptsFile);
      console.log(`Checking output files: analysisFile exists=${existsSync(analysisFile)}, transcriptsFile exists=${existsSync(transcriptsFile)}`);
    }

    // If the script failed and the output files don't exist, return an error
    if ((code !== 0 || signal) && !filesExist) {
      const errorDetails = stderr || (signal ? `Terminated by signal ${signal}` : `Exited with code ${code}`);
      console.error(`Script execution failed: ${errorDetails}`);
      return res.status(500).json({ error: 'Script execution failed', details: errorDetails });
    }

    console.log(`Script execution treated as successful${signal ? ` despite ${signal}` : ''}`);

    try {
      if (contentType === 'youtube') {
        // For YouTube, read the analysis file
        let analysisData = [];
        try {
          const analysisContent = await readFile(analysisFile, 'utf8');
          analysisData = JSON.parse(analysisContent);
        } catch (error) {
          console.error('Error reading analysis file:', error);
          return res.status(500).json({ error: 'Failed to read analysis results', details: error.message });
        }

        // Read the transcripts file
        let transcripts = {};
        try {
          const transcriptContent = await readFile(transcriptsFile, 'utf8');
          transcripts = JSON.parse(transcriptContent);
        } catch (error) {
          console.error('Error reading transcripts file:', error);
          // Continue without transcripts if it fails
        }

        return res.json({
          status: 'success',
          message: 'Video analysis completed',
          analysis: analysisData,
          transcripts: transcripts,
        });
      } else {
        // For web content, read the analysis file
        let analysisData = [];
        try {
          const analysisContent = await readFile(webAnalysisFile, 'utf8');
          analysisData = JSON.parse(analysisContent);
        } catch (error) {
          console.error('Error reading analysis file:', error);
          return res.status(500).json({ error: 'Failed to read analysis results', details: error.message });
        }

        // Read the scraped metadata
        let metadata = {};
        try {
          const scrapeContent = await readFile(scrapeFile, 'utf8');
          const scrapeData = JSON.parse(scrapeContent);
          metadata = scrapeData[0] || {};
        } catch (error) {
          console.error('Error reading scrape file:', error);
          // Continue without metadata if it fails
        }

        return res.json({
          status: 'success',
          message: 'Web analysis completed',
          analysis: analysisData,
          metadata: metadata,
        });
      }
    } catch (error) {
      console.error('Error processing script output:', error);
      return res.status(500).json({ error: 'Failed to process script output', details: error.message });
    }
  });

  child.on('error', (error) => {
    console.error('Error running script:', error);
    return res.status(500).json({ error: 'Failed to run script', details: error.message });
  });
});

// Start the server with error handling
try {
  console.log('Starting server...');
  app.listen(port, () => {
    console.log(`Video analysis server running on port ${port}`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}