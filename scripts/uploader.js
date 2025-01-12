require('dotenv').config();
const fs = require('fs');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

//InfluxDB client instance
const influxDB = new InfluxDB({
    url: process.env.IDB_URL,
    token: process.env.IDB_TOKEN,
});

//Initializing bucket
const bucket = process.env.IDB_BUCKET;
const org = process.env.IDB_ORG;

async function uploadDataToInfluxDB() {
    const filePath = 'performanceMetrics.json';
    let lastModifiedTime = null;

    console.log("Monitoring for updates to JSON File.");

    // Polling mechanism for updates to the json file.
    setInterval(async () => {
        try {
            if (fs.existsSync(filePath)) {
                const currentStats = fs.statSync(filePath);
                const currentModifiedTime = currentStats.mtime;

                // Check if the file has been modified
                if (!lastModifiedTime || currentModifiedTime > lastModifiedTime) {
                    lastModifiedTime = currentModifiedTime; //Update the last modified time
                    console.log("File updated. Proceeding to read and upload data...");

                    // Read the performance metrics from the JSON file
                    const jsonData = fs.readFileSync(filePath, 'utf8');
                    let metrics;

                    try {
                        metrics = JSON.parse(jsonData);
                    } catch (error) {
                        console.error("Error parsing JSON data:", error);
                        return; // Exit if JSON parsing fails
                    }

                    // Creating a write API instance
                    const writeApi = influxDB.getWriteApi(org, bucket);

                    metrics.forEach(metric => {
                        //Logging Metrics
                        console.log("Uploading metric:", metric);

                        const gasUsed = parseFloat(metric.gasUsed);
                        const gasUsedInUSD = parseFloat(metric.gasUsedInUSD);
                        const avgGasPrice = parseFloat(metric.avgGasPrice);
                        const avgGasPriceInUSD = parseFloat(metric.avgGasPriceInUSD);
                        const totalTransactions = parseInt(metric.totalTransactions);
                        const eventsEmitted = parseInt(metric.eventsEmitted);

                        //Checking for NaN Values
                        if (
                            isNaN(gasUsed) ||
                            isNaN(avgGasPrice) ||
                            isNaN(gasUsedInUSD) ||
                            isNaN(avgGasPriceInUSD)
                        ) {
                            console.warn(`Invalid data for txHash ${metric.txHash}: Metrics contain invalid values.`);
                            return; 
                        }

                        const point = new Point('performance_metrics')
                            .tag('contract', metric.contract)  // Using the contract as a tag
                            .tag('txHash', metric.txHash)      // Using the txHash as a tag
                            .timestamp(new Date(metric.timestamp)) // Include timestamp
                            .floatField('gasUsed', gasUsed)  // Store gas used as a float field
                            .floatField('gasUsedInUSD', gasUsedInUSD) // Store gas used in USD
                            .floatField('avgGasPrice', avgGasPrice) // Store avg gas price as a float field
                            .floatField('avgGasPriceInUSD', avgGasPriceInUSD) // Store avg gas price in USD
                            .intField('totalTransactions', totalTransactions) // Store total txns as an int field
                            .intField('eventsEmitted', eventsEmitted); // Store events emitted as an int field

                        writeApi.writePoint(point);
                    });

                    // Flush the write API
                    await writeApi.close();
                    console.log(`Successfully uploaded ${metrics.length} metrics to InfluxDB.`);
                }
            } else {
                console.log("Waiting for performanceMetrics.json to be created...");
            }
        } catch (error) {
            console.error("Error while processing the file:", error);
        }
    }, 5000); // Polling every 5 seconds
}

uploadDataToInfluxDB();