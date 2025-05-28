#!/bin/bash
set -e # Exit on error

# Function to log messages with timestamp
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to validate YouTube URL and extract video ID
get_youtube_video_id() {
  local url=$1
  local video_id=""
  
  # Match various YouTube URL formats
  if [[ $url =~ (youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11}) ]]; then
    video_id=${BASH_REMATCH[2]}
  fi
  
  echo "$video_id"
}

# Check if required arguments are provided
if [ -z "$1" ]; then
  log "Error: Please provide a search_term, YouTube URL, or web URL."
  log "Usage: $0 <search_term|youtube_url> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] [--search-phrase <phrases>] [--web-url <webpage_url>]"
  log "       $0 <search_term> --web-url <webpage_url>"
  exit 1
fi

INPUT="$1"
shift  # Move past the first argument

# Parse additional arguments
START_DATE=""
END_DATE=""
SEARCH_PHRASE=""
WEB_URL=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --start-date) START_DATE="$2"; shift ;;
        --end-date) END_DATE="$2"; shift ;;
        --search-phrase) SEARCH_PHRASE="$2"; shift ;;
        --web-url) WEB_URL="$2"; shift ;;
        *) log "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

DB_NAME="video_analysis_db"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_HOST="postgres"
DB_PORT="5432"
OUTPUT_DIR="analysis_outputs"

# Ensure output directory exists
if [ ! -d "$OUTPUT_DIR" ]; then
  log "Creating output directory: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi

# Check if input is a YouTube URL
VIDEO_ID=$(get_youtube_video_id "$INPUT")
if [ -n "$VIDEO_ID" ]; then
  SEARCH_TERM="youtube_video_${VIDEO_ID}"
elif [ -n "$WEB_URL" ]; then
  SEARCH_TERM="${INPUT:-web_content}"
else
  SEARCH_TERM="$INPUT"
fi

# Define dynamic file names based on the search term
METADATA_FILE="$OUTPUT_DIR/${SEARCH_TERM}-metadata.json"
VIDEOIDS_FILE="$OUTPUT_DIR/${SEARCH_TERM}-videoids.json"
TRANSCRIPTS_FILE="$OUTPUT_DIR/${SEARCH_TERM}-transcripts.json"
ANALYSIS_FILE="$OUTPUT_DIR/${SEARCH_TERM}-analysis.json"
WEB_SCRAPE_FILE="$OUTPUT_DIR/${SEARCH_TERM}-webscrape.json"
WEB_ANALYSIS_FILE="$OUTPUT_DIR/${SEARCH_TERM}-web-analysis.json"

# Ensure postgres and app services are running
log "Starting PostgreSQL and app services..."
docker compose up -d postgres app

# Wait for PostgreSQL to be ready
log "Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" >/dev/null 2>&1; do
  log "PostgreSQL not ready yet, waiting..."
  sleep 2
done

# Function to check if search_term exists in SearchConfig and extract attributes
check_search_term() {
  log "Checking if '$SEARCH_TERM' exists in SearchConfig table..."
  RESULT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -v "search_term=$SEARCH_TERM" -c "SELECT param_id, user_id, search_phrase, search_name, creation_date FROM SearchConfig WHERE search_name = :search_term;" 2>/dev/null)

  if [ -n "$RESULT" ]; then
    log "Search term '$SEARCH_TERM' found in SearchConfig table:"
    echo "$RESULT" | while read -r line; do
      if [ -n "$line" ]; then
        log "  - $line"
      fi
    done
    VIDEO_COUNT=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -v "search_term=$SEARCH_TERM" -c "SELECT COUNT(*) FROM videos WHERE search_name = :search_term;" 2>/dev/null | tr -d ' ')
    log "Found $VIDEO_COUNT videos with search_name '$SEARCH_TERM' in videos table."
    return 0 # Exists
  else
    log "Search term '$SEARCH_TERM' not found in SearchConfig table."
    return 1 # Does not exist
  fi
}

# Function to check if video_id exists in videos table
check_video_id() {
  local video_id=$1
  log "Checking if video ID '$video_id' exists in videos table..."
  VIDEO_EXISTS=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -v "video_id=$video_id" -c "SELECT COUNT(*) FROM videos WHERE video_id = :video_id;" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$VIDEO_EXISTS" ]; then
    VIDEO_EXISTS=0
  fi
  if [ "$VIDEO_EXISTS" -gt 0 ]; then
    log "Video ID '$video_id' found in videos table."
    return 0 # Exists
  else
    log "Video ID '$video_id' not found in videos table."
    return 1 # Does not exist
  fi
}

# Function to run the YouTube pipeline
run_youtube_pipeline() {
  log "Running YouTube pipeline for '$SEARCH_TERM' from ${START_DATE:-'beginning'} to ${END_DATE:-'now'}..."

  # Initialize videoids.json if it doesn't exist
  if [ ! -f "$VIDEOIDS_FILE" ]; then
    log "Initializing $VIDEOIDS_FILE..."
    echo "[]" > "$VIDEOIDS_FILE"
  fi

  # Step 1: Fetch metadata and store in database incrementally
  log "Running youtube-fetcher.ts..."
  FETCHER_CMD="npx tsx bin/youtube-fetcher.ts --disease \"$SEARCH_TERM\" --output-file \"$METADATA_FILE\" --video-ids-file \"$VIDEOIDS_FILE\""
  if [ -n "$VIDEO_ID" ]; then
    FETCHER_CMD="npx tsx bin/youtube-fetcher.ts --video-id \"$VIDEO_ID\" --output-file \"$METADATA_FILE\" --video-ids-file \"$VIDEOIDS_FILE\""
  fi
  [ -n "$SEARCH_PHRASE" ] && FETCHER_CMD="$FETCHER_CMD --search-phrase \"$SEARCH_PHRASE\""
  [ -n "$START_DATE" ] && FETCHER_CMD="$FETCHER_CMD --start-date \"$START_DATE\""
  [ -n "$END_DATE" ] && FETCHER_CMD="$FETCHER_CMD --end-date \"$END_DATE\""
  
  set +e
  docker compose exec -T app bash -c "$FETCHER_CMD" </dev/null
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
    VIDEO_COUNT=$(docker compose exec -T app npx tsx bin/count-json-objects.ts "$METADATA_FILE" </dev/null | tr -d ' ')
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

  # Step 2: Fetch transcripts and store in database
  log "Running transcript-fetcher.ts..."
  set +e
  docker compose exec -T app npx tsx bin/transcript-fetcher.ts --input-file "$VIDEOIDS_FILE" --output-file "$TRANSCRIPTS_FILE" </dev/null
  TRANSCRIPT_EXIT_CODE=$?
  set -e
  if [ $TRANSCRIPT_EXIT_CODE -ne 0 ]; then
    log "transcript-fetcher.ts exited with code $TRANSCRIPT_EXIT_CODE"
    exit 1
  fi

  log "Storing transcripts in database..."
  set +e
  docker compose exec -T app npx tsx bin/database-manager.ts --transcripts-file "$TRANSCRIPTS_FILE" </dev/null
  DB_TRANSCRIPT_EXIT_CODE=$?
  set -e
  if [ $DB_TRANSCRIPT_EXIT_CODE -ne 0 ]; then
    log "database-manager.ts (transcripts) exited with code $DB_TRANSCRIPT_EXIT_CODE"
    exit 1
  fi

  # Step 3: Analyze transcripts and store in database
  log "Running llm-analyzer.ts..."
  set +e
  docker compose exec -T app npx tsx bin/llm-analyzer.ts --input-file "$TRANSCRIPTS_FILE" --output-file "$ANALYSIS_FILE" </dev/null
  ANALYZER_EXIT_CODE=$?
  set -e
  if [ $ANALYZER_EXIT_CODE -ne 0 ]; then
    log "llm-analyzer.ts exited with code $ANALYZER_EXIT_CODE"
    exit 1
  fi

  log "Storing analysis in database..."
  set +e
  docker compose exec -T app npx tsx bin/database-manager.ts --analysis-file "$ANALYSIS_FILE" </dev/null
  DB_ANALYSIS_EXIT_CODE=$?
  set -e
  if [ $DB_ANALYSIS_EXIT_CODE -ne 0 ]; then
    log "database-manager.ts (analysis) exited with code $DB_ANALYSIS_EXIT_CODE"
    exit 1
  fi

  log "YouTube pipeline completed. Results stored in database with search_name '$SEARCH_TERM'."
}

# Function to run the web scraping pipeline
run_web_pipeline() {
  log "Running web scraping pipeline for '$WEB_URL'..."

  # Step 1: Scrape webpage
  log "Running web-scraper.ts..."
  set +e
  docker compose exec -T app npx tsx bin/web-scraper.ts --url "$WEB_URL" --output-file "$WEB_SCRAPE_FILE" </dev/null
  SCRAPER_EXIT_CODE=$?
  set -e
  if [ $SCRAPER_EXIT_CODE -ne 0 ]; then
    log "web-scraper.ts exited with code $SCRAPER_EXIT_CODE"
    exit 1
  fi

  # Step 2: Analyze scraped content
  log "Running llm-analyzer.ts for web content..."
  set +e
  docker compose exec -T app npx tsx bin/llm-analyzer.ts --input-file "$WEB_SCRAPE_FILE" --output-file "$WEB_ANALYSIS_FILE" </dev/null
  WEB_ANALYZER_EXIT_CODE=$?
  set -e
  if [ $WEB_ANALYZER_EXIT_CODE -ne 0 ]; then
    log "llm-analyzer.ts (web) exited with code $WEB_ANALYZER_EXIT_CODE"
    exit 1
  fi

  log "Web scraping pipeline completed. Results stored in $WEB_ANALYSIS_FILE."
}

# Main logic
if [ -n "$WEB_URL" ]; then
  run_web_pipeline
elif [ -n "$VIDEO_ID" ]; then
  if check_video_id "$VIDEO_ID"; then
    log "Video ID '$VIDEO_ID' already exists in database, skipping pipeline."
  else
    log "Video ID '$VIDEO_ID' does not exist in database, running YouTube pipeline..."
    run_youtube_pipeline
  fi
else
  if check_search_term; then
    log "Search term '$SEARCH_TERM' exists in SearchConfig."
    if [ -n "$START_DATE" ] || [ -n "$END_DATE" ]; then
      log "Date range specified, running YouTube pipeline..."
      run_youtube_pipeline
    else
      log "No date range specified, checking for new videos..."
      run_youtube_pipeline
    fi
  else
    log "Search term '$SEARCH_TERM' does not exist in SearchConfig, running YouTube pipeline..."
    run_youtube_pipeline
  fi
fi

log "Script finished."
# Optional: Shut down
# docker compose down