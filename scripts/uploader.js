require('dotenv').config();
const fs = require('fs');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { QueryApi } = require('@influxdata/influxdb-client');

async function uploaderFunction({ stopTime }) {
    const influxDB = new InfluxDB({
        url: process.env.IDB_URL,
        token: process.env.IDB_TOKEN,
    });

    const bucket = process.env.IDB_BUCKET;
    const org = process.env.IDB_ORG;

    async function checkInfluxDBConnection() {
        const queryApi = influxDB.getQueryApi(org);
        const query = `buckets()`; 
    
        try {
            await queryApi.collectRows(query);
            console.log("InfluxDB Connection: Successful");
        } catch (error) {
            console.error("Failed to connect to InfluxDB:", error);
        }
    }
    checkInfluxDBConnection();

    const filePath = '../data/eventsData.json';
    let lastModifiedTime = null;

    console.log("Uploader Function started.");

    const stopTimestamp = new Date(stopTime).getTime();

    while (Date.now() < stopTimestamp) {
        try {
            if (fs.existsSync(filePath)) {
                const currentStats = fs.statSync(filePath);
                const currentModifiedTime = currentStats.mtime;

                if (!lastModifiedTime || currentModifiedTime > lastModifiedTime) {
                    lastModifiedTime = currentModifiedTime;
                    console.log("File updated. Proceeding to read and upload data...");

                    const jsonData = fs.readFileSync(filePath, 'utf8');
                    let metrics;

                    try {
                        metrics = JSON.parse(jsonData);
                    } catch (error) {
                        console.error("Error parsing JSON data:", error);
                        continue;
                    }

                    const writeApi = influxDB.getWriteApi(org, bucket);

                    for (const metric of metrics) {
                        console.log("Uploading metric:", metric);

                        const gasUsed = parseFloat(metric.gasUsed);
                        const gasUsedInUSD = parseFloat(metric.gasUsedInUSD);
                        const avgGasPrice = parseFloat(metric.gasPrice);
                        const avgGasPriceInUSD = parseFloat(metric.gasPriceInUSD);
                        const totalTransactions = parseInt(metric.totalTransactions);

                        if (
                            isNaN(gasUsed) ||
                            isNaN(avgGasPrice) ||
                            isNaN(gasUsedInUSD) ||
                            isNaN(avgGasPriceInUSD)
                        ) {
                            console.warn(`Invalid data for txHash ${metric.transactionHash}: Metrics contain invalid values.`);
                            continue;
                        }

                        const point = new Point('performance_metrics')
                            .tag('contract', metric.contract)
                            .tag('txHash', metric.transactionHash)
                            .tag('eventName', metric.eventName)
                            .timestamp(new Date(metric.blockTimestamp))
                            .floatField('gasUsed', gasUsed)
                            .floatField('gasUsedInUSD', gasUsedInUSD)
                            .floatField('avgGasPrice', avgGasPrice)
                            .floatField('avgGasPriceInUSD', avgGasPriceInUSD)
                            .intField('totalTransactions', totalTransactions)
                            .intField('eventsEmitted', metric.eventArgs ? Object.keys(metric.eventArgs).length : 0); 

                        writeApi.writePoint(point);
                    }

                    await writeApi.close();
                    console.log(`Successfully uploaded ${metrics.length} metrics to InfluxDB.`);
                }
            } 
        } catch (error) {
            console.error("Error while processing the file:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log("Uploader Function stopped.");
}

module.exports = { uploaderFunction };
