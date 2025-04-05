#!/bin/sh

# Run migrations
echo "Running database migrations..."
pnpm run db:migrate 

# Start the Python server in the background
echo "Starting Python services server..."
python app/\(chat\)/api/python/server.py &
PYTHON_PID=$!

# Wait a moment for the Python server to initialize
sleep 2

# Start the Next.js application
echo "Starting the Next.js application..."
pnpm dev

# When Next.js is terminated, also terminate the Python server
kill $PYTHON_PID
