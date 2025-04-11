process.env.TZ = "Europe/Berlin";
require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { uploadMetrics, initializeCounters } = require("../scripts/uploader");

async function oracleFunction({ stopTime, outputFileName }) {
  const rpcUrl = process.env.RPCUrl;
  const convRate = parseFloat(process.env.ConvRate);
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  function loadABI(contractName) {
    const abiPath = path.join(__dirname, "contracts", "abis", `${contractName}.json`);
    if (fs.existsSync(abiPath)) {
      const abiJson = fs.readFileSync(abiPath, "utf8");
      const abiObject = JSON.parse(abiJson);
      const abi = abiObject.abi;
      return abi;
    } else {
      throw new Error(`ABI file for ${contractName} not found at ${abiPath}`);
    }
  }

  const contracts = [
    {
      contractName: process.env.CONTRACT_ORACLE_REGISTRY,
      address: process.env.CONTRACT_ORACLE_REGISTRY_ADDRESS.toLowerCase(),
      abi: loadABI(process.env.CONTRACT_ORACLE_REGISTRY),
    },
    {
      contractName: process.env.CONTRACT_DID_REGISTRY,
      address: process.env.CONTRACT_DID_REGISTRY_ADDRESS.toLowerCase(),
      abi: loadABI(process.env.CONTRACT_DID_REGISTRY),
    },
    {
      contractName: process.env.CONTRACT_ASSET_DNFT,
      address: process.env.CONTRACT_ASSET_DNFT_ADDRESS.toLowerCase(),
      abi: loadABI(process.env.CONTRACT_ASSET_DNFT),
    },
  ];

  // Initialize counters with atomic operations to ensure thread safety
  const counters = {
    _transactions: 0,
    _events: 0,

    get transactions() {
      return this._transactions;
    },

    get events() {
      return this._events;
    },

    incrementTransactions() {
      return ++this._transactions;
    },

    incrementEvents() {
      return ++this._events;
    },
  };

  // Track transaction processing order and counts
  const processOrder = new Map();

  const seenTransactions = new Set();
  const seenEvents = new Set();

  const stopTimestamp = new Date(stopTime).getTime();

  const filePath = path.join(__dirname, "../data", outputFileName);

  ensureFileExists(filePath);

  // Initialize InfluxDB counters with zero values at the start of monitoring
  const startTime = new Date();
  console.log(`Initializing counters in InfluxDB at ${startTime.toISOString()}`);
  await initializeCounters(startTime);

  console.log("Listening for transactions from multiple contracts...");

  // Create a flag to track if monitoring should continue
  let shouldContinueMonitoring = true;

  provider.on("block", async (blockNumber) => {
    try {
      if (Date.now() >= stopTimestamp || !shouldContinueMonitoring) {
        console.log("Stopping Oracle function monitoring.");
        provider.removeAllListeners("block");
        return;
      }

      console.log(`Scanning transactions in block number: ${blockNumber}`);
      const block = await provider.getBlockWithTransactions(blockNumber);

      // First pass: detect all transactions in this block and record their sequential order
      for (const tx of block.transactions) {
        for (const { address, contractName } of contracts) {
          if (tx.to && tx.to.toLowerCase() === address) {
            const transactionHash = tx.hash;
            if (!processOrder.has(transactionHash)) {
              const currentTxCount = counters.incrementTransactions();
              processOrder.set(transactionHash, {
                count: currentTxCount,
                blockNumber,
              });
              console.log(`New transaction detected (total: ${currentTxCount}): ${transactionHash}`);
            }
          }
        }
      }

      // Second pass: process details for each transaction
      for (const tx of block.transactions) {
        for (const { address, abi, contractName } of contracts) {
          if (tx.to && tx.to.toLowerCase() === address) {
            const transactionHash = tx.hash;

            if (!seenTransactions.has(transactionHash)) {
              seenTransactions.add(transactionHash);

              // Get this transaction's sequence number from the processOrder map
              if (!processOrder.has(transactionHash)) {
                console.warn(`Warning: Transaction ${transactionHash} not found in processOrder map`);
                continue;
              }

              const txSequenceNumber = processOrder.get(transactionHash).count;
              console.log(`Processing transaction #${txSequenceNumber}: ${transactionHash}`);

              const receipt = await provider.getTransactionReceipt(transactionHash);
              if (!receipt) {
                console.log(`Transaction receipt not available yet for ${transactionHash}`);
                continue;
              }

              const blockTimestamp = new Date(
                (await provider.getBlock(receipt.blockNumber)).timestamp * 1000
              ).toISOString();

              const gasUsed = receipt.gasUsed.toString();
              const gasPrice = tx.gasPrice.toString();
              const gasUsedInETH = ethers.utils.formatEther(gasUsed);
              const gasPriceInETH = ethers.utils.formatEther(gasPrice);
              const gasUsedInUSD = parseFloat(gasUsedInETH) * convRate;
              const gasPriceInUSD = parseFloat(gasPriceInETH) * convRate;

              let eventDetails = {
                blockNumber: receipt.blockNumber,
                blockTimestamp,
                transactionHash,
                contract: address,
                eventName: "TransactionOnly",
                eventArgs: null,
                gasUsed: gasUsedInETH,
                gasUsedInUSD,
                gasPrice: gasPriceInETH,
                gasPriceInUSD,
                usedETHPriceUSD: convRate,
                totalTransactions: txSequenceNumber,
                totalEvents: counters.events,
              };

              if (receipt.logs && receipt.logs.length > 0) {
                try {
                  const contractInstance = new ethers.Contract(address, abi, provider);

                  for (const log of receipt.logs) {
                    try {
                      const parsedEvent = contractInstance.interface.parseLog(log);
                      if (!parsedEvent) continue;

                      const eventIdentifier = `${transactionHash}-${parsedEvent.name}`;

                      if (!seenEvents.has(eventIdentifier)) {
                        seenEvents.add(eventIdentifier);
                        const currentEventCount = counters.incrementEvents();
                        eventDetails.totalEvents = currentEventCount;

                        eventDetails.eventName = parsedEvent.name;
                        eventDetails.eventArgs = parsedEvent.args;

                        console.log(
                          `Event Detected: ${parsedEvent.name} from ${contractName} (total events: ${currentEventCount})`
                        );
                      }
                    } catch (error) {
                      console.debug(`Could not parse log: ${error.message}`);
                      continue;
                    }
                  }
                } catch (error) {
                  console.error(`Error processing logs for tx ${transactionHash}: ${error.message}`);
                }
              }

              console.log(`Transaction Processed: ${transactionHash}`);
              console.log(`Total Transactions: ${txSequenceNumber}, Total Events: ${eventDetails.totalEvents}`);

              await uploadMetrics(eventDetails);
              await writeEventToFile(filePath, eventDetails);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing block ${blockNumber}: ${error.message}`);
    }
  });

  function ensureFileExists(filePath) {
    // Make sure the directory exists
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      console.log(`Creating directory: ${dirPath}`);
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Create the file if it doesn't exist
    if (!fs.existsSync(filePath)) {
      console.log(`Creating file: ${filePath}`);
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  }

  async function writeEventToFile(filePath, eventData) {
    let existingData = [];

    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        existingData = JSON.parse(data);
      }
    } catch (error) {
      console.error("Error reading or parsing Events Data .json:", error);
      existingData = [];
    }

    existingData.push(eventData);

    try {
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), "utf8");
      console.log(`Event data successfully written to ${filePath}`);
    } catch (error) {
      console.error("Error writing to Events Data .json:", error);
    }
  }

  // Return cleanup function that will stop monitoring without exiting the process
  return function cleanup() {
    console.log("Oracle cleanup function called. Stopping monitoring...");
    shouldContinueMonitoring = false;
    provider.removeAllListeners("block");

    // Log final statistics
    console.log(`Oracle monitoring stopped. Data saved to ${filePath}`);
    console.log(`Final statistics: ${counters.transactions} transactions, ${counters.events} events processed`);
  };
}

module.exports = { oracleFunction };
