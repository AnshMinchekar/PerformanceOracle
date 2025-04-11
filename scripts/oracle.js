process.env.TZ = "Europe/Berlin";
require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { uploadMetrics } = require("../scripts/uploader");

async function oracleFunction({ stopTime }) {
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

  const seenTransactions = new Set();
  const seenEvents = new Set();

  // Store transaction timestamps to calculate confirmation times
  const pendingTransactions = new Map();

  const stopTimestamp = new Date(stopTime).getTime();

  const filePath = path.join(__dirname, "../data/eventsData.json");

  ensureFileExists(filePath);

  console.log("Listening for transactions from multiple contracts...");

  // Track all pending transactions
  provider.on("pending", (txHash) => {
    if (!pendingTransactions.has(txHash)) {
      pendingTransactions.set(txHash, Date.now());
      console.log(`Pending transaction detected: ${txHash}`);
    }
  });

  provider.on("block", async (blockNumber) => {
    try {
      if (Date.now() >= stopTimestamp) {
        console.log("Stopping Oracle function.");
        provider.removeAllListeners("block");
        provider.removeAllListeners("pending");
        return;
      }

      console.log(`Scanning transactions in block number: ${blockNumber}`);
      const block = await provider.getBlockWithTransactions(blockNumber);
      const blockTimestampMs = block.timestamp * 1000;

      for (const tx of block.transactions) {
        for (const { address, abi, contractName } of contracts) {
          if (tx.to && tx.to.toLowerCase() === address) {
            const transactionHash = tx.hash;

            if (!seenTransactions.has(transactionHash)) {
              seenTransactions.add(transactionHash);
              const currentTxCount = counters.incrementTransactions();
              console.log(`New transaction detected (total: ${currentTxCount}): ${transactionHash}`);

              const receipt = await provider.getTransactionReceipt(transactionHash);
              if (!receipt) {
                console.log(`Transaction receipt not available yet for ${transactionHash}`);
                continue;
              }

              const blockTimestamp = new Date(
                (await provider.getBlock(receipt.blockNumber)).timestamp * 1000
              ).toISOString();

              // Calculate block confirmation time
              let confirmationTime = null;
              if (pendingTransactions.has(transactionHash)) {
                confirmationTime = Date.now() - pendingTransactions.get(transactionHash);
                pendingTransactions.delete(transactionHash); // Clean up
                console.log(`Transaction ${transactionHash} confirmed after ${confirmationTime} ms`);
              } else {
                // Fallback: Calculate confirmation time using block timestamp
                const currentTime = Date.now();
                confirmationTime = currentTime - blockTimestampMs;
                console.log(
                  `Using block timestamp for confirmation time: ${confirmationTime} ms for tx: ${transactionHash}`
                );
              }

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
                confirmationTime: confirmationTime,
                totalTransactions: counters.transactions,
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
              console.log(`Total Transactions: ${counters.transactions}, Total Events: ${counters.events}`);
              if (confirmationTime) {
                console.log(`Block Confirmation Time: ${confirmationTime} ms`);
              }

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
      console.error("Error reading or parsing eventsData.json:", error);
      existingData = [];
    }

    existingData.push(eventData);

    try {
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), "utf8");
      console.log(`Event data successfully written to ${filePath}`);
    } catch (error) {
      console.error("Error writing to eventsData.json:", error);
    }
  }
}

module.exports = { oracleFunction };
