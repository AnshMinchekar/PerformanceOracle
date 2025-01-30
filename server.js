process.env.TZ = "Europe/Berlin";
console.log("=====================================");
console.log("Timezone set to:", process.env.TZ);
console.log("=====================================");

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");

const swaggerUi = require("swagger-ui-express");
const swaggerJsDoc = require("swagger-jsdoc");
const { oracleFunction } = require("./scripts/oracle");
const { uploaderFunction } = require("./scripts/uploader");
const gracefulShutdown = require("./utils/gracefulShutdown");
const rateLimiter = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");

require("dotenv-safe").config();

const app = express();

// Middleware
app.use(helmet());

// Define custom morgan format
morgan.token("route", (req) => req.originalUrl);
morgan.token("status", (req, res) => res.statusCode);
morgan.token("response-time", (req, res) => {
  const diff = process.hrtime(req._startAt);
  const time = diff[0] * 1e3 + diff[1] * 1e-6;
  return time.toFixed(3);
});

app.use(
  morgan(":method :route :status :response-time ms", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

app.use(express.json());
app.use(rateLimiter);
app.use(errorHandler);

let runningTasks = [];

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Performance Oracle API",
      version: "1.0.0",
      description: "API to schedule and monitor Oracle and Uploader functions",
    },
    servers: [
      {
        url: "http://0.0.0.0:10002",
      },
    ],
  },
  apis: ["./server.js"],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /run/schedule:
 *   post:
 *     summary: Schedule Oracle and Uploader functions to start and stop at specific times
 *     parameters:
 *       - name: startTime
 *         in: query
 *         required: true
 *         description: Start time in HH:mm format (24-hour clock)
 *         schema:
 *           type: string
 *       - name: endTime
 *         in: query
 *         required: true
 *         description: End time in HH:mm format (24-hour clock)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Functions scheduled successfully
 *       400:
 *         description: Invalid input or logical errors in time constraints
 */
app.post("/run/schedule", (req, res) => {
  const { startTime, endTime } = req.query;

  if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return res.status(400).send({ error: "Please provide valid startTime and endTime in HH:mm format." });
  }

  const now = new Date();
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  const startTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute).getTime();

  const endTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, endMinute).getTime();

  if (endTimestamp <= now.getTime()) {
    return res.status(400).send({ error: "End time must be in the future." });
  }
  if (startTimestamp >= endTimestamp) {
    return res.status(400).send({ error: "Start time must be earlier than end time." });
  }

  console.log(`Functions scheduled to start at ${startTime} and stop at ${endTime}.`);

  const startTask = setTimeout(async () => {
    console.log("Starting Oracle and Uploader functions...");
    try {
      await Promise.all([
        oracleFunction({ stopTime: new Date(endTimestamp).toISOString() }),
        uploaderFunction({ stopTime: new Date(endTimestamp).toISOString() }),
      ]);
      console.log("Both functions completed their execution.");
    } catch (error) {
      console.error("Error during function execution:", error);
    }
  }, startTimestamp - now.getTime());

  runningTasks.push(startTask);

  res.status(200).send({
    message: `Functions scheduled successfully. Start time: ${startTime}, End time: ${endTime}.`,
  });
});

/**
 * Stop all running tasks
 */
app.post("/stop/all", (req, res) => {
  runningTasks.forEach((task) => clearTimeout(task));
  runningTasks = [];
  console.log("All tasks stopped successfully.");
  res.status(200).send({ message: "All tasks stopped successfully." });
});

/**
 * @swagger
 * /shutdown:
 *   post:
 *     summary: Shut down the server and stop all running tasks.
 *     responses:
 *       200:
 *         description: Server is shutting down.
 */
app.post("/shutdown", (req, res) => {
  console.log("Shutting down server...");
  runningTasks.forEach((task) => clearTimeout(task));
  runningTasks = [];
  res.status(200).send({ message: "Server is shutting down." });

  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

const PORT = process.env.PORT || 10002;
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`SwaggerUI running at http://localhost:${PORT}/api-docs`);
});

process.on("SIGTERM", gracefulShutdown(server));
process.on("SIGINT", gracefulShutdown(server));
