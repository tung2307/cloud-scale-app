FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app code
COPY . .

# Build Next.js
RUN npm run build

EXPOSE 3000

# Start production server
CMD ["npm", "start"]