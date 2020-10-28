import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Contract as EthersContract, utils as EthersUtils } from 'ethers'
import environment from 'lib/environment'
import { getKnownContract, getKnownAbi } from './known-contracts'
import { useWalletAugmented } from './wallet'
import { bigNum } from './utils'

import { collateral, bonded } from '../config'

// See https://fundraising.aragon.black/components/bonding-curve#pricing-algorithm
const MAINNET_CONNECTOR_WEIGHT = 250000
const RINKEBY_CONNECTOR_WEIGHT = 33333
const RETRY_EVERY = 1000

const connectorWeights = new Map([
  ['MAINNET_CONNECTOR_WEIGHT', MAINNET_CONNECTOR_WEIGHT],
  ['RINKEBY_CONNECTOR_WEIGHT', RINKEBY_CONNECTOR_WEIGHT],
])
const contractsCache = new Map()
const tokenDecimals = new Map([
  [collateral.symbol, collateral.decimals],
  [bonded.symbol, bonded.decimals],
])

function getConnectorWeight() {
  const chainId = environment('CHAIN_ID')
  return connectorWeights.get(
    chainId === '1' ? 'MAINNET_CONNECTOR_WEIGHT' : 'RINKEBY_CONNECTOR_WEIGHT'
  )
}

export function useContract(address, abi, signer = true) {
  const { ethersProvider } = useWalletAugmented()

  if (!address || !ethersProvider) {
    return null
  }
  if (contractsCache.has(address)) {
    return contractsCache.get(address)
  }

  const contract = new EthersContract(
    address,
    abi,
    signer ? ethersProvider.getSigner() : ethersProvider
  )

  contractsCache.set(address, contract)

  return contract
}

export function useKnownContract(name, signer = true) {
  const [address, abi] = getKnownContract(name)
  return useContract(address, abi, signer)
}

export function useTokenDecimals(symbol) {
  return tokenDecimals.get(symbol)
}

export function useTokenBalance(symbol, address = '') {
  const { account } = useWalletAugmented()
  const [balance, setBalance] = useState(bigNum(-1))
  const tokenContract = useKnownContract(collateral.symbol === symbol ? 'COLLATERAL_TOKEN' : 'BONDED_TOKEN')

  const cancelBalanceUpdate = useRef(null)

  const updateBalance = useCallback(() => {
    let cancelled = false

    if (cancelBalanceUpdate.current) {
      cancelBalanceUpdate.current()
      cancelBalanceUpdate.current = null
    }

    if ((!account && !address) || !tokenContract) {
      setBalance(bigNum(-1))
      return
    }

    cancelBalanceUpdate.current = () => {
      cancelled = true
    }
    const requestedAddress = address || account
    tokenContract.balanceOf(requestedAddress).then(balance => {
      if (!cancelled) {
        setBalance(balance)
      }
    })
  }, [account, address, tokenContract])

  useEffect(() => {
    // Always update the balance if updateBalance() has changed
    updateBalance()

    if ((!account && !address) || !tokenContract) {
      return
    }

    const onTransfer = (from, to, value) => {
      if (
        from === account ||
        to === account ||
        from === address ||
        to === address
      ) {
        updateBalance()
      }
    }
    tokenContract.on('Transfer', onTransfer)

    return () => {
      tokenContract.removeListener('Transfer', onTransfer)
    }
  }, [account, address, tokenContract, updateBalance])

  return balance
}

export function useBondingCurvePrice(amount, forwards = true) {
  const [loading, setLoading] = useState(false)
  const [price, setPrice] = useState(bigNum(-1))
  const bondedContract = useKnownContract('BONDED_TOKEN')
  const bancorContract = useKnownContract('BANCOR_FORMULA')

  const [treasuryAddress] = getKnownContract('BONDING_CURVE_TREASURY')
  const collateralTreasuryBalance = useTokenBalance(collateral.symbol, treasuryAddress)
  const connectorWeight = getConnectorWeight()
  useEffect(() => {
    let cancelled = false
    let retryTimer

    if (!bondedContract || collateralTreasuryBalance.eq(-1) || !bancorContract) {
      return
    }

    const getSalePrice = async () => {
      try {
        setLoading(true)
        const bondedTotalSupply = await bondedContract.totalSupply()
        const salePrice = await (forwards
          ? bancorContract.calculatePurchaseReturn(
              bondedTotalSupply,
              collateralTreasuryBalance,
              connectorWeight,
              amount
            )
          : bancorContract.calculateSaleReturn(
              bondedTotalSupply,
              collateralTreasuryBalance,
              connectorWeight,
              amount
            ))
        if (!cancelled) {
          setLoading(false)
          setPrice(salePrice)
        }
      } catch (err) {
        if (!cancelled) {
          retryTimer = setTimeout(getSalePrice, RETRY_EVERY)
        }
      }
    }

    getSalePrice()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [
    amount,
    bondedContract,
    collateralTreasuryBalance,
    bancorContract,
    connectorWeight,
    forwards,
  ])

  return useMemo(() => ({ loading, price }), [loading, price])
}

export function useAllowance() {
  const { account } = useWalletAugmented()
  const collateralContract = useKnownContract('COLLATERAL_TOKEN')
  const [marketMakerAddress] = getKnownContract('MARKET_MAKER')

  return useCallback(async () => {
    try {
      if (!collateralContract) {
        throw new Error('Collateral token contract not loaded')
      }

      return await collateralContract.allowance(account, marketMakerAddress)
    } catch (err) {
      throw new Error(err.message)
    }
  }, [account, collateralContract, marketMakerAddress])
}

export function useApprove() {
  const collateralContract = useKnownContract('COLLATERAL_TOKEN')
  const [marketMakerAddress] = getKnownContract('MARKET_MAKER')

  return useCallback(
    async amount => {
      try {
        if (!collateralContract) {
          throw new Error('Collateral token contract not loaded')
        }

        return await collateralContract.approve(marketMakerAddress, amount)
      } catch (err) {
        throw new Error(err.message)
      }
    },
    [collateralContract, marketMakerAddress]
  )
}

// Convert collateral to bonded token action
export function useOpenOrder() {
  const fundraisingContract = useKnownContract('FUNDRAISING')
  const [collateralAddress] = getKnownContract('COLLATERAL_TOKEN')

  return useCallback(
    async (amount, toBonded = true) => {
      try {
        if (!fundraisingContract) {
          throw new Error('Fundraising contract not loaded')
        }

        return await (toBonded
          ? fundraisingContract.openBuyOrder(collateralAddress, amount, {
              gasLimit: 650000,
              value: 0,
            })
          : fundraisingContract.openSellOrder(collateralAddress, amount, {
              gasLimit: 850000,
            }))
      } catch (err) {
        throw new Error(err.message)
      }
    },
    [collateralAddress, fundraisingContract]
  )
}

export function useClaimOrder() {
  const { account, ethersProvider } = useWalletAugmented()
  const fundraisingContract = useKnownContract('FUNDRAISING')
  const [collateralAddress] = getKnownContract('COLLATERAL_TOKEN')

  return useCallback(
    async (openOrderTransactionHash, toBonded = true) => {
      try {
        if (!fundraisingContract) {
          throw new Error('Fundraising contract error')
        }

        const { blockNumber: batchId } = await ethersProvider.getTransaction(
          openOrderTransactionHash
        )

        // We claim the buy order, with the blockNumber of the emitted open order
        return await (toBonded
          ? fundraisingContract.claimBuyOrder(account, batchId, collateralAddress, {
              gasLimit: 500000,
            })
          : fundraisingContract.claimSellOrder(account, batchId, collateralAddress, {
              gasLimit: 500000,
            }))
      } catch (err) {
        throw new Error(err)
      }
    },
    [account, collateralAddress, ethersProvider, fundraisingContract]
  )
}

export function useClaimOrderReceiptAmount() {
  const { ethersProvider } = useWalletAugmented()

  return useCallback(
    async hash => {
      const abi = getKnownAbi('COLLATERAL_TOKEN')
      const abiInterface = new EthersUtils.Interface(abi)

      try {
        const transactionReceipt = await ethersProvider.getTransactionReceipt(
          hash
        )

        const parsedTransferLog = abiInterface.parseLog(
          transactionReceipt.logs[0]
        )

        const amount = parsedTransferLog.values.amount

        return amount ? bigNum(amount) : null
      } catch (err) {
        throw new Error(err)
      }
    },
    [ethersProvider]
  )
}
