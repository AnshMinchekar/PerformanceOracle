require('dotenv').config();
const { ethers } = require("hardhat");
const fs = require("fs");

let totalTransactions = 0;
let lastLoggedTxnCount = 0;
let transactionBatch = []; 
let timer;

const ethToUsdRate = parseFloat(process.env.ConvRate); 

async function trackData(contracts) {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPCUrl);

    const contractMetrics = contracts.reduce((acc, contract) => {
        acc[contract.address] = {
            totalGasPrice: ethers.BigNumber.from(0),
            txCount: 0,
            eventCount: 0,
        };
        return acc;
    }, {});

    console.log(`Tracking performance metrics for contracts: ${contracts.map(c => c.address).join(", ")}`);
    timer = Date.now();

    provider.on("block", async (blockNumber) => {
        const block = await provider.getBlock(blockNumber);
        const transactions = block.transactions;

        const txPromises = transactions.map(async (txHash) => {
            try {
                const tx = await provider.getTransaction(txHash);
                for (const contract of contracts) {
                    const { address } = contract;

                    if (tx.to && tx.to === address) {
                        const txReceipt = await provider.getTransactionReceipt(txHash);

                        if (txReceipt && txReceipt.gasUsed) {
                            const gasUsed = txReceipt.gasUsed;
                            const gasPrice = tx.gasPrice ? tx.gasPrice : ethers.BigNumber.from(0);

                            //gas pricing
                            const gasUsedInETH = ethers.utils.formatEther(gasUsed);
                            const gasPriceInETH = ethers.utils.formatEther(gasPrice);

                            //gas price in USD
                            const gasUsedInUSD = (parseFloat(gasUsedInETH) * ethToUsdRate);
                            const gasPriceInUSD = (parseFloat(gasPriceInETH) * ethToUsdRate);

                            // Update contract metrics
                            contractMetrics[address].txCount++;
                            contractMetrics[address].eventCount += txReceipt.logs.length;

                            totalTransactions++;

                            // Create a txn object with all the metrics
                            const transactionData = {
                                timestamp: new Date(block.timestamp * 1000).toISOString(),
                                contract: address,
                                txHash,
                                gasUsed: gasUsedInETH, // Store gas in ETH
                                gasUsedInUSD, // Store gas in USD
                                avgGasPrice: gasPriceInETH, // Store gas price in ETH
                                avgGasPriceInUSD: gasPriceInUSD, // Store gas price in USD
                                contractTxCount: contractMetrics[address].txCount, //transaction count per contract
                                totalTransactions, //total transactions count
                                eventsEmitted: contractMetrics[address].eventCount,
                            };

                            transactionBatch.push(transactionData); // Add to batch

                            // If the batch reaches a certain size, write to file
                            if (transactionBatch.length >= 10) { // Every 10 transactions
                                await writeBatchToFile(transactionBatch);
                                transactionBatch = []; //batch wipe
                            }
                        } else {
                            console.error(`Missing Transaction Receipt: ${txHash}`);
                        }
                    }
                }
            } catch (error) {
                console.error("Error fetching transaction metrics:", error);
            }
        });

        await Promise.all(txPromises);

        // Logging
        if (totalTransactions > lastLoggedTxnCount) {
            const timePassed = (Date.now() - timer) / 1000; //Time calculated from when the script starts running
            const TPS = totalTransactions / timePassed; 

            console.log(`Total Transactions: ${totalTransactions}`);
            console.log(`TPS: ${TPS.toFixed(3)}`);
            lastLoggedTxnCount = totalTransactions;
            console.log('--------------------------------------');
        }
    });
}

async function writeBatchToFile(batch) {
    //Reading data from the existing file
    let existingData = [];
    if (fs.existsSync("performanceMetrics.json")) {
        const data = fs.readFileSync("performanceMetrics.json", "utf8");
        try {
            existingData = JSON.parse(data);
        } catch (error) {
            console.error("Error parsing the data:", error);
        }
    }

    //Append new batch to existing data
    existingData = existingData.concat(batch);

    //Write updated data back to the file
    fs.writeFileSync("performanceMetrics.json", JSON.stringify(existingData, null, 2), "utf8");
}

async function main() {
    try {
        const contracts = [
            { address: process.env.conAdd_1 },
            { address: process.env.conAdd_2 },
        ];

        console.log("Start performance tracking...");
        await trackData(contracts);

        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error("Error running the main function:", error);
    }
}

main().catch((error) => {
    console.error("Error:", error);
});