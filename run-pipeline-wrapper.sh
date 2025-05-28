#!/bin/bash

set -e

# Function to log messages with timestamp
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to extract YouTube video ID from a URL
get_youtube_video_id() {
  local url="$1"
  local video_id=""
  if [[ $url =~ (youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11}) ]]; then
    video_id="${BASH_REMATCH[2]}"
  fi
  echo "$video_id"
}

# Function to run the YouTube pipeline
run_youtube_pipeline() {
  log "Running YouTube video pipeline for video ID '$VIDEO_ID'..."

  # Clean up existing output files
  log "Cleaning up existing output files..."
  rm -f "$METADATA_FILE" "$VIDEOIDS_FILE" "$TRANSCRIPTS_FILE" "$ANALYSIS_FILE"

  # Initialize videoids.json if it doesn't exist
  if [ ! -f "$VIDEOIDS_FILE" ]; then
    log "Initializing $VIDEOIDS_FILE..."
    echo "[]" > "$VIDEOIDS_FILE"
  fi

  # Step 1: Fetch metadata
  log "Running youtube-fetcher.ts..."
  FETCHER_CMD="npx tsx bin/youtube-fetcher.ts --video-id \"$VIDEO_ID\" --output-file \"$METADATA_FILE\" --video-ids-file \"$VIDEOIDS_FILE\""
  [ -n "$SEARCH_PHRASE" ] && FETCHER_CMD="$FETCHER_CMD --search-phrase \"$SEARCH_PHRASE\""
  set +e
  eval "$FETCHER_CMD"
  FETCHER_EXIT_CODE=$?
  set -e
  if [ $FETCHER_EXIT_CODE -ne 0 ]; then
    log "youtube-fetcher.ts exited with code $FETCHER_EXIT_CODE (possibly due to quota limit)"
    log "Proceeding with videos fetched so far..."
  else
    log "youtube-fetcher.ts completed successfully."
  fi

  # Check if any videos were fetched
  if [ -s "$METADATA_FILE" ]; then
    VIDEO_COUNT=$(npx tsx bin/count-json-objects.ts "$METADATA_FILE" | tr -d ' ')
    if [ "$VIDEO_COUNT" -gt 0 ]; then
      log "Fetched $VIDEO_COUNT videos, proceeding to transcript fetching..."
    else
      log "No videos found in $METADATA_FILE, exiting pipeline."
      exit 1
    fi
  else
    log "No videos fetched, exiting pipeline."
    exit 1
  fi

  # Step 2: Fetch transcripts
  log "Running transcript-fetcher.ts..."
  set +e
  npx tsx bin/transcript-fetcher.ts --input-file "$VIDEOIDS_FILE" --output-file "$TRANSCRIPTS_FILE"
  TRANSCRIPT_EXIT_CODE=$?
  set -e
  if [ $TRANSCRIPT_EXIT_CODE -ne 0 ]; then
    log "Error: transcript-fetcher.ts failed with exit code $TRANSCRIPT_EXIT_CODE"
    exit $TRANSCRIPT_EXIT_CODE
  fi

  # Step 3: Analyze transcripts
  log "Running llm-analyzer.ts..."
  set +e
  npx tsx bin/llm-analyzer.ts --input-file "$TRANSCRIPTS_FILE" --output-file "$ANALYSIS_FILE"
  ANALYZER_EXIT_CODE=$?
  set -e
  if [ $ANALYZER_EXIT_CODE -ne 0 ]; then
    log "Error: llm-analyzer.ts failed with exit code $ANALYZER_EXIT_CODE"
    exit $ANALYZER_EXIT_CODE
  fi
}

# Function to run the web scraping pipeline
run_web_pipeline() {
  log "Running web scraping pipeline for '$WEB_URL'..."

  # Clean up existing output files
  log "Cleaning up existing output files..."
  rm -f "$WEB_SCRAPE_FILE" "$WEB_ANALYSIS_FILE"

  log "Running web-scraper.ts..."
  set +e
  npx tsx bin/web-scraper.ts --url "$WEB_URL" --output-file "$WEB_SCRAPE_FILE"
  SCRAPER_EXIT_CODE=$?
  set -e
  if [ $SCRAPER_EXIT_CODE -ne 0 ]; then
    log "Error: web-scraper.ts failed with exit code $SCRAPER_EXIT_CODE"
    exit $SCRAPER_EXIT_CODE
  fi

  log "Running llm-analyzer.ts for web content..."
  set +e
  npx tsx bin/llm-analyzer.ts --input-file "$WEB_SCRAPE_FILE" --output-file "$WEB_ANALYSIS_FILE"
  ANALYZER_EXIT_CODE=$?
  set -e
  if [ $ANALYZER_EXIT_CODE -ne 0 ]; then
    log "Error: llm-analyzer.ts failed with exit code $ANALYZER_EXIT_CODE"
    exit $ANALYZER_EXIT_CODE
  fi
}

# Function to run the search pipeline
run_search_pipeline() {
  log "Running search pipeline for '$SEARCH_TERM' from $START_DATE to $END_DATE..."

  # Clean up existing output files
  log "Cleaning up existing output files..."
  rm -f "$VIDEOIDS_FILE" "$METADATA_FILE" "$TRANSCRIPTS_FILE" "$ANALYSIS_FILE"

  log "Running youtube-searcher.ts..."
  set +e
  npx tsx bin/youtube-searcher.ts --search-term "$SEARCH_TERM" --start-date "$START_DATE" --end-date "$END_DATE" --output-file "$VIDEOIDS_FILE"
  SEARCHER_EXIT_CODE=$?
  set -e
  if [ $SEARCHER_EXIT_CODE -ne 0 ]; then
    log "Error: youtube-searcher.ts failed with exit code $SEARCHER_EXIT_CODE"
    exit $SEARCHER_EXIT_CODE
  fi

  log "Running youtube-fetcher.ts..."
  set +e
  FETCHER_CMD="npx tsx bin/youtube-fetcher.ts --input-file \"$VIDEOIDS_FILE\" --output-file \"$METADATA_FILE\""
  [ -n "$SEARCH_PHRASE" ] && FETCHER_CMD="$FETCHER_CMD --search-phrase \"$SEARCH_PHRASE\""
  eval "$FETCHER_CMD"
  DOWNLOADER_EXIT_CODE=$?
  set -e
  if [ $DOWNLOADER_EXIT_CODE -ne 0 ]; then
    log "Error: youtube-fetcher.ts failed with exit code $DOWNLOADER_EXIT_CODE"
    exit $DOWNLOADER_EXIT_CODE
  fi

  log "Running transcript-fetcher.ts..."
  set +e
  npx tsx bin/transcript-fetcher.ts --input-file "$VIDEOIDS_FILE" --output-file "$TRANSCRIPTS_FILE"
  TRANSCRIPTOR_EXIT_CODE=$?
  set -e
  if [ $TRANSCRIPTOR_EXIT_CODE -ne 0 ]; then
    log "Error: transcript-fetcher.ts failed with exit code $TRANSCRIPTOR_EXIT_CODE"
    exit $TRANSCRIPTOR_EXIT_CODE
  fi

  log "Running llm-analyzer.ts..."
  set +e
  npx tsx bin/llm-analyzer.ts --input-file "$TRANSCRIPTS_FILE" --output-file "$ANALYSIS_FILE"
  ANALYZER_EXIT_CODE=$?
  set -e
  if [ $ANALYZER_EXIT_CODE -ne 0 ]; then
    log "Error: llm-analyzer.ts failed with exit code $ANALYZER_EXIT_CODE"
    exit $ANALYZER_EXIT_CODE
  fi
}

# Main script logic
if [ -z "$1" ]; then
  echo "Usage: $0 <input> [--start-date <date>] [--end-date <date>] [--search-phrase <phrase>] [--web-url <url>]"
  exit 1
fi

# Parse the first argument as input type
INPUT="$1"
shift

# Parse optional arguments
START_DATE=""
END_DATE=""
SEARCH_PHRASE=""
WEB_URL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --start-date)
      START_DATE="$2"
      shift
      shift
      ;;
    --end-date)
      END_DATE="$2"
      shift
      shift
      ;;
    --search-phrase)
      SEARCH_PHRASE="$2"
      shift
      shift
      ;;
    --web-url)
      WEB_URL="$2"
      shift
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Set up output directory
OUTPUT_DIR="analysis_outputs"
if [ ! -d "$OUTPUT_DIR" ]; then
  mkdir -p "$OUTPUT_DIR"
fi

# Check if we're processing a YouTube video or web content
VIDEO_ID=$(get_youtube_video_id "$INPUT")
if [ -n "$VIDEO_ID" ]; then
  SEARCH_TERM="$VIDEO_ID"
else
  if [ -n "$WEB_URL" ]; then
    SEARCH_TERM="$INPUT"
  else
    SEARCH_TERM="$SEARCH_PHRASE"
  fi
fi

# Replace spaces with underscores for filenames
SEARCH_TERM=$(echo "$SEARCH_TERM" | tr ' ' '_')

# Define output file paths
METADATA_FILE="$OUTPUT_DIR/$SEARCH_TERM-metadata.json"
VIDEOIDS_FILE="$OUTPUT_DIR/$SEARCH_TERM-videoids.json"
TRANSCRIPTS_FILE="$OUTPUT_DIR/$SEARCH_TERM-transcripts.json"
ANALYSIS_FILE="$OUTPUT_DIR/$SEARCH_TERM-analysis.json"
WEB_SCRAPE_FILE="$OUTPUT_DIR/$SEARCH_TERM-webscrape.json"
WEB_ANALYSIS_FILE="$OUTPUT_DIR/$SEARCH_TERM-web-analysis.json"

# Run the appropriate pipeline
if [ -n "$VIDEO_ID" ]; then
  run_youtube_pipeline
elif [ -n "$WEB_URL" ]; then
  run_web_pipeline
else
  run_search_pipeline
fi

log "Analysis pipeline completed"