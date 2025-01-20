require('dotenv').config();

async function oracleFunction({ stopTime }) {
    const { ethers } = require("hardhat");
    const fs = require("fs");

    const contracts = [
        { address: process.env.conAdd_1 },
        { address: process.env.conAdd_2 },
    ];
    const rpcUrl = process.env.RPCUrl;
    const convRate = process.env.ConvRate;
    const batchSize = 10;

    let totalTransactions = 0;
    let transactionBatch = [];
    const ethToUsdRate = parseFloat(convRate);
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const contractMetrics = contracts.reduce((acc, contract) => {
        acc[contract.address] = {
            totalGasPrice: ethers.BigNumber.from(0),
            txCount: 0,
            eventCount: 0,
        };
        return acc;
    }, {});

    console.log(`Tracking performance metrics for contracts: ${contracts.map(c => c.address).join(", ")}`);
    const stopTimestamp = new Date(stopTime).getTime();

    provider.on("block", async (blockNumber) => {
        if (Date.now() >= stopTimestamp) {
            console.log("Stopping Oracle Function...");
            provider.removeAllListeners("block");
            return;
        }

        console.log(`Processing block number: ${blockNumber}`);
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
                            const gasPrice = tx.gasPrice || ethers.BigNumber.from(0);

                            const gasUsedInETH = ethers.utils.formatEther(gasUsed);
                            const gasPriceInETH = ethers.utils.formatEther(gasPrice);

                            const gasUsedInUSD = (parseFloat(gasUsedInETH) * ethToUsdRate);
                            const gasPriceInUSD = (parseFloat(gasPriceInETH) * ethToUsdRate);

                            contractMetrics[address].txCount++;
                            contractMetrics[address].eventCount += txReceipt.logs.length;

                            totalTransactions++;

                            const transactionData = {
                                timestamp: new Date(block.timestamp * 1000).toISOString(),
                                contract: address,
                                txHash,
                                gasUsed: gasUsedInETH,
                                gasUsedInUSD,
                                avgGasPrice: gasPriceInETH,
                                avgGasPriceInUSD: gasPriceInUSD,
                                contractTxCount: contractMetrics[address].txCount,
                                totalTransactions,
                                eventsEmitted: contractMetrics[address].eventCount,
                            };

                            transactionBatch.push(transactionData);

                            if (transactionBatch.length >= batchSize) {
                                await writeBatchToFile(transactionBatch);
                                transactionBatch = [];
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Error processing transaction:", error);
            }
        });

        await Promise.all(txPromises);

        console.log(`Total Transactions: ${totalTransactions}`);
    });

    async function writeBatchToFile(batch) {
        let existingData = [];
        if (fs.existsSync("performanceMetrics.json")) {
            const data = fs.readFileSync("performanceMetrics.json", "utf8");
            try {
                existingData = JSON.parse(data);
            } catch (error) {
                console.error("Error parsing the data:", error);
            }
        }

        existingData = existingData.concat(batch);

        fs.writeFileSync("performanceMetrics.json", JSON.stringify(existingData, null, 2), "utf8");
    }
}

module.exports = { oracleFunction };
