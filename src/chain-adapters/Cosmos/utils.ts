import { chains, assets } from 'chain-registry'

import { type ChainInfo } from '@chain-adapters/Cosmos/types'

export const fetchChainInfo = async (chainId: string): Promise<ChainInfo> => {
  const chainInfo = chains.find((chain) => chain.chain_id === chainId)
  if (!chainInfo) {
    throw new Error(`Chain info not found for chainId: ${chainId}`)
  }

  const { bech32_prefix: prefix, chain_id: expectedChainId } = chainInfo
  const denom = chainInfo.staking?.staking_tokens?.[0]?.denom
  const rpcUrl = chainInfo.apis?.rpc?.[0]?.address
  const restUrl = chainInfo.apis?.rest?.[0]?.address
  const gasPrice = chainInfo.fees?.fee_tokens?.[0]?.average_gas_price

  if (
    !prefix ||
    !denom ||
    !rpcUrl ||
    !restUrl ||
    !expectedChainId ||
    gasPrice === undefined
  ) {
    throw new Error(
      `Missing required chain information for ${chainInfo.chain_name}`
    )
  }

  const assetList = assets.find(
    (asset) => asset.chain_name === chainInfo.chain_name
  )
  const asset = assetList?.assets.find((asset) => asset.base === denom)
  const decimals = asset?.denom_units.find(
    (unit) => unit.denom === asset.display
  )?.exponent

  if (decimals === undefined) {
    throw new Error(
      `Could not find decimals for ${denom} on chain ${chainInfo.chain_name}`
    )
  }

  return { prefix, denom, rpcUrl, restUrl, expectedChainId, gasPrice, decimals }
}
