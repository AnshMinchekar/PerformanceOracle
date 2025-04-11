require("dotenv").config();
const { Point } = require("@influxdata/influxdb-client");
const { influxDB, bucket, org } = require("./dbconnect");

// Add a new function to initialize counters at the start of testing
async function initializeCounters(startTimestamp = new Date()) {
  try {
    const writeApi = influxDB.getWriteApi(org, bucket);
    console.log("Initializing counters in InfluxDB with zero values...");

    const timestamp = new Date(startTimestamp);

    // Initialize transaction counter with zero
    const txCounterPoint = new Point("transaction_counter")
      .tag("type", "cumulative")
      .tag("status", "initialized")
      .timestamp(timestamp)
      .intField("value", 0);

    // Initialize event counter with zero
    const eventCounterPoint = new Point("event_counter")
      .tag("type", "cumulative")
      .tag("status", "initialized")
      .timestamp(timestamp)
      .intField("value", 0);

    // Write initialization points
    writeApi.writePoint(txCounterPoint);
    writeApi.writePoint(eventCounterPoint);

    await writeApi.close();
    console.log("Successfully initialized counter metrics in InfluxDB with zero values");
  } catch (error) {
    console.error("Error initializing counters in InfluxDB:", error);
  }
}

async function uploadMetrics(eventDetails) {
  try {
    const writeApi = influxDB.getWriteApi(org, bucket);

    console.log("Uploading metric to InfluxDB.");

    const gasUsed = parseFloat(eventDetails.gasUsed);
    const gasUsedInUSD = parseFloat(eventDetails.gasUsedInUSD);
    const avgGasPrice = parseFloat(eventDetails.gasPrice);
    const avgGasPriceInUSD = parseFloat(eventDetails.gasPriceInUSD);
    const totalTransactions = parseInt(eventDetails.totalTransactions);
    const totalEvents = parseInt(eventDetails.totalEvents);
    const timestamp = new Date(eventDetails.blockTimestamp);

    if (isNaN(gasUsed) || isNaN(avgGasPrice) || isNaN(gasUsedInUSD) || isNaN(avgGasPriceInUSD)) {
      console.warn(`Invalid data for txHash ${eventDetails.transactionHash}: Metrics contain invalid values.`);
      return;
    }

    // Main point with all transaction details
    const point = new Point("oracle_performance_metrics")
      .tag("contract", eventDetails.contract)
      .tag("txHash", eventDetails.transactionHash)
      .tag("eventName", eventDetails.eventName)
      .timestamp(timestamp)
      .floatField("gasUsed", gasUsed)
      .floatField("gasUsedInUSD", gasUsedInUSD)
      .floatField("avgGasPrice", avgGasPrice)
      .floatField("avgGasPriceInUSD", avgGasPriceInUSD)
      .floatField("usedETHPriceUSD", eventDetails.usedETHPriceUSD)
      .intField("Block Number", eventDetails.blockNumber)
      .intField("totalEvents", totalEvents)
      .intField("totalTransactions", totalTransactions);

    // Transaction counter time series point - using the exact same timestamp as the event
    const txCounterPoint = new Point("transaction_counter")
      .tag("type", "cumulative")
      .timestamp(timestamp)
      .intField("value", totalTransactions);

    // Event counter time series point - using the exact same timestamp as the event
    const eventCounterPoint = new Point("event_counter")
      .tag("type", "cumulative")
      .timestamp(timestamp)
      .intField("value", totalEvents);

    // Write all points
    writeApi.writePoint(point);
    writeApi.writePoint(txCounterPoint);
    writeApi.writePoint(eventCounterPoint);

    await writeApi.close();
    console.log(
      `Successfully uploaded metrics to InfluxDB. Transactions: ${totalTransactions}, Events: ${totalEvents}`
    );
  } catch (error) {
    console.error("Error uploading transaction metrics to InfluxDB:", error);
  }
}

module.exports = { uploadMetrics, initializeCounters };
