import { Bitcoin } from './chains/Bitcoin/Bitcoin'
import { type BitcoinRequest } from './chains/Bitcoin/types'
import { type CosmosRequest } from './chains/Cosmos/types'
import { Cosmos } from './chains/Cosmos/Cosmos'
import { EVM } from './chains/EVM/EVM'
import { type EVMRequest } from './chains/EVM/types'
import { type Response } from './chains/types'
import { ChainSignaturesContract } from './signature/ChainSignaturesContract/ChainSignaturesContract'
import { type KeyPair } from '@near-js/crypto'

export const signAndSendEVMTransaction = async (
  req: EVMRequest,
  keyPair: KeyPair
): Promise<Response> => {
  try {
    const evm = new EVM(req.chainConfig)

    const { txSerialized, mpcPayloads } =
      await evm.getMPCPayloadAndTxSerialized({
        data: req.transaction,
        nearAuthentication: req.nearAuthentication,
        path: req.derivationPath,
      })

    const signature = await ChainSignaturesContract.sign({
      hashedTx: mpcPayloads[0].payload,
      path: req.derivationPath,
      nearAuthentication: req.nearAuthentication,
      contract: req.chainConfig.contract,
      relayerUrl: req.fastAuthRelayerUrl,
      keypair: keyPair,
    })

    const txHash = await evm.reconstructAndSendTransaction({
      txSerialized,
      mpcSignatures: [signature],
    })

    return {
      transactionHash: txHash,
      success: true,
    }
  } catch (e: unknown) {
    console.error(e)
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    }
  }
}

export const signAndSendBTCTransaction = async (
  req: BitcoinRequest,
  keyPair: KeyPair
): Promise<Response> => {
  try {
    const btc = new Bitcoin(req.chainConfig)

    const { txSerialized, mpcPayloads } =
      await btc.getMPCPayloadAndTxSerialized({
        data: req.transaction,
        nearAuthentication: req.nearAuthentication,
        path: req.derivationPath,
      })

    const signatures = await Promise.all(
      mpcPayloads.map(
        async ({ payload }) =>
          await ChainSignaturesContract.sign({
            hashedTx: payload,
            path: req.derivationPath,
            nearAuthentication: req.nearAuthentication,
            contract: req.chainConfig.contract,
            relayerUrl: req.fastAuthRelayerUrl,
            keypair: keyPair,
          })
      )
    )

    const txHash = await btc.reconstructAndSendTransaction({
      nearAuthentication: req.nearAuthentication,
      path: req.derivationPath,
      mpcSignatures: signatures,
      txSerialized,
    })

    return {
      transactionHash: txHash,
      success: true,
    }
  } catch (e: unknown) {
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    }
  }
}

export const signAndSendCosmosTransaction = async (
  req: CosmosRequest,
  keyPair: KeyPair
): Promise<Response> => {
  try {
    const cosmos = new Cosmos(req.chainConfig)

    const { txSerialized, mpcPayloads } =
      await cosmos.getMPCPayloadAndTxSerialized({
        data: req.transaction,
        nearAuthentication: req.nearAuthentication,
        path: req.derivationPath,
      })

    const signatures = await Promise.all(
      mpcPayloads.map(
        async ({ payload }) =>
          await ChainSignaturesContract.sign({
            hashedTx: payload,
            path: req.derivationPath,
            nearAuthentication: req.nearAuthentication,
            contract: req.chainConfig.contract,
            relayerUrl: req.fastAuthRelayerUrl,
            keypair: keyPair,
          })
      )
    )

    const txHash = await cosmos.reconstructAndSendTransaction({
      data: req.transaction,
      nearAuthentication: req.nearAuthentication,
      path: req.derivationPath,
      txSerialized,
      mpcSignatures: signatures,
    })

    return {
      transactionHash: txHash,
      success: true,
    }
  } catch (e: unknown) {
    console.error(e)
    return {
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    }
  }
}
