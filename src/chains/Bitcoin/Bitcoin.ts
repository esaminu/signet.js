import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'

import { ChainSignaturesContract } from '../../signature'
import {
  fetchBTCFeeProperties,
  fetchBTCUTXOs,
  fetchDerivedBTCAddressAndPublicKey,
  parseBTCNetwork,
} from './utils'
import { type ChainSignatureContracts, type NearAuthentication } from '../types'
import { type KeyDerivationPath } from '../../kdf/types'
import {
  type BTCNetworkIds,
  type BTCTransaction,
  type UTXO,
  type BTCOutput,
  type Transaction,
} from './types'

export class Bitcoin {
  private readonly network: BTCNetworkIds

  private readonly providerUrl: string

  private readonly relayerUrl?: string

  private readonly contract: ChainSignatureContracts

  constructor(config: {
    network: BTCNetworkIds
    providerUrl: string
    relayerUrl?: string
    contract: ChainSignatureContracts
  }) {
    this.network = config.network
    this.providerUrl = config.providerUrl
    this.relayerUrl = config.relayerUrl
    this.contract = config.contract
  }

  /**
   * Converts a value from satoshis to bitcoins.
   *
   * @param {number} satoshis - The amount in satoshis to convert.
   * @returns {number} The equivalent amount in bitcoins.
   */
  static toBTC(satoshis: number): number {
    return satoshis / 100000000
  }

  /**
   * Converts a value from bitcoins to satoshis.
   *
   * @param {number} btc - The amount in bitcoins to convert.
   * @returns {number} The equivalent amount in satoshis.
   */
  static toSatoshi(btc: number): number {
    return Math.round(btc * 100000000)
  }

  /**
   * Fetches the balance for a given Bitcoin address.
   *
   * @param {string} address - The Bitcoin address for which to fetch the balance.
   * @returns {Promise<string>} A promise that resolves to the balance of the address as a string.
   */
  async fetchBalance(address: string): Promise<string> {
    const utxos = await fetchBTCUTXOs(this.providerUrl, address)
    return Bitcoin.toBTC(
      utxos.reduce((acc, utxo) => acc + utxo.value, 0)
    ).toString()
  }

  /**
   * Fetches a Bitcoin transaction by its ID and constructs a transaction object.
   *
   * @param {string} transactionId - The ID of the transaction to fetch.
   * @returns {Promise<bitcoin.Transaction>} A promise that resolves to a bitcoin.Transaction object representing the fetched transaction.
   */
  async fetchTransaction(transactionId: string): Promise<bitcoin.Transaction> {
    const { data } = await axios.get<Transaction>(
      `${this.providerUrl}tx/${transactionId}`
    )
    const tx = new bitcoin.Transaction()

    tx.version = data.version
    tx.locktime = data.locktime

    data.vin.forEach((vin) => {
      const txHash = Buffer.from(vin.txid, 'hex').reverse()
      const { vout, sequence } = vin
      const scriptSig = vin.scriptsig
        ? Buffer.from(vin.scriptsig, 'hex')
        : undefined
      tx.addInput(txHash, vout, sequence, scriptSig)
    })

    data.vout.forEach((vout) => {
      const { value } = vout
      const scriptPubKey = Buffer.from(vout.scriptpubkey, 'hex')
      tx.addOutput(scriptPubKey, value)
    })

    data.vin.forEach((vin, index) => {
      if (vin.witness && vin.witness.length > 0) {
        const witness = vin.witness.map((w) => Buffer.from(w, 'hex'))
        tx.setWitness(index, witness)
      }
    })

    return tx
  }

  /**
   * Joins the r and s components of a signature into a single Buffer.
   *
   * @param {Object} signature - An object containing the r and s components of a signature.
   * @param {string} signature.r - The r component of the signature.
   * @param {string} signature.s - The s component of the signature.
   * @returns {Buffer} A Buffer representing the concatenated r and s components of the signature.
   * @throws {Error} Throws an error if the resulting Buffer is not exactly 64 bytes long.
   */
  static joinSignature(signature: { r: string; s: string }): Buffer {
    const r = signature.r.padStart(64, '0')
    const s = signature.s.padStart(64, '0')

    const rawSignature = Buffer.from(r + s, 'hex')

    if (rawSignature.length !== 64) {
      throw new Error('Invalid signature length.')
    }

    return rawSignature
  }

  /**
   * Sends a signed transaction to the Bitcoin network.
   *
   * @param {string} txHex - The hexadecimal string of the signed transaction.
   * @param {Object} [options] - Optional parameters.
   * @param {boolean} [options.proxy=false] - Whether to use a proxy URL for the transaction broadcast.
   * @returns {Promise<string>} A promise that resolves with the txid once the transaction is successfully broadcast.
   */
  async sendTransaction(
    txHex: string,
    options?: { proxy?: boolean }
  ): Promise<string | undefined> {
    try {
      const proxyUrl = options?.proxy ? 'https://corsproxy.io/?' : ''
      const response = await axios.post(
        `${proxyUrl}${this.providerUrl}tx`,
        txHex
      )

      if (response.status === 200) {
        return response.data
      }
      throw new Error(`Failed to broadcast transaction: ${response.data}`)
    } catch (error: unknown) {
      console.log(error)
      throw new Error(`Error broadcasting transaction`)
    }
  }

  /**
   * Handles the process of creating and broadcasting a Bitcoin transaction.
   *
   * @param {BTCTransaction} data - The transaction data.
   * @param {string} data.to - The recipient's Bitcoin address.
   * @param {string} data.value - The amount of Bitcoin to send (in BTC).
   * @param {NearAuthentication} nearAuthentication - The object containing the user's authentication information.
   * @param {string} path - The key derivation path for the account.
   * @returns {Promise<string>} A promise that resolves to the transaction ID once the transaction is successfully broadcast.
   */
  async handleTransaction(
    data: BTCTransaction,
    nearAuthentication: NearAuthentication,
    path: KeyDerivationPath
  ): Promise<string> {
    console.log('called handleTransaction')
    const { address, publicKey } = await fetchDerivedBTCAddressAndPublicKey({
      signerId: nearAuthentication.accountId,
      path,
      btcNetworkId: this.network,
      nearNetworkId: nearAuthentication.networkId,
      multichainContractId: this.contract,
    })

    const { inputs, outputs } =
      data.inputs && data.outputs
        ? data
        : await fetchBTCFeeProperties(this.providerUrl, address, [
            {
              address: data.to,
              value: Bitcoin.toSatoshi(parseFloat(data.value)),
            },
          ])

    const psbt = new bitcoin.Psbt({
      network: parseBTCNetwork(this.network),
    })

    // Since the sender address is always P2WPKH, we can assume all inputs are P2WPKH
    await Promise.all(
      inputs.map(async (utxo: UTXO) => {
        const transaction = await this.fetchTransaction(utxo.txid)
        const prevOut = transaction.outs[utxo.vout]
        const value = utxo.value

        // Prepare the input as P2WPKH
        const inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: prevOut.script,
            value,
          },
        }

        psbt.addInput(inputOptions)
      })
    )

    outputs.forEach((out: BTCOutput) => {
      if ('script' in out) {
        psbt.addOutput({
          script: out.script,
          value: out.value,
        })
      } else {
        psbt.addOutput({
          address: out.address || address,
          value: out.value,
        })
      }
    })

    const mpcKeyPair = {
      publicKey,
      sign: async (hash: Buffer): Promise<Buffer> => {
        const signature = await ChainSignaturesContract.sign({
          transactionHash: hash,
          path,
          nearAuthentication,
          contract: this.contract,
          relayerUrl: this.relayerUrl,
        })

        if (!signature) {
          throw new Error('Failed to sign transaction')
        }

        return Bitcoin.joinSignature(signature)
      },
    }

    // Sign inputs sequentially
    for (let index = 0; index < inputs.length; index += 1) {
      await psbt.signInputAsync(index, mpcKeyPair)
    }

    psbt.finalizeAllInputs()
    const txid = await this.sendTransaction(psbt.extractTransaction().toHex(), {
      proxy: true,
    })

    if (txid) {
      return txid
    }
    throw new Error('Failed to broadcast transaction')
  }
}
