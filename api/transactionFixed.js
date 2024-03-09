const bitcoin = require('bitcoinjs-lib');
const helpers = require('./helper');

const network = bitcoin.networks.mainnet;

async function createTransaction(fromAddress, privateKeyWIF, toAddress, amountSatoshis, feeSatoshis, utxos, rbf = false) {
    const keyPair = bitcoin.ECPair.fromWIF(privateKeyWIF, network);
    const psbt = new bitcoin.Psbt({ network: network });
    
    // Sort UTXOs by confirmation count to prioritize confirmed UTXOs
    utxos.sort((a, b) => b.confirmations - a.confirmations);

    let totalInput = 0;
    for (let utxo of utxos) {
        totalInput += utxo.value;
    }

    // Adjusting amount if it's equal to the total balance
    if (totalInput === amountSatoshis + feeSatoshis) {
        amountSatoshis -= feeSatoshis;
    }

    // When the amount + fee is greater than the balance, send the maximum possible amount (totalInput - fee)
    if (amountSatoshis + feeSatoshis > totalInput) {
        amountSatoshis = totalInput - feeSatoshis;
    }

    let change = totalInput - amountSatoshis - feeSatoshis;
    if (change < 0) {
        console.error('Not enough balance to complete this transaction.');
        return;
    }
    
    for (let utxo of utxos) {
        const input = {
            hash: utxo.txid,
            index: utxo.vout,
            sequence: rbf ? 0xfffffffd : 0xffffffff,
        };

        if (fromAddress.startsWith('bc1')) {
            // Handling for bech32 (SegWit) addresses
            const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
            input.witnessUtxo = {
                script: p2wpkh.output,
                value: utxo.value
            };
        } else if (fromAddress.startsWith('1')) {
            // Handling for Pay-to-Public-Key-Hash (P2PKH) addresses
            const txResult = await helpers.fetchTransaction(utxo.txid);
            if (!txResult || !txResult.data) {
                console.error(`Failed to fetch raw transaction data for txid: ${utxo.txid}`);
                continue;
            }
            input.nonWitnessUtxo = Buffer.from(txResult.data, 'hex');
        } else if (fromAddress.startsWith('3')) {
            // Handling for Pay-to-Script-Hash (P2SH) addresses, specifically P2SH-P2WPKH
            const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
            const p2sh = bitcoin.payments.p2sh({
                redeem: p2wpkh,
                network
            });
        
            input.witnessUtxo = {
                script: p2wpkh.output,
                value: utxo.value
            };
            input.redeemScript = p2sh.redeem.output;
        }         

        psbt.addInput(input);
    }

    // Add recipient output
    psbt.addOutput({
        address: toAddress,
        value: amountSatoshis
    });

    // Add change output
    if (change > 0 && change > 546) { // 546 satoshis is the dust limit
        psbt.addOutput({
            address: fromAddress,
            value: change
        });
    }

    psbt.signAllInputs(keyPair);

    psbt.finalizeAllInputs();

    const transaction = psbt.extractTransaction();
    const hex = transaction.toHex();

    return {
        transactionHex: hex,
        size: transaction.byteLength(),
        virtualSize: transaction.virtualSize()
    };
}

module.exports = async (req, res) => {
    try {
        const { fromAddress, privateKeyWIF, toAddress, amountSatoshis, feeSatoshis, rbf, broadcast } = req.body;

        if (typeof fromAddress !== 'string') throw new Error("fromAddress must be a string");
        if (typeof privateKeyWIF !== 'string') throw new Error("privateKeyWIF must be a string");
        if (typeof toAddress !== 'string') throw new Error("toAddress must be a string");
        if (typeof amountSatoshis !== 'number') throw new Error("amountSatoshis must be a number");
        if (typeof feeSatoshis !== 'number') throw new Error("feeSatoshis must be a number");
        if (rbf !== undefined && typeof rbf !== 'boolean') throw new Error("rbf must be a boolean");
        if (broadcast !== undefined && typeof broadcast !== 'boolean') throw new Error("broadcast must be a boolean");

        let utxos;
        try {
            utxos = await helpers.getUTXOs(fromAddress);
        } catch (err) {
            throw new Error(`Error fetching UTXOs: ${err.message}`);
        }

        let result;
        try {
            result = await createTransaction(fromAddress, privateKeyWIF, toAddress, amountSatoshis, feeSatoshis, utxos, rbf);
        } catch (err) {
            throw new Error(`Error creating transaction: ${err.message}`);
        }

        if (broadcast) {
            let broadcastResult;
            try {
                broadcastResult = await helpers.broadcastTransaction(result.transactionHex);
            } catch (err) {
                throw new Error(`Error broadcasting transaction: ${err.message}`);
            }
            if (broadcastResult.error) {
                res.status(broadcastResult.status).send({ error: 'Failed to broadcast the transaction.' });
                return;
            }
            result.broadcastResult = broadcastResult.data;
        }

        res.status(200).send(result);
    } catch (error) {
        console.error('Detailed Error:', error.message);
        console.error(error.stack);
        res.status(500).send({ error: `Failed to process transaction: ${error.message}` });
    }
};