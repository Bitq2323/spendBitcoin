const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');
const network = bitcoin.networks.mainnet;

async function getUTXOs(address) {
    try {
        const response = await axios.get(`https://mempool.space/api/address/${address}/utxo`);
        return response.data;
    } catch (error) {
        console.error('Error fetching UTXOs:', error.message);
        return [];
    }
}

function getAddressScript(address) {
    if (address.startsWith('bc1')) {
        // BIP84, P2WPKH, Bech32
        return bitcoin.payments.p2wpkh({ address: address, network: network }).output;
    } else if (address.startsWith('3')) {
        // BIP49, P2SH-P2WPKH, Base58
        return bitcoin.payments.p2sh({ address: address, network: network }).output;
    } else {
        // BIP44, P2PKH, Base58
        return bitcoin.payments.p2pkh({ address: address, network: network }).output;
    }
}

async function fetchTransaction(txid) {
    try {
        const response = await axios.get(`https://mempool.space/api/tx/${txid}/hex`);
        return { data: response.data };
    } catch (error) {
        console.error(`Error fetchTransaction for address:`, error.response.data);
        return { error: error.toString(), status: 500 };
    }
}

async function broadcastTransaction(transactionHex) {
    try {
        const response = await axios.post('https://mempool.space/api/tx', transactionHex, {
            headers: { 'Content-Type': 'text/plain' },
        });
        return { data: response.data };
    } catch (error) {
        console.error(`Error broadcast transaction for address `, error.response.data);
        return { error: error.toString(), status: 500 };
    }
}

module.exports = {
    getUTXOs,
    getAddressScript,
    fetchTransaction,
    broadcastTransaction
};