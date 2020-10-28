import { utils as EthersUtils } from 'ethers'
import env from './environment'

export function getEtherscanHref(transactionHash) {
  const chainId = env('CHAIN_ID')

  return `https://${
    chainId === '4' ? 'rinkeby.' : ''
  }etherscan.io/tx/${transactionHash}`
}

export function bigNum(value) {
  return new EthersUtils.BigNumber(value)
}
