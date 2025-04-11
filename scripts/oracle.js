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

  let totalTransactions = 0;
  let totalEvents = 0;

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
    }
  });

  provider.on("block", async (blockNumber) => {
    if (Date.now() >= stopTimestamp) {
      console.log("Stopping Oracle function.");
      provider.removeAllListeners("block");
      provider.removeAllListeners("pending");
      return;
    }

    console.log(`Scanning transactions in block number: ${blockNumber}`);
    const block = await provider.getBlockWithTransactions(blockNumber);

    for (const tx of block.transactions) {
      for (const { address, abi, contractName } of contracts) {
        if (tx.to && tx.to.toLowerCase() === address) {
          const transactionHash = tx.hash;

          if (!seenTransactions.has(tx.hash)) {
            seenTransactions.add(tx.hash);
            totalTransactions++;

            const receipt = await provider.getTransactionReceipt(transactionHash);
            const blockTimestamp = new Date(
              (await provider.getBlock(receipt.blockNumber)).timestamp * 1000
            ).toISOString();

            // Calculate block confirmation time
            let confirmationTime = null;
            if (pendingTransactions.has(transactionHash)) {
              confirmationTime = Date.now() - pendingTransactions.get(transactionHash);
              pendingTransactions.delete(transactionHash); // Clean up
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
              confirmationTime: confirmationTime, // Add confirmation time to metrics
              // Record the current state of the counters when this specific event is processed
              totalTransactions: totalTransactions,
              totalEvents: totalEvents, // This will be updated if events are found
            };

            if (receipt.logs.length > 0) {
              const contractInstance = new ethers.Contract(address, abi, provider);

              for (const log of receipt.logs) {
                try {
                  const parsedEvent = contractInstance.interface.parseLog(log);
                  const eventIdentifier = `${transactionHash}-${parsedEvent.name}`;

                  if (!seenEvents.has(eventIdentifier)) {
                    seenEvents.add(eventIdentifier);
                    totalEvents++;
                    eventDetails.totalEvents = totalEvents;

                    eventDetails.eventName = parsedEvent.name;
                    eventDetails.eventArgs = parsedEvent.args;

                    console.log(`Event Detected: ${parsedEvent.name} from ${contractName}`);
                  }
                } catch (error) {
                  continue;
                }
              }
            }

            console.log(`Transaction Processed: ${transactionHash}`);
            console.log(`Total Transactions: ${totalTransactions}, Total Events: ${totalEvents}`);
            if (confirmationTime) {
              console.log(`Block Confirmation Time: ${confirmationTime} ms`);
            }

            await uploadMetrics(eventDetails);
            await writeEventToFile(filePath, eventDetails);
          }
        }
      }
    }
  });

  function ensureFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
      console.log(`Creating file in existing 'data' directory: ${filePath}`);
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
