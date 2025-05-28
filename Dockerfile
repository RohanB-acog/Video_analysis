# Use Node.js 18 as the base image
FROM node:18

# Install curl for health checks
RUN apt-get update && apt-get install -y curl

# Install tsx globally
RUN npm install -g tsx

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install
RUN npm install express cheerio

# Copy the rest of the application code
COPY . .

# Ensure scripts are executable
RUN chmod +x run-video-pipeline.sh
RUN chmod +x run-pipeline-wrapper.sh

# Expose port 4000
EXPOSE 4000

# Command to start the server
CMD ["node", "server.js"]