FROM node:20-alpine

WORKDIR /app

# Copy package descriptors first to utilize docker cache
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy backend files and database configuration
COPY server/ ./server

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

# Start backend server
CMD ["node", "server/index.js"]
