require('dotenv').config();
require("@nomiclabs/hardhat-ethers");

module.exports = {
  solidity: "0.8.27",

  network:{
    RPCUrl: process.env.RPCUrl, 
    ChainId: process.env.ChainId 
},

};

