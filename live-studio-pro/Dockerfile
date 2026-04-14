# Base image with Node.js
FROM node:18-slim

# Install FFmpeg and essential libraries
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app source
COPY . .

# Ensure records and fonts directories exist
RUN mkdir -p public/records public/fonts

# Expose the studio port
EXPOSE 3000

# Start the studio
CMD [ "npm", "start" ]
