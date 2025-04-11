require("dotenv").config();
const { Point } = require("@influxdata/influxdb-client");
const { influxDB, bucket, org } = require("./dbconnect");

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

    if (isNaN(gasUsed) || isNaN(avgGasPrice) || isNaN(gasUsedInUSD) || isNaN(avgGasPriceInUSD)) {
      console.warn(`Invalid data for txHash ${eventDetails.transactionHash}: Metrics contain invalid values.`);
      return;
    }

    // Main measurement point with all transaction details
    const point = new Point("oracle_performance_metrics")
      .tag("contract", eventDetails.contract)
      .tag("txHash", eventDetails.transactionHash)
      .tag("eventName", eventDetails.eventName)
      .timestamp(new Date(eventDetails.blockTimestamp))
      .floatField("gasUsed", gasUsed)
      .floatField("gasUsedInUSD", gasUsedInUSD)
      .floatField("avgGasPrice", avgGasPrice)
      .floatField("avgGasPriceInUSD", avgGasPriceInUSD)
      .floatField("usedETHPriceUSD", eventDetails.usedETHPriceUSD)
      .intField("Block Number", eventDetails.blockNumber)
      .intField("totalEvents", totalEvents)
      .intField("totalTransactions", totalTransactions);

    // Dedicated point for total transactions count (for single stat)
    const txCountPoint = new Point("total_transactions")
      .tag("metric_type", "counter")
      .timestamp(new Date())
      .intField("count", totalTransactions);

    // Dedicated point for total events count (for single stat)
    const eventCountPoint = new Point("total_events")
      .tag("metric_type", "counter")
      .timestamp(new Date())
      .intField("count", totalEvents);

    writeApi.writePoint(point);
    writeApi.writePoint(txCountPoint);
    writeApi.writePoint(eventCountPoint);

    await writeApi.close();
    console.log("Successfully uploaded transaction metrics to InfluxDB.");
  } catch (error) {
    console.error("Error uploading transaction metrics to InfluxDB:", error);
  }
}

module.exports = { uploadMetrics };
