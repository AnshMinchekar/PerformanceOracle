const express = require('express');
const { exec } = require('child_process');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerConfig'); 
const app = express();
const PORT = process.env.PORT || 3000;

const runningProcesses = new Map(); 

/**
 * Start a script and return the child process.
 */
function runScript(scriptName) {
    return new Promise((resolve, reject) => {
        console.log(`Starting script: ${scriptName}...`);
        const child = exec(`npx hardhat run scripts/${scriptName}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[${scriptName}] Error:`, error.message);
                runningProcesses.delete(scriptName); 
                return reject(error.message);
            }
            runningProcesses.delete(scriptName); 
            resolve(stdout);
        });

        runningProcesses.set(scriptName, child);

        child.stdout.on('data', (data) => {
            console.log(`[${scriptName}] ${data.trim()}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`[${scriptName}] Error: ${data.trim()}`);
        });
    });
}

/**
 * Stop all running scripts.
 */
function stopAllScripts() {
    runningProcesses.forEach((_, scriptName) => {
        console.log(`Stopping script: ${scriptName}`);
        const process = runningProcesses.get(scriptName);
        if (process) {
            try {
                process.kill('SIGTERM');
                console.log(`Script ${scriptName} stopped successfully.`);
            } catch (error) {
                console.error(`Failed to stop script ${scriptName}:`, error);
            }
        }
    });
    runningProcesses.clear();
}


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get('/', (req, res) => {
    res.send('Performance Oracle API');
});

/**
 * @swagger
 * /run/schedule:
 *   post:
 *     summary: Schedule scripts to start and stop at specific times.
 *     parameters:
 *       - name: startTime
 *         in: query
 *         required: true
 *         description: Start time in HH:mm format (24-hour clock).
 *         schema:
 *           type: string
 *       - name: endTime
 *         in: query
 *         required: true
 *         description: End time in HH:mm format (24-hour clock).
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scripts scheduled successfully.
 *       400:
 *         description: Invalid input or logical errors in time constraints.
 */
app.post('/run/schedule', (req, res) => {
    const { startTime, endTime } = req.query;

    // Validate time format (HH:mm)
    if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).send({ error: 'Please provide valid startTime and endTime in HH:mm format.' });
    }

    const now = new Date();
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const startTimestamp = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        startHour,
        startMinute
    ).getTime();

    const endTimestamp = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        endHour,
        endMinute
    ).getTime();


    if (endTimestamp <= now.getTime()) {
        return res.status(400).send({ error: 'End time must be in the future.' });
    }
    if (startTimestamp >= endTimestamp) {
        return res.status(400).send({ error: 'Start time must be earlier than end time.' });
    }

    console.log(`Scripts scheduled to start at ${startTime} and stop at ${endTime}.`);

    // Schedule start of scripts
    setTimeout(() => {
        runScript('oracle.js')
            .then(() => console.log('Oracle script started.'))
            .catch((error) => console.error('Failed to start Oracle script:', error));

        runScript('uploader.js')
            .then(() => console.log('Uploader script started.'))
            .catch((error) => console.error('Failed to start Uploader script:', error));
    }, startTimestamp - now.getTime());

    // Schedule stopping the server
    setTimeout(() => {
        console.log('Shutting down the server...');
        stopAllScripts();
        process.exit(0); // Forcefully shut down the server
    }, endTimestamp - now.getTime());

    res.status(200).send({
        message: `Scripts scheduled successfully. Start time: ${startTime}, End time: ${endTime}.`,
    });
});

/**
 * @swagger
 * /stop/all:
 *   post:
 *     summary: Manually stop all running scripts.
 *     responses:
 *       200:
 *         description: All scripts stopped successfully.
 *       500:
 *         description: Failed to stop scripts.
 */
app.post('/stop/all', (req, res) => {
    stopAllScripts();
    res.status(200).send({ message: 'All running scripts stopped successfully.' });
});

/**
 * @swagger
 * /shutdown:
 *   post:
 *     summary: Shut down the server and stop all running scripts.
 *     responses:
 *       200:
 *         description: Server is shutting down.
 */
app.post('/shutdown', (req, res) => {
    console.log('Shutting down server...');
    stopAllScripts();
    res.status(200).send({ message: 'Server is shutting down.' });

    setTimeout(() => {
        process.exit(0); 
    }, 1000);
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SwaggerUI running at http://localhost:${PORT}/api-docs`);
});
