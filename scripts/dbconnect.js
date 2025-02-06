require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

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

module.exports = { influxDB, bucket, org, checkInfluxDBConnection };
