# Use an official Node.js runtime as a parent image
FROM node:19-alpine AS build

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to work directory
COPY package.json package-lock.json ./

# Install any dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Copy the .env file
COPY .env .env

# Build the application (if you have a build script in your package.json)
# RUN npm run build

# Use a minimal alpine image for the production environment
FROM alpine:3.19.0

# Install Node.js and npm
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Copy built node modules and binaries without including the rest of the app's source code
COPY --from=build /app .

# Ensure the artifacts directory is copied
COPY --from=build /app/src/blockchain/contracts/abis /app/src/blockchain/contracts/abis

# Your app binds to port 8080 so you'll use the EXPOSE instruction to have it mapped by the docker daemon
EXPOSE 8080

# Define the command to run your app using CMD which defines your runtime
CMD ["node", "main.js"]