const express = require('express');
const { exec } = require('child_process');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swaggerConfig');
const app = express();
const PORT = process.env.PORT || 3000;

const runningProcesses = new Map(); 
const scriptsToRun = ['oracle.js', 'uploader.js']; 


function runScript(scriptName) {
    return new Promise((resolve, reject) => {
        console.log(`Starting script: ${scriptName}...`);
        const child = exec(`npx hardhat run scripts/${scriptName}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[${scriptName}] Error:`, error.message);
                runningProcesses.delete(scriptName); // Remove from tracking on error
                return reject(error.message);
            }
            runningProcesses.delete(scriptName); // Remove when completed
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


function stopScript(scriptName) {
    const process = runningProcesses.get(scriptName);

    if (!process) {
        console.error(`Script ${scriptName} is not running.`);
        return false;
    }

    try {
        process.kill('SIGTERM'); // Send termination signal
        runningProcesses.delete(scriptName); // Remove from tracking
        console.log(`Script ${scriptName} stopped successfully.`);
        return true;
    } catch (error) {
        console.error(`Failed to stop script ${scriptName}:`, error);
        return false;
    }
}

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get('/', (req, res) => {
    res.send('Performance Oracle API');
});

/**
 * @swagger
 * /run/until:
 *   post:
 *     summary: Automatically run predefined scripts and stop them at a specific time.
 *     parameters:
 *       - name: endTime
 *         in: query
 *         required: true
 *         description: The time (in HH:mm format, 24-hour clock) when the scripts should stop.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scripts started successfully and will stop at the specified time.
 *       400:
 *         description: Invalid input.
 */
app.post('/run/until', (req, res) => {
    const { endTime } = req.query;

    if (!endTime || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).send({ error: 'Enter end time in HH:mm format.' });
    }

    const [endHour, endMinute] = endTime.split(':').map(Number);
    const now = new Date();
    const endTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, endMinute).getTime();

    if (endTimestamp <= now.getTime()) {
        return res.status(400).send({ error: 'Invalid. End time needs to be in the future' });
    }

 
    scriptsToRun.forEach((scriptName) => {
        runScript(scriptName)
            .then(() => {
                console.log(`Script ${scriptName} started successfully.`);
            })
            .catch((error) => {
                console.error(`Failed to start script ${scriptName}:`, error);
            });
    });


    setTimeout(() => {
        scriptsToRun.forEach((scriptName) => {
            const stopped = stopScript(scriptName);
            if (stopped) {
                console.log(`Script ${scriptName} stopped automatically at the specified time.`);
            }
        });
    }, endTimestamp - now.getTime());

    res.status(200).send({
        message: `Scripts started successfully and will stop at ${endTime}.`,
        scripts: scriptsToRun,
    });
});

/**
 * @swagger
 * /stop/all:
 *   post:
 *     summary: Stop all running predefined scripts manually.
 *     responses:
 *       200:
 *         description: All scripts stopped successfully.
 */
app.post('/stop/all', (req, res) => {
    const stoppedScripts = [];
    runningProcesses.forEach((_, scriptName) => {
        const stopped = stopScript(scriptName);
        if (stopped) {
            stoppedScripts.push(scriptName);
        }
    });

    if (stoppedScripts.length === 0) {
        return res.status(404).send({ error: 'No scripts were running.' });
    }

    res.status(200).send({ message: 'All scripts stopped successfully.', scripts: stoppedScripts });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SwaggerUI running at http://localhost:${PORT}/api-docs`);
});
