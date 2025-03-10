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
      address: process.env.CONTRACT_ORACLE_REGISTRY_ADDRESS,
      abi: loadABI(process.env.CONTRACT_ORACLE_REGISTRY),
    },
    {
      contractName: process.env.CONTRACT_DID_REGISTRY,
      address: process.env.CONTRACT_DID_REGISTRY_ADDRESS,
      abi: loadABI(process.env.CONTRACT_DID_REGISTRY),
    },
    {
      contractName: process.env.CONTRACT_ASSET_DNFT,
      address: process.env.CONTRACT_ASSET_DNFT_ADDRESS,
      abi: loadABI(process.env.CONTRACT_ASSET_DNFT),
    },
  ];

  contracts.forEach(({ abi, address }) => {
    if (!Array.isArray(abi)) {
      throw new Error(`Invalid ABI format for contract at address ${address}. Ensure it is an array.`);
    }
  });

  let totalTransactions = 0;

  const seenTransactions = new Set();
  const seenEvents = new Set();

  const stopTimestamp = new Date(stopTime).getTime();

  const filePath = path.join(__dirname, "../data/eventsData.json");

  ensureFileExists(filePath);

  console.log(`Listening for events from multiple contracts...`);

  for (const { contractName, address, abi } of contracts) {
    const contract = new ethers.Contract(address, abi, provider);

    console.log(`Listening to ${contractName} contract: ${address}`);

    contract.on("*", async (...args) => {
     const event = args[args.length - 1];
     const transactionHash = event.transactionHash;
     const eventIdentifier = `${transactionHash}-${event.event}`;
     if (!seenTransactions.has(transactionHash)) {
      seenTransactions.add(transactionHash);
      totalTransactions++; 
      }

    if (!seenEvents.has(eventIdentifier)) {
      seenEvents.add(eventIdentifier);

      const receipt = await provider.getTransactionReceipt(transactionHash);
      const block = await provider.getBlock(receipt.blockNumber);
      const blockTimestamp = new Date(block.timestamp * 1000).toISOString();

      const gasUsed = receipt.gasUsed.toString();
      const gasPrice = tx.gasPrice.toString();
      const gasUsedInETH = ethers.utils.formatEther(gasUsed);
      const gasPriceInETH = ethers.utils.formatEther(gasPrice);
      const gasUsedInUSD = parseFloat(gasUsedInETH) * convRate;
      const gasPriceInUSD = parseFloat(gasPriceInETH) * convRate;

      const eventDetails = {
        blockNumber: event.blockNumber,
        blockTimestamp,
        transactionHash,
        contract: address,
        eventName: event.event,
        eventArgs: event.args,
        gasUsed: gasUsedInETH,
        gasUsedInUSD,
        gasPrice: gasPriceInETH,
        gasPriceInUSD,
        totalTransactions,
      };

      console.log(`Event Detected from contract ${address}: ${event.event}`);
      console.log("Details:", eventDetails);

      await uploadMetrics(eventDetails); 

      await writeEventToFile(filePath, eventDetails);
    }

      if (Date.now() >= stopTimestamp) {
        console.log(`Stopping Oracle Function for contract ${address}...`);
        contract.removeAllListeners("*");
      }
    });
  }

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
