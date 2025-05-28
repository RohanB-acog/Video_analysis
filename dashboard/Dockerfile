# Use Node.js 18 as base image
FROM node:18

# Set working directory
WORKDIR /app

# Install tsx globally
RUN npm install -g tsx

# -------------------
# Install Server
# -------------------
WORKDIR /app/server

COPY dashboard/server/package*.json ./
RUN npm install

# -------------------
# Install Client
# -------------------
WORKDIR /app/client

COPY dashboard/client/package*.json ./
RUN npm install

# Copy full source code
COPY dashboard/server /app/server
COPY dashboard/client /app/client

# Build the client (assumes Vite)
RUN npm run build

# Copy built frontend to public dir in server
RUN mkdir -p /app/server/public && cp -r /app/client/dist/* /app/server/public/

# Set working directory back to server
WORKDIR /app/server

# Expose port
EXPOSE 3000

# Start the server
CMD ["tsx", "index.ts"]
