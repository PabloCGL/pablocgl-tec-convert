import { useState, useEffect, useCallback, useMemo } from 'react'
import { bigNum } from 'lib/utils'
import { useBondingCurvePrice, useTokenDecimals, getTributePcts } from 'lib/web3-contracts'
import { formatUnits, parseUnits } from 'lib/web3-utils'

import { bonded } from '../../config'

// Filters and parse the input value of a token amount.
// Returns a BN.js instance and the filtered value.
function parseInputValue(inputValue, decimals) {
  if (decimals === -1) {
    return null
  }

  inputValue = inputValue.trim()

  // amount is the parsed value (BN.js instance)
  const amount = parseUnits(inputValue, { digits: decimals })

  if (amount.lt(0)) {
    return null
  }

  return { amount, inputValue }
}


/*TO DO: implement Min return value parsing.
    probably the best thing is to build getAmountReceived and getMinimumWithSlippage into this function
    and keep the code in web3-contracts to a minimum (mainly the parts that actually interact with the contracts!)
    most of the logic will probably be in the useEffect line 64.
    
    will have to return entryTribute, exitTribute, minimumWithSlippage (in bigNum and "pretty") and estimatedAmountReceived(this one only in "pretty") in some formatting or another 

  entry/exit already implemented, seems to work
*/
export function useConvertInputs(otherSymbol, toBonded = true) {
  const [inputValueRecipient, setInputValueRecipient] = useState('')
  const [inputValueSource, setInputValueSource] = useState('0.0')
  const [inputMinWithSlippage, setInputMinWithSlippage]= useState('')
  const [inputEstimatedReceived, setInputEstimatedReceived] = useState('')
  const [amountRecipient, setAmountRecipient] = useState(bigNum(0))
  const [amountSource, setAmountSource] = useState(bigNum(0))
  const [amountMinWithSlippage, setAmountMinWithSlippage]= useState(bigNum(0))
  const [editing, setEditing] = useState(null)
  const {
    loading: bondingPriceLoading,
    price: bondingCurvePrice,
  } = useBondingCurvePrice(amountSource, toBonded)
  const bondedDecimals = useTokenDecimals(bonded.symbol)
  const otherDecimals = useTokenDecimals(otherSymbol)
  const [entryTribute, exitTribute] = getTributePcts() 

  // convertFromBonded is used as a toggle to execute a conversion to or from Bonded.
  const [convertFromBonded, setConvertFromBonded] = useState(false)

  const resetInputs = useCallback(() => {
    setInputValueSource('')
    setInputValueRecipient('')
    setAmountRecipient(bigNum(0))
    setAmountSource(bigNum(0))
    setInputEstimatedReceived('')
    setAmountMinWithSlippage(bigNum(0))
    setInputMinWithSlippage('')
    setInputEstimatedReceived('')
  }, [])

  // Reset the inputs anytime the selected token changes
  useEffect(() => {
    resetInputs()
  }, [otherSymbol, resetInputs])

  // Calculate the Bonded amount from the other amount
  useEffect(() => {
    if (
      bondedDecimals === -1 ||
      otherDecimals === -1 ||
      convertFromBonded ||
      bondingPriceLoading ||
      editing === 'bonded'
    ) {
      return
    }

    const amount = bondingCurvePrice

    let applicableTribute = (toBonded ? entryTribute : exitTribute)

    const maxSlippagePct = 1 //slippage hardcoded at 1% for now, can be made changeable in the future

    const estReceived = amount.mul(100 - applicableTribute).div(100)
    const receivedWithSlippage = estReceived.mul(100 - maxSlippagePct).div(100)

    setAmountRecipient(
      amount
    )
    setInputValueRecipient(
      formatUnits(amount, { digits: bondedDecimals, truncateToDecimalPlace: 8 })
    )
    setInputEstimatedReceived(
      formatUnits(estReceived, { digits: bondedDecimals, truncateToDecimalPlace: 8 })
    )
    setAmountMinWithSlippage(
      receivedWithSlippage
    )
    setInputMinWithSlippage(
      formatUnits(receivedWithSlippage, { digits: bondedDecimals, truncateToDecimalPlace: 8 })
    )

  }, [
    amountSource,
    bondedDecimals,
    bondingCurvePrice,
    bondingPriceLoading,
    convertFromBonded,
    editing,
    otherDecimals,
  ])

  // Alternate the comma-separated format, based on the fields focus state.
  const setEditModeOther = useCallback(
    editMode => {
      setEditing(editMode ? 'other' : null)
      setInputValueSource(
        formatUnits(amountSource, {
          digits: otherDecimals,
          commas: !editMode,
        })
      )
    },
    [amountSource, otherDecimals]
  )

  const setEditModeBonded = useCallback(
    editMode => {
      setEditing(editMode ? 'bonded' : null)
      setInputValueRecipient(
        formatUnits(amountRecipient, {
          digits: bondedDecimals,
          commas: !editMode,
        })
      )
    },
    [amountRecipient, bondedDecimals]
  )

  const handleOtherInputChange = useCallback(
    event => {
      setConvertFromBonded(false)

      if (otherDecimals === -1) {
        return
      }

      const parsed = parseInputValue(event.target.value, otherDecimals)
      if (parsed !== null) {
        setInputValueSource(parsed.inputValue)
        setAmountSource(parsed.amount)
      }
    },
    [otherDecimals]
  )

  const handleBondedInputChange = useCallback(
    event => {
      setConvertFromBonded(true)

      if (bondedDecimals === -1) {
        return
      }

      const parsed = parseInputValue(event.target.value, bondedDecimals)
      if (parsed !== null) {
        setInputValueRecipient(parsed.inputValue)
        setAmountRecipient(parsed.amount)
      }
    },
    [bondedDecimals]
  )

  const handleManualInputChange = useCallback(
    amount => {
      if (otherDecimals === -1) {
        return
      }

      const parsed = parseInputValue(amount, otherDecimals)
      if (parsed !== null) {
        setInputValueSource(parsed.inputValue)
        setAmountSource(parsed.amount)
      }
    },
    [otherDecimals]
  )

  const bindOtherInput = useMemo(
    () => ({
      onChange: handleOtherInputChange,
      onBlur: () => setEditModeOther(false),
      onFocus: () => setEditModeOther(true),
    }),
    [setEditModeOther, handleOtherInputChange]
  )

  const bindBondedInput = useMemo(
    () => ({
      onChange: handleBondedInputChange,
      onBlur: () => setEditModeBonded(false),
      onFocus: () => setEditModeBonded(true),
    }),
    [setEditModeBonded, handleBondedInputChange]
  )

  return {
    // The parsed amounts
    amountSource,
    amountRecipient,
    amountMinWithSlippage,
    entryTribute,
    exitTribute,
    // Event handlers to bind the inputs
    bindOtherInput,
    bindBondedInput,
    bondingPriceLoading,
    handleManualInputChange,
    // The value to be used for inputs
    inputValueRecipient,
    inputValueSource,
    inputEstimatedReceived,
    inputMinWithSlippage,
    resetInputs,    
  }
}
