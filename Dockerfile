FROM node:20-slim

WORKDIR /code

# Copy package files
COPY package*.json ./

# Install dependencies (adding dotenv)
RUN npm install express node-fetch cors dotenv

# Bundle app source
COPY . .

# Default environment variables if not provided at runtime
ENV PORT=7860
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]